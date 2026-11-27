// @ts-check
import { rideSummary } from '../training/summary.js';
import { addDays, dayToDate, daysBetween, weekStart } from '../training/dates.js';

function createPrng(seed) {
    let state = seed >>> 0;
    return () => {
        state = (state + 0x6d2b79f5) >>> 0;
        let t = Math.imul(state ^ (state >>> 15), 1 | state);
        t ^= t + Math.imul(t ^ (t >>> 7), 61 | t);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

/** @type {Record<string, { name: string, blocks: Array<[number, number]> }>} */
const SESSION_TEMPLATES = {
    recovery: { name: 'Recovery spin', blocks: [[2700, 0.5]] },
    endurance: { name: 'Endurance', blocks: [[600, 0.55], [3600, 0.68], [300, 0.5]] },
    sweetspot: { name: 'Sweet spot 2x20', blocks: [[900, 0.6], [1200, 0.9], [300, 0.5], [1200, 0.9], [600, 0.5]] },
    vo2: {
        name: 'VO2 max 5x4',
        blocks: [[900, 0.6], ...Array.from({ length: 5 }, () => /** @type {Array<[number, number]>} */ ([[240, 1.15], [240, 0.5]])).flat(), [600, 0.5]],
    },
    long: { name: 'Long ride', blocks: [[600, 0.55], [5100, 0.72], [1500, 0.84], [300, 0.5]] },
};

const WEEKLY_ROTATION = ['rest', 'vo2', 'endurance', 'sweetspot', 'recovery', 'long', 'endurance'];

function buildSeededWorkout(key) {
    const tpl = SESSION_TEMPLATES[key];
    return {
        id: `seed-${key}`,
        meta: {
            name: tpl.name,
            category: 'Generated',
            author: 'Soigneur Studio',
            description: '',
        },
        intervals: tpl.blocks.map(([duration, power]) => ({
            duration,
            steps: [{ duration, power }],
        })),
    };
}

function synthesizeSamples(key, ftp, rnd, fitnessProgress = 0.5) {
    const blocks = SESSION_TEMPLATES[key].blocks;
    const totalSeconds = blocks.reduce((sum, [dur]) => sum + dur, 0);
    const cardiacDrift = key === 'endurance' || key === 'long' ? 0.075 - 0.04 * fitnessProgress : 0.02;

    const samples = [];
    let elapsed = 0;
    for (const [duration, relPower] of blocks) {
        for (let i = 0; i < duration; i++, elapsed++) {
            const power = Math.max(0, Math.round(ftp * relPower * (1 + (rnd() - 0.5) * 0.12)));
            const baseHr = 95 + 85 * relPower;
            const heartRate = Math.round(baseHr * (1 + cardiacDrift * (elapsed / totalSeconds)));
            samples.push({ power, heartRate, cadence: 88 });
        }
    }
    return samples;
}

/** @param {{ today?: string, days?: number, ftp?: number, weight?: number, seed?: number }} [opts] */
function generateHistory({ today = '', days = 120, ftp = 250, weight = 75, seed = 1 } = {}) {
    const rnd = createPrng(seed);
    const startDay = addDays(today, -(days - 1));
    const summaries = [];

    for (let offset = 0; offset < days; offset++) {
        const day = addDays(startDay, offset);
        const weekday = (dayToDate(day).getDay() + 6) % 7;
        const weekNumber = Math.floor(daysBetween(weekStart(startDay), weekStart(day)) / 7);
        const isRecoveryWeek = weekNumber % 4 === 3;

        let sessionKey = WEEKLY_ROTATION[weekday];
        if (sessionKey === 'rest') continue;
        if (isRecoveryWeek && (sessionKey === 'vo2' || sessionKey === 'long')) {
            sessionKey = 'endurance';
        }
        if (rnd() < 0.12) continue;

        const dayFtp = Math.round(ftp - 15 + 15 * (offset / days));
        const startMs = dayToDate(day).getTime() + 6 * 3600 * 1000 + Math.round(rnd() * 3600) * 1000;
        summaries.push(
            rideSummary(synthesizeSamples(sessionKey, dayFtp, rnd, offset / days), {
                id: `seed-${day}`,
                start: startMs,
                name: SESSION_TEMPLATES[sessionKey].name,
                workoutId: `seed-${sessionKey}`,
                ftp: dayFtp,
                weight,
                distance: null,
            }),
        );
    }

    const completedDays = new Set(summaries.map(s => s.day));
    /** @type {any[]} */
    const plan = [];

    for (let offset = -6; offset <= 21; offset++) {
        const day = addDays(today, offset);
        const sessionKey = WEEKLY_ROTATION[(dayToDate(day).getDay() + 6) % 7];
        if (sessionKey === 'rest') continue;

        const completed = offset < 0 && completedDays.has(day);
        if (offset < 0 && !completed && rnd() < 0.3) continue;

        plan.push({
            id: `seed-plan-${day}`,
            day,
            workout: buildSeededWorkout(sessionKey),
            rideId: completed ? `seed-${day}` : null,
            deleted: false,
            updatedAt: 0,
            dirty: false,
        });
    }

    const todayPlan = plan.find(entry => entry.day === today);
    if (todayPlan) {
        todayPlan.workout = buildSeededWorkout('vo2');
    } else {
        plan.push({
            id: `seed-plan-${today}`,
            day: today,
            workout: buildSeededWorkout('vo2'),
            rideId: null,
            deleted: false,
            updatedAt: 0,
            dirty: false,
        });
    }

    if (!plan.some(entry => entry.day < today && !entry.rideId)) {
        const missedDay = addDays(today, -7);
        plan.push({
            id: `seed-plan-${missedDay}`,
            day: missedDay,
            workout: buildSeededWorkout('endurance'),
            rideId: null,
            deleted: false,
            updatedAt: 0,
            dirty: false,
        });
    }

    const bGoalDay = addDays(weekStart(today), 13);
    const aGoalDay = addDays(weekStart(today), 27);
    const raceWeekMonday = weekStart(aGoalDay);

    for (const taperOffset of [2, 4]) {
        const taperDay = addDays(raceWeekMonday, taperOffset);
        if (taperDay > addDays(today, 21) && taperDay < aGoalDay) {
            plan.push({
                id: `seed-plan-${taperDay}`,
                day: taperDay,
                workout: buildSeededWorkout('recovery'),
                rideId: null,
                deleted: false,
                updatedAt: 0,
                dirty: false,
            });
        }
    }

    plan.push({
        id: 'seed-goal-b',
        day: bGoalDay,
        kind: 'event',
        event: {
            name: 'Winter Warm-Up Crit',
            priority: 'B',
            eventType: 'crit',
            targetDurationS: 3600,
            targetTss: 85,
            notes: 'Sharpener before the main fondo',
        },
        name: 'Winter Warm-Up Crit',
        workout: null,
        zwo: null,
        rideId: null,
        deleted: false,
        origin: 'soigneur',
        updatedAt: 0,
        dirty: false,
    });

    plan.push({
        id: 'seed-goal-a',
        day: aGoalDay,
        kind: 'event',
        event: {
            name: 'Solstice Gran Fondo',
            priority: 'A',
            eventType: 'gran-fondo',
            targetDurationS: 14400,
            targetTss: 240,
            notes: '135 km hilly finale',
        },
        name: 'Solstice Gran Fondo',
        workout: null,
        zwo: null,
        rideId: null,
        deleted: false,
        origin: 'soigneur',
        updatedAt: 0,
        dirty: false,
    });

    const external = [];
    for (let week = 0; week < 4; week++) {
        const day = addDays(weekStart(today), -7 * week);
        if (day > today) continue;
        const duration = 2400 + Math.round(rnd() * 1800);
        external.push({
            version: 1,
            id: `icu-seed-run-${day}`,
            source: 'intervals',
            sport: 'run',
            day,
            name: 'Lunch run',
            start: dayToDate(day).getTime() + 12 * 3600 * 1000,
            duration,
            distance: duration * 2.8,
            tss: Math.round((duration / 3600) * 55),
            if: null,
            np: null,
            avgPower: null,
            kj: null,
            zoneSeconds: Array(7).fill(0),
            best: { 5: null, 60: null, 300: null, 1200: null, 3600: null },
            ftp: null,
            weight,
            workoutId: null,
            remote: { source: 'GARMIN_CONNECT', externalId: null },
            soigneurRideId: null,
        });
    }

    plan.push({
        id: 'seed-icu-1',
        day: addDays(today, 2),
        origin: 'intervals',
        intervalsEventId: 1,
        name: 'Threshold 3x10',
        workout: {
            ...buildSeededWorkout('sweetspot'),
            id: 'icu-ev-1',
            meta: { name: 'Threshold 3x10', category: 'intervals.icu' },
        },
        rideId: null,
        deleted: false,
        updatedAt: 0,
        dirty: false,
    });

    plan.push({
        id: 'seed-icu-2',
        day: addDays(today, 4),
        origin: 'intervals',
        intervalsEventId: 2,
        name: 'Strength circuit',
        workout: null,
        rideId: null,
        deleted: false,
        updatedAt: 0,
        dirty: false,
    });

    const garminBase = {
        if: null,
        np: null,
        avgPower: null,
        kj: null,
        zoneSeconds: Array(7).fill(0),
        best: { 5: null, 60: null, 300: null, 1200: null, 3600: null },
        ftp: null,
        weight,
        workoutId: null,
        soigneurRideId: null,
        version: 1,
        source: 'garmin',
        tss: null,
    };

    for (let week = 0; week < 4; week++) {
        const wed = addDays(weekStart(today), 2 - 7 * week);
        if (wed <= today) {
            external.push({
                ...garminBase,
                id: `garmin-seed-gym-${wed}`,
                sport: 'weighttraining',
                day: wed,
                name: 'Strength',
                start: dayToDate(wed).getTime() - 5 * 3600 * 1000,
                duration: 2700 + Math.round(rnd() * 900),
                distance: null,
                avgHr: null,
                maxHr: null,
                remote: { source: 'garmin', externalId: null },
            });
        }
        const thu = addDays(weekStart(today), 3 - 7 * week);
        if (thu <= today) {
            const duration = 2400 + Math.round(rnd() * 1500);
            external.push({
                ...garminBase,
                id: `garmin-seed-run-${thu}`,
                sport: 'run',
                day: thu,
                name: 'Easy run',
                start: dayToDate(thu).getTime() - 5 * 3600 * 1000,
                duration,
                distance: duration * 2.9,
                avgHr: 148 + Math.round(rnd() * 8),
                maxHr: 168,
                remote: { source: 'garmin', externalId: null },
            });
        }
    }

    const dailyTss = new Map(summaries.map(s => [s.day, s.tss]));
    const wellness = [];
    for (let offset = 89; offset >= 0; offset--) {
        const day = addDays(today, -offset);
        const afterHardDay = (dailyTss.get(addDays(day, -1)) ?? 0) > 80;
        const hrv = Math.round(58 + (rnd() - 0.5) * 10 - (afterHardDay ? 7 : 0));
        wellness.push({
            id: day,
            day,
            hrv,
            hrvWeekly: 58,
            hrvStatus: hrv < 52 ? 'UNBALANCED' : 'BALANCED',
            hrvBaseline: { low: 52, high: 65 },
            restingHr: Math.round(47 + (rnd() - 0.5) * 4 + (afterHardDay ? 2 : 0)),
            sleepSeconds: Math.round((7 + (rnd() - 0.5) * 1.5) * 3600),
            sleepScore: Math.round(62 + rnd() * 28),
            bodyBattery: Math.round(55 + rnd() * 40 - (afterHardDay ? 12 : 0)),
        });
    }

    Object.assign(wellness.at(-1), {
        hrv: 47,
        hrvStatus: 'UNBALANCED',
        sleepSeconds: 6.4 * 3600,
    });

    return {
        summaries,
        plan,
        external,
        wellness,
        thresholds: { cycling: 165, running: 172 },
    };
}

async function seedRideFiles(summaries, { ftp, weight, idb }) {
    const { fit } = await import('../fit/fit.js');
    const { rideSummary: buildSummary } = await import('../training/summary.js');
    const rnd = createPrng(7);

    const storeActivity = async (summary, records) => {
        const view = fit.localActivity.encode({ records, laps: [], events: [], ftp });
        await idb.put('activity', {
            id: summary.id,
            blob: new Blob([/** @type {BlobPart} */ (new Uint8Array(view.buffer, view.byteOffset, view.byteLength))]),
            summary: {
                name: summary.name,
                timestamp: summary.start + summary.duration * 1000,
                duration: summary.duration,
                workoutId: summary.workoutId,
            },
        });
    };

    const latestVo2 = [...summaries].reverse().find(s => s.workoutId === 'seed-vo2');
    if (latestVo2) {
        const samples = synthesizeSamples('vo2', latestVo2.ftp ?? ftp, rnd);
        await storeActivity(
            latestVo2,
            samples.map((sample, idx) => ({
                timestamp: latestVo2.start + idx * 1000,
                power: sample.power,
                heart_rate: sample.heartRate + Math.round(idx / 400),
                cadence: sample.cadence,
                speed: 9 + sample.power / 100,
                distance: idx * 10,
            })),
        );
    }

    const outdoorDay = summaries.at(-2)?.day ?? summaries.at(-1)?.day;
    const outdoorStart = new Date(`${outdoorDay}T09:00:00`).getTime();
    const outdoorRecords = [];
    let totalDist = 0;

    for (let t = 0; t < 7200; t += 4) {
        if (t >= 3600 && t < 3600 + 900) continue;
        const hill = Math.sin(t / 900);
        const speed = Math.max(3, 8.5 - hill * 4 + (rnd() - 0.5));
        totalDist += speed * 4;
        outdoorRecords.push({
            timestamp: outdoorStart + t * 1000,
            heart_rate: Math.round(128 + hill * 22 + t / 600),
            cadence: 82,
            speed,
            distance: totalDist,
            altitude: 320 + Math.round((1 - Math.cos(t / 900)) * 180),
        });
    }

    const outdoorSummary = {
        ...buildSummary(
            outdoorRecords.map(r => ({ power: 0, heartRate: r.heart_rate, cadence: r.cadence })),
            {
                id: `seed-outdoor-${outdoorDay}`,
                start: outdoorStart,
                name: 'Hills outdoors',
                ftp,
                weight,
                distance: totalDist,
            },
        ),
        duration: 7200 - 900,
    };

    await idb.put('rideSummaries', outdoorSummary);
    await storeActivity(outdoorSummary, outdoorRecords);
}

/** @param {{ ftp?: number, weight?: number }} [opts] */
async function seedHistory({ ftp = 250, weight = 75 } = {}) {
    const { history } = await import('../training/history.js');
    const { idb } = await import('../storage/idb.js');
    const { today } = await import('../training/dates.js');

    if ((await history.summaries()).length > 0) return false;

    const riderFtp = ftp || 250;
    const riderWeight = weight || 75;
    const generated = generateHistory({ today: today(), ftp: riderFtp, weight: riderWeight });

    for (const s of generated.summaries) await idb.put('rideSummaries', s);
    for (const r of generated.external) await idb.put('externalRides', r);
    for (const d of generated.wellness) await idb.put('wellness', d);

    const { thresholds } = await import('../training/rider-thresholds.js');
    thresholds.setGarmin(generated.thresholds);

    for (const entry of generated.plan) await idb.put('plan', entry);

    await seedRideFiles(generated.summaries, { ftp: riderFtp, weight: riderWeight, idb });
    await history.saveSummary(generated.summaries.at(-1));
    return true;
}

export { generateHistory, seedHistory };
