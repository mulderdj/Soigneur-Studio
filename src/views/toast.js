//
// In-app toast notifications: top-layer (`popover="manual"` with fixed fallback),
// accessible (`role="status"`, `aria-live="polite"`), auto-dismissing, and
// pointer-events:none so they never interrupt riding or clicks.
//
// Usage:
//   xf.dispatch('ui:toast', 'ERG mode');
//   xf.dispatch('ui:toast', {text: 'Tap Stop again to end ride', tone: 'warn', duration: 3000});
//

import { xf } from '../functions.js';

const DEFAULT_DURATION = 2600;

class ToastHost {
    constructor() {
        this.el = null;
        this.timer = null;
    }

    ensure() {
        if(this.el && this.el.isConnected) return this.el;
        if(typeof document === 'undefined' || !document.body) return null;
        const el = document.createElement('div');
        el.className = 'app-toast';
        el.setAttribute('role', 'status');
        el.setAttribute('aria-live', 'polite');
        el.setAttribute('aria-atomic', 'true');
        if(typeof el.showPopover === 'function') el.setAttribute('popover', 'manual');
        el.hidden = true;
        document.body.append(el);
        this.el = el;
        return el;
    }

    show(payload) {
        const opts = typeof payload === 'string' ? {text: payload} : (payload ?? {});
        const text = String(opts.text ?? '').trim();
        if(!text) return;
        const el = this.ensure();
        if(!el) return;
        const tone = ['info', 'good', 'warn', 'danger'].includes(opts.tone) ? opts.tone : 'info';
        const duration = Number.isFinite(opts.duration) && opts.duration > 0 ? opts.duration : DEFAULT_DURATION;

        el.textContent = text;
        el.dataset.tone = tone;
        el.hidden = false;
        if(typeof el.showPopover === 'function') {
            try {
                if(!el.matches?.(':popover-open')) el.showPopover();
            } catch(_) {}
        }
        clearTimeout(this.timer);
        this.timer = setTimeout(() => this.hide(), duration);
    }

    hide() {
        clearTimeout(this.timer);
        this.timer = null;
        const el = this.el;
        if(!el) return;
        if(typeof el.hidePopover === 'function') {
            try {
                if(el.matches?.(':popover-open')) el.hidePopover();
            } catch(_) {}
        }
        el.hidden = true;
    }
}

const toastHost = new ToastHost();

function showToast(payload) {
    toastHost.show(payload);
}

xf.sub('ui:toast', payload => toastHost.show(payload));

export { ToastHost, toastHost, showToast };
