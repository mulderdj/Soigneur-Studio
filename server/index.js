'use strict';

// Start the Soigneur Studio account server.
//
//   PORT          default 3000
//   DATA_DIR      default ./data (the SQLite file lives here)
//   ALLOW_SIGNUP  "true" lets anyone with the address create a rider account;
//                 otherwise only the first account (the admin) can sign up and
//                 the admin creates everyone else.
//   PUBLIC_URL, STRAVA_CLIENT_ID, STRAVA_CLIENT_SECRET
//                 enable "Connect Strava" (see docs); intervals.icu needs no setup.

const fs = require('node:fs');
const path = require('node:path');
const { createApp } = require('./app.js');

const port = Number(process.env.PORT ?? 3000);
const dataDir = process.env.DATA_DIR ?? path.join(__dirname, 'data');
fs.mkdirSync(dataDir, {recursive: true});

const { server, connections, intervalsSync, garminSync } = createApp({
    dbPath: path.join(dataDir, 'auuki.db'), // the file name from before the rename: keeps existing accounts
    allowSignup: String(process.env.ALLOW_SIGNUP ?? '').toLowerCase() === 'true',
    connections: {
        // the address riders open the app at, e.g. https://soigneur.lan:8443;
        // Strava sends riders back to PUBLIC_URL/api/connect/strava/callback
        publicUrl: process.env.PUBLIC_URL ?? '',
        strava: {
            clientId: process.env.STRAVA_CLIENT_ID ?? '',
            clientSecret: process.env.STRAVA_CLIENT_SECRET ?? '',
        },
    },
    // INTERVALS_READ_ONLY=true: bring activities and planned workouts in from
    // intervals.icu but never write planned workouts there (for a first try)
    intervals: {readOnly: String(process.env.INTERVALS_READ_ONLY ?? '').toLowerCase() === 'true'},
});
connections.resume();
intervalsSync.start(); // every 15 minutes for each rider with intervals.icu connected
garminSync.start();    // every 15 minutes for each rider with a Garmin key

server.listen(port, () => {
    console.log(`Soigneur Studio account server on :${port}, data in ${dataDir}`);
});

for(const signal of ['SIGINT', 'SIGTERM']) {
    process.on(signal, () => server.close(() => process.exit(0)));
}
