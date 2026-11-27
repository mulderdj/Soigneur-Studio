// @ts-check
//
// <route-map>: lightweight, zero-dependency GPS route map on HTML5 <canvas>.
//
// Uses pure Web Mercator projection with optional Carto basemap tiles when
// online and a clean offline fallback on --bg with subtle gridlines.
//
//   el.setTrack({points, ftp})   points: [{lat, lon, power?}]
//   el.setCourse(points)         planned course track drawn underneath
//   el.appendPoint(pt)           incremental live point (RAF-coalesced)
//   el.setCursor(pt | null)      highlighted scrubbing cursor at {lat, lon}
//

import { zoneIndex } from '../../analytics.js';
import { xf } from '../../functions.js';

const MAX_LAT = 85.05112878;
const TILE_SIZE = 256;
const MAX_CACHE = 128;
const MAX_TILES = 64;
const TERRAIN_MAX_ZOOM = 17;

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

    const scale = TILE_SIZE * Math.pow(2, zoom);
    const tileZoom = Math.max(0, Math.min(18, Math.floor(zoom + 0.35)));

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

    return {zoom, tileZoom, scale, cx, cy, width: w, height: h, minX, maxX, minY, maxY, toCanvas};
}

/**
 * Compute the list of slippy map tiles covering a fitted viewport.
 * @param {ReturnType<typeof fitBounds>} view
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

function currentMapStyle() {
    return document.body?.dataset?.mapStyle === 'terrain' ? 'terrain' : 'standard';
}

/**
 * @param {number} z
 * @param {number} x
 * @param {number} y
 * @param {boolean} light
 * @param {'standard' | 'terrain'} [style='standard']
 */
