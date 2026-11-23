/**
 * @jest-environment jsdom
 */
import { models } from '../../src/models/models.js';
import { zwo } from '../../src/workouts/zwo.js';

// the pair the Training page injects: Auuki workouts go to intervals.icu as
// .zwo, intervals.icu's come back through the same parser as uploads
test('a workout survives .zwo out and back', () => {
    const text = '<workout_file><name>Sweet spot</name><workout>' +
                 '<Warmup Duration="300" PowerLow="0.5" PowerHigh="0.75"/>' +
                 '<SteadyState Duration="1200" Power="0.9"/>' +
                 '<Cooldown Duration="300" PowerLow="0.7" PowerHigh="0.5"/></workout></workout_file>';
    const w = models.workout.parse(text);
    const back = models.workout.parse(zwo.write(zwo.fromInterval(w)));
    const total = x => x.intervals.reduce((a, i) => a + i.duration, 0);
    expect(total(back)).toBe(total(w));
    expect(total(w)).toBe(1800);
    expect(back.intervals.length).toBe(w.intervals.length);
});

test('a .zwo without steps is refused', () => {
    expect(() => models.workout.parse('<workout_file><name>x</name><workout></workout></workout_file>')).toThrow();
});
