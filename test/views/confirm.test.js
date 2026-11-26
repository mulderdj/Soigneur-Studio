/**
 * @jest-environment jsdom
 */
import { confirmAction } from '../../src/views/confirm.js';

describe('confirmAction', () => {
    beforeEach(() => {
        document.body.innerHTML = '';
        HTMLDialogElement.prototype.showModal = function() { this.open = true; };
        HTMLDialogElement.prototype.close = function() { this.open = false; };
    });

    test('resolves true when confirmed and closes the dialog', async () => {
        const p = confirmAction({title: 'End ride?', message: 'Stop now?', confirmLabel: 'End ride', danger: true});
        const dlg = document.querySelector('#dialog--confirm');
        expect(dlg.open).toBe(true);
        expect(dlg.textContent).toContain('End ride?');
        expect(dlg.querySelector('[data-confirm="ok"]').classList.contains('btn--danger')).toBe(true);
        dlg.querySelector('[data-confirm="ok"]').click();
        await expect(p).resolves.toBe(true);
        expect(dlg.open).toBe(false);
    });

    test('resolves false on cancel button or Escape cancel event', async () => {
        const p1 = confirmAction({title: 'Reset?', message: 'Reset layout?'});
        document.querySelector('[data-confirm="cancel"]').click();
        await expect(p1).resolves.toBe(false);

        const p2 = confirmAction({title: 'Remove?', message: 'Remove screen?'});
        document.querySelector('#dialog--confirm').dispatchEvent(new Event('cancel', {cancelable: true}));
        await expect(p2).resolves.toBe(false);
    });
});
