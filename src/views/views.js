import './connection-switch.js';
import './data-views.js';
import './effect-views.js';
import './editor.js';
import './tabs.js';
import './app-bar.js';
import './panel-pager.js';
import './workout-list.js';
import './active-list-item.js';
import './activity-list.js';
import './workout-graph.js';
import './moxy-graph.js';
import './watch.js';
import './ant-device-scan.js';
import './keyboard.js';
import './training-dashboard.js';
import './ride-screens.js';
import './sensor-panel.js';
import '../training/wiring.js';
import '../training/rider-model-wiring.js';
import '../tests/wiring.js';
import './test-result.js';
import './training/training-page.js';
import { RidePage } from './analysis/ride-page.js';
import { rideSource } from './analysis/ride-source.js';
import { ReadinessNote } from './readiness-note.js';
import { readinessSource } from '../training/readiness-source.js';
import '../sensors.js';
import '../account/sync.js';
import './rider-menu.js';

RidePage.source = rideSource;
ReadinessNote.source = readinessSource;

function start() {
    console.log('start views.');
}

start();
