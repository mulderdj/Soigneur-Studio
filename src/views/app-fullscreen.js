// @ts-check
//
// Full-app fullscreen toggle ([data-app-fullscreen]):
// Enters browser Fullscreen API with navigationUI: 'hide' (hiding Android
// system status & navigation buttons) and toggles `body.is-app-full` (hiding
// the bottom <app-bar> for an uncluttered bike-computer view).
//

const ICON_ENTER = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/></svg>';
const ICON_EXIT  = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 4v5H4M15 4v5h5M9 20v-5H4M15 20v-5h5"/></svg>';

function initAppFullscreen(root = document) {
    /** @type {HTMLButtonElement | null} */
    const btn = root.querySelector('[data-app-fullscreen]');
    if(!btn) return null;

    let active = false;
    const ac = new AbortController();
    const signal = {signal: ac.signal};

    function sync() {
        document.body?.classList.toggle('is-app-full', active);
        btn.setAttribute('aria-pressed', String(active));
        btn.setAttribute('aria-label', active ? 'Exit full screen' : 'Full screen');
        btn.title = active ? 'Exit full screen' : 'Full screen';
        btn.innerHTML = active ? ICON_EXIT : ICON_ENTER;
    }

    const isPhone = () => typeof window !== 'undefined' &&
        typeof window.matchMedia === 'function' &&
        window.matchMedia('(pointer: coarse), (max-width: 599px)').matches;

    async function enter() {
        active = true;
        sync();
        // On phones, keep the Android notification/status bar visible by only
        // hiding the in-app navigation bar; on desktop, also enter OS fullscreen.
        if(isPhone()) return;
        try {
            const el = document.documentElement;
            if(el?.requestFullscreen) {
                await el.requestFullscreen({navigationUI: 'hide'});
            }
        } catch(_) {
            // Fall back to hiding the in-app navigation bar
        }
    }

    async function exit() {
        if(!active) return;
        active = false;
        sync();
        try {
            if(document.fullscreenElement === document.documentElement) {
                await document.exitFullscreen?.();
            }
        } catch(_) {}
    }

    btn.addEventListener('click', () => {
        if(active) exit();
        else enter();
    }, signal);

    document.addEventListener('fullscreenchange', () => {
        const isRootFull = document.fullscreenElement === document.documentElement;
        if(active && !isRootFull) {
            active = false;
            sync();
        } else if(!active && isRootFull) {
            active = true;
            sync();
        }
    }, signal);

    document.addEventListener('keydown', e => {
        if(e.key === 'Escape' && active && !document.fullscreenElement) {
            exit();
        }
    }, signal);

    sync();

    return {
        enter,
        exit,
        isActive: () => active,
        destroy() { ac.abort(); },
    };
}

if(typeof document !== 'undefined') {
    const start = () => initAppFullscreen(document);
    if(document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, {once: true});
    else start();
}

export { initAppFullscreen };
