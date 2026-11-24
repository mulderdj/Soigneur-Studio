/**
 * @jest-environment jsdom
 */
import './browser-stubs.js';
import { UPlotCard } from '../../src/views/training/uplot-chart.js';
import { ftpNudge } from '../../src/views/training/progress-cards.js';
import { syncCounts, sportLabel, garminCounts, loadTag } from '../../src/views/training/format.js';
import '../../src/views/training/health-card.js';
import '../../src/views/training/hr-thresholds.js';
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

describe('the day dialog and ride analysis', () => {
    test('every ride has Analyse ride, which opens its page', () => {
        document.body.innerHTML = '<day-dialog></day-dialog>';
        const el = document.querySelector('day-dialog');
        el.open('2026-11-24', data);
        const b = el.querySelector('[data-analyse="r1"]');
        expect(b.textContent).toMatch(/Analyse ride/);
        b.click();
        expect(location.hash).toBe('#ride=r1');
    });
});

describe('calendar', () => {
    test('moved to another place on the page (a layout edit), it keeps its month and steps once', () => {
        const el = calendar('desktop');
        const month = () => el.querySelector('.cal-days, .cal-grid')?.parentElement && el.textContent.match(/(January|February|March|April|May|June|July|August|September|October|November|December) \d{4}/)?.[0];
        const before = month();
        const box = document.createElement('div');
        document.body.append(box);
        expect(() => box.append(el)).not.toThrow();
        expect(month()).toBe(before);
        el.querySelector('[data-nav="next"]').click();
        expect(month()).toBe('December 2026');
    });

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

describe('intervals.icu entries', () => {
    const icu = {...data, plan: [...data.plan,
        {id: 'i1', day: '2026-11-27', workout: workout('wi', 'Threshold'), rideId: null, deleted: false, origin: 'intervals'},
        {id: 'i2', day: '2026-11-28', workout: null, name: 'Odd file', rideId: null, deleted: false, origin: 'intervals'}]};

    test('the calendar tags them, and shows an unreadable one by name', () => {
        document.body.innerHTML = '<training-calendar layout="desktop"></training-calendar>';
        const el = document.querySelector('training-calendar');
        el.data = icu;
        const items = [...el.querySelectorAll('.cal-plan')];
        const threshold = items.find(i => i.textContent.includes('Threshold'));
        expect(threshold.querySelector('.badge-icu')).not.toBeNull();
        const odd = items.find(i => i.textContent.includes('Odd file'));
        expect(odd.querySelector('.badge-icu')).not.toBeNull();
        expect(items.find(i => i.textContent.includes('VO2 max')).querySelector('.badge-icu')).toBeNull();
    });

    test('the day dialog tags them; an unreadable one can be removed', () => {
        document.body.innerHTML = '<day-dialog></day-dialog>';
        const el = document.querySelector('day-dialog');
        el.actions = {removePlanEntry: jest.fn()};
        el.open('2026-11-28', icu);
        expect(el.textContent).toContain('Odd file');
        expect(el.textContent).toContain('could not be read');
        expect(el.querySelector('.badge-icu')).not.toBeNull();
        el.querySelector('[data-remove="i2"]').click();
        expect(el.actions.removePlanEntry).toHaveBeenCalledWith('i2');
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

describe('other sports and intervals.icu status', () => {
    test('a run on the calendar shows "Run" and its duration', () => {
        document.body.innerHTML = '<training-calendar layout="desktop"></training-calendar>';
        const el = document.querySelector('training-calendar');
        el.data = {...data, summaries: [...data.summaries,
            {id: 'icu-run', day: '2026-11-26', name: 'Lunch', sport: 'run', duration: 2700, tss: 40, start: 9},
            {id: 'icu-run2', day: '2026-11-26', name: 'Easy run', sport: 'run', duration: 1800, tss: 20, start: 10}]};
        const item = [...el.querySelectorAll('.cal-ride')].find(i => i.textContent.includes('Lunch'));
        expect(item.querySelector('.cal-sport').textContent).toBe('Run');
        expect(item.textContent).toContain('0:45');
        // the name already says it: no second label
        expect([...el.querySelectorAll('.cal-ride')].find(i => i.textContent.includes('Easy run')).querySelector('.cal-sport')).toBeNull();
        const ride = [...el.querySelectorAll('.cal-item')].find(i => i.textContent.includes('Sweet spot'));
        expect(ride.querySelector('.cal-sport')).toBeNull();
    });

    test('the day dialog names the sport of a run', () => {
        document.body.innerHTML = '<day-dialog></day-dialog>';
        const el = document.querySelector('day-dialog');
        el.open('2026-11-26', {...data, summaries: [{id: 'icu-run', day: '2026-11-26', name: 'Lunch', sport: 'run', duration: 2700, tss: 40, start: 9}]});
        expect(el.querySelector('.dd-ride .list-row__meta').textContent).toMatch(/^\s*Run · 0:45/);
    });

    test('sport names', () => {
        expect(sportLabel('run')).toBe('Run');
        expect(sportLabel('weighttraining')).toBe('Strength');
        expect(sportLabel('nordicski')).toBe('Nordicski');
        expect(sportLabel('cycling')).toBe('');
        expect(sportLabel(undefined)).toBe('');
    });

    test('the account card counts what the sync found', () => {
        expect(syncCounts({lastRun: 1, stored: 412, skipped: {STRAVA: 12}})).toBe('412 activities · 12 from Strava weren\'t available');
        expect(syncCounts({stored: 1, skipped: {}})).toBe('1 activity');
        expect(syncCounts({stored: 3, skipped: {STRAVA: 1, GARMIN_CONNECT: 2}}))
            .toBe('3 activities · 1 from Strava, 2 from Garmin weren\'t available');
        expect(syncCounts(null)).toBe('');
    });
});

// jsdom has no canvas: a stand-in uPlot that only records what it was given
UPlotCard.uPlot = class {
    constructor(opts, data, el) { this.opts = opts; this.data = data; this.over = document.createElement('div'); this.root = document.createElement('div'); el.append(this.root); this.cursor = {}; this.select = {width: 0}; }
    destroy() { this.root.remove(); }
    setSize() {}
    setCursor() {}
};

describe('loads, ratings and health', () => {
    test('workouts whose load is not from power carry a tag', () => {
        expect(loadTag('power')).toBe('');
        expect(loadTag('hr')).toBe('HR');
        expect(loadTag('rpe')).toBe('RPE');
        expect(loadTag('estimate')).toBe('est.');
        document.body.innerHTML = '<training-calendar layout="desktop"></training-calendar>';
        const el = document.querySelector('training-calendar');
        el.data = {...data, summaries: [
            {id: 'g1', day: '2026-11-26', name: 'Gym', sport: 'weighttraining', duration: 3600, tss: 30, loadSource: 'estimate', start: 1},
            {id: 'g2', day: '2026-11-26', name: 'Run', sport: 'run', duration: 3600, tss: 69, loadSource: 'hr', start: 2},
            {id: 'g3', day: '2026-11-26', name: 'Ride', duration: 3600, tss: 60, loadSource: 'power', start: 3},
        ]};
        const tag = name => [...el.querySelectorAll('.cal-ride')].find(i => i.textContent.includes(name)).querySelector('.cal-load')?.textContent;
        expect(tag('Gym')).toBe('est.');
        expect(tag('Run')).toBe('HR');
        expect(tag('Ride')).toBeUndefined();
    });

    test('the day dialog asks how hard a workout without power or heart rate was', () => {
        document.body.innerHTML = '<day-dialog></day-dialog>';
        const el = document.querySelector('day-dialog');
        el.actions = {rateRide: jest.fn(async () => {})};
        el.open('2026-11-26', {...data, summaries: [
            {id: 'g1', day: '2026-11-26', name: 'Gym', sport: 'weighttraining', duration: 3600, tss: 49, loadSource: 'rpe', rating: 7, start: 1},
            {id: 'g3', day: '2026-11-26', name: 'Ride', duration: 3600, tss: 60, loadSource: 'power', start: 3},
        ]});
        const buttons = el.querySelectorAll('[data-rate="g1"]');
        expect(buttons).toHaveLength(10);
        expect(el.querySelector('[data-rate="g1"][aria-pressed="true"]').dataset.rpe).toBe('7');
        expect(el.querySelector('[data-rate="g3"]')).toBeNull();
        el.querySelector('[data-rate="g1"][data-rpe="5"]').click();
        expect(el.actions.rateRide).toHaveBeenCalledWith('g1', 5);
        el.open('2026-11-26', {...data, summaries: [{id: 'g1', day: '2026-11-26', name: 'Gym', duration: 3600, tss: 49, loadSource: 'rpe', rating: 7, start: 1}]});
        el.querySelector('[data-rate="g1"][data-rpe="7"]').click();   // the same again takes it away
        expect(el.actions.rateRide).toHaveBeenLastCalledWith('g1', null);
    });

    test('the health card: last night against the normal range, resting HR, sleep, Body Battery', () => {
        document.body.innerHTML = '<health-card></health-card>';
        const el = document.querySelector('health-card');
        const days = Array.from({length: 20}, (_, i) => ({day: `2026-11-${String(i + 4).padStart(2, '0')}`, hrv: 60, restingHr: 48}));
        days.push({day: '2026-11-24', hrv: 44, hrvBaseline: {low: 52, high: 66}, restingHr: 53, sleepSeconds: 25920, sleepScore: 71, bodyBattery: 62});
        el.data = {today, wellness: days};
        expect(el.hidden).toBe(false);
        expect(el.querySelector('[data-hrv-state]').dataset.hrvState).toBe('below');
        expect(el.textContent).toContain('44');
        expect(el.textContent).toContain('52–66');
        expect(el.textContent).toContain('53');
        expect(el.textContent).toContain('7:12');
        expect(el.textContent).toContain('71');
        expect(el.textContent).toContain('62');
        expect(el.querySelector('.uc-plot > div')).not.toBeNull(); // the chart
        el.data = {today, wellness: []};
        expect(el.hidden).toBe(true);
    });

    test('Garmin status text', () => {
        expect(garminCounts({activities: 120, days: 90})).toBe('120 activities · 90 days of health data');
        expect(garminCounts({activities: 1, days: 1})).toBe('1 activity · 1 day of health data');
        expect(garminCounts(null)).toBe('');
    });
});

describe('threshold heart rate in Settings', () => {
    test('shows Garmin\'s value as a hint and saves the rider\'s own', () => {
        const saved = [];
        const store = {
            own: () => ({cycling: null, running: 171}),
            garmin: () => ({cycling: 165, running: 172}),
            setOwn: v => saved.push(v),
        };
        document.body.innerHTML = '<hr-thresholds></hr-thresholds>';
        const el = document.querySelector('hr-thresholds');
        el.store = store;
        const cycling = el.querySelector('input[name="cycling"]');
        const running = el.querySelector('input[name="running"]');
        expect(cycling.value).toBe('');
        expect(cycling.placeholder).toBe('165 from Garmin');
        expect(running.value).toBe('171');
        cycling.value = '158';
        el.querySelector('form').dispatchEvent(new Event('submit', {cancelable: true, bubbles: true}));
        expect(saved).toEqual([{cycling: '158', running: '171'}]);
    });
});

describe('ride a planned workout', () => {
    test('the day dialog offers "Ride this workout" for open, readable entries', () => {
        document.body.innerHTML = '<day-dialog></day-dialog>';
        const el = document.querySelector('day-dialog');
        el.actions = {rideWorkout: jest.fn()};
        el.open('2026-11-24', {...data, plan: [
            {id: 'a', day: '2026-11-24', workout: workout('wa', 'Open'), rideId: null, deleted: false},
            {id: 'b', day: '2026-11-24', workout: workout('wb', 'Done'), rideId: 'r1', deleted: false},
            {id: 'c', day: '2026-11-24', workout: null, name: 'Odd file', rideId: null, deleted: false, origin: 'intervals'},
        ]});
        expect([...el.querySelectorAll('[data-ride]')].map(b => b.dataset.ride)).toEqual(['a']);
        el.querySelector('[data-ride="a"]').click();
        expect(el.actions.rideWorkout).toHaveBeenCalledWith('a');
    });
});

describe('small graphs in the day dialog', () => {
    function open(day, extra) {
        document.body.innerHTML = '<day-dialog></day-dialog>';
        const el = document.querySelector('day-dialog');
        el.actions = {};
        el.open(day, {...data, ftp: 250, ...extra});
        return el;
    }

    test('a planned workout shows its profile; one that could not be read does not', () => {
        const two = {id: 'w9', meta: {name: 'Two steps'}, intervals: [
            {duration: 600, steps: [{duration: 600, power: 0.6}]},
            {duration: 300, steps: [{duration: 300, power: 1.05}]},
        ]};
        const el = open('2026-11-28', {plan: [
            {id: 'a', day: '2026-11-28', workout: two, rideId: null, deleted: false},
            {id: 'c', day: '2026-11-28', workout: null, name: 'Odd file', rideId: null, deleted: false, origin: 'intervals'},
        ]});
        const graphs = el.querySelectorAll('.dd-graph');
        expect(graphs).toHaveLength(1);
        expect(graphs[0].dataset.graph).toBe('a');
        expect(graphs[0].querySelectorAll('.graph--bar')).toHaveLength(2);
        expect(graphs[0].getAttribute('role')).toBe('img');
        expect(graphs[0].getAttribute('aria-label')).toMatch(/15 min/);
    });

    test('a ride with power shows its time in zones; one without power does not', () => {
        const el = open('2026-11-24', {summaries: [
            {id: 'r1', day: '2026-11-24', name: 'Sweet spot', duration: 3600, tss: 70, start: 1, zoneSeconds: [600, 1200, 0, 1800, 0, 0, 0]},
            {id: 'r2', day: '2026-11-24', name: 'Outdoor', duration: 3600, tss: 50, start: 2, zoneSeconds: [0, 0, 0, 0, 0, 0, 0], loadSource: 'hr'},
        ]});
        const bars = el.querySelectorAll('.dd-zones');
        expect(bars).toHaveLength(1);
        const parts = [...bars[0].querySelectorAll('.dd-zone')];
        expect(parts.map(p => p.dataset.zone)).toEqual(['1', '2', '4']);
        expect(parts.map(p => p.style.flexGrow)).toEqual(['600', '1200', '1800']);
        expect(bars[0].getAttribute('aria-label')).toBe('Time in zones: Z1 10 min, Z2 20 min, Z4 30 min');
    });
});
