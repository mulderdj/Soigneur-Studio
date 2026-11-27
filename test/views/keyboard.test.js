/**
 * @jest-environment jsdom
 */
import { xf } from '../../src/functions.js';
import { ignoredKey, isHelpKey, toggleShortcutsDialog, formatLapToast, SHORTCUTS } from '../../src/views/keyboard.js';

const key = (target, init = {}) => {
    const e = new KeyboardEvent('keydown', {code: 'Space', key: ' ', bubbles: true, cancelable: true, ...init});
    Object.defineProperty(e, 'target', {value: target});
    return e;
};

describe('the ride shortcuts stay out of the way', () => {
    beforeEach(() => {
        document.body.innerHTML = '';
        xf.dispatch('db:watchStatus', {watchStatus: 'stopped'});
        xf.dispatch('db:workoutStatus', {workoutStatus: 'stopped'});
    });

    test('typing in a field that is not in a form (a screen name, W′) is not a shortcut', () => {
        for(const html of ['<input type="text">', '<input type="number">', '<textarea></textarea>', '<select></select>', '<div contenteditable="true"></div>']) {
            document.body.innerHTML = html;
            expect(ignoredKey(key(document.body.firstElementChild))).toBe(true);
        }
    });
    test('a key a control already handled (a tile handle in Edit layout) is not a shortcut', () => {
        const e = key(document.body);
        e.preventDefault();
        expect(ignoredKey(e)).toBe(true);
    });
    test('Space on the page is still the start key', () => {
        document.body.innerHTML = '<button>x</button>';
        expect(ignoredKey(key(document.body))).toBe(false);
        expect(ignoredKey(key(document.body, {ctrlKey: true}))).toBe(true);
    });
    test('? opens and closes the shortcuts cheat-sheet when not typing, documenting L for Lap', () => {
        expect(SHORTCUTS.some(([k, d]) => k === 'L' && /lap/i.test(d))).toBe(true);

        document.body.innerHTML = '<input type="text">';
        const helpOnInput = new KeyboardEvent('keydown', {key: '?', shiftKey: true, bubbles: true});
        Object.defineProperty(helpOnInput, 'target', {value: document.body.firstElementChild});
        expect(isHelpKey(helpOnInput)).toBe(false);

        const helpOnBody = new KeyboardEvent('keydown', {key: '?', shiftKey: true, bubbles: true});
        Object.defineProperty(helpOnBody, 'target', {value: document.body});
        expect(isHelpKey(helpOnBody)).toBe(true);

        toggleShortcutsDialog();
        const dlg = document.querySelector('#dialog--shortcuts');
        expect(dlg).not.toBeNull();
        expect(dlg.open).toBe(true);
        expect(dlg.textContent).toMatch(/Lap/i);
        dlg.close = () => { dlg.open = false; };
        toggleShortcutsDialog();
        expect(dlg.open).toBe(false);
    });

    test('lowercase l triggers ui:watchLap, toast "Lap N · mm:ss", and watch:lap-beep only when a ride is running', () => {
        expect(formatLapToast(1, 65)).toBe('Lap 1 · 01:05');

        let laps = 0;
        let lapBeeps = 0;
        const toasts = [];
        xf.sub('ui:watchLap', () => { laps += 1; });
        xf.sub('watch:lap-beep', () => { lapBeeps += 1; });
        xf.sub('ui:toast', t => toasts.push(t));

        const pressL = (target = document.body, extra = {}) => {
            const ev = new KeyboardEvent('keydown', {code: 'KeyL', key: 'l', bubbles: true, cancelable: true, ...extra});
            Object.defineProperty(ev, 'target', {value: target});
            window.dispatchEvent(ev);
        };

        // Ignored while stopped or paused
        pressL();
        xf.dispatch('db:watchStatus', {watchStatus: 'paused'});
        pressL();
        expect(laps).toBe(0);
        expect(lapBeeps).toBe(0);
        expect(toasts).toHaveLength(0);

        // Active ride: free-ride split counts up
        xf.dispatch('db:watchStatus', {watchStatus: 'started'});
        xf.dispatch('db:lapTime', {lapTime: 83});
        pressL();
        expect(laps).toBe(1);
        expect(lapBeeps).toBe(1);
        expect(toasts).toEqual(['Lap 1 · 01:23']);

        // Ignored when typing in an input or Shift+L
        const input = document.createElement('input');
        document.body.append(input);
        pressL(input);
        pressL(document.body, {key: 'L', shiftKey: true});
        expect(laps).toBe(1);

        // Structured workout: split is intervalDuration - remaining lapTime
        xf.dispatch('db:workoutStatus', {workoutStatus: 'started'});
        xf.dispatch('db:intervalDuration', {intervalDuration: 300});
        xf.dispatch('db:lapTime', {lapTime: 255});
        pressL();
        expect(laps).toBe(2);
        expect(lapBeeps).toBe(2);
        expect(toasts.at(-1)).toBe('Lap 2 · 00:45');
    });
});
