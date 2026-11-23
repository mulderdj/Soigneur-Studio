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

    // ?simulate&history: a generated training history for the Training page,
    // written once the rider's database is open
    if(new URLSearchParams(location.search).has('history')) {
        let ftp = 250, weight = 75;
        xf.sub('db:ftp', x => { ftp = x; });
        xf.sub('db:weight', x => { weight = x; });
        xf.sub('activity:restore', () => {
            import('./dev/history-seed.js').then(seed => seed.seedHistory({ftp, weight}));
        });
    }
}

export {
    start,
    stop,
};

