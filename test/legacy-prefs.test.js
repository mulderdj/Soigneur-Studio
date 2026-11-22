import { cleanupLegacyPrefs } from '../src/legacy-prefs.js';

const mem = (o) => ({ d: {...o}, getItem(k){return k in this.d ? this.d[k] : null},
    setItem(k,v){this.d[k]=String(v)}, removeItem(k){delete this.d[k]} });
const id = k => k;

describe('cleanupLegacyPrefs', () => {
    test('removes dock mode and planned, keeps everything else', () => {
        const s = mem({dockMode: 'true', planned: '[]', ftp: '250', theme: 'dark'});
        expect(cleanupLegacyPrefs(s, id).sort()).toEqual(['dockMode', 'planned']);
        expect(s.d).toEqual({ftp: '250', theme: 'dark'});
    });

    test('report page falls back to home', () => {
        const s = mem({page: 'report'});
        cleanupLegacyPrefs(s, id);
        expect(s.d.page).toBe('home');
    });

    test('per-rider keys and idempotent', () => {
        const s = mem({'rider:abc:dockMode': 'true', dockMode: 'true'});
        const key = k => `rider:abc:${k}`;
        expect(cleanupLegacyPrefs(s, key)).toEqual(['rider:abc:dockMode']);
        expect(s.d).toEqual({dockMode: 'true'});
        expect(cleanupLegacyPrefs(s, key)).toEqual([]);
    });

    test('storage that throws is left alone', () => {
        const s = {getItem() { throw new Error('denied'); }, setItem() {}, removeItem() {}};
        expect(cleanupLegacyPrefs(s, id)).toEqual([]);
    });
});
