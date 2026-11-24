//
// <sensor-tray>: in the Ride header after the trainer and heart rate, the
// other sensors, each only while it is connected or connecting: an icon with
// its state as a badge, opening the sensor panel. When they don't fit
// (phones: 3, wider screens: 6) the rest folds into "+N", which opens a list.
//

import { xf } from '../functions.js';
import { SENSORS, EXTRA, icon } from './sensor-icons.js';
import { esc } from './training/format.js';

const PHONE = '(max-width: 599px)';
const room = () => (window.matchMedia?.(PHONE)?.matches ? 3 : 6);

// what fits: up to `max` icons; with more, max - 1 icons and "+N"
function fit(ids, max) {
    if(ids.length <= max) return {shown: ids, more: []};
    return {shown: ids.slice(0, max - 1), more: ids.slice(max - 1)};
}

class SensorTray extends HTMLElement {
    connectedCallback() {
        if(this.state) return;
        this.state = Object.fromEntries(EXTRA.map(id => [id, 'off']));
        for(const id of EXTRA) {
            xf.sub(`${id}:connected`,    () => this.set(id, 'on'));
            xf.sub(`${id}:connecting`,   () => this.set(id, 'loading'));
            xf.sub(`${id}:disconnected`, () => this.set(id, 'off'));
        }
        this.addEventListener('click', e => {
            const b = e.target.closest('[data-sensor], [data-more]');
            if(!b) return;
            if(b.dataset.more !== undefined) xf.dispatch('ui:sensor-panel', {for: 'more', ids: this.more, anchor: b});
            else xf.dispatch('ui:sensor-panel', {for: b.dataset.sensor, anchor: b});
        });
        window.matchMedia?.(PHONE)?.addEventListener?.('change', () => this.render());
        this.render();
    }

    set(id, status) {
        if(this.state[id] === status) return;
        this.state[id] = status;
        this.render();
    }

    inUse() { return EXTRA.filter(id => this.state[id] !== 'off'); }

    render() {
        const {shown, more} = fit(this.inUse(), room());
        this.more = more;
        const badge = status => `<span class="dot hdr-icon__dot ${status === 'on' ? 'on' : 'loading'}"></span>`;
        this.hidden = shown.length === 0;
        this.innerHTML = shown.map(id => `
            <button type="button" class="hdr-icon" data-sensor="${id}" aria-haspopup="dialog" title="${esc(SENSORS[id].name)}" aria-label="${esc(SENSORS[id].name)}">${icon(id)}${badge(this.state[id])}</button>`).join('') +
            (more.length ? `<button type="button" class="hdr-icon hdr-icon--more" data-more aria-haspopup="dialog" title="${more.length} more sensors" aria-label="${more.length} more sensors">+${more.length}${badge(more.every(id => this.state[id] === 'on') ? 'on' : 'loading')}</button>` : '');
    }
}

customElements.define('sensor-tray', SensorTray);

export { SensorTray, fit };
