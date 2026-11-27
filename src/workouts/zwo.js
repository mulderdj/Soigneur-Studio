// @ts-check
import {
    equals, existance, exists, empty, first, last, repeat, toFixed,
} from '../functions.js';

const RAMP_SLICE_SECONDS = 10;

function escapeXml(value) {
    return String(value ?? '')
        .replaceAll('&', '&amp;')
        .replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;')
        .replaceAll('"', '&quot;');
}

function readAttribute(options = {}) {
    const { el, name } = options;
    const decode = existance(options.decode, x => x);
    return el.hasAttribute(name) ? decode(el.getAttribute(name)) : undefined;
}

function writeAttribute(options = {}) {
    const encode = existance(options.encode, x => x);
    const name = existance(options.name);
    const value = existance(options.value);
    return `${name}="${encode(value)}"`;
}

function Attribute(options = {}) {
    const name = existance(options.name, '');
    const decode = existance(options.decode, x => x);
    const encode = existance(options.encode, decode);

    return Object.freeze({
        getName: () => name,
        read: (args = {}) => readAttribute({ el: existance(args.el), name, decode }),
        write: (args = {}) => writeAttribute({ name, value: existance(args.value), encode }),
    });
}

function attributesToStep(options = {}) {
    const tagObj = existance(options.element);
    const keepKey = existance(options.filter, () => true);
    const mapKey = existance(options.toName, x => x);

    /** @type {Record<string, any>} */
    const step = {};
    for (const key of Object.keys(tagObj)) {
        if (keepKey(key) && exists(tagObj[key])) {
            step[mapKey(key)] = tagObj[key];
        }
    }
    return step;
}

function Step(element) {
    return attributesToStep({
        element,
        filter: key => !equals(key, 'element') && !equals(key, 'children'),
        toName: key => key.toLowerCase(),
    });
}

function OnStep(element) {
    return attributesToStep({
        element,
        filter: key => key.startsWith('On') || equals(key, 'Cadence'),
        toName: key => key.replace(/On/g, '').toLowerCase(),
    });
}

function OffStep(element) {
    return attributesToStep({
        element,
        filter: key => key.startsWith('Off') || key.endsWith('Resting'),
        toName: key => key.replace(/On|Off|Resting/g, '').toLowerCase(),
    });
}

function isTextEventTagName(tagName) {
    return equals(String(tagName).toLowerCase(), 'textevent');
}

function readChildTextEvents(el) {
    const children = el.children || [];
    const events = [];
    for (let i = 0; i < children.length; i++) {
        if (isTextEventTagName(children[i].tagName)) {
            events.push(Elements.TextEvent.read({ el: children[i] }));
        }
    }
    return events;
}

function attachTextEvents(intervals, textEvents) {
    if (!exists(textEvents) || empty(textEvents)) {
        return intervals;
    }

    let cursor = 0;
    return intervals.map(interval => {
        const nextSteps = interval.steps.map(step => {
            if (!exists(step.duration)) return step;

            const start = cursor;
            const end = start + step.duration;
            cursor = end;

            const messages = [];
            for (const ev of textEvents) {
                if (!equals(ev.element, 'TextEvent') || !exists(ev.timeoffset)) continue;
                if (ev.timeoffset >= start && ev.timeoffset < end) {
                    /** @type {Record<string, any>} */
                    const cue = {
                        offset: ev.timeoffset - start,
                        message: ev.message,
                    };
                    if (exists(ev.duration)) {
                        cue.duration = ev.duration;
                    }
                    messages.push(cue);
                }
            }

            return empty(messages) ? step : { ...step, messages };
        });

        return { ...interval, steps: nextSteps };
    });
}

function decodeNumberList(raw) {
    return String(raw)
        .split(',')
        .map(part => parseFloat(part))
        .filter(n => !Number.isNaN(n));
}

function encodeNumberList(values) {
    return values.join(',');
}

