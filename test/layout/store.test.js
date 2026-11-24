import { createLayoutStore } from '../../src/layout/store.js';
import { defaultLayouts } from '../../src/layout/tiles.js';

function memory() {
    const m = new Map();
    return {getItem: k => m.has(k) ? m.get(k) : null, setItem: (k, v) => m.set(k, String(v)), m};
}

function store(storage = memory()) {
    const events = [];
    const s = createLayoutStore({storage, key: k => `rider-1:${k}`, dispatch: (name, v) => events.push([name, v])});
    return {s, events, storage};
}

const mine = () => { const l = defaultLayouts(); l.ride.phone.screens[0].name = 'Mine'; return l; };

describe('the layout store', () => {
    test('nothing saved gives the defaults', () => {
        expect(store().s.get().ride.phone.screens).toHaveLength(3);
    });
    test('save and read back, per rider key; announces the change and the save', () => {
        const {s, events, storage} = store();
        s.save(mine());
        expect(JSON.parse(storage.m.get('rider-1:layouts')).ride.phone.screens[0].name).toBe('Mine');
        expect(store(storage).s.get().ride.phone.screens[0].name).toBe('Mine');
        expect(events.map(e => e[0])).toEqual(['layouts:changed', 'layouts:saved']);
    });
    test('a broken saved value gives the defaults', () => {
        const storage = memory();
        storage.setItem('rider-1:layouts', '{not json');
        expect(store(storage).s.get().ride.phone.screens[0].name).toBe('Ride');
    });
    test('a layout from the account is applied without being sent back', () => {
        const {s, events} = store();
        s.applyRemote(mine());
        expect(s.get().ride.phone.screens[0].name).toBe('Mine');
        expect(events.map(e => e[0])).toEqual(['layouts:changed']);
    });
    test('a layout from the account waits while the rider is editing', () => {
        const {s, events} = store();
        s.beginEdit();
        s.applyRemote(mine());
        expect(s.get().ride.phone.screens[0].name).toBe('Ride');
        expect(events).toEqual([]);
        s.endEdit();
        expect(s.get().ride.phone.screens[0].name).toBe('Mine');
    });
    test('saving while editing wins over a layout that arrived meanwhile', () => {
        const {s} = store();
        s.beginEdit();
        s.applyRemote(mine());
        const edited = defaultLayouts(); edited.ride.phone.screens[0].name = 'Edited';
        s.save(edited);
        s.endEdit();
        expect(s.get().ride.phone.screens[0].name).toBe('Edited');
    });
    test('get returns a copy: changing it changes nothing', () => {
        const {s} = store();
        s.get().ride.phone.screens.pop();
        expect(s.get().ride.phone.screens).toHaveLength(3);
    });
    test('the profile: sent as is, applied only when it has layouts', () => {
        const {s, events} = store();
        expect(s.forProfile().ride.phone.screens).toHaveLength(3);
        s.fromProfile({ftp: 250});
        expect(events).toEqual([]);
        s.fromProfile({layouts: mine()});
        expect(s.get().ride.phone.screens[0].name).toBe('Mine');
    });
});
