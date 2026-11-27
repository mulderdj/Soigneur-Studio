// @ts-check
//
// One-time cleanup of stored values for features this version removed:
// dock mode, the upstream intervals.icu planned list, and the Ride Report
// page. Runs at start for the current rider; safe to run every time.
//

const REMOVED_KEYS = ['dockMode', 'planned'];
const REMOVED_PAGES = ['report', 'dock'];

function cleanupLegacyPrefs(storage, keyFor) {
    const changed = [];
    try {
        for(const k of REMOVED_KEYS) {
            const key = keyFor(k);
            if(storage.getItem(key) !== null) {
                storage.removeItem(key);
                changed.push(key);
            }
        }
        const pageKey = keyFor('page');
        if(REMOVED_PAGES.includes(storage.getItem(pageKey))) {
            storage.setItem(pageKey, 'home');
            changed.push(pageKey);
        }
    } catch(e) {
        // storage blocked (private window, site data off): nothing to clean
        return [];
    }
    return changed;
}

export { cleanupLegacyPrefs };
