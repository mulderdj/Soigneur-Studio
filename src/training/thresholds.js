//
// Threshold heart rate per sport (cycling, running): the rider's own
// setting, and Garmin's from the account server. The rider's wins per
// sport. Kept per rider on this device; the own values also travel with
// the profile when signed in (src/account/sync.js).
//

const OWN = 'training:hrThresholds';
const GARMIN = 'training:garminThresholds';
const MIN = 80, MAX = 230;

function clean(v) {
    const n = Number(v);
    return v !== '' && v !== null && Number.isFinite(n) && n >= MIN && n <= MAX ? Math.round(n) : null;
}

function normal(t) {
    return {cycling: clean(t?.cycling), running: clean(t?.running)};
}

function createThresholds({key = k => k, onChange = () => {}} = {}) {
    const read = (k) => {
        try { return normal(JSON.parse(localStorage.getItem(key(k)) ?? 'null')); } catch(e) { return normal(null); }
    };
    const write = (k, v) => {
        try { localStorage.setItem(key(k), JSON.stringify(v)); } catch(e) {}
    };
    return {
        own: () => read(OWN),
        garmin: () => read(GARMIN),
        effective() {
            const o = read(OWN), g = read(GARMIN);
            return {cycling: o.cycling ?? g.cycling, running: o.running ?? g.running};
        },
        setOwn(v, {silent = false} = {}) {
            const n = normal(v);
            write(OWN, n);
            if(!silent) onChange(n);
            return n;
        },
        setGarmin(v) {
            write(GARMIN, normal(v));
        },
    };
}

export { createThresholds, normal as normalThresholds };
