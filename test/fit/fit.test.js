// import { describe, expect, test } from 'vitest';

import { dataviewToArray } from '../../src/functions.js';
import { fit } from '../../src/fit/fit.js';
import { appData, FITjs, fitBinary, flatFitBinary, } from './data.js';

describe('AppData', () => {
    // These used to compare byte for byte with files from an older encoder
    // (which now writes more fields). They check behaviour instead: what goes
    // in comes back out, the checksums hold, and older files still read.

    const records = (fitjs) => fitjs.filter(m => m.type === 'data' && m.name === 'record').map(m => m.fields);

    test('a ride written and read back keeps every record', () => {
        const view = fit.localActivity.encode({records: appData.records, laps: appData.laps});
        const decoded = fit.FITjs.decode(view);
        const back = records(decoded);
        expect(back).toHaveLength(appData.records.length);
        back.forEach((r, i) => {
            const a = appData.records[i];
            expect(r.timestamp).toBe(a.timestamp);
            for(const k of ['power', 'cadence', 'heart_rate']) if(a[k] !== undefined) expect(r[k]).toBe(a[k]);
        });
        expect(decoded.filter(m => m.type === 'data' && m.name === 'session')).toHaveLength(1);
        expect(decoded.filter(m => m.type === 'data' && m.name === 'lap')).toHaveLength(appData.laps.length);
    });

    test('the header and file checksums are right', () => {
        const view = fit.localActivity.encode({records: appData.records, laps: appData.laps});
        const bytes = new Uint8Array(view.buffer, view.byteOffset, view.byteLength);
        const headerSize = bytes[0];
        const headerCRC = fit.CRC.calculateCRC(new DataView(bytes.buffer, bytes.byteOffset), 0, headerSize - 3);
        expect(fit.CRC.getHeaderCRC(view).array).toEqual(fit.CRC.toArray(headerCRC));
        const fileCRC = fit.CRC.calculateCRC(new DataView(bytes.buffer, bytes.byteOffset), 0, bytes.length - 1 - fit.CRC.size);
        expect(fit.CRC.getFileCRC(view).array).toEqual(fit.CRC.toArray(fileCRC));
        // the header's data size matches the records written
        expect(new DataView(bytes.buffer, bytes.byteOffset).getUint32(4, true)).toBe(bytes.length - headerSize - fit.CRC.size);
    });

    test('a file from the older encoder still reads', () => {
        const view = new DataView(new Uint8Array(fitBinary.flat()).buffer);
        const decoded = fit.FITjs.decode(view);
        const expected = records(FITjs({crc: true}));
        const back = records(decoded);
        expect(back).toHaveLength(expected.length);
        expect(back.map(r => [r.timestamp, r.power, r.heart_rate])).toEqual(expected.map(r => [r.timestamp, r.power, r.heart_rate]));
    });
});
