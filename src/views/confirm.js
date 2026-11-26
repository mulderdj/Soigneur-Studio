//
// Styled in-app confirmation dialog (replaces blocking native window.confirm()).
//
//   const ok = await confirmAction({
//       title: 'End ride?',
//       message: 'Stop the clock and finish this ride?',
//       confirmLabel: 'End ride',
//       danger: true,
//   });
//

import { esc } from './training/format.js';

let pending = null;

function confirmAction({title = 'Confirm', message = '', confirmLabel = 'Confirm', cancelLabel = 'Cancel', danger = false} = {}) {
    if(typeof document === 'undefined' || !document.body) return Promise.resolve(false);
    // cancel any superseded dialog cleanly
    if(pending) { pending.resolve(false); pending = null; }

    let dlg = document.querySelector('#dialog--confirm');
    if(!dlg) {
        dlg = document.createElement('dialog');
        dlg.id = 'dialog--confirm';
        dlg.className = 'dialog confirm-dialog';
        dlg.setAttribute('aria-labelledby', 'confirm-dialog-title');
        dlg.setAttribute('aria-describedby', 'confirm-dialog-message');
        document.body.append(dlg);
    }

    dlg.innerHTML = `
        <h2 id="confirm-dialog-title" class="card__title">${esc(title)}</h2>
        <p id="confirm-dialog-message" class="confirm-dialog__msg">${esc(message)}</p>
        <div class="confirm-dialog__actions">
            <button type="button" class="btn btn--secondary" data-confirm="cancel">${esc(cancelLabel)}</button>
            <button type="button" class="btn ${danger ? 'btn--danger' : 'btn--primary'}" data-confirm="ok">${esc(confirmLabel)}</button>
        </div>`;

    return new Promise(resolve => {
        let settled = false;
        const finish = (value) => {
            if(settled) return;
            settled = true;
            dlg.removeEventListener('click', onClick);
            dlg.removeEventListener('cancel', onCancel);
            dlg.removeEventListener('close', onClose);
            if(dlg.open) {
                if(typeof dlg.close === 'function') dlg.close();
                else dlg.open = false;
            }
            if(pending?.resolve === resolve) pending = null;
            resolve(value);
        };
        const onClick = (e) => {
            if(e.target === dlg || e.target.closest('[data-confirm="cancel"]')) finish(false);
            else if(e.target.closest('[data-confirm="ok"]')) finish(true);
        };
        const onCancel = (e) => { e.preventDefault(); finish(false); };
        const onClose = () => finish(false);

        pending = {resolve};
        dlg.addEventListener('click', onClick);
        dlg.addEventListener('cancel', onCancel);
        dlg.addEventListener('close', onClose);
        if(typeof dlg.showModal === 'function') dlg.showModal();
        else dlg.open = true;
        dlg.querySelector('[data-confirm="cancel"]')?.focus?.();
    });
}

export { confirmAction };
