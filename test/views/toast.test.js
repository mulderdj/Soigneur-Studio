/**
 * @jest-environment jsdom
 */
import { xf } from '../../src/functions.js';
import { ToastHost, showToast } from '../../src/views/toast.js';

describe('ToastHost', () => {
    beforeEach(() => {
        jest.useFakeTimers();
        document.body.innerHTML = '';
    });

    afterEach(() => {
        jest.useRealTimers();
    });

    test('shows a toast with tone, auto-dismisses, and resets timer on update', () => {
        const host = new ToastHost();
        host.show({text: 'ERG mode', tone: 'good', duration: 2000});
        const el = document.querySelector('.app-toast');
        expect(el).not.toBeNull();
        expect(el.hidden).toBe(false);
        expect(el.textContent).toBe('ERG mode');
        expect(el.dataset.tone).toBe('good');

        jest.advanceTimersByTime(1500);
        expect(el.hidden).toBe(false);
        host.show({text: 'Slope mode', tone: 'warn', duration: 2000});
        expect(el.textContent).toBe('Slope mode');
        expect(el.dataset.tone).toBe('warn');

        jest.advanceTimersByTime(1500);
        expect(el.hidden).toBe(false);
        jest.advanceTimersByTime(600);
        expect(el.hidden).toBe(true);
    });

    test('responds to ui:toast events and ignores empty strings', () => {
        showToast('   ');
        expect(document.querySelector('.app-toast')).toBeNull();
        xf.dispatch('ui:toast', 'Lap');
        const el = document.querySelector('.app-toast');
        expect(el.hidden).toBe(false);
        expect(el.textContent).toBe('Lap');
        expect(el.dataset.tone).toBe('info');
    });
});
