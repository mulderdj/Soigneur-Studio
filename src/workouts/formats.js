// @ts-check

const TEXT_EXTENSIONS = ['zwo', 'xml', 'erg', 'mrc', 'txt'];
const BINARY_EXTENSIONS = ['fit'];
const EXTENSIONS = [...TEXT_EXTENSIONS, ...BINARY_EXTENSIONS];
const ACCEPT = EXTENSIONS.map(ext => `.${ext}`).join(',');

const ZONE_MIDPOINTS = {
    z1: 0.50,
    z2: 0.65,
    z3: 0.83,
    z4: 0.98,
    z5: 1.13,
    z6: 1.35,
    z7: 1.60,
};

function extensionOf(filename = '') {
    const parts = String(filename).toLowerCase().split('.');
    return parts.length > 1 ? parts.pop() : '';
}

function workoutTitleFromFilename(filename = '') {
    const stem = String(filename).replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' ').trim();
    return stem || 'Workout';
}

function escapeXmlAttr(value = '') {
    return String(value)
        .replaceAll('&', '&amp;')
        .replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;')
        .replaceAll('"', '&quot;');
}

function roundPower(value, places = 3) {
    const scale = 10 ** places;
    return Math.round(value * scale) / scale;
}

function formatSegmentXml(segment) {
    const duration = Math.round(segment.duration);
    if (duration <= 0) return '';

    const cadenceAttr = segment.cadence > 0 ? ` Cadence="${Math.round(segment.cadence)}"` : '';
    const cuesXml = (segment.messages ?? [])
        .map(cue => `<textevent timeoffset="${Math.max(0, Math.round(cue.offset))}" message="${escapeXmlAttr(cue.text)}"/>`)
        .join('');

    if (segment.from === segment.to) {
        const body = cuesXml ? `>${cuesXml}</SteadyState>` : ' />';
        return `<SteadyState Duration="${duration}" Power="${roundPower(segment.from)}"${cadenceAttr}${body}`;
    }

    const body = cuesXml ? `>${cuesXml}</Ramp>` : ' />';
    return `<Ramp Duration="${duration}" PowerLow="${roundPower(segment.from)}" PowerHigh="${roundPower(segment.to)}"${cadenceAttr}${body}`;
}

function buildZwoDocument(segments, meta = {}) {
    const headerXml = [
        `<author>${escapeXmlAttr(meta.author ?? 'Imported')}</author>`,
        `<name>${escapeXmlAttr(meta.name ?? 'Workout')}</name>`,
        `<description>${escapeXmlAttr(meta.description ?? '')}</description>`,
        `<category>${escapeXmlAttr(meta.category ?? 'Imported')}</category>`,
        `<sportType>bike</sportType>`,
    ].join('');
    const bodyXml = segments.map(formatSegmentXml).join('');
    return `<workout_file>${headerXml}<workout>${bodyXml}</workout></workout_file>`;
}

function extractSection(source, sectionTitle) {
    const pattern = new RegExp(`\\[${sectionTitle}\\]([\\s\\S]*?)\\[END ${sectionTitle}\\]`, 'i');
    const match = source.match(pattern);
    return match ? match[1] : '';
}

function parseCourseHeader(headerBlock) {
    /** @type {Record<string, string>} */
    const fields = {};
    for (const line of headerBlock.split(/\r?\n/)) {
        const kv = line.match(/^\s*([^=]+?)\s*=\s*(.*?)\s*$/);
        if (kv) {
            fields[kv[1].toUpperCase()] = kv[2];
        } else if (/MINUTES\s+WATTS/i.test(line)) {
            fields.UNITS = 'WATTS';
        } else if (/MINUTES\s+PERCENT/i.test(line)) {
            fields.UNITS = 'PERCENT';
        }
    }
    return fields;
}

function readErgMrc(source, filename = '', ext = extensionOf(filename)) {
    const header = parseCourseHeader(extractSection(source, 'COURSE HEADER'));
    const units = header.UNITS ?? (ext === 'mrc' ? 'PERCENT' : 'WATTS');
    const ftp = parseFloat(header.FTP);

    const samples = extractSection(source, 'COURSE DATA')
        .split(/\r?\n/)
        .map(line => line.trim().split(/[\s,;]+/).map(Number))
        .filter(cols => cols.length >= 2 && Number.isFinite(cols[0]) && Number.isFinite(cols[1]))
        .map(([minutes, target]) => ({ timeS: minutes * 60, target }));

    if (samples.length < 2) {
        throw new Error(`${filename}: no [COURSE DATA] found`);
    }

    const normalizePower = raw => {
        if (units === 'PERCENT') return raw / 100;
        return ftp > 0 ? raw / ftp : raw;
    };

    const rawSegments = [];
    for (let i = 0; i < samples.length - 1; i++) {
        const cur = samples[i];
        const next = samples[i + 1];
        const duration = next.timeS - cur.timeS;
        if (duration <= 0) continue;
        rawSegments.push({
            start: cur.timeS,
            duration,
            from: normalizePower(cur.target),
            to: normalizePower(next.target),
        });
    }

    /** @type {any[]} */
    const merged = [];
    for (const seg of rawSegments) {
        const prev = merged[merged.length - 1];
        if (prev && prev.from === prev.to && seg.from === seg.to && seg.from === prev.from) {
            prev.duration += seg.duration;
        } else {
            merged.push({ ...seg });
        }
    }

    for (const line of extractSection(source, 'COURSE TEXT').split(/\r?\n/)) {
        const cols = line.split('\t');
        const cueTime = parseFloat(cols[0]);
        const cueText = (cols[1] ?? '').trim();
        if (!Number.isFinite(cueTime) || !cueText || merged.length === 0) continue;

        const hostSeg =
            merged.find(seg => cueTime >= seg.start && cueTime < seg.start + seg.duration) ??
            merged[merged.length - 1];
        (hostSeg.messages ??= []).push({ offset: cueTime - hostSeg.start, text: cueText });
    }

    return buildZwoDocument(merged, {
        name: header['FILE NAME'] || workoutTitleFromFilename(filename),
        description: header.DESCRIPTION ?? '',
    });
}

