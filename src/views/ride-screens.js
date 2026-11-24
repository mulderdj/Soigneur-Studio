//
// <ride-screens>: the Ride page's tiles, on the rider's screens.
//
// The tiles themselves are in the page (index.html, `.ride__pool`) with their
// live values; this element builds the screens from the rider's layout
// (src/layout/) and moves those elements into the slots of the screen in
// view. A tile on several screens is live where it is visible; elsewhere its
// slot shows a placeholder with the tile's name.
//
// Several screens side by side: swipe, the dots under them, or ← → on a
// keyboard. The screen in view is remembered on this device. On the live
// chart a sideways finger is the chart's (its read-out); a swipe that starts
// at the screen's edge still switches.
//
// Edit layout (the header's layout button; not while riding): move, size,
// remove and add tiles of the screen in view (dropping a tile on the screen's
// edge moves it to the next screen); add, rename, remove and reorder
// screens (Shift + ←/→ on a dot); Reset, Cancel, Done.
//

import { xf } from '../functions.js';
import { layouts } from '../layout/store.js';
import { riders } from '../riders.js';
import { RIDE_TILES, RIDE_BY_ID, MAX_SCREENS, defaultLayouts, screenClass, columnsFor, spanFor } from '../layout/tiles.js';
import { currentLayout } from './layout.js';
import { LayoutEditor, editList, editLocked } from './layout-editor.js';
import { esc } from './training/format.js';

const ELEMENT_ID = {chart: 'dash-chart', workout: 'graph-workout'};
const elementId = id => ELEMENT_ID[id] ?? `data-tile--${id}`;
const EDGE = 24;          // px from the screen's side where a swipe on the chart still switches screens
const SWIPE = 40;         // px a finger must travel for that swipe

const typing = el => !!el?.closest?.('input, textarea, select, [contenteditable=""], [contenteditable="true"]');


