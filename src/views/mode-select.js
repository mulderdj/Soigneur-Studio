//
// <select id="mode-select">: the trainer mode as one button on phones, in
// step with the segmented ERG / Resistance / Slope control on wider screens.
//

import { xf } from '../functions.js';

function wire(el = document.getElementById('mode-select')) {
    if(!el || el.dataset.wired) return;
    el.dataset.wired = '1';
    xf.sub('db:mode', mode => { if(mode && el.value !== mode) el.value = mode; });
    el.addEventListener('change', () => xf.dispatch('ui:mode-set', el.value));
}

if(document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => wire());
else wire();

export { wire };
