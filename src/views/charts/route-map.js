// @ts-check
//
// <route-map>: lightweight, zero-dependency GPS route map on HTML5 <canvas>.
//
// Uses pure Web Mercator projection with Carto (standard) or OpenTopoMap
// (terrain) basemap tiles when online and a clean offline grid fallback.
// Supports metric colormap overlays (power, heart rate, speed, grade,
// elevation, cadence) and a fullscreen mode with pan & zoom.
//
//   el.setTrack({points, ftp, lthr})   points: [{lat, lon, power?, heartRate?, speed?, altitude?, distance?, cadence?, grade?}]
//   el.setCourse(points)               planned course track drawn underneath
//   el.appendPoint(pt)                 incremental live point (RAF-coalesced)
//   el.setCursor(pt | null)            highlighted scrubbing cursor at {lat, lon}
//   el.setMetric(metric)               'power' | 'heartRate' | 'speed' | 'grade' | 'elevation' | 'cadence' | 'none'
//

import { zoneIndex } from '../../analytics.js';
import { xf } from '../../functions.js';

const MAX_LAT = 85.05112878;
const TILE_SIZE = 256;
const MAX_CACHE = 160;
const MAX_TILES = 80;
const TERRAIN_MAX_ZOOM = 17;
const EARTH_R_M = 6371000;

/** @type {Array<{id: string, label: string, unit: string}>} */
const METRICS = [
    {id: 'power',     label: 'Power',      unit: 'W'},
    {id: 'heartRate', label: 'Heart rate', unit: 'bpm'},
    {id: 'speed',     label: 'Speed',      unit: 'km/h'},
    {id: 'grade',     label: 'Grade',      unit: '%'},
    {id: 'elevation', label: 'Elevation',  unit: 'm'},
    {id: 'cadence',   label: 'Cadence',    unit: 'rpm'},
    {id: 'none',      label: 'Solid',      unit: ''},
];

// Viridis-inspired high-contrast cycling ramp (cool -> warm -> hot)
/** @type {Array<[number, number, number]>} */
const RAMP_HEAT = [
    [59, 130, 246],  // blue
    [6, 182, 212],   // cyan
    [34, 197, 94],   // green
    [234, 179, 8],   // yellow
    [249, 115, 22],  // orange
    [239, 68, 68],   // red
];

// Diverging grade ramp: steep descent -> flat -> steep climb
/** @type {Array<[number, number, number]>} */
const RAMP_GRADE = [
    [37, 99, 235],   // -12% deep blue
    [56, 189, 248],  // -4%  sky
    [34, 197, 94],   //  0%  green
    [234, 179, 8],   // +4%  yellow
    [249, 115, 22],  // +8%  orange
    [220, 38, 38],   // +12% red
];

// Elevation ramp: valley green -> foothill yellow -> mountain orange -> peak rose
/** @type {Array<[number, number, number]>} */
const RAMP_ELEVATION = [
    [16, 185, 129],  // emerald
    [132, 204, 22],  // lime
    [234, 179, 8],   // yellow
    [249, 115, 22],  // orange
    [225, 29, 72],   // rose
];

/** @type {Map<string, {img: HTMLImageElement, status: 'loading' | 'ready' | 'error'}>} */
const tileCache = new Map();

/**
 * Clamp latitude to Web Mercator bounds.
 * @param {number} lat
 * @returns {number}
 */
function clampLat(lat) {
    return Math.max(-MAX_LAT, Math.min(MAX_LAT, lat));
}

/**
 * Project WGS84 latitude/longitude into normalized Web Mercator [0, 1] x [0, 1].
 * @param {number} lat
 * @param {number} lon
 * @returns {{x: number, y: number}}
 */
function projectPoint(lat, lon) {
    const rad = clampLat(lat) * Math.PI / 180;
    const x = (lon + 180) / 360;
    const y = Math.max(0, Math.min(1, (1 - Math.log(Math.tan(rad) + 1 / Math.cos(rad)) / Math.PI) / 2));
    return {x, y};
}

/**
 * Haversine distance in metres between two WGS84 points.
 * @param {{lat: number, lon: number}} a
 * @param {{lat: number, lon: number}} b
 * @returns {number}
 */
