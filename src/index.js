import { xf } from './functions.js';
import './db.js';
import './views/views.js';
import './ble/devices.js';
import './ble/obc/controls.js';
import './watch.js';
import { startPowerMatch } from './power-match.js';
import { startFuelling } from './fuelling.js';
import './course.js';
import './lock.js';

startPowerMatch();
startFuelling();

// The service worker (src/sw.js) keeps the app usable without a connection.
// Production builds only: on the Vite dev server (import.meta.env.DEV) a cached
// app would hide every change, so there any earlier registration is removed.
const devServer = Boolean(import.meta.env?.DEV);

function startServiceWorker() {
    if(!('serviceWorker' in navigator)) return;
    if(devServer) {
        navigator.serviceWorker.getRegistrations?.()
            .then(regs => regs.forEach(r => r.unregister())).catch(() => {});
        return;
    }
    navigator.serviceWorker.register('/sw.js', {type: 'module'})
        .then(() => console.log(':sw :registered'))
        .catch(err => console.warn(':sw :register', err));   // e.g. an untrusted certificate
}

function start() {
    console.log('start app.');
    startServiceWorker();
    xf.dispatch('app:start');
}

function stop() {
    xf.dispatch('app:stop');
}

start();

// Development only: ?simulate feeds a simulated rider into the app
// (src/dev/simulator.js). import.meta.env.DEV is statically replaced with false
// in production builds, so Docker and production bundles tree-shake it out.
if(import.meta.env?.DEV &&
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

