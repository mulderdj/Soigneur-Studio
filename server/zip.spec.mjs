// Reading the .fit out of a ZIP (Garmin's activity download).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import zlib from 'node:zlib';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { firstFitInZip } = require('./zip.js');

const fit = (n = 64) => { const b = Buffer.alloc(n, 7); b[0] = 14; b.write('.FIT', 8, 'ascii'); return b; };

// a minimal ZIP writer: local headers, central directory, end record
function zip(entries) {
    const locals = [], centrals = [];
    let offset = 0;
    for(const {name, data, method = 8} of entries) {
        const body = method === 8 ? zlib.deflateRawSync(data) : data;
        const n = Buffer.from(name);
        const crc = zlib.crc32(data);
        const local = Buffer.alloc(30);
        local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4); local.writeUInt16LE(method, 8);
        local.writeUInt32LE(crc, 14); local.writeUInt32LE(body.length, 18); local.writeUInt32LE(data.length, 22);
        local.writeUInt16LE(n.length, 26);
        const central = Buffer.alloc(46);
        central.writeUInt32LE(0x02014b50, 0); central.writeUInt16LE(20, 4); central.writeUInt16LE(20, 6); central.writeUInt16LE(method, 10);
        central.writeUInt32LE(crc, 16); central.writeUInt32LE(body.length, 20); central.writeUInt32LE(data.length, 24);
        central.writeUInt16LE(n.length, 28); central.writeUInt32LE(offset, 42);
        locals.push(local, n, body);
        centrals.push(central, n);
        offset += 30 + n.length + body.length;
    }
    const cd = Buffer.concat(centrals);
    const end = Buffer.alloc(22);
    end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(entries.length, 8); end.writeUInt16LE(entries.length, 10);
    end.writeUInt32LE(cd.length, 12); end.writeUInt32LE(offset, 16);
    return Buffer.concat([...locals, cd, end]);
}

test('a deflated .fit (as Garmin sends it)', () => {
    const f = fit(5000);
    assert.deepEqual(firstFitInZip(zip([{name: '123_ACTIVITY.fit', data: f}])), f);
});

test('a stored entry, and the first .fit among other files', () => {
    const f = fit();
    assert.deepEqual(firstFitInZip(zip([{name: 'readme.txt', data: Buffer.from('hi')}, {name: 'ride.FIT', data: f, method: 0}])), f);
});

test('no .fit, not a ZIP, a broken one, or an entry that isn\'t a FIT file: null', () => {
    assert.equal(firstFitInZip(zip([{name: 'notes.txt', data: Buffer.from('x')}])), null);
    assert.equal(firstFitInZip(Buffer.from('not a zip at all')), null);
    const z = zip([{name: 'a.fit', data: fit(3000)}]);
    assert.equal(firstFitInZip(z.subarray(0, z.length - 30)), null);
    assert.equal(firstFitInZip(zip([{name: 'a.fit', data: Buffer.from('plain text, no header here')}])), null);
    assert.equal(firstFitInZip(null), null);
});
