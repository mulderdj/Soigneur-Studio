/**
 * @jest-environment jsdom
 */

import { models } from '../../src/models/models.js';
import { applyPalette, applyThemeMode } from '../../src/views/data-views.js';

describe('Palette model and theme application', () => {
    let meta;

    beforeEach(() => {
        localStorage.clear();
        document.body.className = 'dark-theme';
        delete document.body.dataset.palette;
        document.head.innerHTML = '';
        meta = document.createElement('meta');
        meta.setAttribute('name', 'theme-color');
        meta.setAttribute('content', '#151B23');
        document.head.appendChild(meta);
        models.palette.set(models.palette.default);
    });

    test('validates, labels, switches, and persists palette in localStorage', () => {
        expect(models.palette.default).toBe('default');
        expect(models.palette.isValid('default')).toBe(true);
        expect(models.palette.isValid('abricot')).toBe(true);
        expect(models.palette.isValid('unknown')).toBe(false);

        expect(models.palette.label('default')).toBe('Default');
        expect(models.palette.label('abricot')).toBe('Abricot Siena');
        expect(models.palette.label('other')).toBe('Default');

        expect(models.palette.switch('default')).toBe('abricot');
        expect(models.palette.switch('abricot')).toBe('default');
        expect(models.palette.switch('bad')).toBe('default');

        models.palette.backup('abricot');
        expect(models.palette.restore()).toBe('abricot');

        models.palette.backup('default');
        expect(models.palette.restore()).toBe('default');
    });

    test('applyPalette toggles data-palette and updates meta theme-color for dark and light modes', () => {
        applyPalette('abricot');
        expect(document.body.dataset.palette).toBe('abricot');
        expect(meta.getAttribute('content')).toBe('#17120F');

        applyThemeMode('WHITE');
        expect(document.body.className).toBe('white-theme');
        expect(meta.getAttribute('content')).toBe('#FAF7F2');

        applyPalette('default');
        expect(document.body.dataset.palette).toBeUndefined();
        expect(meta.getAttribute('content')).toBe('#ECEFF3');

        applyThemeMode('DARK');
        expect(document.body.className).toBe('dark-theme');
        expect(meta.getAttribute('content')).toBe('#151B23');
    });
});