const Attrs = {
    Duration: Attribute({ name: 'Duration', decode: val => parseInt(val, 10) }),
    OnDuration: Attribute({ name: 'OnDuration', decode: val => parseInt(val, 10) }),
    OffDuration: Attribute({ name: 'OffDuration', decode: val => parseInt(val, 10) }),

    Power: Attribute({ name: 'Power', decode: parseFloat }),
    OnPower: Attribute({ name: 'OnPower', decode: parseFloat }),
    OffPower: Attribute({ name: 'OffPower', decode: parseFloat }),
    PowerLow: Attribute({ name: 'PowerLow', decode: parseFloat }),
    PowerHigh: Attribute({ name: 'PowerHigh', decode: parseFloat }),

    Cadence: Attribute({ name: 'Cadence', decode: val => parseInt(val, 10) }),
    CadenceLow: Attribute({ name: 'CadenceLow', decode: val => parseInt(val, 10) }),
    CadenceHigh: Attribute({ name: 'CadenceHigh', decode: val => parseInt(val, 10) }),
    CadenceResting: Attribute({ name: 'CadenceResting', decode: val => parseInt(val, 10) }),

    Slope: Attribute({ name: 'Slope', decode: parseFloat }),
    OnSlope: Attribute({ name: 'OnSlope', decode: parseFloat }),
    OffSlope: Attribute({ name: 'OffSlope', decode: parseFloat }),
    SlopeLow: Attribute({ name: 'SlopeLow', decode: parseFloat }),
    SlopeHigh: Attribute({ name: 'SlopeHigh', decode: parseFloat }),

    Distance: Attribute({ name: 'Distance', decode: val => parseInt(val, 10) }),

    Sim: Attribute({ name: 'Sim', decode: decodeNumberList, encode: encodeNumberList }),
    Track: Attribute({ name: 'Track', decode: decodeNumberList, encode: encodeNumberList }),
    Repeat: Attribute({ name: 'Repeat', decode: val => parseInt(val, 10) }),

    duration: Attribute({ name: 'duration', decode: val => parseInt(val, 10) }),
    timeoffset: Attribute({ name: 'timeoffset', decode: val => parseInt(val, 10) }),
    message: Attribute({ name: 'message' }),
    TimeOffset: Attribute({ name: 'TimeOffset', decode: val => parseInt(val, 10) }),
    Message: Attribute({ name: 'Message' }),
};

function Element(options = {}) {
    const name = existance(options.name, 'Unknown');
    const tagOpen = existance(options.tagOpen, '<Unknown');
    const tagClose = existance(options.tagClose, ' />');
    const defaultContent = existance(options.content, '');

    function defaultCalcDuration(parsedEl) {
        return parsedEl.Duration;
    }

    const calcDuration = existance(options.calcDuration, defaultCalcDuration);

    function defaultToInterval(parsedEl) {
        return {
            duration: calcDuration(parsedEl),
            steps: [Step(parsedEl)],
        };
    }

    function defaultFromInterval(interval) {
        /** @type {Record<string, any>} */
        const out = {
            element: name,
            Duration: interval.duration,
        };
        const step = first(interval.steps);
        if (exists(step?.power)) out.Power = step.power;
        if (exists(step?.cadence)) out.Cadence = step.cadence;
        if (exists(step?.slope)) out.Slope = step.slope;
        return out;
    }

    const toInterval = existance(options.toInterval, defaultToInterval);
    const fromInterval = existance(options.fromInterval, defaultFromInterval);

    function readContent(el) {
        if (!exists(el)) return undefined;
        const text = el.textContent;
        return empty(text) ? undefined : text;
    }

    function read(args = {}) {
        const el = existance(args.el);
        const rawAttrs = el.attributes || [];
        /** @type {Record<string, any>} */
        const parsed = { element: name };

        for (let i = 0; i < rawAttrs.length; i++) {
            const attrName = rawAttrs[i].name;
            const attrSpec = Attrs[attrName];
            let value = exists(attrSpec) ? attrSpec.read({ el }) : rawAttrs[i].value;
            if (equals(name, 'TextEvent') && equals(attrName, 'TimeOffset')) {
                parsed.timeoffset = value;
            } else if (equals(name, 'TextEvent') && equals(attrName, 'Message')) {
                parsed.message = value;
            } else {
                parsed[attrName] = value;
            }
        }

        if (!equals(name, 'TextEvent')) {
            const children = readChildTextEvents(el);
            if (children.length > 0) {
                parsed.children = children;
            }
        }

        return parsed;
    }

    function write(args = {}) {
        const { content: rawContent, ...attributes } = args;
        const content = existance(rawContent, defaultContent);
        const safeContent =
            content !== '' && !String(content).trimStart().startsWith('<')
                ? escapeXml(content)
                : content;

        const attrStr = Object.keys(attributes)
            .map(key => ` ${key}="${escapeXml(attributes[key])}"`)
            .join('');

        return `${tagOpen}${attrStr}${safeContent}${tagClose}`;
    }

    return Object.freeze({
        getName: () => name,
        readContent,
        read,
        write,
        toInterval,
        fromInterval,
        calcDuration,
        defaultCalcDuration,
        defaultToInterval,
        readToInterval: (args = {}) => toInterval(read(args)),
        defaultFromInterval,
        writeFromInterval: (args = {}) => write(fromInterval(args)),
    });
}

