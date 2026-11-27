// @ts-check
//
// <ride-indicator>: visual category indicator widget for Ride screens.
//
// Categories:
//   power   — Power zone (Z1–Z7 vs FTP) with optional ERG target marker
//   hr      — Heart rate zone (Z1–Z5 vs max HR)
//   cadence — Cadence gauge (rpm) with optimal zone & optional target marker
//   speed   — Speed gauge (km/h or mph)
//   wbal    — W′ balance remaining tank (W1–W4 fatigue zones)
//   grade   — Slope / grade (-10% to +15%)
//
// Visual variants (tap the widget or press Enter/Space to cycle):
//   bar     — Segmented zone bar with live marker & optional target tick
//   arc     — 220° radial dial gauge with segmented zone track
//   pill    — Compact status meter card with accent stripe & progress bar
//

import { xf } from '../functions.js';
import { db } from '../db.js';
import { riders } from '../riders.js';
import { ZONES, DEFAULT_PERCENTAGES, DEFAULT_WPRIME, zoneIndex } from '../analytics.js';
import { models } from '../models/models.js';

const INDICATOR_VARIANTS = ['bar', 'arc', 'pill'];
const VARIANT_LABEL = {bar: 'Bar', arc: 'Dial', pill: 'Meter'};

const INDICATOR_CATEGORIES = {
    power:   {label: 'Power Zone',  unit: 'W'},
    hr:      {label: 'HR Zone',     unit: 'bpm'},
    cadence: {label: 'Cadence',     unit: 'rpm'},
    speed:   {label: 'Speed',       unit: 'km/h'},
    wbal:    {label: 'W′ Balance',  unit: '%'},
    grade:   {label: 'Grade',       unit: '%'},
};

const HR_ZONES = [
    {short: 'Z1', name: 'Recovery',  max: 0.60, color: 'var(--zone-gray)'},
    {short: 'Z2', name: 'Endurance', max: 0.70, color: 'var(--zone-blue)'},
    {short: 'Z3', name: 'Tempo',     max: 0.80, color: 'var(--zone-teal)'},
    {short: 'Z4', name: 'Threshold', max: 0.90, color: 'var(--zone-yellow)'},
    {short: 'Z5', name: 'VO2 Max',   max: 1.00, color: 'var(--zone-red)'},
];

const CADENCE_ZONES = [
    {name: 'Grind',   max: 70,  color: 'var(--zone-orange)'},
    {name: 'Low',     max: 80,  color: 'var(--zone-yellow)'},
    {name: 'Optimal', max: 95,  color: 'var(--zone-green)'},
    {name: 'High',    max: 105, color: 'var(--zone-teal)'},
    {name: 'Spin',    max: 125, color: 'var(--zone-blue)'},
];

const clamp01 = v => Math.max(0, Math.min(1, Number.isFinite(v) ? v : 0));

