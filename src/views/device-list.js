// @ts-check
//
// Settings → Devices: show only connected or paired (saved) devices, with an
// "+ Add device" button below to reveal and pair additional sensor types.
//

import { xf } from '../functions.js';
import { sensors } from '../sensors.js';

/**
 * Bind filtering and the "+ Add device" picker to a `.settings__devices` section.
 * @param {HTMLElement|null} section
 * @returns {{refresh: () => void, destroy: () => void}|null}
 */
function initDeviceList(section) {
    if(!section) return null;
    /** @type {HTMLElement[]} */
    const cards = Array.from(section.querySelectorAll('.device-card'));
    if(!cards.length) return null;

    const ac = new AbortController();
    const signal = {signal: ac.signal};
    const active = new Set();
    const revealed = new Set();

    const entries = cards.map(card => {
        const switches = Array.from(card.querySelectorAll('connection-switch'));
        const ids = switches.map(el => el.getAttribute('for')).filter(Boolean);
        const primary = ids[0] ?? '';
        const title = card.querySelector('.device-card--title')?.textContent?.trim() || primary;
        return {card, ids, primary, title};
    }).filter(e => e.primary);

    // Ensure empty note, Add button, and picker exist below the cards
    let $empty = /** @type {HTMLElement|null} */ (section.querySelector('.devices-empty'));
    if(!$empty) {
        $empty = document.createElement('p');
        $empty.className = 'card__note devices-empty';
        $empty.textContent = 'No connected or paired devices yet.';
        section.append($empty);
    }

    let $add = /** @type {HTMLButtonElement|null} */ (section.querySelector('.devices-add'));
    if(!$add) {
        $add = document.createElement('button');
        $add.type = 'button';
        $add.className = 'btn btn--secondary devices-add';
        $add.textContent = '+ Add device';
        $add.setAttribute('aria-expanded', 'false');
        section.append($add);
    }

    let $picker = /** @type {HTMLElement|null} */ (section.querySelector('.devices-picker'));
    if(!$picker) {
        $picker = document.createElement('div');
        $picker.className = 'card devices-picker';
        $picker.hidden = true;
        section.append($picker);
    }

    let pickerOpen = false;

    function pairedSet() {
        return new Set(sensors.list().map(d => d.identifier));
    }

    function isShown(entry, paired) {
        return entry.ids.some(id => paired.has(id) || active.has(id) || revealed.has(id));
    }

    function renderPicker(hiddenEntries) {
        if(!$picker || !$add) return;
        if(hiddenEntries.length === 0) {
            pickerOpen = false;
            $add.hidden = true;
            $picker.hidden = true;
            return;
        }
        $add.hidden = false;
        $add.setAttribute('aria-expanded', String(pickerOpen));
        $picker.hidden = !pickerOpen;
        if(!pickerOpen) return;
        $picker.innerHTML = hiddenEntries
            .map(e => `<button type="button" class="btn btn--secondary devices-picker__item" data-add-device="${e.primary}">${e.title}</button>`)
            .join('');
    }

    function refresh() {
        const paired = pairedSet();
        let shownCount = 0;
        const hiddenEntries = [];
        for(const e of entries) {
            const show = isShown(e, paired);
            e.card.hidden = !show;
            if(show) shownCount++;
            else hiddenEntries.push(e);
        }
        if($empty) $empty.hidden = shownCount > 0;
        renderPicker(hiddenEntries);
    }

    // Track live connection state for every device role in the section
    for(const e of entries) {
        for(const id of e.ids) {
            xf.sub(`${id}:connecting`, () => { active.add(id); refresh(); }, signal);
            xf.sub(`${id}:connected`, () => { active.add(id); refresh(); }, signal);
            xf.sub(`${id}:disconnected`, () => { active.delete(id); refresh(); }, signal);
        }
    }
    xf.sub('sensors:changed', () => refresh(), signal);

    $add.addEventListener('click', () => {
        pickerOpen = !pickerOpen;
        refresh();
    }, signal);

    $picker.addEventListener('click', ev => {
        const target = /** @type {HTMLElement|null} */ (ev.target);
        const btn = /** @type {HTMLElement|null} */ (target?.closest('[data-add-device]'));
        if(!btn) return;
        const id = btn.dataset.addDevice;
        if(!id) return;
        revealed.add(id);
        pickerOpen = false;
        const entry = entries.find(e => e.primary === id);
        if(entry && entry.card instanceof HTMLDetailsElement) entry.card.open = true;
        refresh();
        xf.dispatch(`ui:${id}:switch`);
    }, signal);

    refresh();

    return {
        refresh,
        destroy() { ac.abort(); },
    };
}

if(typeof document !== 'undefined') {
    const start = () => initDeviceList(/** @type {HTMLElement|null} */ (document.querySelector('.settings__devices')));
    if(document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, {once: true});
    else start();
}

export { initDeviceList };