function buildRampInterval(element, startPower, endPower, sliceDuration = RAMP_SLICE_SECONDS) {
    const duration = element.Duration;
    const cadence = element.Cadence;
    const cadenceLow = element.CadenceLow;
    const cadenceHigh = element.CadenceHigh;

    const sliceCount = Math.max(1, Math.floor(duration / sliceDuration));
    const baseDur = sliceCount === 1 ? duration : sliceDuration;
    const remainder = sliceCount === 1 ? 0 : duration - sliceCount * sliceDuration;

    const steps = [];
    for (let i = 0; i < sliceCount; i++) {
        const ratio = sliceCount > 1 ? i / (sliceCount - 1) : 0;
        const power = toFixed(startPower + (endPower - startPower) * ratio, 2);
        const stepDur = i === sliceCount - 1 ? baseDur + remainder : baseDur;
        /** @type {Record<string, any>} */
        const step = { duration: stepDur, power };

        if (exists(cadenceLow) && exists(cadenceHigh)) {
            step.cadence = Math.round(cadenceLow + (cadenceHigh - cadenceLow) * ratio);
        } else if (exists(cadence)) {
            step.cadence = cadence;
        }
        steps.push(step);
    }

    return first(attachTextEvents([{ duration, steps }], element.children));
}

function serializeRampInterval(tagName, interval) {
    /** @type {Record<string, any>} */
    const out = {
        element: tagName,
        Duration: interval.duration,
    };
    const startStep = first(interval.steps);
    const endStep = last(interval.steps);
    if (exists(startStep?.power)) out.PowerLow = startStep.power;
    if (exists(endStep?.power)) out.PowerHigh = endStep.power;
    if (exists(startStep?.cadence)) out.Cadence = startStep.cadence;
    return out;
}

function createWarmupElement(options = {}) {
    const sliceDuration = existance(options.timeDx, RAMP_SLICE_SECONDS);
    const tagName = options.spec?.name ?? 'Warmup';

    return Element({
        name: tagName,
        tagOpen: `<${tagName}`,
        tagClose: ' />',
        toInterval(element) {
            const low = element.PowerLow ?? element.Power ?? 0;
            const high = element.PowerHigh ?? element.Power ?? 0;
            return buildRampInterval(element, low, high, sliceDuration);
        },
        fromInterval(interval) {
            return serializeRampInterval(tagName, interval);
        },
        ...options.spec,
    });
}

function createCooldownElement(options = {}) {
    const sliceDuration = existance(options.timeDx, RAMP_SLICE_SECONDS);

    return Element({
        name: 'Cooldown',
        tagOpen: '<Cooldown',
        tagClose: ' />',
        toInterval(element) {
            // In ZWO XML, Cooldown specifies starting power in PowerLow and ending power in PowerHigh
            const startPower = element.PowerLow ?? element.Power ?? 0;
            const endPower = element.PowerHigh ?? element.Power ?? 0;
            return buildRampInterval(element, startPower, endPower, sliceDuration);
        },
        fromInterval(interval) {
            return serializeRampInterval('Cooldown', interval);
        },
    });
}

function createSteadyStateElement(options = {}) {
    return Element({
        name: 'SteadyState',
        tagOpen: '<SteadyState',
        tagClose: ' />',
        toInterval(element) {
            const copy = { ...element };

            if (!exists(copy.Cadence) && (exists(copy.CadenceLow) || exists(copy.CadenceHigh))) {
                const cadParts = [copy.CadenceLow, copy.CadenceHigh].filter(exists);
                copy.Cadence = Math.round(cadParts.reduce((sum, v) => sum + v, 0) / cadParts.length);
                copy.CadenceLow = undefined;
                copy.CadenceHigh = undefined;
            }

            if (!exists(copy.Power)) {
                if (exists(copy.PowerLow) || exists(copy.PowerHigh)) {
                    const pParts = [copy.PowerLow, copy.PowerHigh].filter(exists);
                    copy.Power = pParts.reduce((sum, v) => sum + v, 0) / pParts.length;
                    copy.PowerLow = undefined;
                    copy.PowerHigh = undefined;
                } else {
                    copy.Power = 0;
                    if (!exists(copy.Slope)) copy.Slope = 0;
                }
            }

            const step = Step(copy);
            return first(attachTextEvents([{ duration: copy.Duration, steps: [step] }], copy.children));
        },
        ...options.spec,
    });
}

