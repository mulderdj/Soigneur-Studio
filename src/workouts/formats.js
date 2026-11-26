//
// Workout file formats
//
// Every text format is converted to ZWO and then read by the existing ZWO
// reader, so ramps, text cues, the editor and the workout graph all work the
// same whatever the source file was.
//
//   .zwo  Zwift                       (native)
//   .xml  ZWO saved with .xml         (native)
//   .erg  absolute watts              (TrainerRoad, GoldenCheetah, PerfPRO, ...)
//   .mrc  percent of FTP              (TrainerRoad, GoldenCheetah, PerfPRO, ...)
//   .txt  intervals.icu workout text  ("- 10m ramp 50-75%", "5x", "90rpm", ...)
//   .fit  course                      (binary, handled by fit/local-course.js)
//
// Power below 10 is read by the app as a fraction of FTP, anything above as
// absolute watts (see models.ftp.toAbsolute), so absolute ERG files keep
// working even without an FTP in their header.
//

const TEXT_EXTENSIONS   = ['zwo', 'xml', 'erg', 'mrc', 'txt'];
const BINARY_EXTENSIONS = ['fit'];
const EXTENSIONS        = [...TEXT_EXTENSIONS, ...BINARY_EXTENSIONS];
const ACCEPT            = EXTENSIONS.map(e => `.${e}`).join(',');

function extensionOf(name = '') {
    const parts = String(name).toLowerCase().split('.');
    return parts.length > 1 ? parts.pop() : '';
}

function baseName(name = '') {
    return String(name).replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' ').trim() || 'Workout';
}

