//
// Dots under the stats panels on a phone, where the panels sit side by side
// in a row you swipe through one at a time.
//
//   <panel-pager for="dash-stats"></panel-pager>
//
// One dot per .panel in the target; tapping a dot scrolls to that panel.
// Hidden by CSS on wider screens.
//

function activeIndex(scrollLeft, pageWidth, count) {
    if(!(pageWidth > 0) || count <= 0) return 0;
    const i = Math.round(scrollLeft / pageWidth);
    return Math.min(count - 1, Math.max(0, i));
}

class PanelPager extends HTMLElement {
    connectedCallback() {
        this.$target = document.getElementById(this.getAttribute('for'));
        if(!this.$target) return;
        this.abort = new AbortController();
        const signal = {signal: this.abort.signal};
        this.setAttribute('role', 'tablist');
        this.setAttribute('aria-label', 'Statistics panels');

        this.build();
        this.$target.addEventListener('scroll', () => {
            if(this.frame) return;
            this.frame = requestAnimationFrame(() => { this.frame = null; this.update(); });
        }, {passive: true, ...signal});
        this.addEventListener('click', e => {
            const dot = e.target.closest('[data-index]');
            if(!dot) return;
            const panel = this.panels()[Number(dot.dataset.index)];
            panel?.scrollIntoView({behavior: 'smooth', block: 'nearest', inline: 'start'});
        }, signal);
        // panels render after connect; rebuild once they exist
        this.observer = new MutationObserver(() => this.build());
        this.observer.observe(this.$target, {childList: true});
    }

    disconnectedCallback() {
        this.abort?.abort();
        this.observer?.disconnect();
        if(this.frame) cancelAnimationFrame(this.frame);
    }

    panels() {
        return [...this.$target.querySelectorAll(':scope > .panel')];
    }

    build() {
        const panels = this.panels();
        if(panels.length === this.childElementCount) return this.update();
        this.innerHTML = panels.map((p, i) => {
            const title = p.querySelector('.panel__title')?.firstChild?.textContent?.trim() || `Panel ${i + 1}`;
            return `<button type="button" class="pager__dot" role="tab" data-index="${i}" aria-label="${title}"></button>`;
        }).join('');
        this.update();
    }

    update() {
        const i = activeIndex(this.$target.scrollLeft, this.$target.clientWidth, this.childElementCount);
        [...this.children].forEach((dot, k) => dot.setAttribute('aria-selected', String(k === i)));
    }
}

customElements.define('panel-pager', PanelPager);

export { activeIndex };
