/**
 * @jest-environment jsdom
 */
import { uuid } from '../../src/storage/uuid.js';

const V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

describe('uuid', () => {
    const saved = globalThis.crypto;
    afterEach(() => Object.defineProperty(globalThis, 'crypto', {value: saved, configurable: true}));

    test('a plain v4 id, also on a page that is not secure (no crypto.randomUUID)', () => {
        let n = 0;
        Object.defineProperty(globalThis, 'crypto', {configurable: true, value: {
            getRandomValues: (a) => { for(let i = 0; i < a.length; i++) a[i] = (n++ * 37) & 0xFF; return a; },
        }});
        const id = uuid();
        expect(id).toMatch(V4);   // no curly braces: the account server only takes [A-Za-z0-9_-]
        expect(uuid()).not.toBe(id);
    });

    test('crypto.randomUUID when there is one', () => {
        Object.defineProperty(globalThis, 'crypto', {configurable: true, value: {randomUUID: () => 'r-1', getRandomValues: () => { throw new Error('unused'); }}});
        expect(uuid()).toBe('r-1');
    });
});
