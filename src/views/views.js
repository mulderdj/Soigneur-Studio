// @ts-check
import { xf } from '../functions.js';
import './connection-switch.js';
import './device-list.js';
import './data-views.js';
import './effect-views.js';
import './editor.js';
import './tabs.js';
import './app-bar.js';
import './app-fullscreen.js';
import './panel-pager.js';
import './workout-list.js';
import './active-list-item.js';
import './activity-list.js';
import './workout-graph.js';
import './moxy-graph.js';
import './watch.js';
import './ant-device-scan.js';
import './toast.js';
import './keyboard.js';
import './training-dashboard.js';
import './ride-screens.js';
import './sensor-panel.js';
import './sensor-tray.js';
import '../training/wiring.js';
import '../training/rider-model-wiring.js';
import '../tests/wiring.js';
import './test-result.js';
import './training/hr-thresholds.js';
import { rideFromHash } from './analysis/open-ride.js';
import { ReadinessNote } from './readiness-note.js';
import { readinessSource } from '../training/readiness-source.js';
import '../sensors.js';
import '../account/sync.js';
import './rider-menu.js';

ReadinessNote.source = readinessSource;

// Code-split heavy chart pages (Training and Ride Analysis + uPlot):
// loaded the first time the rider opens them, keeping Ride startup light.
let trainingLoaded = null;
function loadTraining() {
    if(!trainingLoaded) {
        trainingLoaded = import('./training/training-page.js').then(() => {
            /** @type {any} */ (document.querySelector('training-page'))?.onShow?.();
        });
    }
    return trainingLoaded;
}

let analysisLoaded = null;
let pendingRide = null;
function loadAnalysis() {
    if(!analysisLoaded) {
        analysisLoaded = Promise.all([
            import('./analysis/ride-page.js'),
            import('./analysis/ride-source.js'),
        ]).then(([{RidePage}, {rideSource}]) => {
            RidePage.source = rideSource;
            /** @type {any} */
            const el = document.querySelector('ride-page');
            if(pendingRide) {
                const {id, from} = pendingRide;
                pendingRide = null;
                if(el) { el.from = from; el.open(id); }
            } else {
                el?.fromHash?.();
            }
        });
    }
    return analysisLoaded;
}

xf.sub('db:page', page => {
    if(page === 'training') loadTraining();
    if(page === 'analysis') loadAnalysis();
});

if(typeof window !== 'undefined') {
    window.addEventListener('ride:open', e => {
        if(!customElements.get('ride-page')) {
            pendingRide = /** @type {CustomEvent} */ (e).detail;
            loadAnalysis();
        }
    });
    window.addEventListener('hashchange', () => { if(rideFromHash()) loadAnalysis(); });
    if(rideFromHash()) loadAnalysis();
}

function start() {
    console.log('start views.');
}

start();