function escapeXml(s = '') {
    return String(s)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

function round(x, digits = 3) {
    const k = Math.pow(10, digits);
    return Math.round(x * k) / k;
}

// --- segments -> zwo -------------------------------------------------------
//
// segment: {duration: s, from: power, to: power, cadence?, messages?: [{offset, text}]}
// power is either a fraction of FTP (< 10) or absolute watts

function segmentToZwo(seg) {
    const d = Math.round(seg.duration);
    if(d <= 0) return '';
    const cad = seg.cadence > 0 ? ` Cadence="${Math.round(seg.cadence)}"` : '';
    const events = (seg.messages ?? [])
          .map(m => `<textevent timeoffset="${Math.max(0, Math.round(m.offset))}" message="${escapeXml(m.text)}"/>`)
          .join('');
    const close = events ? `>${events}</%TAG%>` : ' />';
    if(seg.from === seg.to) {
        return `<SteadyState Duration="${d}" Power="${round(seg.from)}"${cad}${close.replace('%TAG%', 'SteadyState')}`;
    }
    return `<Ramp Duration="${d}" PowerLow="${round(seg.from)}" PowerHigh="${round(seg.to)}"${cad}${close.replace('%TAG%', 'Ramp')}`;
}

function segmentsToZwo(segments, meta = {}) {
    const head = [
        `<author>${escapeXml(meta.author ?? 'Imported')}</author>`,
        `<name>${escapeXml(meta.name ?? 'Workout')}</name>`,
        `<description>${escapeXml(meta.description ?? '')}</description>`,
        `<category>${escapeXml(meta.category ?? 'Imported')}</category>`,
        `<sportType>bike</sportType>`,
    ].join('');
    const body = segments.map(segmentToZwo).join('');
    return `<workout_file>${head}<workout>${body}</workout></workout_file>`;
}

// --- ERG / MRC ------------------------------------------------------------
//
// [COURSE HEADER]
// FTP = 250            (optional)
// FILE NAME = ...      (optional)
// DESCRIPTION = ...    (optional)
// MINUTES WATTS        (erg)  or  MINUTES PERCENT (mrc)
// [END COURSE HEADER]
// [COURSE DATA]
// 0.00	100
// 10.00	150          a change in value at a new time is a ramp,
// 10.00	250          the same time twice is a step
// [END COURSE DATA]
// [COURSE TEXT]        (optional)
// 600	Go!	10         seconds, message, duration
// [END COURSE TEXT]

function section(text, name) {
    const re = new RegExp(`\\[${name}\\]([\\s\\S]*?)\\[END ${name}\\]`, 'i');
    const m = text.match(re);
    return m ? m[1] : '';
}

function readHeader(headerText) {
    const header = {};
    headerText.split(/\r?\n/).forEach(line => {
        const m = line.match(/^\s*([^=]+?)\s*=\s*(.*?)\s*$/);
        if(m) header[m[1].toUpperCase()] = m[2];
        else if(/MINUTES\s+WATTS/i.test(line)) header.UNITS = 'WATTS';
        else if(/MINUTES\s+PERCENT/i.test(line)) header.UNITS = 'PERCENT';
    });
    return header;
}

function readErgMrc(text, name, ext) {
    const header = readHeader(section(text, 'COURSE HEADER'));
    const units  = header.UNITS ?? (ext === 'mrc' ? 'PERCENT' : 'WATTS');
    const ftp    = parseFloat(header.FTP);

    const points = section(text, 'COURSE DATA')
          .split(/\r?\n/)
          .map(l => l.trim().split(/[\s,;]+/).map(Number))
          .filter(p => p.length >= 2 && Number.isFinite(p[0]) && Number.isFinite(p[1]))
          .map(([min, v]) => ({t: min * 60, v}));

    if(points.length < 2) {
        throw new Error(`${name}: no [COURSE DATA] found`);
    }

    const toPower = v => {
        if(units === 'PERCENT') return v / 100;
        return ftp > 0 ? v / ftp : v;     // absolute watts if FTP is unknown
    };

    const segments = [];
    for(let i = 0; i < points.length - 1; i++) {
        const a = points[i], b = points[i + 1];
        const duration = b.t - a.t;
        if(duration <= 0) continue;       // same time: a step
        segments.push({start: a.t, duration, from: toPower(a.v), to: toPower(b.v)});
    }

    // merge identical consecutive steady segments
    const merged = [];
    segments.forEach(s => {
        const last = merged[merged.length - 1];
        if(last && last.from === last.to && s.from === s.to && s.from === last.from) {
            last.duration += s.duration;
        } else {
            merged.push({...s});
        }
    });

    // [COURSE TEXT]: seconds <tab> message <tab> duration
    section(text, 'COURSE TEXT').split(/\r?\n/).forEach(line => {
        const cols = line.split('\t');
        const t = parseFloat(cols[0]);
        const msg = (cols[1] ?? '').trim();
        if(!Number.isFinite(t) || !msg || !merged.length) return;
        const seg = merged.find(s => t >= s.start && t < s.start + s.duration) ?? merged[merged.length - 1];
        (seg.messages ??= []).push({offset: t - seg.start, text: msg});
    });

    return segmentsToZwo(merged, {
        name: header['FILE NAME'] || baseName(name),
        description: header.DESCRIPTION ?? '',
    });
}

// --- intervals.icu text ---------------------------------------------------
//
// Warmup
// - 10m ramp 50-75% 85rpm
// Main set 5x
// - 4m 105%
// - 3m 55% easy spin
// Cooldown
// - 5m 50%
//
// Durations: 30s, 10m, 1h, 1m30s, 1:30 (mm:ss), 2'30". Power: 75%, 50-75%,
// 200w, 150-250w, Z2, Z2-Z3. Text that is not a duration, power or cadence
// becomes a cue shown when the step starts.

const ICU_ZONES = {z1: 0.50, z2: 0.65, z3: 0.83, z4: 0.98, z5: 1.13, z6: 1.35, z7: 1.60};

function parseDuration(tok) {
    let m;
    if((m = tok.match(/^(\d+):(\d{1,2})(?::(\d{1,2}))?$/))) {
        return m[3] !== undefined ? (+m[1]) * 3600 + (+m[2]) * 60 + (+m[3]) : (+m[1]) * 60 + (+m[2]);
    }
    if((m = tok.match(/^(\d+)'(?:(\d+)(?:"|'')?)?$/))) {
        return (+m[1]) * 60 + (+(m[2] ?? 0));
    }
    m = tok.match(/^(?:(\d+(?:\.\d+)?)h)?(?:(\d+(?:\.\d+)?)(?:m|min))?(?:(\d+(?:\.\d+)?)(?:s|sec))?$/i);
    if(m && (m[1] || m[2] || m[3])) {
        return (+(m[1] ?? 0)) * 3600 + (+(m[2] ?? 0)) * 60 + (+(m[3] ?? 0));
    }
    return null;
}

function parsePower(tok) {
    let m;
    if((m = tok.match(/^(\d+(?:\.\d+)?)(?:-(\d+(?:\.\d+)?))?%(?:ftp)?$/i))) {
        const a = +m[1] / 100, b = m[2] ? +m[2] / 100 : a;
        return [a, b];
    }
    if((m = tok.match(/^(\d+)(?:-(\d+))?w$/i))) {
        const a = +m[1], b = m[2] ? +m[2] : a;
        return [a, b];
    }
    if((m = tok.match(/^(z[1-7])(?:-(z[1-7]))?$/i))) {
        const a = ICU_ZONES[m[1].toLowerCase()];
        const b = m[2] ? ICU_ZONES[m[2].toLowerCase()] : a;
        return [a, b];
    }
    return null;
}

function readIntervalsText(text, name) {
    const segments = [];
    let block = null;   // {repeat, steps}

    const flush = () => {
        if(!block) return;
        for(let r = 0; r < block.repeat; r++) {
            block.steps.forEach(s => segments.push({...s, messages: s.messages ? [...s.messages] : undefined}));
        }
        block = null;
    };

    text.split(/\r?\n/).forEach(raw => {
        const line = raw.trim();
        if(!line) { flush(); return; }

        if(!line.startsWith('-')) {
            flush();
            const rep = line.match(/(?:^|\s)(\d+)\s*x\s*$/i);
            block = {repeat: rep ? Math.min(200, Math.max(1, +rep[1])) : 1, steps: []};
            return;
        }

        if(!block) block = {repeat: 1, steps: []};

        const tokens = line.slice(1).trim().split(/\s+/);
        let duration = null, power = null, cadence = 0, ramp = false;
        const words = [];
        tokens.forEach(tok => {
            const t = tok.replace(/,$/, '');
            let v;
            if(duration === null && (v = parseDuration(t)) !== null) { duration = v; return; }
            if(power === null && (v = parsePower(t))) { power = v; return; }
            if(/^ramp$/i.test(t)) { ramp = true; return; }
            if((v = t.match(/^(\d+)(?:-\d+)?rpm$/i))) { cadence = +v[1]; return; }
            words.push(tok);
        });
        if(!duration) return;
        const [from, to] = power ?? [0.5, 0.5];
        const step = {duration, from, to: ramp || from !== to ? to : from, cadence};
        if(words.length) step.messages = [{offset: 0, text: words.join(' ')}];
        block.steps.push(step);
    });
    flush();

    if(segments.length === 0) {
        throw new Error(`${name}: no steps found. Steps start with "-", e.g. "- 10m 65%"`);
    }
    return segmentsToZwo(segments, {name: baseName(name)});
}

// --- entry point ----------------------------------------------------------

// returns ZWO text for any supported text format
function toZwo(text, name = '') {
    const ext = extensionOf(name);
    const trimmed = String(text).trim();

    if(/^<\?xml|^<workout_file/i.test(trimmed)) return text;
    if(ext === 'erg' || ext === 'mrc' || /\[COURSE HEADER\]/i.test(trimmed)) {
        return readErgMrc(text, name, ext);
    }
    if(ext === 'txt' || /^\s*-\s*\d/m.test(trimmed)) {
        return readIntervalsText(text, name);
    }
    return text;
}

function isSupported(name = '') {
    return EXTENSIONS.includes(extensionOf(name));
}

function isBinary(name = '') {
    return BINARY_EXTENSIONS.includes(extensionOf(name));
}

export {
    toZwo,
    readErgMrc,
    readIntervalsText,
    extensionOf,
    isSupported,
    isBinary,
    EXTENSIONS,
    TEXT_EXTENSIONS,
    BINARY_EXTENSIONS,
    ACCEPT,
};