function tileUrl(z, x, y, light, style = 'standard') {
    if(style === 'terrain') {
        return `https://a.tile.opentopomap.org/${z}/${x}/${y}.png`;
    }
    return light
        ? `https://a.basemaps.cartocdn.com/rastertiles/voyager/${z}/${x}/${y}@2x.png`
        : `https://a.basemaps.cartocdn.com/dark_all/${z}/${x}/${y}@2x.png`;
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

class RouteMap extends HTMLElement {
    constructor() {
        super();
        /** @type {Array<{lat: number, lon: number, power?: number | null}>} */
        this._points = [];
        /** @type {Array<{lat: number, lon: number}>} */
        this._course = [];
        /** @type {number | null} */
        this._ftp = null;
        /** @type {{lat: number, lon: number} | null} */
        this._cursor = null;
        /** @type {number | null} */
        this._raf = null;
        /** @type {boolean} */
        this._pending = false;
        /** @type {HTMLCanvasElement | null} */
        this.$canvas = null;
        /** @type {HTMLButtonElement | null} */
        this.$styleBtn = null;
        /** @type {'standard' | 'terrain' | null} */
        this._mapStyle = null;
        /** @type {ResizeObserver | null} */
        this._resize = null;
        /** @type {MutationObserver | null} */
        this._theme = null;
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
        if(!this.$styleBtn) {
            this.$styleBtn = document.createElement('button');
            this.$styleBtn.type = 'button';
            this.$styleBtn.className = 'rm-style-btn';
            this.$styleBtn.setAttribute('aria-label', 'Switch map style');
            this.$styleBtn.addEventListener('click', () => {
                if(this._mapStyle) {
                    this.setMapStyle(this._mapStyle === 'terrain' ? 'standard' : 'terrain');
                } else {
                    xf.dispatch('ui:mapStyle-switch');
                }
            });
            this.append(this.$styleBtn);
        }
        this._syncStyleBtn();
        if(typeof ResizeObserver === 'function') {
            this._resize = new ResizeObserver(() => this.scheduleDraw());
            this._resize.observe(this);
        }
        if(typeof MutationObserver === 'function' && document.body) {
            this._theme = new MutationObserver(() => {
                this._syncStyleBtn();
                this.scheduleDraw();
            });
            this._theme.observe(document.body, {attributes: true, attributeFilter: ['class', 'data-palette', 'data-map-style']});
        }
        this.draw();
    }

    /** @returns {'standard' | 'terrain'} */
    getMapStyle() {
        return this._mapStyle ?? currentMapStyle();
    }

    /** @param {'standard' | 'terrain' | null} style */
    setMapStyle(style) {
        this._mapStyle = style === 'terrain' || style === 'standard' ? style : null;
        this._syncStyleBtn();
        this.scheduleDraw();
    }

    _syncStyleBtn() {
        if(!this.$styleBtn) return;
        const style = this.getMapStyle();
        const isTerrain = style === 'terrain';
        this.$styleBtn.textContent = isTerrain ? 'Terrain' : 'Map';
        this.$styleBtn.setAttribute('aria-pressed', String(isTerrain));
        this.$styleBtn.title = isTerrain ? 'Switch to standard map' : 'Switch to terrain map';
    }

    disconnectedCallback() {
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
     * Set the main GPS track (and optional FTP for power-zone colouring).
     * @param {{points?: Array<{lat: number, lon: number, power?: number | null}>, ftp?: number | null}} [args]
     */
    setTrack({points = [], ftp = null} = {}) {
        this._points = (points ?? []).filter(validPoint).map(p => ({
            lat: p.lat,
            lon: p.lon,
            power: Number.isFinite(p.power) ? p.power : null,
        }));
        this._ftp = Number.isFinite(ftp) && ftp > 0 ? ftp : null;
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
     * @param {{lat: number, lon: number, power?: number | null}} pt
     */
    appendPoint(pt) {
        if(!validPoint(pt)) return;
        this._points.push({
            lat: pt.lat,
            lon: pt.lon,
            power: Number.isFinite(pt.power) ? pt.power : null,
        });
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
        img.crossOrigin = 'anonymous';
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
            if(this.$styleBtn) this.$styleBtn.hidden = true;
            this._drawGrid(ctx, w, h, c.line);
            ctx.restore();
            return;
        }
        if(this.$styleBtn) this.$styleBtn.hidden = false;

        const pad = Math.min(32, Math.round(Math.min(w, h) * 0.12));
        const view = fitBounds(all, w, h, pad);
        const mapStyle = this.getMapStyle();
        const drewTiles = this._drawBasemap(ctx, view, mapStyle);
        if(!drewTiles) {
            this._drawGrid(ctx, w, h, c.line);
        }

        // Planned course track underneath
        if(this._course.length >= 2) {
            this._drawCourse(ctx, view, c);
        }

        // Main GPS track
        if(this._points.length >= 2) {
            this._drawTrack(ctx, view, c);
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
     * @param {ReturnType<typeof fitBounds>} view
     * @param {'standard' | 'terrain'} [style='standard']
     * @returns {boolean}
     */
    _drawBasemap(ctx, view, style = 'standard') {
        if(typeof navigator !== 'undefined' && navigator.onLine === false) return false;
        const light = isLightTheme();
        const maxZoom = style === 'terrain' ? TERRAIN_MAX_ZOOM : 18;
        const tiles = tileRange(view, maxZoom);
        let drewAny = false;
        for(const t of tiles) {
            const url = tileUrl(t.z, t.x, t.y, light, style);
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
     * @param {ReturnType<typeof fitBounds>} view
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
     * @param {ReturnType<typeof fitBounds>} view
     * @param {ReturnType<RouteMap['_colors']>} c
     */
    _drawTrack(ctx, view, c) {
        const pts = this._points;
        const projected = pts.map(p => view.toCanvas(p.lat, p.lon));

        // Casing for legibility over map tiles
        ctx.save();
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        ctx.strokeStyle = c.bg;
        ctx.globalAlpha = 0.7;
        ctx.lineWidth = 5.5;
        ctx.beginPath();
        for(let i = 0; i < projected.length; i++) {
            const p = projected[i];
            if(i === 0) ctx.moveTo(p.x, p.y);
            else ctx.lineTo(p.x, p.y);
        }
        ctx.stroke();
        ctx.restore();

        const ftp = this._ftp;
        const hasPower = !!(ftp && ftp > 0 && pts.some(p => Number.isFinite(p.power)));

        ctx.save();
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        ctx.lineWidth = 3.2;

        if(!hasPower) {
            ctx.strokeStyle = c.accent;
            ctx.beginPath();
            for(let i = 0; i < projected.length; i++) {
                const p = projected[i];
                if(i === 0) ctx.moveTo(p.x, p.y);
                else ctx.lineTo(p.x, p.y);
            }
            ctx.stroke();
            ctx.restore();
            return;
        }

        // Batch consecutive segments sharing the same zone colour
        let currentColor = null;
        for(let i = 1; i < projected.length; i++) {
            const w = pts[i].power ?? pts[i - 1].power;
            const color = Number.isFinite(w) ? c.zones[zoneIndex(w, ftp)] : c.accent;
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
     * @param {'standard' | 'terrain'} [style='standard']
     */
    _drawAttribution(ctx, w, h, c, style = 'standard') {
        ctx.save();
        ctx.font = '10px system-ui, -apple-system, sans-serif';
        const text = style === 'terrain' ? '© OSM · OpenTopoMap' : '© OSM · CARTO';
        const tw = ctx.measureText ? ctx.measureText(text).width : 76;
        const px = 6, py = 3;
        const bx = w - tw - px * 2 - 4;
        const by = h - 16 - 4;
        ctx.fillStyle = c.bg;
        ctx.globalAlpha = 0.72;
        ctx.fillRect(bx, by, tw + px * 2, 16);
        ctx.globalAlpha = 0.85;
        ctx.fillStyle = c.muted;
        ctx.textBaseline = 'middle';
        ctx.fillText(text, bx + px, by + 8 + py * 0);
        ctx.restore();
    }
}

if(!customElements.get('route-map')) {
    customElements.define('route-map', RouteMap);
}

export { RouteMap, projectPoint, fitBounds, tileRange, tileUrl };
