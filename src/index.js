import { xf } from './functions.js';
import './db.js';
import './views/views.js';
import './ble/devices.js';
import './ble/obc/controls.js';
import './watch.js';
import './course.js';
import './lock.js';

function startServiceWorker() {
    if('serviceWorker' in navigator) {
        try {
            // const reg = navigator.serviceWorker.register('./sw.js');

            const reg = navigator.serviceWorker.register(
                new URL('./sw.js', import.meta.url),
                {type: 'module'}
            );

            console.log(`SW: register success.`);
            console.log('Cache Version: Flux-v003');
        } catch(err) {
            console.log(`SW: register error: `, err);
        }
    };
}

function start() {
    console.log('start app.');

    // startServiceWorker(); // stable version only
    xf.dispatch('app:start');
}

function stop() {
    xf.dispatch('app:stop');
}

start();

// Development only: ?simulate feeds a simulated rider into the app
// (src/dev/simulator.js). module.hot only exists on the Parcel dev server
// (npm start), so production builds and Docker never run it.
if(typeof module !== 'undefined' && module.hot &&
   new URLSearchParams(location.search).has('simulate')) {
    import('./dev/simulator.js').then(simulator => simulator.start({xf}));
}

export {
    start,
    stop,
};

