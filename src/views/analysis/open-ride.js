//
// Lightweight navigation helper for opening a ride on the analysis page
// (<ride-page>), kept separate from ride-page.js so the Ride page doesn't
// pull uPlot and the ride analysis engine into the initial bundle.
//

import { xf } from '../../functions.js';

function rideFromHash() {
    const m = /^#ride=(.+)$/.exec(location.hash);
    if(!m) return null;
    try { return decodeURIComponent(m[1]); } catch(e) { return null; }
}

function openRide(id, from = 'training') {
    const hash = `#ride=${encodeURIComponent(id)}`;
    if(location.hash !== hash) history.pushState(null, '', hash);
    xf.dispatch('ui:page-set', 'analysis');
    window.dispatchEvent(new CustomEvent('ride:open', {detail: {id, from}}));
}

export { openRide, rideFromHash };
