/**
 * @jest-environment jsdom
 */
import { TestResult } from '../../src/views/test-result.js';

function setup() {
    const calls = [];
    TestResult.actions = {
        useModel: (v, mode) => calls.push(['model', v, mode]),
        useFtp: ftp => calls.push(['ftp', ftp]),
    };
    document.body.innerHTML = '<test-result></test-result>';
    const el = document.querySelector('test-result');
    const q = s => el.querySelector(s);
    const click = s => q(s).dispatchEvent(new MouseEvent('click', {bubbles: true}));
    return {el, q, click, calls};
}

const cpCtx = (extra = {}) => ({
    test: '3-12', ftp: 260, mode: 'ask',
    result: {ok: true, values: {p3: 361, p12: 278, cp: 250, wprime: 20000}},
    current: {cp: 260, wprime: 18000, source: 'settings'},
    fit: {ok: true, cp: 245, wprime: 21500},
    ...extra,
});

describe('<test-result>', () => {
    test('3 + 12: CP and W′, against now and the model; Use for W′bal', () => {
        const {el, q, click, calls} = setup();
        el.open(cpCtx());
        expect(q('dialog').hasAttribute('open')).toBe(true);
        expect(q('[data-k="cp"]').textContent).toBe('250 W');
        expect(q('[data-k="wprime"]').textContent).toBe('20.0 kJ');
        expect(el.textContent).toMatch(/260 W · 18\.0 kJ \(your settings\)/);
        expect(el.textContent).toMatch(/245 W · 21\.5 kJ/);
        expect(q('[data-tr="use-model"]').textContent).toBe('Use for W′bal');
        click('[data-tr="use-model"]');
        expect(calls).toEqual([['model', {cp: 250, wprime: 20000}, 'ask']]);
        expect(q('[data-tr="use-model"]')).toBeNull();
        expect(q('.tr-done').textContent).toMatch(/W′bal now uses/);
    });

    test('3 + 12 in Automatically: the button says it switches to Ask me', () => {
        const {el, q, click, calls} = setup();
        el.open(cpCtx({mode: 'auto', fit: {ok: false}}));
        expect(q('[data-tr="use-model"]').textContent).toMatch(/switches to Ask me/);
        expect(el.textContent).toMatch(/not enough efforts yet/);
        click('[data-tr="use-model"]');
        expect(calls[0][2]).toBe('auto');
    });

    test('FTP tests: the FTP against the current one; Use as FTP', () => {
        const {el, q, click, calls} = setup();
        el.open({test: 'ramp', ftp: 250, result: {ok: true, values: {best60: 325, ftp: 244}}});
        expect(q('[data-k="ftp"]').textContent).toBe('244 W');
        expect(el.textContent).toMatch(/250 W \(−6 W\)/);
        expect(el.textContent).toMatch(/Best minute325 W/);
        click('[data-tr="use-ftp"]');
        expect(calls).toEqual([['ftp', 244]]);
        expect(q('.tr-done').textContent).toBe('Your FTP is now 244 W.');

        el.open({test: '2x8', ftp: 279, result: {ok: true, values: {p8a: 320, p8b: 300, ftp: 279}}});
        expect(q('[data-tr="use-ftp"]')).toBeNull();          // same as now: nothing to offer
        expect(el.textContent).toMatch(/8 min, first320 W/);
        el.open({test: '20min', ftp: 0, result: {ok: true, values: {p20: 300, ftp: 285}}});
        expect(el.textContent).toMatch(/Your FTP now—/);
    });

    test('Sprint: peak and best 5 s, W/kg; no setting changes', () => {
        const {el, q} = setup();
        el.open({test: 'sprint', ftp: 250, result: {ok: true, values: {peak: 1100, best5: 970, sprints: 3, peakWkg: 14.7, best5Wkg: 12.9}}});
        expect(q('[data-k="peak"]').textContent).toBe('1100 W');
        expect(q('[data-k="best5"]').textContent).toBe('970 W');
        expect(q('[data-k="peak-wkg"]').textContent).toBe('14.7 W/kg');
        expect(q('[data-k="best5-wkg"]').textContent).toBe('12.9 W/kg');
        expect(q('[data-tr="use-ftp"], [data-tr="use-model"]')).toBeNull();
        el.open({test: 'sprint', ftp: 250, result: {ok: true, values: {peak: 1100, best5: 970, sprints: 1}}});
        expect(el.textContent).toMatch(/From 1 sprint\. Set your weight/);
        expect(q('[data-k="peak-wkg"]')).toBeNull();
    });

    test('not usable: the reason, nothing to tap but Close', () => {
        const {el, q, click, calls} = setup();
        el.open(cpCtx({result: {ok: false, values: {p3: 300, p12: 300}, reason: 'The 12 min was as hard as the 3 min: …'}}));
        expect(q('h2').textContent).toMatch(/no result/);
        expect(q('[data-k="reason"]').textContent).toMatch(/as hard as the 3 min/);
        expect(q('[data-tr="use-model"]')).toBeNull();
        click('[data-tr="close"]');
        expect(q('dialog').hasAttribute('open')).toBe(false);
        expect(calls).toEqual([]);
    });

    test('values are escaped', () => {
        const {el} = setup();
        el.open({test: 'ramp', ftp: 250, result: {ok: false, reason: '<b>x</b>'}});
        expect(el.querySelector('b')).toBeNull();
    });
});
