/**
 * @jest-environment jsdom
 */
import { ftpNudge } from '../../src/views/training/progress-cards.js';
import '../../src/views/training/calendar.js';
import '../../src/views/training/day-dialog.js';

const today = '2026-11-25';
const workout = (id, name) => ({id, meta: {name}, intervals: [{duration: 3600, steps: [{duration: 3600, power: 0.79}]}]});
const data = {
    today,
    summaries: [{id: 'r1', day: '2026-11-24', name: 'Sweet spot', duration: 3900, tss: 70, start: 0}],
    plan: [
        {id: 'p1', day: '2026-11-24', workout: workout('w1', 'Sweet spot'), rideId: 'r1', deleted: false},
        {id: 'p2', day: '2026-11-23', workout: workout('w2', 'Endurance'), rideId: null, deleted: false},
        {id: 'p3', day: '2026-11-27', workout: workout('w3', 'VO2 max'), rideId: null, deleted: false},
    ],
    workouts: [workout('a', 'Sweet spot 2x20'), workout('b', 'VO2 max 5x4'), workout('c', 'Endurance 90')],
};

function calendar(layout) {
    document.body.innerHTML = `<training-calendar layout="${layout}"></training-calendar>`;
    const el = document.querySelector('training-calendar');
    el.data = data;
    return el;
}

describe('calendar', () => {
    test('a week list on a phone', () => {
        const el = calendar('phone');
        expect(el.querySelectorAll('.cal-day')).toHaveLength(7);
        expect(el.querySelector('.cal-day[data-day="2026-11-23"]')).not.toBeNull();
    });

    test('a month grid on wider screens', () => {
        const el = calendar('desktop');
        expect(el.querySelectorAll('.cal-day')).toHaveLength(42);
        expect(el.querySelector('.cal-title').textContent).toMatch(/November 2026/);
    });

    test('done, missed and planned entries', () => {
        const el = calendar('phone');
        const done = el.querySelector('.cal-day[data-day="2026-11-24"]');
        expect(done.textContent).toMatch(/done/);
        expect(done.textContent).toMatch(/planned 62 \/ actual 70 TSS/);
        expect(el.querySelector('.cal-day[data-day="2026-11-23"]').textContent).toMatch(/missed/);
        expect(el.querySelector('.cal-day[data-day="2026-11-27"]').textContent).toMatch(/planned/);
    });

    test('next week', () => {
        const el = calendar('phone');
        el.querySelector('[data-nav="next"]').click();
        expect(el.querySelector('.cal-day[data-day="2026-11-30"]')).not.toBeNull();
    });

    test('opening a day', () => {
        const el = calendar('phone');
        const days = [];
        el.addEventListener('day-open', e => days.push(e.detail.day));
        el.querySelector('.cal-day[data-day="2026-11-27"] .cal-open').click();
        expect(days).toEqual(['2026-11-27']);
    });
});

describe('day dialog', () => {
    function dialog() {
        document.body.innerHTML = '<day-dialog></day-dialog>';
        const el = document.querySelector('day-dialog');
        el.actions = {addPlanEntry: jest.fn(async () => {}), movePlanEntry: jest.fn(), removePlanEntry: jest.fn()};
        el.open('2026-11-27', data);
        return el;
    }

    test('search filters the library', () => {
        const el = dialog();
        const search = el.querySelector('input[type=search]');
        search.value = 'vo2';
        search.dispatchEvent(new Event('input', {bubbles: true}));
        const names = [...el.querySelectorAll('.dd-pick')].map(b => b.textContent.trim());
        expect(names).toEqual(['VO2 max 5x4']);
    });

    test('picking a workout plans it on that day', async () => {
        const el = dialog();
        el.querySelector('.dd-pick[data-id="a"]').click();
        await Promise.resolve();
        expect(el.actions.addPlanEntry).toHaveBeenCalledWith('2026-11-27', data.workouts[0]);
    });

    test('a ride can be hidden, and a hidden ride shown again', () => {
        document.body.innerHTML = '<day-dialog></day-dialog>';
        const el = document.querySelector('day-dialog');
        el.actions = {hideRide: jest.fn(async () => {}), showRide: jest.fn(async () => {})};
        el.open('2026-11-24', {...data, summaries: [...data.summaries,
            {id: 'icu-7', day: '2026-11-24', name: 'Commute', duration: 1200, tss: 15, start: 5, hidden: true}]});
        const rows = [...el.querySelectorAll('.dd-ride')];
        expect(rows.map(r => r.classList.contains('is-hidden'))).toEqual([false, true]);
        el.querySelector('[data-hide="r1"]').click();
        expect(el.actions.hideRide).toHaveBeenCalledWith('r1');
        el.querySelector('[data-show="icu-7"]').click();
        expect(el.actions.showRide).toHaveBeenCalledWith('icu-7');
    });

    test('a planned entry can be removed', () => {
        const el = dialog();
        el.querySelector('[data-remove="p3"]').click();
        expect(el.actions.removePlanEntry).toHaveBeenCalledWith('p3');
    });
});

describe('FTP nudge', () => {
    test('only beyond 5 %', () => {
        expect(ftpNudge(260, 250)).toBeNull();
        expect(ftpNudge(262, 250)).toBeNull(); // 4.8 %
        expect(ftpNudge(268.4, 250)).toBe(268);
        expect(ftpNudge(230, 250)).toBe(230);
        expect(ftpNudge(null, 250)).toBeNull();
    });
});
