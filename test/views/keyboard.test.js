/**
 * @jest-environment jsdom
 */
import { ignoredKey } from '../../src/views/keyboard.js';

const key = (target, init = {}) => {
    const e = new KeyboardEvent('keydown', {code: 'Space', key: ' ', bubbles: true, cancelable: true, ...init});
    Object.defineProperty(e, 'target', {value: target});
    return e;
};

describe('the ride shortcuts stay out of the way', () => {
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
});
