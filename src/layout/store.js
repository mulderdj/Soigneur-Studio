//
// The current rider's layouts (see tiles.js), kept in the rider's local
// storage and sent with the profile (src/account/sync.js):
//
//   'layouts:changed'  the layouts in use changed (pages re-render)
//   'layouts:saved'    the rider saved an edit (the profile is pushed)
//
// A layout that arrives from the account while the rider is editing waits
// until the edit ends; saving the edit wins over it.
//

import { xf } from '../functions.js';
import { riders } from '../riders.js';
import { readLayout } from './tiles.js';

const copy = x => JSON.parse(JSON.stringify(x));

function createLayoutStore({storage, key, dispatch}) {
    let current = null;
    let editing = false;
    let pending = null;

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
        applyRemote(next) {
            if(editing) { pending = next; return; }
            store(next);
            dispatch('layouts:changed', copy(current));
        },
        beginEdit() { editing = true; },
        endEdit() {
            editing = false;
            if(pending) { const p = pending; pending = null; this.applyRemote(p); }
        },
        get editing() { return editing; },
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