function computeIndicator(category, snap = {}) {
    if(category === 'power') {
        const ftp = snap.ftp > 0 ? snap.ftp : 200;
        const p = Number.isFinite(snap.power) ? Math.max(0, snap.power) : null;
        const maxW = ftp * 1.4;
        const zi = p != null ? zoneIndex(p, ftp, DEFAULT_PERCENTAGES) : 0;
        const z = ZONES[zi] ?? ZONES[0];
        const bounds = [0, ...DEFAULT_PERCENTAGES, 1.4];
        const segments = ZONES.map((zone, i) => ({
            from: bounds[i] / 1.4,
            to: bounds[i + 1] / 1.4,
            color: zone.color,
        }));
        const target = snap.powerTarget > 0 ? snap.powerTarget : null;
        return {
            label: 'Power Zone',
            valueText: p != null ? String(Math.round(p)) : '--',
            unit: 'W',
            subText: p != null ? `${Math.round((p / ftp) * 100)}% FTP` : `FTP ${Math.round(ftp)} W`,
            zoneLabel: p != null ? `${z.short} ${z.name}` : 'Idle',
            color: p != null ? z.color : 'var(--muted)',
            ratio: p != null ? clamp01(p / maxW) : 0,
            targetRatio: target != null ? clamp01(target / maxW) : null,
            segments,
        };
    }

    if(category === 'hr') {
        const maxHr = snap.maxHr > 0 ? snap.maxHr : 190;
        const hr = Number.isFinite(snap.heartRate) && snap.heartRate > 0 ? snap.heartRate : null;
        const pct = hr != null ? hr / maxHr : 0;
        let z = HR_ZONES[HR_ZONES.length - 1];
        for(const zone of HR_ZONES) {
            if(pct < zone.max) { z = zone; break; }
        }
        const bounds = [0.40, 0.60, 0.70, 0.80, 0.90, 1.00];
        const segments = HR_ZONES.map((zone, i) => ({
            from: (bounds[i] - 0.40) / 0.60,
            to: (bounds[i + 1] - 0.40) / 0.60,
            color: zone.color,
        }));
        return {
            label: 'HR Zone',
            valueText: hr != null ? String(Math.round(hr)) : '--',
            unit: 'bpm',
            subText: hr != null ? `${Math.round(pct * 100)}% max` : `Max ${Math.round(maxHr)}`,
            zoneLabel: hr != null ? `${z.short} ${z.name}` : 'No HR',
            color: hr != null ? z.color : 'var(--muted)',
            ratio: hr != null ? clamp01((pct - 0.40) / 0.60) : 0,
            targetRatio: null,
            segments,
        };
    }

    if(category === 'cadence') {
        const cad = Number.isFinite(snap.cadence) && snap.cadence > 0 ? snap.cadence : null;
        const minC = 40, maxC = 125;
        let z = CADENCE_ZONES[CADENCE_ZONES.length - 1];
        if(cad != null) {
            for(const zone of CADENCE_ZONES) {
                if(cad < zone.max) { z = zone; break; }
            }
        }
        const bounds = [40, 70, 80, 95, 105, 125];
        const segments = CADENCE_ZONES.map((zone, i) => ({
            from: (bounds[i] - minC) / (maxC - minC),
            to: (bounds[i + 1] - minC) / (maxC - minC),
            color: zone.color,
        }));
        const target = snap.cadenceTarget > 0 ? snap.cadenceTarget : null;
        return {
            label: 'Cadence',
            valueText: cad != null ? String(Math.round(cad)) : '--',
            unit: 'rpm',
            subText: target != null ? `Target ${Math.round(target)} rpm` : '80–95 optimal',
            zoneLabel: cad != null ? z.name : 'Idle',
            color: cad != null ? z.color : 'var(--muted)',
            ratio: cad != null ? clamp01((cad - minC) / (maxC - minC)) : 0,
            targetRatio: target != null ? clamp01((target - minC) / (maxC - minC)) : null,
            segments,
        };
    }

    if(category === 'speed') {
        const imperial = snap.measurement === 'imperial';
        const mps = Number.isFinite(snap.speed) && snap.speed > 0
            ? snap.speed
            : (Number.isFinite(snap.speedVirtual) && snap.speedVirtual > 0 ? snap.speedVirtual : null);
        const val = mps != null ? (imperial ? models.speed.mpsToMph(mps) : models.speed.mpsToKmh(mps)) : null;
        const maxS = imperial ? 38 : 60;
        const unit = imperial ? 'mph' : 'km/h';
        const kmh = mps != null ? models.speed.mpsToKmh(mps) : 0;
        let zoneLabel = 'Stopped', color = 'var(--muted)';
        if(val != null) {
            if(kmh < 20)      { zoneLabel = 'Easy';   color = 'var(--zone-gray)'; }
            else if(kmh < 30) { zoneLabel = 'Cruise'; color = 'var(--zone-blue)'; }
            else if(kmh < 38) { zoneLabel = 'Fast';   color = 'var(--zone-teal)'; }
            else if(kmh < 46) { zoneLabel = 'Aero';   color = 'var(--zone-green)'; }
            else              { zoneLabel = 'Sprint'; color = 'var(--zone-orange)'; }
        }
        const segments = [
            {from: 0,    to: 20/60, color: 'var(--zone-gray)'},
            {from: 20/60, to: 30/60, color: 'var(--zone-blue)'},
            {from: 30/60, to: 38/60, color: 'var(--zone-teal)'},
            {from: 38/60, to: 46/60, color: 'var(--zone-green)'},
            {from: 46/60, to: 1,     color: 'var(--zone-orange)'},
        ];
        return {
            label: 'Speed',
            valueText: val != null ? val.toFixed(1) : '--',
            unit,
            subText: imperial ? '0–38 mph' : '0–60 km/h',
            zoneLabel,
            color,
            ratio: val != null ? clamp01(val / maxS) : 0,
            targetRatio: null,
            segments,
        };
    }

    if(category === 'wbal') {
        const wprime = snap.wprime > 0 ? snap.wprime : DEFAULT_WPRIME;
        const wbal = Number.isFinite(snap.wbal) ? Math.max(0, Math.min(wprime, snap.wbal)) : wprime;
        const remRatio = clamp01(wbal / wprime);
        const pct = Math.round(remRatio * 100);
        const usedPct = 100 - pct;
        let zoneLabel = 'Fresh', color = 'var(--zone-green)';
        if(usedPct >= 75)      { zoneLabel = 'W4 Severe';   color = 'var(--zone-red)'; }
        else if(usedPct >= 50) { zoneLabel = 'W3 Heavy';    color = 'var(--zone-orange)'; }
        else if(usedPct >= 25) { zoneLabel = 'W2 Moderate'; color = 'var(--zone-blue)'; }
        else                   { zoneLabel = 'W1 Fresh';    color = 'var(--zone-green)'; }
        const segments = [
            {from: 0,    to: 0.25, color: 'var(--zone-red)'},
            {from: 0.25, to: 0.50, color: 'var(--zone-orange)'},
            {from: 0.50, to: 0.75, color: 'var(--zone-blue)'},
            {from: 0.75, to: 1,    color: 'var(--zone-green)'},
        ];
        return {
            label: 'W′ Balance',
            valueText: String(pct),
            unit: '%',
            subText: `${(wbal / 1000).toFixed(1)} / ${(wprime / 1000).toFixed(1)} kJ`,
            zoneLabel,
            color,
            ratio: remRatio,
            targetRatio: null,
            segments,
        };
    }

    // grade / slope
    const slope = Number.isFinite(snap.slope) ? snap.slope : 0;
    const minG = -10, maxG = 15;
    const ratio = clamp01((slope - minG) / (maxG - minG));
    let zoneLabel = 'Flat', color = 'var(--zone-green)';
    if(slope <= -3)     { zoneLabel = 'Descent'; color = 'var(--zone-blue)'; }
    else if(slope < 1)  { zoneLabel = 'Flat';    color = 'var(--zone-green)'; }
    else if(slope < 5)  { zoneLabel = 'False flat'; color = 'var(--zone-teal)'; }
    else if(slope < 9)  { zoneLabel = 'Climb';   color = 'var(--zone-yellow)'; }
    else                { zoneLabel = 'Steep';   color = 'var(--zone-red)'; }
    const segments = [
        {from: 0,           to: 7/25,  color: 'var(--zone-blue)'},
        {from: 7/25,        to: 11/25, color: 'var(--zone-green)'},
        {from: 11/25,       to: 15/25, color: 'var(--zone-teal)'},
        {from: 15/25,       to: 19/25, color: 'var(--zone-yellow)'},
        {from: 19/25,       to: 1,     color: 'var(--zone-red)'},
    ];
    return {
        label: 'Grade',
        valueText: `${slope > 0 ? '+' : ''}${slope.toFixed(1)}`,
        unit: '%',
        subText: 'Slope',
        zoneLabel,
        color,
        ratio,
        targetRatio: (0 - minG) / (maxG - minG), // 0% reference mark
        segments,
    };
}

