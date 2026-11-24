//
// <sensor-panel>: the small panel under a sensor button in the Ride header
// (trainer, heart rate). Status, the device, its battery when it reports
// one, Connect / Disconnect, and for the trainer its mode (ERG, Resistance,
// Slope) and the mode lock. "All sensors" opens the rider menu's Sensors tab.
//
// A <connection-switch data-panel> asks for it with 'ui:sensor-panel'
// {for, anchor}. The trainer's mode control is markup inside the element
// ([data-sp-trainer]); it is moved into the panel, so it keeps working as is.
//

import { xf } from '../functions.js';
import { sensors } from '../sensors.js';
import { esc } from './training/format.js';

const NAMES = {'ble:controllable': 'Trainer', 'ble:heartRateMonitor': 'Heart rate'};
const STATUS = {on: 'Connected', loading: 'Connecting…', off: 'Not connected'};

class SensorPanel extends HTMLElement {
    connectedCallback() {
        if(this.$dialog) return;
        this.state = {};
        for(const id of Object.keys(NAMES)) this.state[id] = {status: 'off', name: null, battery: null};
        this.$trainer = this.querySelector('[data-sp-trainer]');
        this.$trainer?.remove();
        this.innerHTML = `<dialog class="sensor-panel" aria-label="Sensor"></dialog>`;
        this.$dialog = this.querySelector('dialog');
        this.$dialog.addEventListener('click', e => this.onClick(e));
        this.$dialog.addEventListener('keydown', e => { if(e.key === 'Escape') this.close(); });
        for(const id of Object.keys(NAMES)) {
            xf.sub(`${id}:connected`,    () => this.set(id, {status: 'on'}));
            xf.sub(`${id}:connecting`,   () => this.set(id, {status: 'loading'}));
            xf.sub(`${id}:disconnected`, () => this.set(id, {status: 'off', battery: null}));
            xf.sub(`${id}:name`,         name => this.set(id, {name}));
            xf.sub(`${id}:batteryLevel`, level => this.set(id, {battery: level}));
        }
        xf.sub('ui:sensor-panel', ({for: id, anchor} = {}) => this.open(id, anchor));
    }

    set(id, change) {
        Object.assign(this.state[id], change);
        if(this.$dialog.open && this.for === id) this.render();
    }

    open(id, anchor) {
        if(!NAMES[id]) return;
        if(this.$dialog.open && this.for === id) return this.close();
        this.for = id;
        this.render();
        if(typeof this.$dialog.showModal === 'function') { if(!this.$dialog.open) this.$dialog.showModal(); }
        else this.$dialog.setAttribute('open', '');
        this.place(anchor);
    }

    close() {
        if(typeof this.$dialog.close === 'function') this.$dialog.close();
        this.$dialog.removeAttribute('open');
    }

    // just under the button, inside the window
    place(anchor) {
        const r = anchor?.getBoundingClientRect?.();
        if(!r) return;
        const width = this.$dialog.offsetWidth || 300;
        const left = Math.max(8, Math.min(r.left, window.innerWidth - width - 8));
        this.$dialog.style.left = `${left}px`;
        this.$dialog.style.top = `${r.bottom + 8}px`;
    }

    onClick(e) {
        if(e.target === this.$dialog) {                          // the backdrop, not the panel's own padding
            const r = this.$dialog.getBoundingClientRect();
            const inside = e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom;
            if(!inside) this.close();
            return;
        }
        const b = e.target.closest('[data-sp]');
        if(!b) return;
        if(b.dataset.sp === 'switch') xf.dispatch(`ui:${this.for}:switch`);
        if(b.dataset.sp === 'close') this.close();
        if(b.dataset.sp === 'all') {
            this.close();
            const menu = document.querySelector('rider-menu');
            if(menu) { menu.tab = 'sensors'; menu.open?.(); }
        }
    }

    // the frame is made once; the trainer's mode control stays in it (its
    // buttons keep their listeners and state), only the text changes
    frame() {
        if(this.$rows) return;
        this.$dialog.innerHTML = `
            <div class="sp-head">
                <h2 class="sp-title" data-k="title"></h2>
                <span class="sp-status" data-k="status"></span>
                <button type="button" class="btn btn--icon sp-close" data-sp="close" aria-label="Close">×</button>
            </div>
            <dl class="sp-rows" data-k="rows"></dl>
            <div class="sp-trainer" data-k="trainer"></div>
            <div class="sp-actions">
                <button type="button" class="btn" data-sp="switch"></button>
                <button type="button" class="btn btn--quiet" data-sp="all">All sensors</button>
            </div>`;
        const k = name => this.$dialog.querySelector(`[data-k="${name}"]`);
        this.$title = k('title'); this.$status = k('status'); this.$rows = k('rows'); this.$slot = k('trainer');
        this.$switch = this.$dialog.querySelector('[data-sp="switch"]');
        if(this.$trainer) this.$slot.append(this.$trainer);
    }

    render() {
        this.frame();
        const id = this.for, s = this.state[id];
        const saved = sensors.list().find(d => d.identifier === id);
        const device = s.name ?? saved?.name ?? null;
        const connected = s.status === 'on';
        this.$title.textContent = NAMES[id];
        this.$status.textContent = STATUS[s.status];
        this.$status.dataset.status = s.status;
        this.$rows.innerHTML = `
            ${device ? `<div><dt>${connected ? 'Device' : 'Last used'}</dt><dd data-k="device">${esc(device)}</dd></div>` : ''}
            ${connected && Number.isFinite(s.battery) ? `<div><dt>Battery</dt><dd data-k="battery">${Math.round(s.battery)} %</dd></div>` : ''}`;
        this.$rows.hidden = !this.$rows.querySelector('div');
        this.$slot.hidden = id !== 'ble:controllable' || !this.$trainer;
        this.$switch.textContent = connected ? 'Disconnect' : s.status === 'loading' ? 'Cancel' : 'Connect';
        this.$switch.className = `btn ${connected ? 'btn--secondary' : 'btn--primary'}`;
    }
}

customElements.define('sensor-panel', SensorPanel);

export { SensorPanel };
