import { RIDE_TILES, TRAINING_CARDS, defaultLayouts, readLayout, screenClass, columnsFor, spanFor } from '../../src/layout/tiles.js';

const D = defaultLayouts();
const known = new Set(RIDE_TILES.map(t => t.id));
const ids = screen => screen.tiles.map(t => t.id);

describe('the defaults', () => {
    test('three Ride screens per screen class, every tile known', () => {
        for(const cls of ['phone', 'large']) {
            expect(D.ride[cls].screens.map(s => s.name)).toEqual(['Ride', 'Big numbers', 'Chart']);
            for(const s of D.ride[cls].screens) for(const t of s.tiles) expect(known.has(t.id)).toBe(true);
        }
        expect(ids(D.ride.phone.screens[0]).slice(0, 2)).toEqual(['power', 'target']);
        expect(ids(D.ride.phone.screens[2])).toContain('chart');
    });
    test('every Training card once, in today\'s order', () => {
        expect(D.training.large.cards.map(c => c.id)).toEqual(['readiness', 'form', 'week', 'health', 'calendar', 'volume', 'curve', 'model', 'profile', 'zones', 'ftp', 'efficiency', 'readiness-perf', 'decoupling', 'compliance', 'durability']);
        expect(D.training.phone.cards.every(c => c.size === 'full')).toBe(true);
    });
    test('a fresh copy every time', () => {
        defaultLayouts().ride.phone.screens.pop();
        expect(defaultLayouts().ride.phone.screens).toHaveLength(3);
    });
});

describe('reading a saved layout', () => {
    const one = (tiles, extra = {}) => ({version: 1, ride: {phone: {screens: [{id: 's1', name: 'Mine', tiles}]}, large: D.ride.large}, ...extra});
    test('nothing usable gives the defaults', () => {
        for(const bad of [null, undefined, 'x', 42, [], {version: 9}, {version: 1, ride: 'no'}]) {
            const r = readLayout(bad);
            expect(r.ride.phone.screens).toHaveLength(3);
            expect(r.training.large.cards).toHaveLength(16);
        }
    });
    test('an unknown tile is dropped, a bad size becomes the tile\'s own', () => {
        const r = readLayout(one([{id: 'power', size: 'huge'}, {id: 'gone', size: 'small'}, {id: 'chart', size: 'small'}]));
        expect(r.ride.phone.screens[0].tiles).toEqual([{id: 'power', size: 'large'}, {id: 'chart', size: 'large'}]);
    });
    test('a tile once per screen, at most 8 screens, names kept and cleaned', () => {
        const r = readLayout(one([{id: 'cadence', size: 'small'}, {id: 'cadence', size: 'wide'}]));
        expect(r.ride.phone.screens[0]).toEqual({id: 's1', name: 'Mine', tiles: [{id: 'cadence', size: 'small'}]});
        const many = {version: 1, ride: {phone: {screens: Array.from({length: 12}, (_, i) => ({id: `s${i}`, name: '  ', tiles: []}))}}};
        const m = readLayout(many);
        expect(m.ride.phone.screens).toHaveLength(8);
        expect(m.ride.phone.screens[1].name).toBe('Screen 2');
        expect(m.ride.phone.screens[0].tiles).toEqual([]);       // an empty screen stays
        expect(m.ride.large.screens).toHaveLength(3);             // the other class from the defaults
    });
    test('no screens gives the default screens; duplicate screen ids are renamed', () => {
        expect(readLayout({version: 1, ride: {phone: {screens: []}}}).ride.phone.screens).toHaveLength(3);
        const r = readLayout({version: 1, ride: {phone: {screens: [{id: 'a', tiles: []}, {id: 'a', tiles: []}]}}});
        expect(new Set(r.ride.phone.screens.map(s => s.id)).size).toBe(2);
    });
    test('saved tiles that are all unknown (renamed in an update) give the built-in screens, never an empty Ride page', () => {
        const r = readLayout({version: 1, ride: {phone: {screens: [{id: 'a', name: 'Old', tiles: [{id: 'old-tile'}, {id: 'gone'}]}, {id: 'b', tiles: []}]}}});
        expect(r.ride.phone.screens.map(s => s.name)).toEqual(['Ride', 'Big numbers', 'Chart']);
        // a rider's own empty screens are kept
        const own = readLayout({version: 1, ride: {phone: {screens: [{id: 'a', name: 'Mine', tiles: [{id: 'power'}]}, {id: 'b', name: 'Empty', tiles: []}]}}});
        expect(own.ride.phone.screens.map(s => s.name)).toEqual(['Mine', 'Empty']);
    });

    test('Training: unknown cards dropped, missing cards appended hidden', () => {
        const r = readLayout({version: 1, training: {large: {cards: [{id: 'ftp', size: 'full'}, {id: 'nope'}, {id: 'form', size: 'x', hidden: true}]}}});
        // cards added by updates (shown at once) are left out here: see below
        const cards = r.training.large.cards.filter(c => !['readiness', 'model', 'profile', 'efficiency', 'readiness-perf', 'decoupling', 'compliance', 'durability'].includes(c.id));
        expect(cards.slice(0, 2)).toEqual([{id: 'ftp', size: 'full', hidden: false}, {id: 'form', size: 'narrow', hidden: true}]);
        expect(cards).toHaveLength(8);
        expect(cards.slice(2).every(c => c.hidden)).toBe(true);
    });
});

