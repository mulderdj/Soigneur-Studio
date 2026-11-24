/**
 * @jest-environment jsdom
 */
import '../../src/views/training/readiness-card.js';

const today = '2026-11-24';
const addDays = (d, n) => new Date(Date.parse(d) + n * 86400000).toISOString().slice(0, 10);
const range = {low: 52, high: 65};
const nights = (last = {}) => [
    ...Array.from({length: 30}, (_, i) => ({day: addDays(today, -30 + i), hrv: 58, hrvBaseline: range, restingHr: 48, sleepSeconds: 27000, bodyBattery: 70})),
    {day: today, hrv: 58, hrvBaseline: range, restingHr: 48, sleepSeconds: 27000, bodyBattery: 70, ...last},
];
const summaries = Array.from({length: 60}, (_, i) => ({id: `r${i}`, day: addDays(today, -60 + i), tss: 60}));
const iv = (duration, power) => ({duration, steps: [{duration, power}]});
const vo2 = {id: 'w', meta: {name: 'VO2 max 5x4'}, intervals: [iv(600, 0.6), iv(1200, 1.15)]};

function card(data) {
    document.body.innerHTML = '<readiness-card></readiness-card>';
    const el = document.querySelector('readiness-card');
    el.data = {today, summaries, plan: [], wellness: nights(), ftp: 250, ...data};
    return el;
}

describe('the Readiness card', () => {
    test('ready: the word, the colour, the reasons', () => {
        const el = card({});
        expect(el.querySelector('[data-state]').dataset.state).toBe('ready');
        expect(el.querySelector('.rd-word').textContent).toBe('Ready');
        expect(el.querySelectorAll('.rd-reasons li').length).toBeGreaterThanOrEqual(3);
    });
    test('take care and rest', () => {
        expect(card({wellness: nights({hrv: 48})}).querySelector('.rd-word').textContent).toBe('Take care');
        expect(card({wellness: nights({hrv: 48, restingHr: 55})}).querySelector('.rd-word').textContent).toBe('Rest');
    });
    test('today\'s planned workout and whether it is hard', () => {
        const el = card({wellness: nights({hrv: 48}), plan: [{id: 'p', day: today, workout: vo2, deleted: false, rideId: null}]});
        expect(el.querySelector('.rd-plan').textContent).toMatch(/VO2 max 5x4/);
        expect(el.querySelector('.rd-plan').textContent).toMatch(/hard/i);
        expect(el.querySelector('.rd-plan').textContent).toMatch(/Ride page/);       // the easier option is offered there
    });
    test('no health data at all: from training load only, and how to get more', () => {
        const el = card({wellness: []});
        expect(el.textContent).toMatch(/No health data from last night/);
        expect(el.textContent).toMatch(/Connect Garmin/);
        expect(el.querySelector('.rd-advice').textContent).toMatch(/training load only/);   // the headline says what it rests on
        expect(el.textContent).not.toMatch(/NaN|undefined/);
    });
});