function parseStepDuration(token) {
    let match = token.match(/^(\d+):(\d{1,2})(?::(\d{1,2}))?$/);
    if (match) {
        return match[3] !== undefined
            ? Number(match[1]) * 3600 + Number(match[2]) * 60 + Number(match[3])
            : Number(match[1]) * 60 + Number(match[2]);
    }

    match = token.match(/^(\d+)'(?:(\d+)(?:"|'')?)?$/);
    if (match) {
        return Number(match[1]) * 60 + Number(match[2] ?? 0);
    }

    match = token.match(/^(?:(\d+(?:\.\d+)?)h)?(?:(\d+(?:\.\d+)?)(?:m|min))?(?:(\d+(?:\.\d+)?)(?:s|sec))?$/i);
    if (match && (match[1] || match[2] || match[3])) {
        return (
            Number(match[1] ?? 0) * 3600 +
            Number(match[2] ?? 0) * 60 +
            Number(match[3] ?? 0)
        );
    }

    return null;
}

function parseStepPower(token) {
    let match = token.match(/^(\d+(?:\.\d+)?)(?:-(\d+(?:\.\d+)?))?%(?:ftp)?$/i);
    if (match) {
        const low = Number(match[1]) / 100;
        const high = match[2] ? Number(match[2]) / 100 : low;
        return [low, high];
    }

    match = token.match(/^(\d+)(?:-(\d+))?w$/i);
    if (match) {
        const low = Number(match[1]);
        const high = match[2] ? Number(match[2]) : low;
        return [low, high];
    }

    match = token.match(/^(z[1-7])(?:-(z[1-7]))?$/i);
    if (match) {
        const low = ZONE_MIDPOINTS[match[1].toLowerCase()];
        const high = match[2] ? ZONE_MIDPOINTS[match[2].toLowerCase()] : low;
        return [low, high];
    }

    return null;
}

function readIntervalsText(source, filename = '') {
    /** @type {any[]} */
    const segments = [];
    /** @type {{ repeat: number, steps: any[] } | null} */
    let activeGroup = null;

    function flushGroup() {
        if (!activeGroup) return;
        for (let r = 0; r < activeGroup.repeat; r++) {
            for (const step of activeGroup.steps) {
                segments.push({
                    ...step,
                    messages: step.messages ? [...step.messages] : undefined,
                });
            }
        }
        activeGroup = null;
    }

    for (const rawLine of source.split(/\r?\n/)) {
        const line = rawLine.trim();
        if (!line) {
            flushGroup();
            continue;
        }

        if (!line.startsWith('-')) {
            flushGroup();
            const repeatMatch = line.match(/(?:^|\s)(\d+)\s*x\s*$/i);
            const count = repeatMatch ? Math.min(200, Math.max(1, Number(repeatMatch[1]))) : 1;
            activeGroup = { repeat: count, steps: [] };
            continue;
        }

        if (!activeGroup) {
            activeGroup = { repeat: 1, steps: [] };
        }

        const tokens = line.slice(1).trim().split(/\s+/);
        let duration = null;
        let powerRange = null;
        let cadence = 0;
        let isRamp = false;
        const cueTokens = [];

        for (const rawToken of tokens) {
            const clean = rawToken.replace(/,$/, '');
            if (duration === null) {
                const d = parseStepDuration(clean);
                if (d !== null) {
                    duration = d;
                    continue;
                }
            }
            if (powerRange === null) {
                const p = parseStepPower(clean);
                if (p !== null) {
                    powerRange = p;
                    continue;
                }
            }
            if (/^ramp$/i.test(clean)) {
                isRamp = true;
                continue;
            }
            const cadMatch = clean.match(/^(\d+)(?:-\d+)?rpm$/i);
            if (cadMatch) {
                cadence = Number(cadMatch[1]);
                continue;
            }
            cueTokens.push(rawToken);
        }

        if (!duration) continue;

        const [from, to] = powerRange ?? [0.5, 0.5];
        /** @type {any} */
        const step = {
            duration,
            from,
            to: isRamp || from !== to ? to : from,
            cadence,
        };
        if (cueTokens.length > 0) {
            step.messages = [{ offset: 0, text: cueTokens.join(' ') }];
        }
        activeGroup.steps.push(step);
    }

    flushGroup();

    if (segments.length === 0) {
        throw new Error(`${filename}: no steps found. Steps start with "-", e.g. "- 10m 65%"`);
    }

    return buildZwoDocument(segments, { name: workoutTitleFromFilename(filename) });
}

function toZwo(text, filename = '') {
    const ext = extensionOf(filename);
    const trimmed = String(text).trim();

    if (/^<\?xml|^<workout_file/i.test(trimmed)) {
        return text;
    }
    if (ext === 'erg' || ext === 'mrc' || /\[COURSE HEADER\]/i.test(trimmed)) {
        return readErgMrc(text, filename, ext);
    }
    if (ext === 'txt' || /^\s*-\s*\d/m.test(trimmed)) {
        return readIntervalsText(text, filename);
    }
    return text;
}

function isSupported(filename = '') {
    return EXTENSIONS.includes(extensionOf(filename));
}

function isBinary(filename = '') {
    return BINARY_EXTENSIONS.includes(extensionOf(filename));
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
