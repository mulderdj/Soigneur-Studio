//
// Bottom bar: clock / workout name, ride controls and page tabs.
//
// data-mode="riding" while a ride is started or paused. On a phone the bar
// then shows only the ride controls, and the page tabs sit behind the menu
// button (data-menu-open) so they can't be tapped by accident mid-ride.
//

import { xf } from '../functions.js';

function barMode(watchStatus) {
    return (watchStatus === 'started' || watchStatus === 'paused') ? 'riding' : 'idle';
}

class AppBar extends HTMLElement {
    connectedCallback() {
        this.abort = new AbortController();
        const signal = {signal: this.abort.signal};
        this.dataset.mode = 'idle';
        this.$menu = this.querySelector('.app-bar__menu');

        xf.sub('db:watchStatus', status => {
            this.dataset.mode = barMode(status);
            if(this.dataset.mode === 'idle') this.closeMenu();
        }, signal);

        this.$menu?.addEventListener('click', () => this.toggleMenu(), signal);
        // picking a page closes the menu
        this.querySelector('.app-bar__tabs')?.addEventListener('click', () => this.closeMenu(), signal);
    }

    disconnectedCallback() {
        this.abort?.abort();
    }

    toggleMenu() {
        const open = !this.hasAttribute('data-menu-open');
        this.toggleAttribute('data-menu-open', open);
        this.$menu?.setAttribute('aria-expanded', String(open));
    }

    closeMenu() {
        this.removeAttribute('data-menu-open');
        this.$menu?.setAttribute('aria-expanded', 'false');
    }
}

customElements.define('app-bar', AppBar);

export { barMode };
