//
// <ride-screens>: the Ride page's tiles, on the rider's screens.
//
// The tiles themselves are in the page (index.html, `.ride__pool`) with their
// live values; this element builds the screens from the rider's layout
// (src/layout/) and moves those elements into the slots of the screen in
// view. A tile on several screens is live where it is visible; elsewhere its
// slot shows a placeholder with the tile's name.
//
// Edit layout (the header's layout button; not while riding): move, size,
// remove and add tiles of the screen in view, Reset, Cancel, Done.
//

import { xf } from '../functions.js';
import { layouts } from '../layout/store.js';
import { RIDE_TILES, RIDE_BY_ID, defaultLayouts, screenClass, columnsFor, spanFor } from '../layout/tiles.js';
import { currentLayout } from './layout.js';
import { LayoutEditor, editList, editLocked } from './layout-editor.js';
import { esc } from './training/format.js';

const ELEMENT_ID = {chart: 'dash-chart', workout: 'graph-workout'};
const elementId = id => ELEMENT_ID[id] ?? `data-tile--${id}`;

class RideScreens extends HTMLElement {
    connectedCallback() {
        if(this.$track) return;
        this.state = {watchStatus: 'stopped', workoutStatus: 'stopped'};
        this.screen = 0;
        this.editing = false;
        this.innerHTML = `
            <div class="rs-edit" hidden>
                <p class="rs-edit__note"><span data-k="note"></span></p>
                <div class="rs-edit__actions">
                    <button type="button" class="btn btn--secondary" data-rs="add">Add tile</button>
                    <button type="button" class="btn btn--secondary" data-rs="reset">Reset</button>
                    <button type="button" class="btn btn--secondary" data-rs="cancel">Cancel</button>
                    <button type="button" class="btn btn--primary" data-rs="done">Done</button>
                </div>
            </div>
            <div class="rs-track"></div>
            <span class="rs-live" aria-live="polite"></span>
            <dialog class="dialog rs-tray" aria-label="Add a tile">
                <h2 class="rs-tray__title">Add a tile</h2>
                <div class="rs-tray__list"></div>
                <form method="dialog"><button class="btn btn--secondary">Close</button></form>
            </dialog>`;
        this.$edit = this.querySelector('.rs-edit');
        this.$note = this.querySelector('[data-k="note"]');
        this.$track = this.querySelector('.rs-track');
        this.$live = this.querySelector('.rs-live');
        this.$tray = this.querySelector('.rs-tray');
        this.$list = this.querySelector('.rs-tray__list');
        this.$pool = document.querySelector('.ride__pool');
        this.$button = document.querySelector('[data-ride-layout]');

        this.abort = new AbortController();
        const signal = {signal: this.abort.signal};
        this.$edit.addEventListener('click', e => this.onEditClick(e), signal);
        this.$list.addEventListener('click', e => this.onTrayClick(e), signal);
        this.$button?.addEventListener('click', () => this.editing ? this.done() : this.begin(), signal);
        xf.sub('db:watchStatus', s => this.onState({watchStatus: s}), signal);
        xf.sub('db:workoutStatus', s => this.onState({workoutStatus: s}), signal);
        xf.sub('layouts:changed', () => { if(!this.editing) this.render(); }, signal);
        window.addEventListener('resize', () => this.onResize(), signal);

        this.layoutName = currentLayout();
        this.render();
        this.updateButton();
    }

    disconnectedCallback() {
        this.abort?.abort();
    }

    // --- the layout in use ---

    get cls() { return screenClass(this.layoutName); }

    layout() { return this.editing ? this.draft : layouts.get(); }

    screens() { return this.layout().ride[this.cls].screens; }

    live(id) { return document.getElementById(elementId(id)); }

    // --- building ---

    render() {
        const screens = this.screens();
        this.screen = Math.max(0, Math.min(this.screen, screens.length - 1));
        // every live tile back to the pool before the slots are rebuilt
        for(const t of RIDE_TILES) {
            const el = this.live(t.id);
            if(el && this.$pool && el.parentElement !== this.$pool) this.$pool.append(el);
        }
        this.$track.style.setProperty('--cols', this.columns());
        this.$track.innerHTML = screens.map((s, i) => `
            <section class="rs-screen" data-screen="${i}" aria-label="${esc(s.name)}" ${i === this.screen ? '' : 'aria-hidden="true"'}></section>`).join('');
        screens.forEach((s, i) => this.renderScreen(i));
        this.place();
    }

    renderScreen(i) {
        const $screen = this.$track.querySelector(`[data-screen="${i}"]`);
        const s = this.screens()[i];
        if(!$screen || !s) return;
        for(const el of $screen.querySelectorAll('.rs-slot > :not(.rs-placeholder)')) this.$pool?.append(el);
        const cols = this.columns();
        $screen.innerHTML = s.tiles.length ? s.tiles.map(t => `
            <div class="rs-slot" data-tile="${t.id}" data-size="${t.size}" style="grid-column: span ${spanFor(t.size, cols)}">
                ${this.placeholder(t.id)}
            </div>`).join('') :
            `<p class="rs-empty">${this.editing ? 'Add tiles to this screen with Add tile.' : 'This screen is empty. Add tiles in Edit layout.'}</p>`;
    }

    placeholder(id) {
        const t = RIDE_BY_ID.get(id);
        return `<div class="tile rs-placeholder" aria-hidden="true"><h2 class="tile__label">${esc(t?.name ?? id)}</h2></div>`;
    }

