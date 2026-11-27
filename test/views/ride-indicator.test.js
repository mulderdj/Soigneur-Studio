/**
 * @jest-environment jsdom
 */
import '../training/browser-stubs.js';
import { computeIndicator, INDICATOR_VARIANTS } from '../../src/views/ride-indicator.js';

describe('computeIndicator', () => {
    test('power computes zone, % FTP, and target ratio', () => {
        const d = computeIndicator('power', {power: 250, ftp: 250, powerTarget: 280});
        expect(d.valueText).toBe('250');
        expect(d.subText).toBe('100% FTP');
        expect(d.zoneLabel).toContain('Z5');
        expect(d.targetRatio).toBeGreaterThan(d.ratio);
        expect(d.segments).toHaveLength(7);
    });

    test('heart rate computes 5-zone HR scale', () => {
        const d = computeIndicator('hr', {heartRate: 152, maxHr: 190});
        expect(d.valueText).toBe('152');
        expect(d.subText).toBe('80% max');
        expect(d.zoneLabel).toContain('Z4');
    });

    test('cadence highlights optimal zone and target', () => {
        const d = computeIndicator('cadence', {cadence: 90, cadenceTarget: 95});
        expect(d.zoneLabel).toBe('Optimal');
        expect(d.subText).toBe('Target 95 rpm');
        expect(d.targetRatio).not.toBeNull();
    });

    test('speed supports metric and imperial units', () => {
        const m = computeIndicator('speed', {speed: 10, measurement: 'metric'});
        expect(m.unit).toBe('km/h');
        expect(m.valueText).toBe('36.0');
        const imp = computeIndicator('speed', {speed: 10, measurement: 'imperial'});
        expect(imp.unit).toBe('mph');
        expect(Number(imp.valueText)).toBeCloseTo(22.4, 1);
    });

    test('wbal reflects anaerobic reserve remaining', () => {
        const fresh = computeIndicator('wbal', {wbal: 18000, wprime: 20000});
        expect(fresh.valueText).toBe('90');
        expect(fresh.zoneLabel).toContain('W1');
        const low = computeIndicator('wbal', {wbal: 3000, wprime: 20000});
        expect(low.valueText).toBe('15');
        expect(low.zoneLabel).toContain('W4');
    });

    test('grade distinguishes descent, flat, and steep climb', () => {
        expect(computeIndicator('grade', {slope: -5}).zoneLabel).toBe('Descent');
        expect(computeIndicator('grade', {slope: 0}).zoneLabel).toBe('Flat');
        expect(computeIndicator('grade', {slope: 11}).zoneLabel).toBe('Steep');
    });
});

describe('<ride-indicator> element', () => {
    beforeEach(() => {
        localStorage.clear();
        document.body.innerHTML = '';
    });

    test('cycles through bar, arc, and pill variants on click and persists', () => {
        const el = document.createElement('ride-indicator');
        el.dataset.category = 'power';
        document.body.append(el);
        expect(el.dataset.variant).toBe(INDICATOR_VARIANTS[0]);
        expect(el.querySelector('.ri-bar__track')).not.toBeNull();

        el.click();
        expect(el.dataset.variant).toBe('arc');
        expect(el.querySelector('.ri-arc__svg')).not.toBeNull();

        el.click();
        expect(el.dataset.variant).toBe('pill');
        expect(el.querySelector('.ri-pill__track')).not.toBeNull();

        // Reload remembers last chosen variant
        const el2 = document.createElement('ride-indicator');
        el2.dataset.category = 'power';
        document.body.append(el2);
        expect(el2.dataset.variant).toBe('pill');
    });
});
