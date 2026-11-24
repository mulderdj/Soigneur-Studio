/**
 * @jest-environment jsdom
 */
import { xf } from '../../src/functions.js';
import { ReadinessNote } from '../../src/views/readiness-note.js';

const today = '2026-11-24';
const iv = (duration, power) => ({duration, steps: [{duration, power}]});
const vo2 = {id: 'w-vo2', meta: {name: 'VO2 max 5x4'}, intervals: [iv(600, 0.6), iv(1200, 1.15)]};
const endurance = {id: 'w-end', meta: {name: 'Endurance'}, intervals: [iv(3600, 0.65)]};
const flush = () => new Promise(r => setTimeout(r, 0));

let entry, calls;
function source({state = 'take-care', workout = vo2, next = '2026-11-26'} = {}) {
    entry = {id: 'p1', day: today, workout, deleted: false, rideId: null};
    calls = [];
    const actions = {
        replacePlanWorkout: async (id, w) => { calls.push(['replace', id, w.meta.name]); entry = {...entry, workout: w, original: entry.original ?? {workout}}; return entry; },
        restorePlanWorkout: async id => { calls.push(['restore', id]); entry = {...entry, workout: entry.original.workout, original: null}; return entry; },
        movePlanEntry: async (id, day) => { calls.push(['move', id, day]); entry = {...entry, day}; },
        rideWorkout: async id => { calls.push(['ride', id]); return true; },
    };
    return {
        context: async () => ({today, ftp: 250, verdict: {state, reasons: ['HRV 48 ms, below your range (52–65)']}, entry: entry.day === today ? entry : null, nextFree: next}),
        actions,
    };
}

async function note(src, {workout = vo2, watch = 'stopped'} = {}) {
    ReadinessNote.source = src;
    localStorage.clear();
    document.body.innerHTML = '<readiness-note></readiness-note>';
    const el = document.querySelector('readiness-note');
    xf.dispatch('db:watchStatus', {watchStatus: watch});
    xf.dispatch('db:workout', {workout});
    await flush(); await flush();
    return el;
}

describe('the note before you ride', () => {
    test('take care, today\'s hard workout loaded: the note with Ride it easier and Move', async () => {
        const el = await note(source());
        expect(el.hidden).toBe(false);
        expect(el.textContent).toMatch(/Take care/);
        expect(el.textContent).toMatch(/HRV 48 ms/);
        expect(el.querySelector('[data-rn="easier"]')).not.toBeNull();
        expect(el.querySelector('[data-rn="recovery"]')).toBeNull();
        expect(el.querySelector('[data-rn="move"]').textContent).toMatch(/Move to/);
    });
    test('rest: Recovery spin instead', async () => {
        const el = await note(source({state: 'rest'}));
        expect(el.querySelector('[data-rn="recovery"]')).not.toBeNull();
        expect(el.querySelector('[data-rn="easier"]')).toBeNull();
    });
    test('not shown: ready, an easy workout, a workout chosen by hand, while riding', async () => {
        expect((await note(source({state: 'ready'}))).hidden).toBe(true);
        expect((await note(source({workout: endurance}), {workout: endurance})).hidden).toBe(true);
        expect((await note(source(), {workout: {...endurance, id: 'other'}})).hidden).toBe(true);
        expect((await note(source(), {watch: 'started'})).hidden).toBe(true);
    });
    test('Ride it easier: the plan entry changed, the easier workout loaded, Undo brings it back', async () => {
        const el = await note(source());
        el.querySelector('[data-rn="easier"]').click(); await flush(); await flush();
        expect(calls).toEqual([['replace', 'p1', 'VO2 max 5x4 (easier)'], ['ride', 'p1']]);
        expect(el.textContent).toMatch(/easier/i);
        el.querySelector('[data-rn="undo"]').click(); await flush(); await flush();
        expect(calls.slice(2)).toEqual([['restore', 'p1'], ['ride', 'p1']]);
    });
    test('Move: to the next free day; Undo moves it back', async () => {
        const el = await note(source());
        el.querySelector('[data-rn="move"]').click(); await flush(); await flush();
        expect(calls).toEqual([['move', 'p1', '2026-11-26']]);
        el.querySelector('[data-rn="undo"]').click(); await flush(); await flush();
        expect(calls.slice(1)).toEqual([['move', 'p1', today]]);
    });
    test('Not now: hidden for the rest of today', async () => {
        const src = source();
        const el = await note(src);
        el.querySelector('[data-rn="later"]').click(); await flush();
        expect(el.hidden).toBe(true);
        xf.dispatch('db:workout', {workout: vo2}); await flush(); await flush();
        expect(el.hidden).toBe(true);
    });

    test('the Undo line stays while the changed workout loads (the app sends the workout again)', async () => {
        const src = source();
        src.actions.rideWorkout = async id => { calls.push(['ride', id]); xf.dispatch('db:workout', {workout: entry.workout}); return true; };
        const el = await note(src);
        el.querySelector('[data-rn="easier"]').click();
        for(let i = 0; i < 5; i++) await flush();
        expect(el.hidden).toBe(false);
        expect(el.querySelector('[data-rn="undo"]')).not.toBeNull();
    });
});
