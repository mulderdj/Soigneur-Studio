// @ts-check
import { xf } from './functions.js';

class ScreenWakeLock {
    constructor() {
        /** @type {any} */
        this.sentinel = undefined;
        this.isLocked = false;
        this.isLockable = false;
        this.isVisible = false;
        this.init();
    }

    init() {
        if (typeof navigator === 'undefined' || typeof document === 'undefined') {
            return;
        }

        this.isLockable = 'wakeLock' in navigator;
        this.isVisible = this.checkVisibility();
        this.lockScreen();

        document.addEventListener('visibilitychange', () => this.onVisibilityChange());

        if (typeof window !== 'undefined') {
            window.addEventListener('beforeunload', () => {
                xf.dispatch('lock:beforeunload');
            });
        }
    }

    checkVisibility() {
        return typeof document !== 'undefined' && document.visibilityState === 'visible';
    }

    onVisibilityChange() {
        this.isVisible = this.checkVisibility();
        if (this.isVisible) {
            this.lockScreen();
        }
    }

    async lockScreen() {
        if (!this.isLockable || !this.checkVisibility()) {
            return;
        }

        try {
            const sentinel = await navigator.wakeLock.request('screen');
            this.sentinel = sentinel;
            this.isLocked = true;

            sentinel.addEventListener('release', () => {
                this.isLocked = false;
                this.sentinel = undefined;
                xf.dispatch('lock:release');
            });
        } catch {
            this.isLocked = false;
        }
    }
}

const lock = new ScreenWakeLock();

export { lock, ScreenWakeLock };
