/**
 * @jest-environment jsdom
 */
import { meanMaximal, fitCp, effective, offer, powerProfile, CATEGORIES, currentModel } from '../../src/training/rider-model.js';
import { modelSettings } from '../../src/training/rider-model-settings.js';
import { DURATIONS } from '../../src/training/summary.js';

const today = '2026-11-24';
const addDays = (d, n) => new Date(Date.parse(d) + n * 86400000).toISOString().slice(0, 10);
// a rider exactly on the model: P = CP + W′/t (capped below 2 min like a real curve)
const curve = (cp, wprime, scale = 1) => Object.fromEntries(DURATIONS.map(d => [d, Math.round((cp + wprime / Math.max(d, 60)) * scale)]));
const ride = (id, daysAgo, best, extra = {}) => ({id, day: addDays(today, -daysAgo), name: `Ride ${id}`, best, sport: 'cycling', ...extra});

describe('best power over the last 90 days', () => {
    test('the best per duration, with the ride it came from; older than 90 days and runs left out', () => {
        const mm = meanMaximal([
            ride('a', 10, {300: 320, 1200: 270}),
            ride('b', 30, {300: 330, 1200: 260}),
            ride('old', 120, {300: 400}),
            ride('run', 5, {300: 500}, {sport: 'run'}),
            ride('legacy', 3, {5: 900}),                              // an old summary with five durations
        ], today);
        expect(mm[300]).toEqual({watts: 330, id: 'b', day: addDays(today, -30), name: 'Ride b'});
        expect(mm[1200].watts).toBe(270);
        expect(mm[5].watts).toBe(900);
        expect(mm[120]).toBeNull();
    });
});

describe('fitting CP and W′', () => {
    test('a rider on the model: CP and W′ recovered, a good fit', () => {
        const f = fitCp(meanMaximal([ride('a', 5, curve(260, 20000))], today));
        expect(f.ok).toBe(true);
        expect(f.cp).toBeCloseTo(260, -1);
        expect(f.wprime).toBeGreaterThan(18000);
        expect(f.wprime).toBeLessThan(22000);
        expect(f.r2).toBeGreaterThan(0.99);
        expect(f.points.map(p => p.seconds)).toEqual([120, 180, 240, 300, 420, 600, 720, 900, 1200]);
        expect(f.points[0]).toMatchObject({id: 'a', name: 'Ride a'});
    });
    test('3 + 12 min test with easy cooldown recovers CP and W′ without 15/20 min drag', () => {
        // true CP = 300 W, W′ = 18 kJ: 180 s @ 400 W, 720 s @ 325 W, followed by easy cooldown
        const best = {120: 400, 180: 400, 240: 325, 300: 325, 420: 325, 600: 325, 720: 325, 900: 284, 1200: 243};
        const f = fitCp(meanMaximal([ride('test', 2, best)], today));
        expect(f.ok).toBe(true);
        expect(f.cp).toBeGreaterThan(292);
        expect(f.cp).toBeLessThan(308);
        expect(f.wprime).toBeGreaterThan(16500);
        expect(f.wprime).toBeLessThan(19500);
    });
    test('what is missing, in words', () => {
        expect(fitCp(meanMaximal([], today))).toMatchObject({ok: false, missing: expect.stringMatching(/No power data/)});
        expect(fitCp(meanMaximal([ride('a', 5, {600: 280, 900: 270, 1200: 265})], today)).missing).toMatch(/2–5 minutes/);
        expect(fitCp(meanMaximal([ride('a', 5, {120: 400, 180: 360, 300: 320})], today)).missing).toMatch(/12–20 minutes/);
        expect(fitCp(meanMaximal([ride('a', 5, {300: 320, 1200: 270})], today)).missing).toMatch(/more efforts/i);
        const flat = fitCp(meanMaximal([ride('a', 5, Object.fromEntries(DURATIONS.map(d => [d, 250])))], today));
        expect(flat.ok).toBe(false);
        expect(flat.missing).toMatch(/all-out/);
    });
});