function polar(cx, cy, r, deg) {
    const rad = (deg * Math.PI) / 180;
    return [cx + r * Math.cos(rad), cy + r * Math.sin(rad)];
}

function arcPath(cx, cy, r, a0, a1) {
    const [x0, y0] = polar(cx, cy, r, a0);
    const [x1, y1] = polar(cx, cy, r, a1);
    const large = Math.abs(a1 - a0) > 180 ? 1 : 0;
    return `M ${x0.toFixed(2)} ${y0.toFixed(2)} A ${r} ${r} 0 ${large} 1 ${x1.toFixed(2)} ${y1.toFixed(2)}`;
}

class RideIndicator extends HTMLElement {
    connectedCallback() {
        this.category = this.dataset.category || this.getAttribute('category') || 'power';
        if(!INDICATOR_CATEGORIES[this.category]) this.category = 'power';
        this.variant = this.loadVariant();
        this.snap = {
            power: Number.isFinite(db.power1s) ? db.power1s : db.power,
            powerTarget: db.powerTarget,
            ftp: db.ftp || 200,
            heartRate: db.heartRate,
            maxHr: 190,
            cadence: db.cadence,
            cadenceTarget: db.cadenceTarget,
            speed: db.speed,
            speedVirtual: db.speedVirtual,
            measurement: db.measurement,
            wbal: DEFAULT_WPRIME,
            wprime: DEFAULT_WPRIME,
            slope: db.slopeTarget ?? 0,
        };

        this.classList.add('tile', 'ri');
        this.setAttribute('role', 'button');
        this.setAttribute('tabindex', '0');
        this.title = 'Tap to switch indicator style';

        this.abort?.abort();
        this.abort = new AbortController();
        const signal = {signal: this.abort.signal};

        const update = (key, val) => {
            if(this.snap[key] === val) return;
            this.snap[key] = val;
            this.render();
        };

        if(this.category === 'power') {
            xf.sub('db:power1s', v => update('power', v), signal);
            xf.sub('db:powerTarget', v => update('powerTarget', v), signal);
            xf.sub('db:ftp', v => update('ftp', v), signal);
        } else if(this.category === 'hr') {
            xf.sub('db:heartRate', v => update('heartRate', v), signal);
        } else if(this.category === 'cadence') {
            xf.sub('db:cadence', v => update('cadence', v), signal);
            xf.sub('db:cadenceTarget', v => update('cadenceTarget', v), signal);
        } else if(this.category === 'speed') {
            xf.sub('db:speed', v => update('speed', v), signal);
            xf.sub('db:speedVirtual', v => update('speedVirtual', v), signal);
            xf.sub('db:measurement', v => update('measurement', v), signal);
        } else if(this.category === 'wbal') {
            xf.sub('analytics:update', s => {
                if(!s) return;
                this.snap.wbal = s.wbal;
                this.snap.wprime = s.wprime;
                this.render();
            }, signal);
        } else if(this.category === 'grade') {
            xf.sub('db:slopeTarget', v => update('slope', v), signal);
        }

        this.addEventListener('click', () => this.cycleVariant(), signal);
        this.addEventListener('keydown', e => {
            if(e.key === 'Enter' || e.key === ' ') { e.preventDefault(); this.cycleVariant(); }
        }, signal);

        this.render();
    }