function createIntervalsTElement() {
    return Element({
        name: 'IntervalsT',
        tagOpen: '<IntervalsT',
        tagClose: ' />',
        calcDuration: element => element.Repeat * (element.OnDuration + element.OffDuration),
        toInterval(element) {
            const count = existance(element.Repeat, 1);
            const onStep = OnStep(element);
            const offStep = OffStep(element);
            const expanded = repeat(count)(acc => {
                acc.push({ duration: onStep.duration, steps: [{ ...onStep }] });
                if (exists(offStep.duration) && offStep.duration > 0) {
                    acc.push({ duration: offStep.duration, steps: [{ ...offStep }] });
                }
                return acc;
            })([]);
            return attachTextEvents(expanded, element.children);
        },
    });
}

function createFreeRideElement() {
    return Element({
        name: 'FreeRide',
        tagOpen: '<FreeRide',
        tagClose: ' />',
        toInterval(element) {
            let duration = existance(element.Duration, 1);
            const sim = element.Sim;
            const track = element.Track;
            const steps = [];

            if (exists(sim)) {
                let simTotal = 0;
                for (let i = 0; i < sim.length; i += 2) {
                    simTotal += sim[i + 1];
                    steps.push({ duration: sim[i + 1], slope: sim[i], power: 0 });
                }
                if (simTotal < duration) {
                    steps.push({ duration: duration - simTotal, slope: 0, power: 0 });
                } else if (simTotal > duration) {
                    duration = simTotal;
                }
                if (exists(element.Cadence)) {
                    steps.forEach(s => { s.cadence = element.Cadence; });
                }
                return first(attachTextEvents([{ duration, steps }], element.children));
            }

            if (exists(track)) {
                let trackDistance = 0;
                for (let i = 0; i < track.length; i += 2) {
                    trackDistance += track[i + 1];
                    steps.push({ distance: track[i + 1], slope: track[i], power: 0 });
                }
                return first(attachTextEvents([{ distance: trackDistance, steps }], element.children));
            }

            /** @type {Record<string, any>} */
            const step = { duration, slope: 0, power: 0 };
            if (exists(element.Cadence)) step.cadence = element.Cadence;
            return first(attachTextEvents([{ duration, steps: [step] }], element.children));
        },
    });
}

function createTextEventElement() {
    return Element({
        name: 'TextEvent',
        tagOpen: '<textevent',
        tagClose: ' />',
        toInterval: () => [],
    });
}

const Elements = {
    Warmup: createWarmupElement(),
    SteadyState: createSteadyStateElement(),
    TextEvent: createTextEventElement(),
    IntervalsT: createIntervalsTElement(),
    FreeRide: createFreeRideElement(),
    Ramp: createWarmupElement({ spec: { name: 'Ramp', tagOpen: '<Ramp', tagClose: ' />' } }),
    Cooldown: createCooldownElement(),
    Unknown: Element({ name: 'Unknown', tagOpen: '<Unknown', tagClose: ' />' }),
    Author: Element({ name: 'author', tagOpen: '<author>', tagClose: '</author>' }),
    Name: Element({ name: 'name', tagOpen: '<name>', tagClose: '</name>' }),
    Category: Element({ name: 'category', tagOpen: '<category>', tagClose: '</category>' }),
    SubCategory: Element({ name: 'subcategory', tagOpen: '<subcategory>', tagClose: '</subcategory>' }),
    Description: Element({ name: 'description', tagOpen: '<description>', tagClose: '</description>' }),
    SportType: Element({ name: 'sporttype', tagOpen: '<sporttype>', tagClose: '</sporttype>' }),
    Tags: Element({ name: 'tags', tagOpen: '<tags>', tagClose: '</tags>' }),
};

function queryMetaText(doc, ...tagCandidates) {
    if (!doc) return undefined;
    for (const selector of tagCandidates) {
        const node = doc.querySelector(selector);
        if (exists(node)) {
            const text = node.textContent;
            if (!empty(text)) return text;
        }
    }
    return undefined;
}