class RideScreens extends HTMLElement {
    connectedCallback() {
        if(this.$track) { this.resizeObserver?.observe(this.$track); return; }
        this.state = {watchStatus: 'stopped', workoutStatus: 'stopped'};
        this.screen = 0;
        this.editing = false;
        this.innerHTML = `
            <div class="rs-edit" hidden>
                <p class="rs-edit__note"><span data-k="note"></span></p>
                <div class="rs-edit__actions">
                    <label class="rs-edit__name">Screen
                        <input type="text" class="input" maxlength="24" data-rs="name" autocomplete="off">
                    </label>
                    <button type="button" class="btn btn--secondary" data-rs="add-screen">Add screen</button>
                    <button type="button" class="btn btn--secondary" data-rs="remove-screen">Remove screen</button>
                </div>
                <div class="rs-edit__actions">
                    <button type="button" class="btn btn--secondary" data-rs="add">Add tile</button>
                    <button type="button" class="btn btn--secondary" data-rs="reset">Reset</button>
                    <button type="button" class="btn btn--secondary" data-rs="cancel">Cancel</button>
                    <button type="button" class="btn btn--primary" data-rs="done">Done</button>
                </div>
            </div>
            <div class="rs-track"></div>
            <div class="rs-dots" role="tablist" aria-label="Screens"></div>
            <span class="rs-live" aria-live="polite"></span>
            <dialog class="dialog rs-tray" aria-label="Add a tile">
                <h2 class="rs-tray__title">Add a tile</h2>
                <div class="rs-tray__list"></div>
                <form method="dialog"><button class="btn btn--secondary">Close</button></form>
            </dialog>`;
        this.$edit = this.querySelector('.rs-edit');
        this.$note = this.querySelector('[data-k="note"]');
        this.$track = this.querySelector('.rs-track');
        this.$dots = this.querySelector('.rs-dots');
        this.$name = this.querySelector('[data-rs="name"]');
        this.$live = this.querySelector('.rs-live');
        this.$tray = this.querySelector('.rs-tray');
        this.$list = this.querySelector('.rs-tray__list');
        this.$pool = document.querySelector('.ride__pool');
        this.$button = document.querySelector('[data-ride-layout]');

        this.abort = new AbortController();
        const signal = {signal: this.abort.signal};
        this.$edit.addEventListener('click', e => this.onEditClick(e), signal);
        this.$list.addEventListener('click', e => this.onTrayClick(e), signal);
        this.$name.addEventListener('input', () => this.rename(this.$name.value), signal);
        this.$dots.addEventListener('click', e => {
            const d = e.target.closest('[data-dot]');
            if(this.dotDragged) { this.dotDragged = false; return; }      // the click that ends a dot drag
            if(d) this.show(Number(d.dataset.dot));
        }, signal);
        this.$dots.addEventListener('pointerdown', e => this.onDotDown(e), signal);
        this.$dots.addEventListener('keydown', e => this.onDotKey(e), signal);
        this.$track.addEventListener('scroll', () => this.onScroll(), {passive: true, ...signal});
        this.$track.addEventListener('scrollend', () => this.scrolled(), signal);
        this.$track.addEventListener('pointerdown', e => this.onEdgeDown(e), signal);
        this.$track.addEventListener('pointerup', e => this.onEdgeUp(e), signal);
        window.addEventListener('keydown', e => this.onKey(e), signal);
        this.$button?.addEventListener('click', () => this.editing ? this.done() : this.begin(), signal);
        xf.sub('db:watchStatus', s => this.onState({watchStatus: s}), signal);
        xf.sub('db:workoutStatus', s => this.onState({workoutStatus: s}), signal);
        xf.sub('layouts:changed', () => { if(!this.editing) this.render(); }, signal);
        window.addEventListener('resize', () => this.onResize(), signal);
        // the dots sit in their strip under the page header ([data-rs-dots-slot]) when there is one
        this.placeDots();
        // the screens area changes size without a window resize too (the
        // header hides while riding on the handlebars): fit again
        this.resizeObserver = typeof ResizeObserver === 'function' ? new ResizeObserver(() => this.fit()) : null;
        this.resizeObserver?.observe(this.$track);

        this.layoutName = currentLayout();
        this.screen = this.restore();
        this.render();
        this.updateButton();
    }

    placeDots() {
        const slot = document.querySelector('[data-rs-dots-slot]');
        if(slot) { if(this.$dots.parentNode !== slot) slot.append(this.$dots); }
        else if(this.$dots.parentNode !== this) this.$track.after(this.$dots);
    }
    disconnectedCallback() {
        if(this.editing) { this.end(); layouts.endEdit(); }
        this.abort?.abort();
        this.resizeObserver?.disconnect();
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
        this.renderDots();
        this.place();
        this.scrollTo(false);
    }

    renderDots() {
        const screens = this.screens();
        this.$dots.hidden = screens.length < 2 && !this.editing;
        this.$dots.innerHTML = screens.map((s, i) => `
            <button type="button" class="rs-dot" role="tab" data-dot="${i}" aria-label="${esc(s.name)}"
                    aria-current="${i === this.screen}" aria-selected="${i === this.screen}"><span></span></button>`).join('');
    }

    // --- switching screens ---

    key() { return riders.key(`ride:screen:${this.cls}`); }

    restore() {
        try { return Math.max(0, Number(localStorage.getItem(this.key())) || 0); } catch(e) { return 0; }
    }

    show(i, {scroll = true} = {}) {
        const n = this.screens().length;
        i = Math.max(0, Math.min(i, n - 1));
        const changed = i !== this.screen;
        this.screen = i;
        try { localStorage.setItem(this.key(), String(i)); } catch(e) {}
        this.$track.querySelectorAll('.rs-screen').forEach(($s, k) => {
            if(k === i) $s.removeAttribute('aria-hidden'); else $s.setAttribute('aria-hidden', 'true');
        });
        this.$dots.querySelectorAll('[data-dot]').forEach((d, k) => {
            d.setAttribute('aria-current', String(k === i));
            d.setAttribute('aria-selected', String(k === i));
        });
        this.place();
        if(scroll) this.scrollTo(true);
        if(this.editing) { this.startEditor(); this.updateEditControls(); }
        if(changed) xf.dispatch('ride:screen', i);
    }