function haversineMeters(a, b) {
    const dLat = (b.lat - a.lat) * Math.PI / 180;
    const dLon = (b.lon - a.lon) * Math.PI / 180;
    const lat1 = a.lat * Math.PI / 180;
    const lat2 = b.lat * Math.PI / 180;
    const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
    return 2 * EARTH_R_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

/**
 * Interpolate an RGB color along a multi-stop ramp for t in [0, 1].
 * @param {Array<[number, number, number]>} stops
 * @param {number} t
 * @returns {string}
 */
function sampleRamp(stops, t) {
    const u = Math.max(0, Math.min(1, Number.isFinite(t) ? t : 0));
    const n = stops.length - 1;
    const scaled = u * n;
    const i = Math.min(n - 1, Math.floor(scaled));
    const f = scaled - i;
    const a = stops[i];
    const b = stops[i + 1];
    const r = Math.round(a[0] + (b[0] - a[0]) * f);
    const g = Math.round(a[1] + (b[1] - a[1]) * f);
    const bl = Math.round(a[2] + (b[2] - a[2]) * f);
    return `rgb(${r}, ${g}, ${bl})`;
}

/**
 * Compute smoothed road grade (%) for each GPS point using altitude and
 * distance (or haversine distance fallback) over a ~30 m window.
 * @param {Array<{lat: number, lon: number, altitude?: number | null, distance?: number | null, grade?: number | null}>} points
 * @returns {Array<number | null>}
 */
function computeGrades(points) {
    const n = points.length;
    /** @type {Array<number | null>} */
    const out = new Array(n).fill(null);
    if(n < 2) return out;

    // If caller already provided explicit grades, preserve them
    if(points.some(p => Number.isFinite(p.grade))) {
        return points.map(p => Number.isFinite(p.grade) ? /** @type {number} */ (p.grade) : null);
    }

    // Build cumulative distance array (metres)
    const dist = new Float64Array(n);
    for(let i = 1; i < n; i++) {
        const dCurr = points[i].distance;
        const dPrev = points[i - 1].distance;
        if(Number.isFinite(dCurr) && Number.isFinite(dPrev) && /** @type {number} */ (dCurr) >= /** @type {number} */ (dPrev)) {
            dist[i] = dist[i - 1] + (/** @type {number} */ (dCurr) - /** @type {number} */ (dPrev));
        } else {
            dist[i] = dist[i - 1] + haversineMeters(points[i - 1], points[i]);
        }
    }

    const HALF_WINDOW_M = 20;
    let lo = 0;
    let hi = 0;
    for(let i = 0; i < n; i++) {
        const alt = points[i].altitude;
        if(!Number.isFinite(alt)) continue;
        while(lo + 1 < i && dist[i] - dist[lo + 1] >= HALF_WINDOW_M) lo++;
        if(hi < i) hi = i;
        while(hi + 1 < n && dist[hi] - dist[i] < HALF_WINDOW_M) hi++;
        let aIdx = lo;
        while(aIdx < i && !Number.isFinite(points[aIdx].altitude)) aIdx++;
        let bIdx = hi;
        while(bIdx > i && !Number.isFinite(points[bIdx].altitude)) bIdx--;
        const run = dist[bIdx] - dist[aIdx];
        if(run >= 8 && Number.isFinite(points[aIdx].altitude) && Number.isFinite(points[bIdx].altitude)) {
            const rise = /** @type {number} */ (points[bIdx].altitude) - /** @type {number} */ (points[aIdx].altitude);
            const pct = (rise / run) * 100;
            out[i] = Math.max(-25, Math.min(25, pct));
        }
    }
    return out;
}

/**
 * Extract the display value of a metric for point `p` (speed converted m/s -> km/h).
 * @param {any} p
 * @param {string} metric
 * @param {number | null} grade
 * @returns {number | null}
 */
function metricValue(p, metric, grade) {
    if(!p) return null;
    switch(metric) {
    case 'power':     return Number.isFinite(p.power) ? p.power : null;
    case 'heartRate': return Number.isFinite(p.heartRate) && p.heartRate > 0 ? p.heartRate : null;
    case 'speed':     return Number.isFinite(p.speed) && p.speed >= 0 ? p.speed * 3.6 : null;
    case 'grade':     return Number.isFinite(grade) ? grade : null;
    case 'elevation': return Number.isFinite(p.altitude) ? p.altitude : null;
    case 'cadence':   return Number.isFinite(p.cadence) && p.cadence > 0 ? p.cadence : null;
    default:          return null;
    }
}

/**
 * Compute robust [min, max] range for a series of numeric values (2nd–98th percentile
 * for large series so single spikes don't wash out the colormap).
 * @param {Array<number | null>} values
 * @param {string} metric
 * @returns {{min: number, max: number} | null}
 */
function metricRange(values, metric) {
    if(metric === 'grade') return {min: -12, max: 12};
    const nums = /** @type {number[]} */ (values.filter(v => Number.isFinite(v)));
    if(nums.length < 2) return null;
    nums.sort((a, b) => a - b);
    const lo = nums.length >= 20 ? nums[Math.floor(nums.length * 0.02)] : nums[0];
    const hi = nums.length >= 20 ? nums[Math.min(nums.length - 1, Math.ceil(nums.length * 0.98))] : nums[nums.length - 1];
    if(hi - lo < 1e-6) return {min: lo, max: lo + 1};
    return {min: lo, max: hi};
}

/**
 * Map a metric value to a CSS color string.
 * @param {string} metric
 * @param {number | null} val
 * @param {{min: number, max: number} | null} range
 * @param {{accent: string, zones: string[]}} colors
 * @param {number | null} ftp
 * @returns {string}
 */
function colorForMetric(metric, val, range, colors, ftp = null) {
    if(!Number.isFinite(val)) return colors.accent;
    const v = /** @type {number} */ (val);
    if(metric === 'power' && ftp && ftp > 0) {
        return colors.zones[zoneIndex(v, ftp)];
    }
    if(metric === 'grade') {
        const t = (Math.max(-12, Math.min(12, v)) + 12) / 24;
        return sampleRamp(RAMP_GRADE, t);
    }
    if(!range) return colors.accent;
    const t = (v - range.min) / Math.max(1e-6, range.max - range.min);
    if(metric === 'elevation') return sampleRamp(RAMP_ELEVATION, t);
    return sampleRamp(RAMP_HEAT, t);
}

/**
 * Build a viewport transform from explicit Web Mercator center & zoom.
 * @param {number} cx
 * @param {number} cy
 * @param {number} zoom
 * @param {number} width
 * @param {number} height
 */
function makeViewport(cx, cy, zoom, width, height) {
    const w = Math.max(1, width);
    const h = Math.max(1, height);
    const z = Math.max(1, Math.min(18, zoom));
    const scale = TILE_SIZE * Math.pow(2, z);
    const tileZoom = Math.max(0, Math.min(18, Math.floor(z + 0.35)));
    /**
     * @param {number} lat
     * @param {number} lon
     */
    const toCanvas = (lat, lon) => {
        const m = projectPoint(lat, lon);
        return {
            x: w / 2 + (m.x - cx) * scale,
            y: h / 2 + (m.y - cy) * scale,
        };
    };
    return {zoom: z, tileZoom, scale, cx, cy, width: w, height: h, toCanvas};
}

/**
 * Fit a set of GPS points into a canvas of size (width, height) with padding.
 * @param {Array<{lat: number, lon: number}>} points
 * @param {number} width
 * @param {number} height
 * @param {number} [pad=28]
 */
function fitBounds(points, width, height, pad = 28) {
    const w = Math.max(1, width);
    const h = Math.max(1, height);
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    let count = 0;

    for(const p of points ?? []) {
        if(!Number.isFinite(p?.lat) || !Number.isFinite(p?.lon)) continue;
        const m = projectPoint(p.lat, p.lon);
        if(m.x < minX) minX = m.x;
        if(m.x > maxX) maxX = m.x;
        if(m.y < minY) minY = m.y;
        if(m.y > maxY) maxY = m.y;
        count++;
    }

    if(count === 0) {
        minX = 0.5; maxX = 0.5; minY = 0.5; maxY = 0.5;
    }

    const cx = (minX + maxX) / 2;
    const cy = (minY + maxY) / 2;
    const spanX = maxX - minX;
    const spanY = maxY - minY;
    const innerW = Math.max(1, w - pad * 2);
    const innerH = Math.max(1, h - pad * 2);

    let zoom = 15;
    if(spanX > 1e-9 || spanY > 1e-9) {
        const worldX = spanX > 1e-9 ? innerW / spanX : Infinity;
        const worldY = spanY > 1e-9 ? innerH / spanY : Infinity;
        const world = Math.min(worldX, worldY);
        zoom = Math.max(1, Math.min(18, Math.log2(world / TILE_SIZE)));
    }

    const vp = makeViewport(cx, cy, zoom, w, h);
    return {...vp, minX, maxX, minY, maxY};
}

/**
 * Compute the list of slippy map tiles covering a fitted viewport.
 * @param {ReturnType<typeof makeViewport>} view
 * @param {number} [maxZoom=18]
 */
function tileRange(view, maxZoom = 18) {
    const z = Math.min(view.tileZoom, maxZoom);
    const n = Math.pow(2, z);
    const halfW = (view.width / 2) / view.scale;
    const halfH = (view.height / 2) / view.scale;
    const xMin = Math.floor((view.cx - halfW) * n);
    const xMax = Math.floor((view.cx + halfW) * n);
    const yMin = Math.max(0, Math.floor((view.cy - halfH) * n));
    const yMax = Math.min(n - 1, Math.floor((view.cy + halfH) * n));

    const tiles = [];
    const tilePx = view.scale / n;

    for(let tx = xMin; tx <= xMax; tx++) {
        for(let ty = yMin; ty <= yMax; ty++) {
            if(tiles.length >= MAX_TILES) return tiles;
            const wx = ((tx % n) + n) % n;
            const dx = view.width / 2 + (tx / n - view.cx) * view.scale;
            const dy = view.height / 2 + (ty / n - view.cy) * view.scale;
            tiles.push({z, x: wx, y: ty, dx, dy, size: tilePx});
        }
    }
    return tiles;
}

function isLightTheme() {
    const cls = document.body?.classList;
    if(cls?.contains('white-theme')) return true;
    if(cls?.contains('dark-theme')) return false;
    if(cls?.contains('auto-theme')) {
        return typeof matchMedia === 'function' && matchMedia('(prefers-color-scheme: light)').matches;
    }
    return false;
}

const MAP_PROVIDERS = {
    standard:      {label: 'Standard',      maxZoom: 16, attribution: '© Esri'},
    terrain:       {label: 'Terrain',       maxZoom: 17, attribution: '© OSM · OpenTopoMap'},
    cyclosm:       {label: 'CyclOSM',       maxZoom: 18, attribution: '© OSM · CyclOSM'},
    satellite:     {label: 'Satellite',     maxZoom: 18, attribution: '© Esri'},
    osm:           {label: 'OSM',           maxZoom: 18, attribution: '© OpenStreetMap'},
    mapy:          {label: 'Mapy.com',      maxZoom: 19, attribution: '© Seznam.cz · Mapy.com'},
    thunderforest: {label: 'Thunderforest', maxZoom: 18, attribution: '© OSM · Thunderforest'},
    custom:        {label: 'Custom',        maxZoom: 18, attribution: '© Map tiles'},
};

function currentMapStyle() {
    const s = document.body?.dataset?.mapStyle ?? 'standard';
    return Object.prototype.hasOwnProperty.call(MAP_PROVIDERS, s) ? s : 'standard';
}

function currentMapConfig() {
    return {
        apiKey: document.body?.dataset?.mapApiKey ?? '',
        customUrl: document.body?.dataset?.mapTileUrl ?? '',
    };
}

/**
 * @param {number} z
 * @param {number} x
 * @param {number} y
 * @param {boolean} light
 * @param {string} [style='standard']
 * @param {{apiKey?: string, customUrl?: string}} [cfg]
 * @returns {string | null}
 */
function tileUrl(z, x, y, light, style = 'standard', cfg = {}) {
    switch(style) {
    case 'terrain':
        return `https://a.tile.opentopomap.org/${z}/${x}/${y}.png`;
    case 'cyclosm':
        return `https://a.tile-cyclosm.openstreetmap.fr/cyclosm/${z}/${x}/${y}.png`;
    case 'satellite':
        return `https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/${z}/${y}/${x}`;
    case 'osm':
        return `https://tile.openstreetmap.org/${z}/${x}/${y}.png`;
    case 'mapy': {
        const key = (cfg.apiKey ?? '').trim();
        if(!key) return null;
        return `https://api.mapy.com/v1/maptiles/outdoor/256/${z}/${x}/${y}?apikey=${encodeURIComponent(key)}`;
    }
    case 'thunderforest': {
        const key = (cfg.apiKey ?? '').trim();
        if(!key) return null;
        return `https://tile.thunderforest.com/cycle/${z}/${x}/${y}.png?apikey=${encodeURIComponent(key)}`;
    }
    case 'custom': {
        const tpl = (cfg.customUrl ?? '').trim();
        if(!tpl || !/^https?:\/\//i.test(tpl)) return null;
        return tpl
            .replace(/\{z\}/g, String(z))
            .replace(/\{x\}/g, String(x))
            .replace(/\{y\}/g, String(y))
            .replace(/\{key\}/g, encodeURIComponent((cfg.apiKey ?? '').trim()));
    }
    default:
        return light
            ? `https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Light_Gray_Base/MapServer/tile/${z}/${y}/${x}`
            : `https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Base/MapServer/tile/${z}/${y}/${x}`;
    }
}

/**
 * @param {Element} el
 * @param {string} name
 * @param {string} fallback
 */
function token(el, name, fallback) {
    return getComputedStyle(el).getPropertyValue(name).trim() || fallback;
}

/**
 * @param {any} pt
 */
function validPoint(pt) {
    return !!pt && Number.isFinite(pt.lat) && Number.isFinite(pt.lon) && !(pt.lat === 0 && pt.lon === 0);
}

/**
 * Normalize a track point, preserving all optional telemetry metrics.
 * @param {any} p
 */
function normalizePoint(p) {
    return {
        lat: p.lat,
        lon: p.lon,
        power: Number.isFinite(p.power) ? p.power : null,
        heartRate: Number.isFinite(p.heartRate) ? p.heartRate : null,
        speed: Number.isFinite(p.speed) ? p.speed : null,
        altitude: Number.isFinite(p.altitude) ? p.altitude : null,
        distance: Number.isFinite(p.distance) ? p.distance : null,
        cadence: Number.isFinite(p.cadence) ? p.cadence : null,
        grade: Number.isFinite(p.grade) ? p.grade : null,
    };
}

/**
 * Format a legend endpoint value for the given metric.
 * @param {string} metric
 * @param {number} val
 */
function formatLegendVal(metric, val) {
    if(metric === 'grade') return `${val > 0 ? '+' : ''}${Math.round(val)}%`;
    if(metric === 'speed') return `${Math.round(val)}`;
    return `${Math.round(val)}`;
}

class RouteMap extends HTMLElement {
    constructor() {
        super();
        /** @type {Array<ReturnType<typeof normalizePoint>>} */
        this._points = [];
        /** @type {Array<{lat: number, lon: number}>} */
        this._course = [];
        /** @type {Array<number | null>} */
        this._grades = [];
        /** @type {number | null} */
        this._ftp = null;
        /** @type {{lat: number, lon: number} | null} */
        this._cursor = null;
        /** @type {string | null} */
        this._metric = null;
        /** @type {string | null} */
        this._mapStyle = null;
        /** @type {{cx: number, cy: number, zoom: number} | null} */
        this._panZoom = null;
        /** @type {ReturnType<typeof makeViewport> | null} */
        this._lastView = null;
        /** @type {boolean} */
        this.full = false;
        /** @type {symbol | null} */
        this._fullRun = null;
        /** @type {(() => void) | null} */
        this._popped = null;
        /** @type {number | null} */
        this._raf = null;
        /** @type {boolean} */
        this._pending = false;
        /** @type {HTMLCanvasElement | null} */
        this.$canvas = null;
        /** @type {HTMLElement | null} */
        this.$controls = null;
        /** @type {HTMLSelectElement | null} */
        this.$metricSelect = null;
        /** @type {HTMLSelectElement | null} */
        this.$styleSelect = null;
        /** @type {HTMLButtonElement | null} */
        this.$fullBtn = null;
        /** @type {HTMLElement | null} */
        this.$zoomControls = null;
        /** @type {ResizeObserver | null} */
        this._resize = null;
        /** @type {MutationObserver | null} */
        this._theme = null;
        /** @type {AbortController | null} */
        this._abort = null;
        /** @type {Map<number, {x: number, y: number}>} */
        this._pointers = new Map();
        /** @type {{dist: number, cx: number, cy: number} | null} */
        this._pinch = null;
    }

    connectedCallback() {
        if(!this.$canvas) {
            this.style.position = this.style.position || 'relative';
            this.style.display = this.style.display || 'block';
            this.$canvas = document.createElement('canvas');
            this.$canvas.style.display = 'block';
            this.$canvas.style.width = '100%';
            this.$canvas.style.height = '100%';
            this.append(this.$canvas);
        }
        if(!this.$controls) {
            this.$controls = document.createElement('div');
            this.$controls.className = 'rm-controls';
            this.$controls.hidden = true;

            this.$metricSelect = document.createElement('select');
            this.$metricSelect.className = 'rm-ctrl rm-metric-select';
            this.$metricSelect.setAttribute('aria-label', 'Trace colormap overlay');
            this.$metricSelect.addEventListener('change', () => {
                this.setMetric(this.$metricSelect?.value ?? 'none');
            });

            this.$styleSelect = document.createElement('select');
            this.$styleSelect.className = 'rm-ctrl rm-style-select';
            this.$styleSelect.setAttribute('aria-label', 'Map style');
            this.$styleSelect.addEventListener('change', () => {
                const next = this.$styleSelect?.value ?? 'standard';
                if(this._mapStyle) {
                    this.setMapStyle(next);
                } else {
                    xf.dispatch('ui:mapStyle-set', next);
                }
            });

            this.$fullBtn = document.createElement('button');
            this.$fullBtn.type = 'button';
            this.$fullBtn.className = 'rm-ctrl rm-full-btn';
            this.$fullBtn.addEventListener('click', () => this.full ? this.exitFull() : this.enterFull());

            this.$controls.append(this.$metricSelect, this.$styleSelect, this.$fullBtn);
            this.append(this.$controls);
        }
        if(!this.$zoomControls) {
            this.$zoomControls = document.createElement('div');
            this.$zoomControls.className = 'rm-zoom-controls';
            this.$zoomControls.hidden = true;
            this.$zoomControls.innerHTML = `
                <button type="button" class="rm-ctrl rm-zoom-btn" data-rm-zoom="in" aria-label="Zoom in" title="Zoom in">+</button>
                <button type="button" class="rm-ctrl rm-zoom-btn" data-rm-zoom="out" aria-label="Zoom out" title="Zoom out">−</button>
                <button type="button" class="rm-ctrl rm-zoom-btn" data-rm-zoom="fit" aria-label="Fit route" title="Fit route">Fit</button>`;
            this.$zoomControls.addEventListener('click', e => {
                const btn = /** @type {HTMLElement | null} */ (/** @type {Element} */ (e.target).closest('[data-rm-zoom]'));
                if(!btn) return;
                const act = btn.dataset.rmZoom;
                if(act === 'in') this.zoomBy(1);
                else if(act === 'out') this.zoomBy(-1);
                else if(act === 'fit') this.resetView();
            });
            this.append(this.$zoomControls);
        }

        this._abort?.abort();
        this._abort = new AbortController();
        const signal = {signal: this._abort.signal};

        document.addEventListener('fullscreenchange', () => {
            if(this.full && document.fullscreenElement !== this) this.exitFull();
        }, signal);
        document.addEventListener('keydown', e => {
            if(e.key === 'Escape' && this.full) this.exitFull();
        }, signal);
        window.addEventListener('resize', () => {
            if(this.full) this.scheduleDraw();
        }, signal);

        // Pan & zoom interactions on the canvas (active in fullscreen)
        this._bindPanZoom(signal);

        this._syncStyleBtn();
        this._syncFullBtn();
        this._syncMetricSelect();

        if(typeof ResizeObserver === 'function') {
            this._resize = new ResizeObserver(() => this.scheduleDraw());
            this._resize.observe(this);
        }
        if(typeof MutationObserver === 'function' && document.body) {
            this._theme = new MutationObserver(() => {
                this._syncStyleBtn();
                this.scheduleDraw();
            });
            this._theme.observe(document.body, {
                attributes: true,
                attributeFilter: ['class', 'data-palette', 'data-map-style', 'data-map-api-key', 'data-map-tile-url'],
            });
        }
        this.draw();
    }

    disconnectedCallback() {
        this.exitFull({fromBack: true});
        this._abort?.abort();
        this._abort = null;
        this._pointers.clear();
        this._pinch = null;
        if(this._raf !== null && typeof cancelAnimationFrame === 'function') {
            cancelAnimationFrame(this._raf);
        }
        this._raf = null;
        this._pending = false;
        this._resize?.disconnect();
        this._resize = null;
        this._theme?.disconnect();
        this._theme = null;
    }

    /**
     * @param {{signal: AbortSignal}} signal
     */
    _bindPanZoom(signal) {
        const canvas = this.$canvas;
        if(!canvas) return;

        canvas.addEventListener('wheel', e => {
            if(!this.full) return;
            e.preventDefault();
            const rect = canvas.getBoundingClientRect();
            const px = e.clientX - rect.left;
            const py = e.clientY - rect.top;
            const delta = -Math.sign(e.deltaY) * Math.min(1.5, Math.abs(e.deltaY) / 140 + 0.35);
            this.zoomBy(delta, px, py);
        }, {passive: false, signal: signal.signal});

        canvas.addEventListener('dblclick', e => {
            if(!this.full) return;
            const rect = canvas.getBoundingClientRect();
            this.zoomBy(1.2, e.clientX - rect.left, e.clientY - rect.top);
        }, signal);

        canvas.addEventListener('pointerdown', e => {
            if(!this.full) return;
            if(e.button !== 0 && e.pointerType === 'mouse') return;
            try { canvas.setPointerCapture?.(e.pointerId); } catch(_) {}
            this._pointers.set(e.pointerId, {x: e.clientX, y: e.clientY});
            if(this._pointers.size === 2) {
                const pts = [...this._pointers.values()];
                const dist = Math.hypot(pts[1].x - pts[0].x, pts[1].y - pts[0].y);
                this._pinch = {
                    dist: Math.max(1, dist),
                    cx: (pts[0].x + pts[1].x) / 2,
                    cy: (pts[0].y + pts[1].y) / 2,
                };
            }
        }, signal);

        canvas.addEventListener('pointermove', e => {
            if(!this.full || !this._pointers.has(e.pointerId)) return;
            const prev = this._pointers.get(e.pointerId);
            this._pointers.set(e.pointerId, {x: e.clientX, y: e.clientY});
            if(this._pointers.size === 1 && prev) {
                const dx = e.clientX - prev.x;
                const dy = e.clientY - prev.y;
                if(dx !== 0 || dy !== 0) this.panBy(dx, dy);
            } else if(this._pointers.size === 2 && this._pinch) {
                const pts = [...this._pointers.values()];
                const dist = Math.max(1, Math.hypot(pts[1].x - pts[0].x, pts[1].y - pts[0].y));
                const midX = (pts[0].x + pts[1].x) / 2;
                const midY = (pts[0].y + pts[1].y) / 2;
                const panDx = midX - this._pinch.cx;
                const panDy = midY - this._pinch.cy;
                if(panDx !== 0 || panDy !== 0) this.panBy(panDx, panDy);
                const dz = Math.log2(dist / this._pinch.dist);
                if(Math.abs(dz) > 0.002) {
                    const rect = canvas.getBoundingClientRect();
                    this.zoomBy(dz, midX - rect.left, midY - rect.top);
                }
                this._pinch = {dist, cx: midX, cy: midY};
            }
        }, signal);

        const release = /** @param {PointerEvent} e */ e => {
            this._pointers.delete(e.pointerId);
            if(this._pointers.size < 2) this._pinch = null;
        };
        canvas.addEventListener('pointerup', release, signal);
        canvas.addEventListener('pointercancel', release, signal);
    }

    /** Ensure _panZoom is seeded from the current fitted viewport before mutating it. */
    _ensurePanZoom() {
        if(this._panZoom) return this._panZoom;
        const base = this._lastView;
        if(!base) return null;
        this._panZoom = {cx: base.cx, cy: base.cy, zoom: base.zoom};
        return this._panZoom;
    }

    /**
     * Pan the map by (dx, dy) CSS pixels (used in fullscreen).
     * @param {number} dx
     * @param {number} dy
     */
    panBy(dx, dy) {
        const pz = this._ensurePanZoom();
        if(!pz) return;
        const scale = TILE_SIZE * Math.pow(2, pz.zoom);
        pz.cx = ((pz.cx - dx / scale) % 1 + 1) % 1;
        pz.cy = Math.max(0.01, Math.min(0.99, pz.cy - dy / scale));
        this.scheduleDraw();
    }

    /**
     * Zoom the map by `delta` zoom levels, optionally anchored at canvas pixel (px, py).
     * @param {number} delta
     * @param {number} [px]
     * @param {number} [py]
     */
    zoomBy(delta, px, py) {
        const pz = this._ensurePanZoom();
        const base = this._lastView;
        if(!pz || !base) return;
        const oldZoom = pz.zoom;
        const newZoom = Math.max(1, Math.min(18, oldZoom + delta));
        if(Math.abs(newZoom - oldZoom) < 1e-4) return;
        if(Number.isFinite(px) && Number.isFinite(py)) {
            const oldScale = TILE_SIZE * Math.pow(2, oldZoom);
            const newScale = TILE_SIZE * Math.pow(2, newZoom);
            const mx = pz.cx + (/** @type {number} */ (px) - base.width / 2) / oldScale;
            const my = pz.cy + (/** @type {number} */ (py) - base.height / 2) / oldScale;
            pz.cx = ((mx - (/** @type {number} */ (px) - base.width / 2) / newScale) % 1 + 1) % 1;
            pz.cy = Math.max(0.01, Math.min(0.99, my - (/** @type {number} */ (py) - base.height / 2) / newScale));
        }
        pz.zoom = newZoom;
        this.scheduleDraw();
    }

    /** Reset pan & zoom back to auto-fit bounds. */
    resetView() {
        this._panZoom = null;
        this.scheduleDraw();
    }

    // --- fullscreen ---

    async enterFull() {
        const run = this._fullRun = Symbol();
        const still = () => this.full && this._fullRun === run;
        this.full = true;
        this.classList.add('is-full');
        this._syncFullBtn();
        if(this.$zoomControls) this.$zoomControls.hidden = false;
        this.scheduleDraw();
        try {
            if(this.requestFullscreen) await this.requestFullscreen({navigationUI: 'hide'});
        } catch(_) {}
        if(!still()) {
            if(document.fullscreenElement === this) document.exitFullscreen?.().catch(() => {});
            return;
        }
        if(!document.fullscreenElement) {
            try {
                history.pushState({rmFull: true}, '');
                this._popped = () => this.exitFull({fromBack: true});
                window.addEventListener('popstate', this._popped, {once: true});
            } catch(_) {}
        }
        this.scheduleDraw();
    }

    exitFull({fromBack = false} = {}) {
        if(!this.full) return;
        this.full = false;
        this._fullRun = null;
        this._panZoom = null;
        this._pointers.clear();
        this._pinch = null;
        this.classList.remove('is-full');
        this._syncFullBtn();
        if(this.$zoomControls) this.$zoomControls.hidden = true;
        if(document.fullscreenElement === this) document.exitFullscreen?.().catch(() => {});
        if(this._popped && !fromBack) {
            window.removeEventListener('popstate', this._popped);
            this._popped = null;
            try { history.back(); } catch(_) {}
        }
        this._popped = null;
        this.scheduleDraw();
    }

    _syncFullBtn() {
        if(!this.$fullBtn) return;
        this.$fullBtn.setAttribute('aria-label', this.full ? 'Close full screen' : 'Full screen');
        this.$fullBtn.title = this.full ? 'Close full screen' : 'Full screen';
        this.$fullBtn.innerHTML = this.full
            ? '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18"/></svg>'
            : '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/></svg>';
    }

    /** @returns {string} */
    getMapStyle() {
        return this._mapStyle ?? currentMapStyle();
    }

    /** @param {string | null} style */
    setMapStyle(style) {
        this._mapStyle = style && Object.prototype.hasOwnProperty.call(MAP_PROVIDERS, style) ? style : null;
        this._syncStyleBtn();
        this.scheduleDraw();
    }

    _syncStyleBtn() {
        if(!this.$styleSelect) return;
        const active = this.getMapStyle();
        const cfg = currentMapConfig();
        const options = ['standard', 'terrain', 'cyclosm', 'satellite', 'osm'];
        if(cfg.apiKey || active === 'mapy') options.push('mapy');
        if(cfg.apiKey || active === 'thunderforest') options.push('thunderforest');
        if(cfg.customUrl || active === 'custom') options.push('custom');
        const sig = options.join(',');
        if(this.$styleSelect.dataset.sig !== sig) {
            this.$styleSelect.dataset.sig = sig;
            this.$styleSelect.innerHTML = options
                .map(id => `<option value="${id}">${MAP_PROVIDERS[id].label}</option>`)
                .join('');
        }
        if(this.$styleSelect.value !== active) {
            this.$styleSelect.value = active;
        }
    }

    /** Return list of metrics that have usable data on the current track (always includes 'none'). */
    availableMetrics() {
        const pts = this._points;
        const avail = [];
        for(const m of METRICS) {
            if(m.id === 'none') {
                avail.push(m);
                continue;
            }
            let count = 0;
            for(let i = 0; i < pts.length; i++) {
                if(Number.isFinite(metricValue(pts[i], m.id, this._grades[i] ?? null))) {
                    count++;
                    if(count >= 2) break;
                }
            }
            if(count >= 2) avail.push(m);
        }
        return avail;
    }

    /** Active metric id (falls back to first available metric if current choice has no data). */
    getMetric() {
        const avail = this.availableMetrics();
        if(this._metric && avail.some(m => m.id === this._metric)) return this._metric;
        return avail[0]?.id ?? 'none';
    }

    /** @param {string} metric */
    setMetric(metric) {
        this._metric = METRICS.some(m => m.id === metric) ? metric : 'none';
        this._syncMetricSelect();
        this.scheduleDraw();
    }

    _syncMetricSelect() {
        if(!this.$metricSelect) return;
        const avail = this.availableMetrics();
        const active = this.getMetric();
        // Hide metric selector when there are no telemetry metrics to choose from
        const hasTelemetry = avail.some(m => m.id !== 'none');
        this.$metricSelect.hidden = !hasTelemetry;
        if(!hasTelemetry) return;
        const sig = avail.map(m => m.id).join(',');
        if(this.$metricSelect.dataset.sig !== sig) {
            this.$metricSelect.dataset.sig = sig;
            this.$metricSelect.innerHTML = avail
                .map(m => `<option value="${m.id}">${m.label}</option>`)
                .join('');
        }
        if(this.$metricSelect.value !== active) {
            this.$metricSelect.value = active;
        }
    }

    /**
     * Set the main GPS track (and optional FTP for power-zone colouring).
     * @param {{points?: Array<any>, ftp?: number | null}} [args]
     */
    setTrack({points = [], ftp = null} = {}) {
        this._points = (points ?? []).filter(validPoint).map(normalizePoint);
        this._grades = computeGrades(this._points);
        this._ftp = Number.isFinite(ftp) && /** @type {number} */ (ftp) > 0 ? ftp : null;
        this._panZoom = null;
        this._syncMetricSelect();
        this.draw();
    }

    /**
     * Set an optional planned course track drawn underneath the live track.
     * @param {Array<{lat: number, lon: number}>} [points]
     */
    setCourse(points = []) {
        this._course = (points ?? []).filter(validPoint).map(p => ({lat: p.lat, lon: p.lon}));
        this.draw();
    }

    /**
     * Append a single live GPS point and coalesce redraws on RAF.
     * @param {any} pt
     */
    appendPoint(pt) {
        if(!validPoint(pt)) return;
        this._points.push(normalizePoint(pt));
        this._grades = computeGrades(this._points);
        this._syncMetricSelect();
        this.scheduleDraw();
    }

    /**
     * Highlight a scrubbing cursor position on the route, or clear it with null.
     * @param {{lat: number, lon: number} | null} pt
     */
    setCursor(pt) {
        this._cursor = validPoint(pt) ? {lat: pt.lat, lon: pt.lon} : null;
        this.scheduleDraw();
    }

    scheduleDraw() {
        if(!this.isConnected) return;
        if(this._pending) return;
        if(typeof requestAnimationFrame === 'function') {
            this._pending = true;
            const id = requestAnimationFrame(() => {
                this._pending = false;
                this._raf = null;
                this.draw();
            });
            if(this._pending) this._raf = id;
        } else {
            this.draw();
        }
    }

    /**
     * @param {string} url
     */
    _requestTile(url) {
        let entry = tileCache.get(url);
        if(entry) return entry;
        if(typeof Image !== 'function') return null;
        if(tileCache.size >= MAX_CACHE) {
            const oldest = tileCache.keys().next().value;
            if(oldest !== undefined) tileCache.delete(oldest);
        }
        const img = new Image();
        entry = {img, status: 'loading'};
        tileCache.set(url, entry);
        img.onload = () => {
            entry.status = 'ready';
            this.scheduleDraw();
        };
        img.onerror = () => {
            entry.status = 'error';
        };
        img.src = url;
        return entry;
    }

    _colors() {
        return {
            bg:     token(this, '--bg', '#151B23'),
            line:   token(this, '--line', '#364354'),
            ink:    token(this, '--ink', '#E9EEF4'),
            muted:  token(this, '--muted', '#8C98A8'),
            accent: token(this, '--accent', '#4C9AFF'),
            good:   token(this, '--good', '#57C057'),
            zones:  [1, 2, 3, 4, 5, 6, 7].map(i => token(this, `--zone-${i}`, '#4C9AFF')),
        };
    }

    draw() {
        if(!this.isConnected || !this.$canvas) return;
        const w = Math.max(1, Math.round(this.clientWidth || this.$canvas.clientWidth || 320));
        const h = Math.max(1, Math.round(this.clientHeight || this.$canvas.clientHeight || 220));
        const dpr = Math.min(3, Math.max(1, window.devicePixelRatio || 1));

        const targetW = Math.round(w * dpr);
        const targetH = Math.round(h * dpr);
        if(this.$canvas.width !== targetW || this.$canvas.height !== targetH) {
            this.$canvas.width = targetW;
            this.$canvas.height = targetH;
        }

        const ctx = this.$canvas.getContext?.('2d');
        if(!ctx) return;

        ctx.save();
        ctx.scale(dpr, dpr);

        const c = this._colors();
        ctx.fillStyle = c.bg;
        ctx.fillRect(0, 0, w, h);

        const all = this._course.length
            ? (this._points.length ? [...this._course, ...this._points] : this._course)
            : this._points;

        if(all.length === 0) {
            if(this.$controls) this.$controls.hidden = true;
            this._lastView = null;
            this._drawGrid(ctx, w, h, c.line);
            ctx.restore();
            return;
        }
        if(this.$controls) this.$controls.hidden = false;

        const pad = Math.min(36, Math.round(Math.min(w, h) * 0.12));
        const view = this._panZoom
            ? makeViewport(this._panZoom.cx, this._panZoom.cy, this._panZoom.zoom, w, h)
            : fitBounds(all, w, h, pad);
        this._lastView = view;

        const mapStyle = this.getMapStyle();
        const drewTiles = this._drawBasemap(ctx, view, mapStyle);
        if(!drewTiles) {
            this._drawGrid(ctx, w, h, c.line);
        }

        // Planned course track underneath
        if(this._course.length >= 2) {
            this._drawCourse(ctx, view, c);
        }

        // Main GPS track + colormap legend
        const activeMetric = this.getMetric();
        let legendRange = null;
        if(this._points.length >= 2) {
            legendRange = this._drawTrack(ctx, view, c, activeMetric);
        }

        // Markers: start & end / live position
        if(this._points.length >= 1) {
            const start = view.toCanvas(this._points[0].lat, this._points[0].lon);
            const end = view.toCanvas(
                this._points[this._points.length - 1].lat,
                this._points[this._points.length - 1].lon
            );
            if(this._points.length >= 2) {
                this._drawStartMarker(ctx, start.x, start.y, c);
            }
            this._drawEndMarker(ctx, end.x, end.y, c);
        } else if(this._course.length >= 2) {
            const start = view.toCanvas(this._course[0].lat, this._course[0].lon);
            this._drawStartMarker(ctx, start.x, start.y, c);
        }

        // Scrubbing cursor
        if(this._cursor) {
            const cur = view.toCanvas(this._cursor.lat, this._cursor.lon);
            this._drawCursorMarker(ctx, cur.x, cur.y, c);
        }

        if(activeMetric !== 'none' && legendRange) {
            this._drawLegend(ctx, h, c, activeMetric, legendRange);
        }

        if(drewTiles) {
            this._drawAttribution(ctx, w, h, c, mapStyle);
        }

        ctx.restore();
    }

    /**
     * @param {CanvasRenderingContext2D} ctx
     * @param {number} w
     * @param {number} h
     * @param {string} stroke
     */
    _drawGrid(ctx, w, h, stroke) {
        const step = 40;
        ctx.save();
        ctx.strokeStyle = stroke;
        ctx.globalAlpha = 0.25;
        ctx.lineWidth = 1;
        ctx.beginPath();
        for(let x = step; x < w; x += step) {
            ctx.moveTo(x + 0.5, 0);
            ctx.lineTo(x + 0.5, h);
        }
        for(let y = step; y < h; y += step) {
            ctx.moveTo(0, y + 0.5);
            ctx.lineTo(w, y + 0.5);
        }
        ctx.stroke();
        ctx.restore();
    }

    /**
     * @param {CanvasRenderingContext2D} ctx
     * @param {ReturnType<typeof makeViewport>} view
     * @param {string} [style='standard']
     * @returns {boolean}
     */
    _drawBasemap(ctx, view, style = 'standard') {
        if(typeof navigator !== 'undefined' && navigator.onLine === false) return false;
        const light = isLightTheme();
        const provider = MAP_PROVIDERS[style] ?? MAP_PROVIDERS.standard;
        const cfg = currentMapConfig();
        const tiles = tileRange(view, provider.maxZoom);
        let drewAny = false;
        for(const t of tiles) {
            const url = tileUrl(t.z, t.x, t.y, light, style, cfg);
            if(!url) continue;
            const entry = this._requestTile(url);
            if(entry && entry.status === 'ready') {
                try {
                    ctx.drawImage(entry.img, t.dx, t.dy, t.size + 0.5, t.size + 0.5);
                    drewAny = true;
                } catch(_) {
                    // ignore broken image draw
                }
            }
        }
        return drewAny;
    }

    /**
     * @param {CanvasRenderingContext2D} ctx
     * @param {ReturnType<typeof makeViewport>} view
     * @param {ReturnType<RouteMap['_colors']>} c
     */
    _drawCourse(ctx, view, c) {
        ctx.save();
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        ctx.strokeStyle = c.muted;
        ctx.globalAlpha = 0.55;
        ctx.lineWidth = 2.5;
        ctx.setLineDash([6, 5]);
        ctx.beginPath();
        this._course.forEach((pt, i) => {
            const p = view.toCanvas(pt.lat, pt.lon);
            if(i === 0) ctx.moveTo(p.x, p.y);
            else ctx.lineTo(p.x, p.y);
        });
        ctx.stroke();
        ctx.restore();
    }

    /**
     * @param {CanvasRenderingContext2D} ctx
     * @param {ReturnType<typeof makeViewport>} view
     * @param {ReturnType<RouteMap['_colors']>} c
     * @param {string} metric
     * @returns {{min: number, max: number} | null}
     */
    _drawTrack(ctx, view, c, metric) {
        const pts = this._points;
        const projected = pts.map(p => view.toCanvas(p.lat, p.lon));

        // Casing for legibility over map tiles
        ctx.save();
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        ctx.strokeStyle = c.bg;
        ctx.globalAlpha = 0.72;
        ctx.lineWidth = 5.8;
        ctx.beginPath();
        for(let i = 0; i < projected.length; i++) {
            const p = projected[i];
            if(i === 0) ctx.moveTo(p.x, p.y);
            else ctx.lineTo(p.x, p.y);
        }
        ctx.stroke();
        ctx.restore();

        ctx.save();
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        ctx.lineWidth = 3.4;

        if(metric === 'none') {
            ctx.strokeStyle = c.accent;
            ctx.beginPath();
            for(let i = 0; i < projected.length; i++) {
                const p = projected[i];
                if(i === 0) ctx.moveTo(p.x, p.y);
                else ctx.lineTo(p.x, p.y);
            }
            ctx.stroke();
            ctx.restore();
            return null;
        }

        const values = pts.map((p, i) => metricValue(p, metric, this._grades[i] ?? null));
        const range = metricRange(values, metric);
        if(!range && !(metric === 'power' && this._ftp)) {
            ctx.strokeStyle = c.accent;
            ctx.beginPath();
            for(let i = 0; i < projected.length; i++) {
                const p = projected[i];
                if(i === 0) ctx.moveTo(p.x, p.y);
                else ctx.lineTo(p.x, p.y);
            }
            ctx.stroke();
            ctx.restore();
            return null;
        }

        // Batch consecutive segments sharing the same colour
        let currentColor = null;
        for(let i = 1; i < projected.length; i++) {
            const val = values[i] ?? values[i - 1];
            const color = colorForMetric(metric, val, range, c, this._ftp);
            if(color !== currentColor) {
                if(currentColor !== null) ctx.stroke();
                currentColor = color;
                ctx.strokeStyle = color;
                ctx.beginPath();
                ctx.moveTo(projected[i - 1].x, projected[i - 1].y);
            }
            ctx.lineTo(projected[i].x, projected[i].y);
        }
        if(currentColor !== null) ctx.stroke();
        ctx.restore();

        if(metric === 'power' && this._ftp && !range) {
            return {min: 0, max: Math.round(this._ftp * 1.5)};
        }
        return range;
    }

    /**
     * Draw a compact colorbar legend on the bottom-left of the canvas.
     * @param {CanvasRenderingContext2D} ctx
     * @param {number} h
     * @param {ReturnType<RouteMap['_colors']>} c
     * @param {string} metric
     * @param {{min: number, max: number}} range
     */
    _drawLegend(ctx, h, c, metric, range) {
        const meta = METRICS.find(m => m.id === metric);
        if(!meta) return;
        const minText = formatLegendVal(metric, range.min);
        const maxText = `${formatLegendVal(metric, range.max)}${meta.unit && metric !== 'grade' ? ' ' + meta.unit : ''}`;

        ctx.save();
        ctx.font = '10px system-ui, -apple-system, sans-serif';
        const minW = ctx.measureText ? ctx.measureText(minText).width : 20;
        const maxW = ctx.measureText ? ctx.measureText(maxText).width : 36;
        const barW = 72;
        const barH = 6;
        const padX = 7;
        const gap = 5;
        const boxW = padX * 2 + minW + gap + barW + gap + maxW;
        const boxH = 20;
        const bx = 6;
        const by = h - boxH - 6;

        ctx.fillStyle = c.bg;
        ctx.globalAlpha = 0.78;
        ctx.fillRect(bx, by, boxW, boxH);

        ctx.globalAlpha = 0.92;
        ctx.fillStyle = c.ink;
        ctx.textBaseline = 'middle';
        const cy = by + boxH / 2;
        ctx.fillText(minText, bx + padX, cy);

        const barX = bx + padX + minW + gap;
        const barY = by + (boxH - barH) / 2;
        const steps = 16;
        const segW = barW / steps;
        for(let i = 0; i < steps; i++) {
            const frac = i / (steps - 1);
            const v = range.min + frac * (range.max - range.min);
            ctx.fillStyle = colorForMetric(metric, v, range, c, this._ftp);
            ctx.fillRect(barX + i * segW, barY, segW + 0.5, barH);
        }

        ctx.fillStyle = c.ink;
        ctx.fillText(maxText, barX + barW + gap, cy);
        ctx.restore();
    }

    /**
     * @param {CanvasRenderingContext2D} ctx
     * @param {number} x
     * @param {number} y
     * @param {ReturnType<RouteMap['_colors']>} c
     */
    _drawStartMarker(ctx, x, y, c) {
        ctx.save();
        ctx.beginPath();
        ctx.arc(x, y, 5, 0, Math.PI * 2);
        ctx.fillStyle = c.good;
        ctx.fill();
        ctx.lineWidth = 2;
        ctx.strokeStyle = c.bg;
        ctx.stroke();
        ctx.restore();
    }

    /**
     * @param {CanvasRenderingContext2D} ctx
     * @param {number} x
     * @param {number} y
     * @param {ReturnType<RouteMap['_colors']>} c
     */
    _drawEndMarker(ctx, x, y, c) {
        ctx.save();
        ctx.beginPath();
        ctx.arc(x, y, 10, 0, Math.PI * 2);
        ctx.fillStyle = c.accent;
        ctx.globalAlpha = 0.25;
        ctx.fill();

        ctx.globalAlpha = 1;
        ctx.beginPath();
        ctx.arc(x, y, 5.5, 0, Math.PI * 2);
        ctx.fillStyle = c.accent;
        ctx.fill();
        ctx.lineWidth = 2;
        ctx.strokeStyle = c.bg;
        ctx.stroke();
        ctx.restore();
    }

    /**
     * @param {CanvasRenderingContext2D} ctx
     * @param {number} x
     * @param {number} y
     * @param {ReturnType<RouteMap['_colors']>} c
     */
    _drawCursorMarker(ctx, x, y, c) {
        ctx.save();
        ctx.beginPath();
        ctx.arc(x, y, 11, 0, Math.PI * 2);
        ctx.fillStyle = c.accent;
        ctx.globalAlpha = 0.3;
        ctx.fill();

        ctx.globalAlpha = 1;
        ctx.beginPath();
        ctx.arc(x, y, 6, 0, Math.PI * 2);
        ctx.fillStyle = c.ink;
        ctx.fill();
        ctx.lineWidth = 2.5;
        ctx.strokeStyle = c.accent;
        ctx.stroke();
        ctx.restore();
    }

    /**
     * @param {CanvasRenderingContext2D} ctx
     * @param {number} w
     * @param {number} h
     * @param {ReturnType<RouteMap['_colors']>} c
     * @param {string} [style='standard']
     */
    _drawAttribution(ctx, w, h, c, style = 'standard') {
        ctx.save();
        ctx.font = '10px system-ui, -apple-system, sans-serif';
        const text = (MAP_PROVIDERS[style] ?? MAP_PROVIDERS.standard).attribution;
        const tw = ctx.measureText ? ctx.measureText(text).width : 76;
        const px = 6;
        const bx = w - tw - px * 2 - 4;
        const by = h - 16 - 4;
        ctx.fillStyle = c.bg;
        ctx.globalAlpha = 0.72;
        ctx.fillRect(bx, by, tw + px * 2, 16);
        ctx.globalAlpha = 0.85;
        ctx.fillStyle = c.muted;
        ctx.textBaseline = 'middle';
        ctx.fillText(text, bx + px, by + 8);
        ctx.restore();
    }
}

if(!customElements.get('route-map')) {
    customElements.define('route-map', RouteMap);
}

export {
    RouteMap,
    projectPoint,
    fitBounds,
    makeViewport,
    tileRange,
    tileUrl,
    computeGrades,
    sampleRamp,
    colorForMetric,
    METRICS,
};