describe('a card added by an update', () => {
    test('Readiness is added visible, first, to a saved Training layout without it', () => {
        const saved = {version: 1, training: {large: {cards: ['form', 'week', 'health', 'calendar', 'volume', 'curve', 'zones', 'ftp'].map(id => ({id, size: 'narrow'}))}}};
        const cards = readLayout(saved).training.large.cards;
        expect(cards[0]).toMatchObject({id: 'readiness', hidden: false});
        expect(cards).toHaveLength(16);
        // the rider model's cards too, after the power curve
        const ids = cards.filter(c => !c.hidden).map(c => c.id);
        expect(ids.indexOf('model')).toBe(ids.indexOf('curve') + 1);
        expect(ids.indexOf('profile')).toBe(ids.indexOf('curve') + 2);
        // and the trend cards, shown
        expect(cards.find(c => c.id === 'efficiency')).toMatchObject({hidden: false});
        expect(cards.find(c => c.id === 'readiness-perf')).toMatchObject({hidden: false});
        expect(cards.find(c => c.id === 'decoupling')).toMatchObject({hidden: false});
        expect(cards.find(c => c.id === 'compliance')).toMatchObject({hidden: false});
        expect(cards.find(c => c.id === 'durability')).toMatchObject({hidden: false});
    });
    test('a rider who hid it keeps it hidden', () => {
        const saved = {version: 1, training: {large: {cards: [{id: 'form', size: 'narrow'}, {id: 'readiness', size: 'wide', hidden: true}]}}};
        expect(readLayout(saved).training.large.cards.find(c => c.id === 'readiness').hidden).toBe(true);
    });
});

describe('the grid', () => {
    test('screen classes', () => {
        expect(['phone', 'phone-landscape', 'tablet', 'desktop', 'tv'].map(screenClass)).toEqual(['phone', 'phone', 'large', 'large', 'large']);
    });
    test('columns per layout and width', () => {
        expect(columnsFor('phone', 390)).toBe(3);
        expect(columnsFor('phone-landscape', 800)).toBe(5);
        expect(columnsFor('tablet', 900)).toBe(4);
        expect(columnsFor('desktop', 1440)).toBe(4);
        expect(columnsFor('desktop', 1700)).toBe(4);
        expect(columnsFor('tv', 2560)).toBe(6);
    });
    test('spans per size', () => {
        expect(spanFor('small', 3)).toBe(1);
        expect(spanFor('wide', 3)).toBe(2);
        expect(spanFor('large', 5)).toBe(5);
    });
});