describe('which CP and W′ W′bal uses', () => {
    const fit = {ok: true, cp: 265, wprime: 23500};
    test('automatically: the fit when there is one, else FTP and the typed W′', () => {
        expect(effective({fit, settings: {mode: 'auto'}, ftp: 250, typedWprime: 20000})).toEqual({cp: 265, wprime: 23500, source: 'model'});
        expect(effective({fit: {ok: false}, settings: {mode: 'auto'}, ftp: 250, typedWprime: 20000})).toEqual({cp: 250, wprime: 20000, source: 'settings'});
    });
    test('ask me: only what the rider accepted', () => {
        expect(effective({fit, settings: {mode: 'ask', use: null}, ftp: 250, typedWprime: 20000})).toEqual({cp: 250, wprime: 20000, source: 'settings'});
        expect(effective({fit, settings: {mode: 'ask', use: {cp: 262, wprime: 22000}}, ftp: 250, typedWprime: 20000})).toEqual({cp: 262, wprime: 22000, source: 'model'});
    });
    test('the offer: when W′ differs by more than 1 kJ or CP by more than 3 %', () => {
        expect(offer({fit, current: {cp: 250, wprime: 20000}})).toEqual({cp: 265, wprime: 23500});
        expect(offer({fit, current: {cp: 262, wprime: 23000}})).toBeNull();
        expect(offer({fit: {ok: false}, current: {cp: 250, wprime: 20000}})).toBeNull();
    });
});

describe('the power profile', () => {
    test('categories from the men\'s and women\'s tables', () => {
        const mm = {5: {watts: 1050}, 60: {watts: 525}, 300: {watts: 330}};
        const p = powerProfile({meanMax: mm, ftp: 262, weight: 75, table: 'men'});
        expect(p.rows.map(r => [r.label, r.wkg, r.category])).toEqual([
            ['5 s', 14, 'Moderate'], ['1 min', 7, 'Good'], ['5 min', 4.4, 'Good'], ['FTP', 3.49, 'Moderate'],
        ]);
        expect(p.sentence).toMatch(/Strongest at (1 min|5 min)/);
        expect(p.sentence).toMatch(/limiter/);
        const w = powerProfile({meanMax: mm, ftp: 262, weight: 75, table: 'women'});
        expect(w.rows.find(r => r.label === '1 min').category).toBe('Excellent');
    });
    test('boundaries and edges: world class at the top, untrained at the bottom', () => {
        const top = powerProfile({meanMax: {5: {watts: 2000}}, ftp: 500, weight: 70, table: 'men'});
        expect(top.rows[0].category).toBe('World class');
        expect(top.rows[3].category).toBe('World class');
        expect(CATEGORIES).toHaveLength(8);
    });
    test('no weight: asks for it; no data: says so; no NaN', () => {
        expect(powerProfile({meanMax: {}, ftp: 250, weight: null, table: 'men'})).toMatchObject({needsWeight: true});
        const p = powerProfile({meanMax: {}, ftp: 250, weight: 75, table: 'men'});
        expect(p.rows.filter(r => r.wkg !== null).map(r => r.label)).toEqual(['FTP']);
        expect(JSON.stringify(p)).not.toMatch(/NaN|Infinity/);
    });
});

describe('the settings, per rider', () => {
    beforeEach(() => localStorage.clear());
    test('Ask me and the men\'s table by default; saved and read back', () => {
        expect(modelSettings.get()).toEqual({mode: 'ask', use: null, table: 'men'});
        modelSettings.set({mode: 'auto'});
        modelSettings.set({table: 'women'});
        expect(modelSettings.get()).toEqual({mode: 'auto', use: null, table: 'women'});
    });
    test('nonsense in storage gives the defaults', () => {
        localStorage.setItem('riderModel', '{"mode":"sometimes","use":{"cp":-1}}');
        expect(modelSettings.get()).toEqual({mode: 'ask', use: null, table: 'men'});
    });
});

describe('the model now, for the app', () => {
    test('fit, what W′bal uses and the offer, from summaries and settings', () => {
        const m = currentModel({summaries: [ride('a', 5, curve(270, 22000))], today, ftp: 250, typedWprime: 20000, settings: {mode: 'ask', use: null, table: 'men'}});
        expect(m.fit.ok).toBe(true);
        expect(m.effective).toEqual({cp: 250, wprime: 20000, source: 'settings'});
        expect(m.offer.cp).toBeCloseTo(270, -1);
        const auto = currentModel({summaries: [ride('a', 5, curve(270, 22000))], today, ftp: 250, typedWprime: 20000, settings: {mode: 'auto', use: null, table: 'men'}});
        expect(auto.effective.source).toBe('model');
        expect(auto.offer).toBeNull();
    });
    test('efforts aging out of 90 days in auto mode: back to FTP and the typed W′', () => {
        const m = currentModel({summaries: [ride('a', 100, curve(270, 22000))], today, ftp: 250, typedWprime: 20000, settings: {mode: 'auto', use: null, table: 'men'}});
        expect(m.fit.ok).toBe(false);
        expect(m.effective).toEqual({cp: 250, wprime: 20000, source: 'settings'});
    });
});