    // the live elements into the slots: the screen in view first, then the
    // others for tiles that are on one screen only
    place() {
        const order = [this.screen, ...this.screens().map((_, i) => i).filter(i => i !== this.screen)];
        const placed = new Set();
        for(const i of order) {
            for(const slot of this.$track.querySelectorAll(`[data-screen="${i}"] .rs-slot`)) {
                const id = slot.dataset.tile;
                if(placed.has(id)) {
                    if(!slot.querySelector('.rs-placeholder')) slot.innerHTML = this.placeholder(id);
                    continue;
                }
                const el = this.live(id);
                if(!el) continue;
                placed.add(id);
                if(el.parentElement !== slot) slot.replaceChildren(el);
            }
        }
        requestAnimationFrame?.(() => this.fit());
    }

    // phone on the handlebars: as many tiles as fit; the rest is a swipe away
    fit() {
        const landscape = this.layoutName === 'phone-landscape';
        for(const $screen of this.$track.querySelectorAll('.rs-screen')) {
            const box = $screen.getBoundingClientRect();
            for(const slot of $screen.querySelectorAll('.rs-slot')) {
                const r = slot.getBoundingClientRect();
                slot.classList.toggle('is-clipped', landscape && !this.editing && box.height > 0 && r.bottom > box.bottom + 1);
            }
        }
    }

    columns() { return columnsFor(this.layoutName); }

    onResize() {
        const name = currentLayout();
        const changed = screenClass(name) !== this.cls;
        this.layoutName = name;
        if(changed) {
            if(this.editing) this.cancel();
            this.render();
            return;
        }
        const cols = this.columns();
        this.$track.style.setProperty('--cols', cols);
        for(const slot of this.$track.querySelectorAll('.rs-slot')) slot.style.gridColumn = `span ${spanFor(slot.dataset.size, cols)}`;
        this.fit();
    }

    // --- riding locks editing ---

    onState(s) {
        Object.assign(this.state, s);
        if(this.editing && editLocked(this.state)) this.cancel();
        this.updateButton();
    }

    updateButton() {
        if(!this.$button) return;
        const locked = editLocked(this.state);
        this.$button.disabled = locked;
        this.$button.title = locked ? 'Stop the ride to edit the layout' : this.editing ? 'Done' : 'Edit layout';
        this.$button.setAttribute('aria-pressed', String(this.editing));
    }

    // --- edit mode ---

    begin() {
        if(this.editing || editLocked(this.state)) return;
        layouts.beginEdit();
        this.draft = layouts.get();
        this.editing = true;
        this.classList.add('is-editing');
        this.$edit.hidden = false;
        this.render();
        this.startEditor();
        this.updateButton();
    }

    startEditor() {
        this.editor?.stop();
        const $screen = this.$track.querySelector(`[data-screen="${this.screen}"]`);
        if(!$screen) return;
        this.$note.textContent = `Editing the ${this.cls} layout · ${this.screens()[this.screen]?.name ?? ''}`;
        this.editor = new LayoutEditor($screen, {
            list: () => this.screens()[this.screen].tiles,
            sizesOf: id => RIDE_BY_ID.get(id)?.sizes ?? [],
            nameOf: id => RIDE_BY_ID.get(id)?.name ?? id,
            onChange: list => this.changeTiles(list),
            announce: text => { this.$live.textContent = text; },
        });
        this.editor.start();
    }

    changeTiles(list) {
        this.draft.ride[this.cls].screens[this.screen].tiles = list;
        this.renderScreen(this.screen);
        this.place();
        this.editor?.refresh();
    }

    end() {
        this.editor?.stop();
        this.editor = null;
        this.editing = false;
        this.draft = null;
        this.classList.remove('is-editing');
        this.$edit.hidden = true;
        if(this.$tray.open) this.$tray.close();
        this.updateButton();
    }

    done() {
        if(!this.editing) return;
        const draft = this.draft;
        this.end();
        layouts.save(draft);          // re-renders through layouts:changed
        layouts.endEdit();
        this.render();
    }

    cancel() {
        if(!this.editing) return;
        this.end();
        layouts.endEdit();
        this.render();
    }

    reset() {
        if(!this.editing || !window.confirm(`Reset the ${this.cls} Ride layout to the built-in screens?`)) return;
        this.draft.ride[this.cls] = defaultLayouts().ride[this.cls];
        this.screen = 0;
        this.render();
        this.startEditor();
    }

    onEditClick(e) {
        const b = e.target.closest('[data-rs]');
        if(!b) return;
        ({add: () => this.openTray(), reset: () => this.reset(), cancel: () => this.cancel(), done: () => this.done()})[b.dataset.rs]?.();
    }

    openTray() {
        const on = new Set(this.screens()[this.screen].tiles.map(t => t.id));
        const rest = RIDE_TILES.filter(t => !on.has(t.id));
        this.$list.innerHTML = rest.length ? rest.map(t => `
            <button type="button" class="rs-tray__item" data-add="${t.id}">
                <strong>${esc(t.name)}</strong><span>${esc(t.description)}</span>
            </button>`).join('') : '<p class="card__note">Every tile is on this screen.</p>';
        this.$tray.showModal?.();
    }

    onTrayClick(e) {
        const b = e.target.closest('[data-add]');
        if(!b) return;
        const t = RIDE_BY_ID.get(b.dataset.add);
        this.changeTiles(editList(this.screens()[this.screen].tiles, {add: {id: t.id, size: t.size}}, () => []));
        this.$live.textContent = `${t.name} added`;
        if(this.$tray.open) this.$tray.close();
    }
}

customElements.define('ride-screens', RideScreens);

export { RideScreens, elementId };
