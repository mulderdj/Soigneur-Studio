//
// The .fit inside a ZIP (Garmin's activity download: one deflated
// <id>_ACTIVITY.fit). Reads the central directory; stored and deflated
// entries; Node's zlib, no dependency. Anything unexpected gives null.
//

const zlib = require('node:zlib');

const EOCD = 0x06054b50, CENTRAL = 0x02014b50, LOCAL = 0x04034b50;
const MAX_FIT = 100 * 1024 * 1024;

const isFit = b => !!b && b.length >= 14 && b.toString('ascii', 8, 12) === '.FIT';

function endRecord(buf) {
    // the end record is within the last 22 + 65535 (comment) bytes
    for(let i = buf.length - 22; i >= Math.max(0, buf.length - 22 - 65535); i--) {
        if(buf.readUInt32LE(i) === EOCD) return i;
    }
    return -1;
}

function firstFitInZip(buf) {
    try {
        if(!Buffer.isBuffer(buf) || buf.length < 22) return null;
        const end = endRecord(buf);
        if(end < 0) return null;
        const count = buf.readUInt16LE(end + 10);
        let p = buf.readUInt32LE(end + 16);
        for(let i = 0; i < count; i++) {
            if(p + 46 > buf.length || buf.readUInt32LE(p) !== CENTRAL) return null;
            const method = buf.readUInt16LE(p + 10);
            const size = buf.readUInt32LE(p + 20);
            const full = buf.readUInt32LE(p + 24);
            const nameLen = buf.readUInt16LE(p + 28), extraLen = buf.readUInt16LE(p + 30), commentLen = buf.readUInt16LE(p + 32);
            const local = buf.readUInt32LE(p + 42);
            const name = buf.toString('utf8', p + 46, p + 46 + nameLen);
            p += 46 + nameLen + extraLen + commentLen;
            if(!name.toLowerCase().endsWith('.fit') || full > MAX_FIT) continue;
            if(local + 30 > buf.length || buf.readUInt32LE(local) !== LOCAL) return null;
            const start = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28);
            if(start + size > buf.length) return null;
            const body = buf.subarray(start, start + size);
            const data = method === 0 ? Buffer.from(body) : method === 8 ? zlib.inflateRawSync(body, {maxOutputLength: MAX_FIT}) : null;
            return isFit(data) ? data : null;
        }
        return null;
    } catch(e) {
        return null;
    }
}

module.exports = { firstFitInZip, isFit };
