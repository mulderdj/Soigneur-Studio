//
// The rider model in the app: worked out from the ride summaries and the
// settings, and applied to the live W′bal (training-dashboard.js) — never
// during a ride. 'rider-model:changed' carries the whole model for the cards.
//

import { xf } from '../functions.js';
import { db } from '../db.js';
import { history } from './history.js';
import { countable } from './merge.js';
import { today } from './dates.js';
import { currentModel } from './rider-model.js';
import { modelSettings } from './rider-model-settings.js';
import { applyModel, loadWprime } from '../views/training-dashboard.js';

const riding = () => db.watchStatus === 'started' || db.watchStatus === 'paused';

async function modelNow() {
    const summaries = countable(await history.summaries());
    return currentModel({summaries, today: today(), ftp: db.ftp, typedWprime: loadWprime(), settings: modelSettings.get()});
}

async function refresh() {
    let m;
    try { m = await modelNow(); } catch(e) { return; }       // the database isn't open yet
    if(!riding()) applyModel(m.effective);
    xf.dispatch('rider-model:changed', m);
}

xf.sub('activity:restore', refresh);
xf.sub('training:changed', refresh);
xf.sub('db:ftp', refresh);
xf.sub('dashboard:wprime', refresh);
xf.sub('db:watchStatus', s => { if(s === 'stopped') refresh(); });
window.addEventListener('rider-model:settings', refresh);

export { modelNow, refresh as refreshRiderModel };
