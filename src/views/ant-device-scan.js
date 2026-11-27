// @ts-check
//
// <request-popup>: ANT+ device chooser dialog (WebUSB ANT+ scan results).
//

import { xf } from '../functions.js';

const DEVICE_TYPES = {
    17: 'Fitness Equipment',
    11: 'Bicycle Power',
    120: 'Heart Rate',
    121: 'Speed & Cadence',
    122: 'Cadence',
    123: 'Speed',
};

function deviceTypeLabel(type) {
    return DEVICE_TYPES[type] ?? `ANT+ (${type ?? '?'})`;
}

class RequestPopup extends HTMLElement {
    constructor() {
        super();
        /** @type {{deviceId?: any, selected?: string}} */
        this.state = {};
        /** @type {AbortController | null} */
        this._abort = null;
        this.list = this.querySelector('#request-popup-list');
        this.status = this.querySelector('#request-popup-status');
        this.cancelBtn = this.querySelector('#request-popup-cancel-btn');
        this.pairBtn = this.querySelector('#request-popup-pair-btn');
    }

    connectedCallback() {
        this._abort?.abort();
        this._abort = new AbortController();
        const signal = { signal: this._abort.signal };

        xf.sub('db:antDeviceId', id => { this.state.deviceId = id; }, signal);
        xf.sub('db:antSearchList', list => {
            if(Array.isArray(list) && list.length > 0) this.add(list[list.length - 1]);
        }, signal);
        xf.sub('ant:search:started', () => this.show(), signal);
        xf.sub('ant:search:stopped', () => { this.clear(); this.hide(); }, signal);
        xf.sub('ant:request:pair', () => {
            if(!this.state.selected) return;
            this.clear();
            this.hide();
        }, signal);
        xf.sub('ant:request:cancel', () => { this.clear(); this.hide(); }, signal);

        this.list?.addEventListener('pointerup', e => this.onSelect(e), signal);
    }

    disconnectedCallback() {
        this._abort?.abort();
        this._abort = null;
    }

    /** @param {Event} e */
    onSelect(e) {
        const el = /** @type {HTMLElement | null} */ (/** @type {Element} */ (e.target).closest('.device-chooser-item'));
        if(!el || !el.id) return;
        this.state.selected = el.id;
        this.list?.querySelectorAll('.device-chooser-item').forEach(node => {
            /** @type {HTMLElement} */ (node).classList.toggle('is-selected', node === el);
        });
        xf.dispatch('ui:ant:request:selected', el.id);
    }

    show() { this.style.display = 'block'; }
    hide() { this.style.display = 'none'; }
    clear() { if(this.list) this.list.innerHTML = ''; }

    /** @param {{deviceNumber: number | string, deviceType: number}} device */
    add(device) {
        if(!this.list || !device) return;
        const item = document.createElement('div');
        item.className = 'device-chooser-item';
        item.id = String(device.deviceNumber);
        item.innerHTML = `
            <div class="device-connection-type t2">ANT+</div>
            <div class="device-number t3">${String(device.deviceNumber)}</div>
            <div class="device-type t2">${deviceTypeLabel(device.deviceType)}</div>`;
        this.list.append(item);
    }
}

if(!customElements.get('request-popup')) {
    customElements.define('request-popup', RequestPopup);
}

export { RequestPopup as Request, deviceTypeLabel };
