// @ts-check
import { xf } from '../functions.js';

class Watch extends HTMLElement {
    constructor() {
        super();
    }
    connectedCallback() {
        const self = this;
        this.abortController = new AbortController();
        this.signal = { signal: self.abortController.signal };

        this.dom = {
            start:   document.querySelector('#watch-start'),
            pause:   document.querySelector('#watch-pause'),
            back:    document.querySelector('#watch-back'),
            lap:     document.querySelector('#watch-lap'),
            stop:    /** @type {HTMLElement} */ (document.querySelector('#watch-stop')),
            save:    document.querySelector('#activity-save'),
            discard: document.querySelector('#activity-discard'),
            // workout: document.querySelector('#start-workout'),
        };

        const bind = (el, fn) => {
            if(!el) return;
            el.addEventListener('pointerup', fn, this.signal);
            el.addEventListener('keydown', e => {
                if(e.key === 'Enter' || e.key === ' ') { e.preventDefault(); fn(e); }
            }, this.signal);
        };
        bind(this.dom.start,   this.onStart.bind(this));
        bind(this.dom.pause,   this.onPause.bind(this));
        bind(this.dom.back,    this.onBack.bind(this));
        bind(this.dom.lap,     this.onLap.bind(this));
        bind(this.dom.stop,    this.onStop.bind(this));
        bind(this.dom.save,    this.onSave.bind(this));
        bind(this.dom.discard, this.onDiscard.bind(this));

        this.renderInit(this.dom);

        xf.sub(`db:watchStatus`, this.onWatchStatus.bind(this), this.signal);
        xf.sub(`db:workoutStatus`, this.onWorkoutStatus.bind(this), this.signal);
        xf.sub('activity:discarded', () => {
            if(this.dom.save instanceof HTMLElement) this.dom.save.style.display = 'none';
            if(this.dom.discard instanceof HTMLElement) this.dom.discard.style.display = 'none';
        }, this.signal);
    }
    disconnectedCallback() {
        clearTimeout(this.stopArmTimer);
        this.abortController.abort();
    }
    disarmStop() {
        clearTimeout(this.stopArmTimer);
        if(this.dom?.stop) {
            this.dom.stop.removeAttribute('data-armed');
            this.dom.stop.setAttribute('aria-label', 'End ride');
            this.dom.stop.title = 'End ride';
        }
    }
    onStart(e) {
        this.disarmStop();
        xf.dispatch('ui:watchStart');
        xf.dispatch('ui:workoutStart');
    }
    onPause(e) { xf.dispatch('ui:watchPause'); }
    onBack(e)  { xf.dispatch('ui:watchBack'); }
    onLap(e)   { xf.dispatch('ui:watchLap'); }
    onStop(e)  {
        // two-tap guard so one sweaty slip next to Resume never ends a ride
        if(this.dom?.stop && this.dom.stop.dataset.armed !== '1') {
            this.dom.stop.dataset.armed = '1';
            this.dom.stop.setAttribute('aria-label', 'Tap again to end ride');
            this.dom.stop.title = 'Tap again to end ride';
            xf.dispatch('ui:toast', {text: 'Tap Stop again to end ride', tone: 'warn', duration: 3000});
            clearTimeout(this.stopArmTimer);
            this.stopArmTimer = setTimeout(() => this.disarmStop(), 3000);
            return;
        }
        this.disarmStop();
        xf.dispatch('ui:watchStop');
    }
    onSave(e)    { xf.dispatch('ui:activity:save'); }
    onDiscard(e) { this.disarmStop(); xf.dispatch('ui:watchDiscard'); }
    onWorkoutStart(e) { xf.dispatch('ui:workoutStart'); }
    onWatchStatus(status) {
        if(status === 'started') { this.renderStarted(this.dom); }
        if(status === 'paused')  { this.renderPaused(this.dom);  }
        if(status === 'stopped') { this.renderStopped(this.dom); }
    }
    onWorkoutStatus(status) {
        if(status === 'started') { this.renderWorkoutStarted(this.dom); }
        if(status === 'done')    {  }
    }
    renderInit(dom) {
        dom.pause.style.display = 'none';
        dom.stop.style.display  = 'none';
        dom.save.style.display  = 'none';
        if(dom.discard) dom.discard.style.display = 'none';
        dom.lap.style.display   = 'none';
        dom.back.style.display  = 'none';
    };
    renderStarted(dom) {
        dom.start.style.display  = 'none';
        dom.save.style.display   = 'none';
        if(dom.discard) dom.discard.style.display = 'none';
        dom.pause.style.display  = 'inline-block';
        dom.lap.style.display    = 'inline-block';
        dom.back.style.display   = 'inline-block';
        dom.stop.style.display   = 'none';
        // dom.stop.style.display  = 'inline-block';
    };
    renderPaused(dom) {
        dom.pause.style.display    = 'none';
        // dom.back.style.display = 'none';
        dom.lap.style.display      = 'none';
        dom.start.style.display    = 'inline-block';
        dom.stop.style.display     = 'inline-block';
        if(dom.discard) dom.discard.style.display = 'inline-block';
    };
    renderStopped(dom) {
        dom.pause.style.display  = 'none';
        dom.lap.style.display    = 'none';
        dom.back.style.display   = 'none';
        dom.stop.style.display   = 'none';
        dom.save.style.display   = 'inline-block';
        if(dom.discard) dom.discard.style.display = 'inline-block';
        // dom.workout.style.display = 'inline-block';
        dom.start.style.display  = 'inline-block';
    };
    renderWorkoutStarted(dom) {
        // dom.workout.style.display = 'none';
    };
}

customElements.define('watch-control', Watch);

export { Watch };