    scrollTo(smooth) {
        const w = this.$track.clientWidth;
        if(!(w > 0)) return;
        this.scrolling = true;
        this.$track.scrollTo?.({left: this.screen * w, behavior: smooth ? 'smooth' : 'instant'});
        clearTimeout(this.scrollTimer);
        // when the scroll is over ('scrollend', or this timer where there is
        // none): the screen the track really stopped at, in case the rider
        // swiped on meanwhile
        this.scrollTimer = setTimeout(() => this.scrolled(), smooth ? 700 : 50);
    }

    scrolled() {
        clearTimeout(this.scrollTimer);
        this.scrolling = false;
        const w = this.$track.clientWidth;
        if(!(w > 0)) return;
        const i = Math.round(this.$track.scrollLeft / w);
        if(i !== this.screen) this.show(i, {scroll: false});
    }

    // a swipe ends: the screen that snapped into view
    onScroll() {
        if(this.scrolling) return;
        clearTimeout(this.settle);
        this.settle = setTimeout(() => this.scrolled(), 120);
    }

    onKey(e) {
        if(e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
        if(e.defaultPrevented || e.altKey || e.ctrlKey || e.metaKey || typing(e.target)) return;
        // keys on a tile handle or a screen dot are theirs (the dot may be gone by now)
        if(e.composedPath?.().includes(this.$dots) || e.target?.closest?.('[data-le-handle], dialog')) return;
        const page = this.closest('.page');
        if(page && !page.classList.contains('active')) return;
        this.show(this.screen + (e.key === 'ArrowRight' ? 1 : -1));
    }

    // the live chart keeps sideways fingers (touch-action: pan-y); from the
    // screen's edge a swipe still switches
    onEdgeDown(e) {
        this.edge = null;
        if(e.pointerType !== 'touch' || !e.target.closest('.rs-slot[data-tile="chart"]')) return;
        const r = this.$track.getBoundingClientRect();
        if(e.clientX <= r.left + EDGE || e.clientX >= r.right - EDGE) this.edge = {x: e.clientX};
    }

    onEdgeUp(e) {
        if(!this.edge) return;
        const dx = e.clientX - this.edge.x;
        this.edge = null;
        if(Math.abs(dx) >= SWIPE) this.show(this.screen + (dx > 0 ? -1 : 1));
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
        const chart = $screen.querySelector('.rs-slot[data-tile="chart"]');
        if(chart) chart.style.touchAction = 'pan-y';
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
            onDragEdge: (side, id) => this.moveToNeighbour(side, id),
            announce: text => { this.$live.textContent = text; },
        });
        this.editor.start();
        this.updateEditControls();
    }

    updateEditControls() {
        const screens = this.screens();
        this.querySelector('[data-rs="add-screen"]').disabled = screens.length >= MAX_SCREENS;
        this.querySelector('[data-rs="remove-screen"]').disabled = screens.length <= 1;
        if(document.activeElement !== this.$name) this.$name.value = screens[this.screen]?.name ?? '';
        this.$note.textContent = `Editing the ${this.cls} layout`;
    }

    addScreen() {
        const screens = this.screens();
        if(screens.length >= MAX_SCREENS) return;
        screens.push({id: `screen-${Date.now().toString(36)}-${screens.length + 1}`, name: `Screen ${screens.length + 1}`, tiles: []});
        this.render();
        this.show(screens.length - 1);
        this.say(`Screen ${screens.length} added`);
    }

    removeScreen() {
        const screens = this.screens();
        const s = screens[this.screen];
        if(screens.length <= 1 || !s) return;
        if(s.tiles.length && !window.confirm(`Remove the screen "${s.name}" and its tiles?`)) return;
        screens.splice(this.screen, 1);
        this.screen = Math.min(this.screen, screens.length - 1);
        this.render();
        this.show(this.screen);
        this.say(`${s.name} removed`);
    }

    rename(name) {
        const s = this.screens()[this.screen];
        if(!s) return;
        s.name = name.slice(0, 24);
        const dot = this.$dots.querySelector(`[data-dot="${this.screen}"]`);
        if(dot) dot.setAttribute('aria-label', s.name.trim() || `Screen ${this.screen + 1}`);
        this.$track.querySelector(`[data-screen="${this.screen}"]`)?.setAttribute('aria-label', s.name);
    }

    moveScreen(from, to) {
        const screens = this.screens();
        if(to < 0 || to >= screens.length || from === to) return;
        const [s] = screens.splice(from, 1);
        screens.splice(to, 0, s);
        this.screen = to;
        this.render();
        this.show(to);
        this.$dots.querySelector(`[data-dot="${to}"]`)?.focus();
        this.say(`${s.name} moved to place ${to + 1}`);
    }

    // on a dot: ← → switch screens (focus follows); in Edit layout Shift + ← →
    // moves the screen
    onDotKey(e) {
        const d = e.target.closest('[data-dot]');
        if(!d || (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight')) return;
        e.preventDefault();
        const i = Number(d.dataset.dot), step = e.key === 'ArrowRight' ? 1 : -1;
        if(this.editing && e.shiftKey) { this.moveScreen(i, i + step); return; }
        this.show(i + step);
        this.$dots.querySelector(`[data-dot="${this.screen}"]`)?.focus();
    }

    // edit mode: drag a dot onto another to move that screen there
    onDotDown(e) {
        const d = e.target.closest('[data-dot]');
        if(!d || !this.editing || (e.button ?? 0) !== 0) return;
        const drag = {from: Number(d.dataset.dot), x0: e.clientX, moved: false};
        const move = ev => { if(Math.abs(ev.clientX - drag.x0) > 6) drag.moved = true; };
        const up = ev => {
            document.removeEventListener('pointermove', move);
            document.removeEventListener('pointerup', up);
            if(!drag.moved) return;
            const dots = [...this.$dots.querySelectorAll('[data-dot]')];
            let to = drag.from, best = Infinity;
            dots.forEach((dot, i) => {
                const r = dot.getBoundingClientRect();
                const dist = Math.abs(ev.clientX - (r.left + r.right) / 2);
                if(dist < best) { best = dist; to = i; }
            });
            this.dotDragged = true;
            setTimeout(() => { this.dotDragged = false; }, 0);
            this.moveScreen(drag.from, to);
        };
        document.addEventListener('pointermove', move);
        document.addEventListener('pointerup', up);
    }

    // a tile dropped on the screen's edge: onto the screen next to it
    moveToNeighbour(side, id) {
        const screens = this.screens();
        const j = this.screen + (side === 'right' ? 1 : -1);
        if(!this.editing || j < 0 || j >= screens.length) return;
        const here = screens[this.screen].tiles;
        const k = here.findIndex(t => t.id === id);
        if(k < 0) return;
        const [tile] = here.splice(k, 1);
        if(!screens[j].tiles.some(t => t.id === id)) screens[j].tiles.push(tile);
        this.render();
        this.show(j);
        this.say(`${RIDE_BY_ID.get(id)?.name ?? id} moved to ${screens[j].name}`);
    }

    say(text) { this.$live.textContent = text; }

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
        const mine = this.draft.ride[this.cls];
        this.end();
        layouts.saveSection('ride', this.cls, mine);   // only Ride, this screen class
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
        ({add: () => this.openTray(), reset: () => this.reset(), cancel: () => this.cancel(), done: () => this.done(),
          'add-screen': () => this.addScreen(), 'remove-screen': () => this.removeScreen()})[b.dataset.rs]?.();
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
