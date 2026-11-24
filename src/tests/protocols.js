//
// The built-in tests, as workouts the watch already runs. Power is a
// fraction of FTP; all-out steps are sim steps at 1 % ({slope: 1}), so the
// power is the rider's. Scored efforts carry `effort` (openers don't); the
// Ramp's ramp steps are one interval with `ramp: true`, so a lap moves on
// to the cool-down.
//
//   protocols()          → the five workouts (fresh copies)
//   protocol(test)       → one of them by meta.test
//   TEST_IDS             → {test: workout id}
//

const fmt = s => s >= 60 ? `${Math.floor(s / 60)} min${s % 60 ? ` ${s % 60} s` : ''}` : `${s} s`;

// a message at the step's start and one 10 s before its end
function messages(duration, start, end) {
    const out = [{offset: 0, message: start}];
    if(end && duration > 20) out.push({offset: duration - 10, message: end});
    return out;
}

function erg(duration, power, start, end) {
    return {duration, power, messages: messages(duration, start ?? `${fmt(duration)} easy`, end)};
}

function allOut(duration, effort, start, end) {
    const step = {duration, slope: 1, messages: messages(duration, start ?? `All out for ${fmt(duration)}!`, end ?? '10 s left: empty the tank')};
    if(effort) step.effort = effort;
    return step;
}

const single = step => ({duration: step.duration, steps: [step]});

function workout(test, name, subcategory, description, intervals) {
    return {
        id: `builtin-test-${test}`,
        meta: {
            name, category: 'Test', subcategory, author: 'Soigneur', description, test,
            sportType: 'bike',
            duration: intervals.reduce((a, i) => a + i.duration, 0),
        },
        intervals,
    };
}

const WARMUP = () => erg(600, 0.55, 'Warm up: 10 min easy', 'Warm-up ends in 10 s');
const PRIMERS = () => [0, 1, 2].flatMap(n => [
    single(erg(60, 1.0, `Primer ${n + 1} of 3: 1 min at threshold`)),
    single(erg(60, 0.5, '1 min easy')),
]);

function threeTwelve() {
    return workout('3-12', '3 + 12 min Test', 'CP and W′',
        'Two all-out efforts, 3 and 12 minutes, 30 minutes apart: your critical power (CP) and W′ from one session. Efforts in sim mode at 1 %: the power is yours. Pace the 3 min hard from the start; start the 12 min a little below what you think you can hold and finish strong.', [
        single(WARMUP()),
        ...[1, 2].flatMap(n => [
            single(allOut(10, null, `Opener ${n} of 2: 10 s sprint`)),
            single(erg(170, 0.5, 'Easy', n === 2 ? 'Next: 3 min steady' : 'Next: opener 2')),
        ]),
        single(erg(180, 0.6, '3 min steady', 'Next: 3 min all out')),
        single(allOut(180, 'p3', '3 min all out: start hard, hold on', '10 s left: everything')),
        single(erg(1800, 0.5, '30 min easy: recover fully', 'Next: 12 min all out')),
        single(allOut(720, 'p12', '12 min all out: start a little below your limit, build', '10 s left: everything')),
        single(erg(600, 0.45, 'Cool down: 10 min easy')),
    ]);
}

function ramp() {
    const steps = [];
    for(let k = 0; k <= 25; k++) {
        const power = Math.round((0.52 + 0.06 * k) * 100) / 100;
        steps.push({duration: 60, power, messages: [{offset: 0, message: `Step ${k + 1}: ${Math.round(power * 100)} % FTP — keep going`}]});
    }
    return workout('ramp', 'Ramp Test', 'FTP',
        'A 1-minute step up of 6 % FTP until you can’t hold the target. ERG mode sets the power. The test ends by itself when your power drops below half the target for 10 s. FTP = 75 % of your best minute.', [
        single(erg(300, 0.46, 'Warm up: 5 min easy', 'The ramp starts in 10 s')),
        {duration: steps.reduce((a, s) => a + s.duration, 0), ramp: true, steps},
        single(erg(600, 0.4, 'Cool down: 10 min easy')),
    ]);
}

function twentyMin() {
    return workout('20min', '20 min Test', 'FTP',
        'A 5 min effort to open up, then 20 minutes all out. Efforts in sim mode at 1 %: the power is yours. FTP = 95 % of the 20 min average. Pace it evenly: the first 5 minutes should feel too easy.', [
        single(WARMUP()), ...PRIMERS(),
        single(erg(300, 0.5, '5 min easy', 'Next: 5 min hard')),
        single(allOut(300, null, '5 min hard: opens you up', '10 s left')),
        single(erg(600, 0.5, '10 min easy', 'Next: 20 min all out')),
        single(allOut(1200, 'p20', '20 min all out: pace evenly', '10 s left: everything')),
        single(erg(600, 0.45, 'Cool down: 10 min easy')),
    ]);
}

function twoEight() {
    return workout('2x8', '2 × 8 min Test', 'FTP',
        'Two 8-minute all-out efforts with 10 minutes between. Efforts in sim mode at 1 %: the power is yours. FTP = 90 % of the mean of the two.', [
        single(WARMUP()), ...PRIMERS(),
        single(erg(300, 0.5, '5 min easy', 'Next: 8 min all out')),
        single(allOut(480, 'p8a', 'Effort 1 of 2: 8 min all out', '10 s left')),
        single(erg(600, 0.5, '10 min easy', 'Next: effort 2')),
        single(allOut(480, 'p8b', 'Effort 2 of 2: 8 min all out', '10 s left: everything')),
        single(erg(600, 0.45, 'Cool down: 10 min easy')),
    ]);
}

function sprint() {
    return workout('sprint', 'Sprint Test', 'Peak power',
        'Three 10-second sprints with 3 minutes between, in sim mode at 1 %. Your peak and best 5 s power. Sprint seated or standing, as on the road.', [
        single(WARMUP()),
        ...[1, 2, 3].flatMap(n => [
            single(allOut(10, 'sprint', `Sprint ${n} of 3: go!`)),
            single(erg(180, 0.45, '3 min easy', n < 3 ? `Next: sprint ${n + 1}` : null)),
        ]),
        single(erg(300, 0.45, 'Cool down: 5 min easy')),
    ]);
}

const BUILDERS = {'3-12': threeTwelve, 'ramp': ramp, '20min': twentyMin, '2x8': twoEight, 'sprint': sprint};
const TEST_IDS = Object.fromEntries(Object.keys(BUILDERS).map(t => [t, `builtin-test-${t}`]));

const protocols = () => Object.values(BUILDERS).map(b => b());
const protocol = test => BUILDERS[test]?.() ?? null;

export { protocols, protocol, TEST_IDS };
