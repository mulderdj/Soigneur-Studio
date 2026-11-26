// @ts-check
//
// A .zwo workout read without a DOM (the app's reader needs DOMParser): the
// same {meta, intervals: [{duration, steps: [{duration, power, cadence?}]}]}
// as zwo.readToInterval, for the steps the app writes and intervals.icu sends.
// Power is relative to FTP; ramps are 10 s steps, like the app's.
//

const RAMP_STEP = 10;

function attrs(tag) {
    const out = {};
    for(const m of tag.matchAll(/([A-Za-z_]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)) out[m[1].toLowerCase()] = m[2] ?? m[3] ?? '';
    return out;
}

const num = (x) => (x === undefined || x === '' ? null : Number(x));
const r2 = (x) => Math.round(x * 100) / 100;

function text(xml, name) {
    const m = xml.match(new RegExp(`<${name}\\b[^>]*>([\\s\\S]*?)</${name}>`, 'i'));
    return m ? m[1].trim().replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&') : null;
}

function extra(a, step) {
    const cadence = num(a.cadence);
    if(Number.isFinite(cadence)) step.cadence = cadence;
    if(a.slopetarget !== undefined) step.slopetarget = a.slopetarget;
    return step;
}

function ramp(duration, from, to, a) {
    const n = Math.max(1, Math.floor(duration / RAMP_STEP));
    const each = n === 1 ? duration : RAMP_STEP;
    const rem = n === 1 ? 0 : duration - n * RAMP_STEP;
    const steps = Array.from({length: n}, (_, i) =>
        extra(a, {duration: i === n - 1 ? each + rem : each, power: r2(n === 1 ? from : from + (to - from) * i / (n - 1))}));
    return {duration, steps};
}

function readWorkout(xml) {
    const body = text(xml, 'workout') ?? '';
    const intervals = [];
    for(const m of body.matchAll(/<(Warmup|Cooldown|Ramp|SteadyState|IntervalsT|FreeRide|MaxEffort)\b([^>]*?)\/?>/gi)) {
        const tag = m[1].toLowerCase(), a = attrs(m[2]);
        const duration = num(a.duration) ?? 0;
        if(tag === 'steadystate') {
            intervals.push({duration, steps: [extra(a, {duration, power: num(a.power) ?? 0})]});
        } else if(tag === 'warmup' || tag === 'ramp') {
            intervals.push(ramp(duration, num(a.powerlow) ?? 0, num(a.powerhigh) ?? 0, a));
        } else if(tag === 'cooldown') {
            // as the app reads it: from PowerLow to PowerHigh (written high to low)
            intervals.push(ramp(duration, num(a.powerlow) ?? 0, num(a.powerhigh) ?? 0, a));
        } else if(tag === 'intervalst') {
            const n = Math.min(200, Math.max(0, num(a.repeat) ?? 1)), on = num(a.onduration) ?? 0, off = num(a.offduration) ?? 0;
            for(let i = 0; i < n; i++) {
                intervals.push({duration: on, steps: [extra({cadence: a.cadence}, {duration: on, power: num(a.onpower) ?? 0})]});
                if(off > 0) intervals.push({duration: off, steps: [extra({cadence: a.cadenceresting}, {duration: off, power: num(a.offpower) ?? 0})]});
            }
        } else {
            intervals.push({duration, steps: [{duration, slope: 0, power: 0}]});
        }
    }
    const meta = {
        name: text(xml, 'name') ?? 'Workout',
        category: text(xml, 'category') ?? null,
        description: text(xml, 'description') ?? null,
        duration: intervals.reduce((s, iv) => s + iv.duration, 0),
    };
    return {meta, intervals};
}

// --- writing: as the app's zwo.write(zwo.fromInterval(w)) ---------------------

const esc = x => String(x ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const sameish = (a, b) => Math.abs(a - b) < 1e-9;

const toFrac = (p, ftp) => {
    const v = Number(p);
    if(!Number.isFinite(v)) return 0;
    return v >= 10 && ftp > 0 ? Math.round((v / ftp) * 1000) / 1000 : v;
};

function writeInterval(iv, ftp = 250) {
    const steps = iv.steps ?? [];
    const first = steps[0] ?? {}, last = steps[steps.length - 1] ?? {};
    const cadence = Number.isFinite(first.cadence) ? ` Cadence="${first.cadence}"` : '';
    if(steps.length === 1 && Number.isFinite(first.slope) && !(first.power > 0)) return `<FreeRide Duration="${iv.duration}"${cadence}/>`;
    const p1 = toFrac(first.power ?? 0, ftp), p2 = toFrac(last.power ?? 0, ftp);
    if(steps.length > 1 && !sameish(p1, p2)) {
        const tag = p2 > p1 ? 'Warmup' : 'Cooldown';
        return `<${tag} Duration="${iv.duration}" PowerLow="${p1}" PowerHigh="${p2}"${cadence}/>`;
    }
    return `<SteadyState Duration="${iv.duration}" Power="${p1}"${cadence}/>`;
}

function writeWorkout(workout, ftp = 250) {
    const m = workout?.meta ?? {};
    const body = (workout?.intervals ?? []).map(iv => `        ${writeInterval(iv, ftp)}\n`).join('');
    return `<workout_file>
    <author>${esc(m.author ?? 'Soigneur AI')}</author>
    <name>${esc(m.name ?? 'Workout')}</name>
    <category>${esc(m.category ?? 'AI')}</category>
    <description>${esc(m.description ?? '')}</description>
    <sportType>bike</sportType>
    <workout>
${body}    </workout>
</workout_file>`;
}

export { readWorkout, writeWorkout, ramp };
