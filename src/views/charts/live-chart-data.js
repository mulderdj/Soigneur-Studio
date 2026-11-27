// @ts-check
//
// Pure data preparation, decimation, and scale helpers for <live-chart>.
// Kept free of DOM / uPlot so it can be unit-tested directly and stays cheap
// during 1 Hz live ride updates.
//

const MAX_LIVE_POINTS = 1200;

const RANGES = [
    {key: '5',   label: '5 min',      seconds: 300},
    {key: '20',  label: '20 min',     seconds: 1200},
    {key: 'all', label: 'Whole ride', seconds: Infinity},
];

const SERIES = [
    {key: 'power',   label: 'Power'},
    {key: 'target',  label: 'Target'},
    {key: 'hr',      label: 'Heart rate'},
    {key: 'cadence', label: 'Cadence'},
    {key: 'wbal',    label: 'W′bal'},
];

function fmtTime(seconds) {
    seconds = Math.max(0, Math.round(seconds));
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = seconds % 60;
    const mm = String(m).padStart(h > 0 ? 2 : 1, '0');
    const ss = String(s).padStart(2, '0');
    return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

function powerMax(ftp, dataMax) {
    const base = Math.max((ftp > 0 ? ftp : 200) * 1.3, Number.isFinite(dataMax) ? dataMax : 0);
    return Math.ceil(base / 50) * 50;
}

function powerSplits(ftp, scaleMax) {
    if(!(ftp > 0)) return [0, Math.round(scaleMax / 2), scaleMax];
    return [0.5, 0.75, 1.0, 1.25]
        .map(f => ftp * f)
        .filter(v => v <= scaleMax);
}

function hrBounds(min, max) {
    if(!Number.isFinite(min) || !Number.isFinite(max) || max <= 0) return [80, 190];
    const hMin = Math.max(40, Math.floor((min - 10) / 10) * 10);
    const hMax = Math.max(hMin + 40, Math.ceil((max + 10) / 10) * 10);
    return [hMin, hMax];
}

function hrTicks(hMin, hMax, plotHeightPx) {
    if(!Number.isFinite(hMin) || !Number.isFinite(hMax)) return [];
    return plotHeightPx > 120 ? [hMin, Math.round((hMin + hMax) / 2), hMax] : [hMin, hMax];
}

function windowFor(count, rangeKey) {
    const range = RANGES.find(r => r.key === rangeKey) ?? RANGES[1];
    const windowSec = Number.isFinite(range.seconds) ? range.seconds : Math.max(count, 300);
    const start = Math.max(0, count - windowSec);
    return {start, end: count, windowSec, xMin: start, xMax: start + windowSec};
}

/**
 * Slice and (when span > maxPoints) decimate SessionStats arrays into uPlot's
 * columnar AlignedData format: [x, power, wbal, target, cadence, hr].
 * Zero values in power, target, cadence, and hr become `null` so lines break
 * cleanly over dropouts / pauses.
 */
function buildLiveData(session, rangeKey, maxPoints = MAX_LIVE_POINTS) {
    const count = session?.count ?? 0;
    const win = windowFor(count, rangeKey);
    const span = win.end - win.start;

    if(span <= 0) {
        return {
            ...win,
            step: 1,
            hasHr: false,
            data: [[], [], [], [], [], []],
        };
    }

    const xs = [];
    const power = [];
    const wbal = [];
    const target = [];
    const cadence = [];
    const hr = [];
    let hasHr = false;

    const cap = Math.max(1, Math.floor(maxPoints));
    if(span <= cap) {
        for(let i = win.start; i < win.end; i++) {
            const p = session.power[i];
            const t = session.target[i];
            const h = session.hr[i];
            const c = session.cadence[i];
            const wb = session.wbalSeries[i] ?? 0;
            xs.push(i);
            power.push(p > 0 ? p : null);
            wbal.push(wb);
            target.push(t > 0 ? t : null);
            cadence.push(c > 0 ? c : null);
            if(h > 0) { hr.push(h); hasHr = true; } else { hr.push(null); }
        }
        return {...win, step: 1, hasHr, data: [xs, power, wbal, target, cadence, hr]};
    }

    const per = span / cap;
    for(let bIdx = 0; bIdx * per < span; bIdx++) {
        const a = win.start + Math.floor(bIdx * per);
        const b = Math.min(win.end, win.start + Math.floor((bIdx + 1) * per));
        if(b <= a) continue;
        let p = 0, t = 0, tc = 0, h = 0, hc = 0, cd = 0, cc = 0, wb = 0;
        for(let i = a; i < b; i++) {
            p += session.power[i];
            wb += session.wbalSeries[i] ?? 0;
            if(session.target[i] > 0) { t += session.target[i]; tc++; }
            if(session.hr[i] > 0) { h += session.hr[i]; hc++; }
            if(session.cadence[i] > 0) { cd += session.cadence[i]; cc++; }
        }
        const len = b - a;
        const avgP = p / len;
        xs.push(a);
        power.push(avgP > 0 ? avgP : null);
        wbal.push(wb / len);
        target.push(tc ? t / tc : null);
        cadence.push(cc ? cd / cc : null);
        if(hc) { hr.push(h / hc); hasHr = true; } else { hr.push(null); }
    }

    return {...win, step: per, hasHr, data: [xs, power, wbal, target, cadence, hr]};
}

export {
    MAX_LIVE_POINTS,
    RANGES,
    SERIES,
    fmtTime,
    powerMax,
    powerSplits,
    hrBounds,
    hrTicks,
    windowFor,
    buildLiveData,
};