    disconnectedCallback() {
        this.abort?.abort();
    }

    storageKey() {
        return riders.key(`indicator:variant:${this.category}`);
    }

    loadVariant() {
        try {
            const v = localStorage.getItem(this.storageKey());
            if(INDICATOR_VARIANTS.includes(v)) return v;
        } catch(_) {}
        return 'bar';
    }

    cycleVariant() {
        const idx = INDICATOR_VARIANTS.indexOf(this.variant);
        this.variant = INDICATOR_VARIANTS[(idx + 1) % INDICATOR_VARIANTS.length];
        try { localStorage.setItem(this.storageKey(), this.variant); } catch(_) {}
        this.render();
    }

    render() {
        const d = computeIndicator(this.category, this.snap);
        this.dataset.variant = this.variant;
        this.style.setProperty('--ri-color', d.color);
        this.setAttribute('aria-label', `${d.label}: ${d.valueText} ${d.unit}, ${d.zoneLabel}. Style: ${VARIANT_LABEL[this.variant]}`);

        if(this.variant === 'arc') {
            const startDeg = 160, sweepDeg = 220;
            const cx = 60, cy = 58, r = 46;
            const segPaths = d.segments.map(s => {
                const a0 = startDeg + s.from * sweepDeg;
                const a1 = startDeg + s.to * sweepDeg;
                return `<path class="ri-arc__seg" d="${arcPath(cx, cy, r, a0, a1)}" stroke="${s.color}"/>`;
            }).join('');
            const valAngle = startDeg + d.ratio * sweepDeg;
            const [nx, ny] = polar(cx, cy, r, valAngle);
            let targetTick = '';
            if(d.targetRatio != null) {
                const ta = startDeg + d.targetRatio * sweepDeg;
                const [t0x, t0y] = polar(cx, cy, r - 6, ta);
                const [t1x, t1y] = polar(cx, cy, r + 6, ta);
                targetTick = `<line class="ri-arc__target" x1="${t0x.toFixed(1)}" y1="${t0y.toFixed(1)}" x2="${t1x.toFixed(1)}" y2="${t1y.toFixed(1)}"/>`;
            }
            this.innerHTML = `
                <div class="ri-head">
                    <h2 class="tile__label">${d.label}</h2>
                    <span class="ri-mode">${VARIANT_LABEL[this.variant]}</span>
                </div>
                <div class="ri-arc">
                    <svg class="ri-arc__svg" viewBox="0 0 120 88" aria-hidden="true">
                        ${segPaths}
                        ${targetTick}
                        <circle class="ri-arc__dot" cx="${nx.toFixed(1)}" cy="${ny.toFixed(1)}" r="5.5" fill="${d.color}"/>
                    </svg>
                    <div class="ri-arc__center">
                        <span class="ri-val">${d.valueText}</span>
                        <span class="ri-unit">${d.unit}</span>
                    </div>
                </div>
                <div class="ri-foot">
                    <span class="ri-badge">${d.zoneLabel}</span>
                    <span class="ri-sub">${d.subText}</span>
                </div>`;
            return;
        }

        if(this.variant === 'pill') {
            this.innerHTML = `
                <div class="ri-head">
                    <h2 class="tile__label">${d.label}</h2>
                    <span class="ri-badge">${d.zoneLabel}</span>
                </div>
                <div class="ri-pill__mid">
                    <span class="ri-val">${d.valueText}</span>
                    <span class="ri-unit">${d.unit}</span>
                    <span class="ri-sub">${d.subText}</span>
                </div>
                <div class="ri-pill__track" aria-hidden="true">
                    <span class="ri-pill__fill" style="width:${(d.ratio * 100).toFixed(1)}%"></span>
                    ${d.targetRatio != null ? `<span class="ri-pill__target" style="left:${(d.targetRatio * 100).toFixed(1)}%"></span>` : ''}
                </div>`;
            return;
        }

        // 'bar' (default): segmented zone bar
        const segs = d.segments.map(s =>
            `<span class="ri-bar__seg" style="flex:${((s.to - s.from) * 100).toFixed(2)};background:${s.color}"></span>`
        ).join('');
        this.innerHTML = `
            <div class="ri-head">
                <h2 class="tile__label">${d.label}</h2>
                <span class="ri-mode">${VARIANT_LABEL[this.variant]}</span>
            </div>
            <div class="ri-bar__row">
                <span class="ri-val">${d.valueText}</span>
                <span class="ri-unit">${d.unit}</span>
                <span class="ri-badge">${d.zoneLabel}</span>
            </div>
            <div class="ri-bar__track" aria-hidden="true">
                <div class="ri-bar__segs">${segs}</div>
                ${d.targetRatio != null ? `<span class="ri-bar__target" style="left:${(d.targetRatio * 100).toFixed(1)}%"></span>` : ''}
                <span class="ri-bar__needle" style="left:${(d.ratio * 100).toFixed(1)}%"></span>
            </div>
            <div class="ri-foot">
                <span class="ri-sub">${d.subText}</span>
            </div>`;
    }
}

if(!customElements.get('ride-indicator')) {
    customElements.define('ride-indicator', RideIndicator);
}

export { RideIndicator, INDICATOR_CATEGORIES, INDICATOR_VARIANTS, computeIndicator };
