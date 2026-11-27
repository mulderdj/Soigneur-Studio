// @ts-check
//
// Top-layer chart tooltip shared by Training (uPlot), Ride Analysis (uPlot),
// and Ride (live canvas chart).
//
// Uses the native Popover API (`popover="manual"`) so the browser hoists the
// tooltip into the Top Layer while keeping the element in its component DOM
// (preserving CSS custom properties, theme inheritance, and event bubbling).
// Immune to ancestor `overflow: hidden`, `container-type`, and sibling card
// stacking contexts. Falls back to `position: fixed` where Popover API is
// unavailable (e.g. JSDOM).
//

const PAD = 8;
const GAP = 14;

let active = null;
let listenersBound = false;

function onViewportChange() {
    active?.hide();
}

function onOutsidePointer(e) {
    if(!active || !active._touch) return;
    if(active.el.contains(e.target) || active.owner?.contains(e.target)) return;
    active.hide();
}

function bindGlobal() {
    if(listenersBound || typeof window === 'undefined') return;
    listenersBound = true;
    window.addEventListener('scroll', onViewportChange, {capture: true, passive: true});
    window.addEventListener('resize', onViewportChange, {passive: true});
    window.addEventListener('pointerdown', onOutsidePointer, {capture: true, passive: true});
}

function unbindGlobal() {
    if(!listenersBound || typeof window === 'undefined') return;
    listenersBound = false;
    window.removeEventListener('scroll', onViewportChange, {capture: true});
    window.removeEventListener('resize', onViewportChange);
    window.removeEventListener('pointerdown', onOutsidePointer, {capture: true});
}

// Compute viewport-clamped (left, top) for a fixed/top-layer tooltip.
// Prefers placing the tooltip above the plot (centered over x) so scrubbing
// never covers the data; falls back beside the cursor inside the plot when
// there is not enough room above the plot.
function placeTooltip({x, plotTop}, {width, height}, {width: vw, height: vh, bottomInset = 0}) {
    const maxLeft = Math.max(PAD, vw - width - PAD);
    const maxTop = Math.max(PAD, vh - bottomInset - PAD - height);

    const aboveTop = plotTop - height - PAD;
    if(aboveTop >= PAD) {
        const left = Math.max(PAD, Math.min(x - width / 2, maxLeft));
        const top = Math.min(aboveTop, maxTop);
        return {left, top};
    }

    const rawLeft = x + GAP + width > vw - PAD ? x - GAP - width : x + GAP;
    const left = Math.max(PAD, Math.min(rawLeft, maxLeft));
    const top = Math.max(PAD, Math.min(plotTop + PAD, maxTop));
    return {left, top};
}

function appBarInset(owner) {
    if(typeof document === 'undefined') return 0;
    if(document.fullscreenElement || owner?.classList?.contains('is-full')) return 0;
    const bar = document.querySelector('.app-bar');
    if(!bar) return 0;
    const r = bar.getBoundingClientRect();
    return r.height > 0 && r.bottom >= (window.innerHeight || 0) - 2 ? r.height : 0;
}

class ChartTooltip {
    constructor(el, {owner = null} = {}) {
        this.el = el;
        this.owner = owner;
        this._touch = false;
        el.classList.add('chart-tip');
        if(typeof el.showPopover === 'function') el.setAttribute('popover', 'manual');
        el.hidden = true;
    }

    show({html, x, plotTop, touch = false}) {
        if(active && active !== this) active.hide();
        active = this;
        this._touch = touch;
        bindGlobal();

        const el = this.el;
        el.innerHTML = html;
        el.classList.toggle('is-touch', touch);
        el.style.left = '0px';
        el.style.top = '0px';
        el.hidden = false;
        if(typeof el.showPopover === 'function') {
            try {
                if(!el.matches?.(':popover-open')) el.showPopover();
            } catch(_) {
                // detached or browser restriction: fixed fallback still displays it
            }
        }
        const vw = window.innerWidth || 1024;
        const vh = window.innerHeight || 768;
        const pos = placeTooltip(
            {x, plotTop},
            {width: el.offsetWidth || 0, height: el.offsetHeight || 0},
            {width: vw, height: vh, bottomInset: appBarInset(this.owner)},
        );
        el.style.left = `${Math.round(pos.left)}px`;
        el.style.top = `${Math.round(pos.top)}px`;
    }

    hide() {
        const el = this.el;
        if(el) {
            if(typeof el.hidePopover === 'function') {
                try {
                    if(el.matches?.(':popover-open')) el.hidePopover();
                } catch(_) {}
            }
            el.hidden = true;
        }
        this._touch = false;
        if(active === this) {
            active = null;
            unbindGlobal();
        }
    }

    destroy() {
        this.hide();
    }
}

export { ChartTooltip, placeTooltip };
