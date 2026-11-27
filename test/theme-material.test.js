/**
 * @jest-environment jsdom
 */
import {
    DEFAULT_MATERIAL_SEED,
    TOKEN_KEYS,
    normalizeSeed,
    buildMaterialTokens,
    applyMaterialTheme,
    clearMaterialTheme,
} from '../src/theme-material.js';

describe('Material You theme generator', () => {
    test('normalizes valid hex seeds and falls back for invalid input', () => {
        expect(normalizeSeed('#3b82f6')).toBe('#3B82F6');
        expect(normalizeSeed('  #006874  ')).toBe('#006874');
        expect(normalizeSeed('not-a-color')).toBe(DEFAULT_MATERIAL_SEED);
        expect(normalizeSeed(null)).toBe(DEFAULT_MATERIAL_SEED);
    });

    test('builds distinct dark and light Material 3 tonal palettes from a seed color', () => {
        const dark = buildMaterialTokens('#3B82F6', true);
        const light = buildMaterialTokens('#3B82F6', false);

        for(const k of TOKEN_KEYS) {
            expect(dark[k]).toBeTruthy();
            expect(light[k]).toBeTruthy();
        }
        expect(dark['--bg']).not.toBe(light['--bg']);
        expect(dark['--surface']).not.toBe(dark['--bg']);
        expect(light['--surface']).not.toBe(light['--bg']);
        expect(dark['--band']).toMatch(/^rgba\(/);
        expect(light['--band']).toMatch(/^rgba\(/);
    });

    test('applyMaterialTheme sets inline CSS variables and clearMaterialTheme removes them', () => {
        const el = document.createElement('div');
        const tokens = applyMaterialTheme('#10B981', true, el);
        expect(el.style.getPropertyValue('--accent')).toBe(tokens['--accent']);
        expect(el.style.getPropertyValue('--bg')).toBe(tokens['--bg']);

        clearMaterialTheme(el);
        for(const k of TOKEN_KEYS) {
            expect(el.style.getPropertyValue(k)).toBe('');
        }
    });
});