function createHeadCodec() {
    const defaults = {
        author: 'Unknown',
        name: 'Custom',
        description: 'Custom',
        category: 'Custom',
        subcategory: '',
        sportType: 'bike',
        tags: '',
    };

    function read(args = {}) {
        const doc = existance(args.doc);
        return {
            author: existance(queryMetaText(doc, 'author', 'Author'), defaults.author),
            name: existance(queryMetaText(doc, 'name', 'Name'), defaults.name),
            description: existance(queryMetaText(doc, 'description', 'Description'), defaults.description),
            category: existance(queryMetaText(doc, 'category', 'Category'), defaults.category),
            subcategory: existance(queryMetaText(doc, 'subcategory', 'SubCategory'), defaults.subcategory),
            sportType: existance(queryMetaText(doc, 'sportType', 'sporttype', 'SportType'), defaults.sportType),
            tags: existance(queryMetaText(doc, 'tags', 'Tags'), defaults.tags),
        };
    }

    function write(args = {}) {
        const lines = [
            Elements.Author.write({ content: existance(args.author, defaults.author) }),
            Elements.Name.write({ content: existance(args.name, defaults.name) }),
            Elements.Category.write({ content: existance(args.category, defaults.category) }),
            Elements.SubCategory.write({ content: existance(args.subcategory, defaults.subcategory) }),
            Elements.Description.write({ content: existance(args.description, defaults.description) }),
            Elements.SportType.write({ content: existance(args.sportType, defaults.sportType) }),
            Elements.Tags.write({ content: existance(args.tags, defaults.tags) }),
        ];
        return '\n' + lines.map(line => `    ${line}\n`).join('');
    }

    function fromInterval(workout) {
        const meta = workout.meta ?? {};
        return {
            author: meta.author,
            name: meta.name,
            category: meta.category,
            subcategory: meta.subcategory,
            sportType: meta.sportType,
            description: meta.description,
            tags: meta.tags,
        };
    }

    return Object.freeze({ read, write, fromInterval });
}

function createBodyCodec() {
    function workoutChildElements(doc) {
        if (!doc || doc.querySelector('parsererror')) return [];
        const container = doc.querySelector('workout');
        return container ? Array.from(container.children) : [];
    }

    function resolveCodec(tagName) {
        if (isTextEventTagName(tagName)) return Elements.TextEvent;
        return Elements[tagName] ?? Elements.Unknown;
    }

    function read(args = {}) {
        const doc = existance(args.doc);
        return workoutChildElements(doc).map(el => resolveCodec(el.tagName).read({ el }));
    }

    function readToInterval(args = {}) {
        const doc = existance(args.doc);
        return workoutChildElements(doc).flatMap(el => resolveCodec(el.tagName).readToInterval({ el }));
    }

    function fromInterval(workout) {
        return (workout.intervals ?? []).map(interval => {
            const steps = interval.steps ?? [];
            if (steps.length > 1) {
                const pStart = first(steps)?.power;
                const pEnd = last(steps)?.power;
                if (pStart < pEnd) return Elements.Warmup.fromInterval(interval);
                if (pStart > pEnd) return Elements.Cooldown.fromInterval(interval);
            }
            return Elements.SteadyState.fromInterval(interval);
        });
    }

    function write(nodes = []) {
        const rows = nodes
            .map(node => {
                const { element, ...spec } = node;
                const codec = Elements[element] ?? Elements.Unknown;
                return `        ${codec.write(spec)}\n`;
            })
            .join('');
        return `<workout>\n${rows}    </workout>`;
    }

    return Object.freeze({ read, readToInterval, fromInterval, write });
}

const head = createHeadCodec();
const body = createBodyCodec();

function parseXmlDocument(xmlString) {
    const parser = new DOMParser();
    return parser.parseFromString(xmlString, 'text/xml');
}

function readToInterval(xmlString) {
    const doc = parseXmlDocument(xmlString);
    const meta = head.read({ doc });
    const intervals = body.readToInterval({ doc });
    const duration = intervals.reduce((total, iv) => total + (iv.duration ?? 0), 0);

    return {
        meta: { ...meta, duration },
        intervals,
    };
}

function read(xmlString) {
    const doc = parseXmlDocument(xmlString);
    return {
        head: head.read({ doc }),
        body: body.read({ doc }),
    };
}

function fromInterval(workout) {
    return {
        head: head.fromInterval(workout),
        body: body.fromInterval(workout),
    };
}

function write(documentSpec = {}) {
    return `<workout_file>${head.write(documentSpec.head)}    ${body.write(documentSpec.body)}\n</workout_file>`;
}

const zwo = Object.freeze({
    readAttribute,
    writeAttribute,
    Attribute,
    Attrs,
    Element,
    Elements,
    attributesToStep,
    Step,
    OnStep,
    OffStep,
    head,
    body,
    readToInterval,
    read,
    fromInterval,
    write,
});

export { zwo };
