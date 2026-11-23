//
// .fit import on the Training page: rides intervals.icu can't provide
// (Strava-sourced, or Garmin's when its API access is blocked). Each
// readable activity becomes a ride summary with id fit-<start>, kept with
// the external rides and sent to the account; the .fit itself is not kept.
//

import { history, toDataView } from './history.js';
import { fitToSamples } from './fit-records.js';
import { rideSummary } from './summary.js';

const SAME_START_MS = 120000; // a ride already there that started within 2 min is the same ride

function baseName(name = '') {
    return String(name).replace(/\.fit$/i, '') || 'Imported ride';
}

async function importFitFiles(files = [], {ftp, weight} = {}) {
    const added = [], skipped = [], unreadable = [];
    const starts = (await history.summaries()).map(s => Number(s.start)).filter(Number.isFinite);

    for(const file of files) {
        let read;
        try {
            read = fitToSamples(await toDataView(file));
        } catch(e) {
            read = null;
        }
        if(!read || read.samples.length === 0 || !Number.isFinite(read.start)) {
            unreadable.push(file.name);
            continue;
        }
        if(starts.some(s => Math.abs(s - read.start) < SAME_START_MS)) {
            skipped.push(file.name);
            continue;
        }
        const s = rideSummary(read.samples, {
            id: `fit-${read.start}`, start: read.start, name: baseName(file.name), workoutId: null,
            ftp, weight, distance: read.distance,
        });
        await history.saveImported({...s, source: 'fit'});
        starts.push(read.start);
        added.push(file.name);
    }
    return {added, skipped, unreadable};
}

function importMessage({added = [], skipped = [], unreadable = []} = {}) {
    const n = (k, one, many) => `${k} ${k === 1 ? one : many}`;
    if(!added.length && !skipped.length && !unreadable.length) return 'No .fit files chosen.';
    const parts = [];
    if(added.length) parts.push(`Imported ${n(added.length, 'ride', 'rides')}.`);
    if(skipped.length) parts.push(added.length ?
        `${skipped.length} ${skipped.length === 1 ? 'was' : 'were'} already there.` :
        `No new rides: ${skipped.length} ${skipped.length === 1 ? 'was' : 'were'} already there.`);
    if(unreadable.length) parts.push(`Could not read: ${unreadable.join(', ')}.`);
    return parts.join(' ');
}

export { importFitFiles, importMessage, SAME_START_MS };
