//
// <hr-thresholds>: the rider's threshold heart rate for cycling and
// running, in Settings. Empty uses Garmin's value (shown as a hint). Used
// for the load of workouts with heart rate but no power.
//

import { thresholds } from '../../training/rider-thresholds.js';
import { xf } from '../../functions.js';

class HrThresholds extends HTMLElement {
    constructor() {
        super();
        this._store = thresholds;
    }

    set store(s) {
        this._store = s;
        this.render();
    }

    connectedCallback() {
        this.render();
        this.abort = new AbortController();
        // Garmin's values arrive with the sync; the rider's own with the profile
        xf.sub('training:changed', () => { if(!this.contains(document.activeElement)) this.render(); }, {signal: this.abort.signal});
    }

    disconnectedCallback() {
        this.abort?.abort();
    }

    render() {
        if(!this.isConnected) return;
        const own = this._store.own();
        const garmin = this._store.garmin();
        const row = (sport, label) => `
            <div class="settings-tile">
                <label for="lthr-${sport}" class="settings-tile--label">${label}</label>
                <input id="lthr-${sport}" class="settings-tile--input input" name="${sport}" type="number" min="80" max="230" step="1"
                       inputmode="numeric" value="${own[sport] ?? ''}" placeholder="${garmin[sport] ? `${garmin[sport]} from Garmin` : 'bpm'}">
                <span class="settings-tile--unit">bpm</span>
            </div>`;
        this.innerHTML = `
            <form class="settings-tiles--cont hr-thresholds">
                <p class="settings-tile--hint">Threshold heart rate, for the training load of workouts with heart rate but no power. Leave empty to use Garmin's.</p>
                ${row('cycling', 'Threshold HR, cycling')}
                ${row('running', 'Threshold HR, running')}
                <button type="submit" class="btn btn--secondary hr-thresholds__save">Save</button>
            </form>`;
        this.querySelector('form').addEventListener('submit', e => {
            e.preventDefault();
            const data = Object.fromEntries(new FormData(e.target).entries());
            this._store.setOwn({cycling: data.cycling, running: data.running});
            this.render();
        });
    }
}

customElements.define('hr-thresholds', HrThresholds);

export { HrThresholds };
