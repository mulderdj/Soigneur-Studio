//
// The current rider's layouts (see tiles.js), kept in the rider's local
// storage and sent with the profile (src/account/sync.js):
//
//   'layouts:changed'  the layouts in use changed (pages re-render)
//   'layouts:saved'    the rider saved an edit (the profile is pushed)
//
// A layout that arrives from the account while the rider is editing (on
// either page) waits until every edit ends. Each page saves only its own part
// (saveSection: Ride or Training, for one screen class) into the newest
// layout, so one page's Done never undoes the other's, and a layout from the
// account keeps the parts the rider didn't edit.
//

import { xf } from '../functions.js';
import { riders } from '../riders.js';
import { readLayout } from './tiles.js';

const copy = x => JSON.parse(JSON.stringify(x));

function createLayoutStore({storage, key, dispatch}) {
    let current = null;
    let edits = 0;           // pages editing right now
    let pending = null;      // a layout from the account, waiting for the edits to end

    function load() {
        if(current) return current;
        let saved = null;
        try { saved = JSON.parse(storage.getItem(key('layouts'))); } catch(e) { saved = null; }
        current = readLayout(saved);
        return current;
    }

    function store(next) {
        current = readLayout(next);
        try { storage.setItem(key('layouts'), JSON.stringify(current)); } catch(e) {}
    }

    return {
        get: () => copy(load()),
        save(next) {
            pending = null;
            store(next);
            dispatch('layouts:changed', copy(current));
            dispatch('layouts:saved', copy(current));
        },
        saveSection(section, cls, value) {
            const base = copy(pending ? readLayout(pending) : load());
            pending = null;
            base[section][cls] = value;
            store(base);
            dispatch('layouts:changed', copy(current));
            dispatch('layouts:saved', copy(current));
        },
        applyRemote(next) {
            if(edits > 0) { pending = next; return; }
            store(next);
            dispatch('layouts:changed', copy(current));
        },
        beginEdit() { edits++; },
        endEdit() {
            edits = Math.max(0, edits - 1);
            if(edits === 0 && pending) { const p = pending; pending = null; this.applyRemote(p); }
        },
        get editing() { return edits > 0; },
        // the profile synced through the account
        forProfile: () => copy(load()),
        fromProfile(data) { if(data && data.layouts) this.applyRemote(data.layouts); },
    };
}

const layouts = createLayoutStore({
    storage: {
        getItem: k => { try { return localStorage.getItem(k); } catch(e) { return null; } },
        setItem: (k, v) => localStorage.setItem(k, v),
    },
    key: k => riders.key(k),
    dispatch: (name, v) => xf.dispatch(name, v),
});

export { layouts, createLayoutStore };
