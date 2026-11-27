// @ts-check
import { xf } from '../functions.js';

class TabBtn extends HTMLElement {
    constructor() {
        super();
    }
    connectedCallback() {
        this.state = '';
        this.effect = this.getAttribute('effect') || '';
        this.param = this.getAttribute('param') || '';
        this.prop = this.getAttribute('prop') || false;
        this.abort?.abort();
        this.abort = new AbortController();
        const signal = {signal: this.abort.signal};

        if(!this.hasAttribute('tabindex')) this.setAttribute('tabindex', '0');
        if(!this.hasAttribute('role')) this.setAttribute('role', 'button');

        this.addEventListener('pointerup', e => this.onEffect(e), signal);
        this.addEventListener('keydown', e => {
            if(e.key === 'Enter' || e.key === ' ') { e.preventDefault(); this.onEffect(e); }
        }, signal);

        if(this.prop) {
            xf.sub(`db:${this.prop}`, state => this.onUpdate(state), signal);
        }
    }
    disconnectedCallback() {
        this.abort?.abort();
    }
    onEffect(e) {
        xf.dispatch(`ui:${this.effect}`, this.param);
    }
    onUpdate(state) {
        this.state = state;
        const active = this.state === this.param;
        this.classList.toggle('active', active);
        if(this.prop === 'page') {
            if(active) this.setAttribute('aria-current', 'page');
            else this.removeAttribute('aria-current');
        }
    }
}

class TabGroup extends HTMLElement {
    constructor() {
        super();
        this.tabClass = this.defaultTabSelector();
        this.tabAttr = this.defaultTabAttr();
        this.prop = this.getAttribute('prop') || '';
        this.tabs = this.querySelectorAll(this.tabClass);
    }
    defaultTabSelector() { return '.tab'; }
    defaultTabAttr() { return 'tab'; }
    connectedCallback() {
        this.abort?.abort();
        this.abort = new AbortController();
        xf.sub(`db:${this.prop}`, param => this.onUpdate(param), {signal: this.abort.signal});
    }
    disconnectedCallback() {
        this.abort?.abort();
    }
    onUpdate(param) {
        this.tabs.forEach(tab => {
            if(this.getId(tab) === param) {
                tab.classList.add('active');
            } else {
                tab.classList.remove('active');
            }
        });
    }
    getId(tab) {
        return tab.getAttribute(this.tabAttr);
    }
}

customElements.define('tab-btn', TabBtn);
customElements.define('tab-group', TabGroup);



class PageBtn extends TabBtn {}
class PageGroup extends TabGroup {
    defaultTabSelector() { return '.page'; }
    defaultTabAttr() { return 'page'; }
}

customElements.define('page-btn', PageBtn);
customElements.define('page-group', PageGroup);

export { TabBtn, TabGroup };
