//
// The rider model's settings, per rider on this device:
//   mode   'ask' (the card offers the fitted CP and W′) or 'auto'
//   use    the CP and W′ the rider accepted in ask mode, or null
//   table  'men' or 'women' (the power profile's table)
//

import { riders } from '../riders.js';

const DEFAULTS = {mode: 'ask', use: null, table: 'men'};
const key = () => riders.key('riderModel');
const pos = x => Number.isFinite(x) && x > 0;

function clean(v) {
    const mode = v?.mode === 'auto' ? 'auto' : 'ask';
    const use = pos(v?.use?.cp) && pos(v?.use?.wprime) ? {cp: v.use.cp, wprime: v.use.wprime} : null;
    const table = v?.table === 'women' ? 'women' : 'men';
    return {mode, use, table};
}

const modelSettings = {
    get() {
        try { return clean(JSON.parse(localStorage.getItem(key()) ?? 'null')); } catch(e) { return {...DEFAULTS}; }
    },
    set(change) {
        const next = clean({...this.get(), ...change});
        try { localStorage.setItem(key(), JSON.stringify(next)); } catch(e) {}
        window.dispatchEvent(new CustomEvent('rider-model:settings', {detail: {data: next}}));
        return next;
    },
};

export { modelSettings };
