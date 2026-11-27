// @ts-check
//
// Edit layout: move, size and remove the tiles of one list (a Ride screen,
// the Training cards). The page renders the list as [data-tile] children of
// a container; the editor adds a bar to each (handle, size, remove), and
// reports every change as a new list through onChange — the page saves it
// and renders again, then calls refresh().
//
//   const editor = new LayoutEditor(container, {
//       list: () => [{id, size}], sizesOf: id => [...], nameOf: id => 'Power',
//       onChange: list => …, announce: text => …,           // announce optional
//       onDragEdge: (side, id) => …,                          // optional (Ride screens)
//   });
//   editor.start(); … editor.stop();
//
// Moving: drag the handle (a mouse at once; a finger after holding it
// 300 ms, so a quick swipe still scrolls), or focus the handle and use the
// arrow keys. Enter cycles the size, Delete removes.
//

import { esc } from './training/format.js';

const HOLD_MS = 300;
const SLOP = 8;          // px a finger may wander before the hold counts as a scroll
const EDGE = 24;         // px from the container's side that counts as its edge

const SIZE_LABEL = {small: 'Small', wide: 'Wide', large: 'Large', narrow: 'Narrow', full: 'Full'};

function editList(list, op, sizesOf) {
    const out = list.map(t => ({...t}));
    if(op.move) {
        const [from, to] = op.move;
        if(from < 0 || from >= out.length) return out;
        const [item] = out.splice(from, 1);
        out.splice(Math.max(0, Math.min(to, out.length)), 0, item);
    } else if(op.size != null) {
        const t = out[op.size];
        const sizes = t ? sizesOf(t.id) ?? [] : [];
        if(sizes.length) t.size = sizes[(sizes.indexOf(t.size) + 1) % sizes.length];
    } else if(op.hide != null) {
        out.splice(op.hide, 1);
    } else if(op.add) {
        if(!out.some(t => t.id === op.add.id)) out.push({...op.add});
    }
    return out;
}

function editLocked(state = {}) {
    return state.watchStatus === 'started' || state.watchStatus === 'paused' || state.workoutStatus === 'started';
}

class LayoutEditor {
    constructor(container, opts) {
        this.container = container;
        this.opts = opts;
        this.active = false;
        this.onClickCapture = e => {
            // taps on a tile's content don't reach it (no tile switching while editing)
            if(!e.target.closest('.le-bar') && e.target.closest('[data-tile]')) { e.stopPropagation(); e.preventDefault(); }
        };
        this.onClick = e => this.click(e);
        this.onKey = e => this.key(e);
        this.onDown = e => this.down(e);
    }

    start() {
        if(this.active) return;
        this.active = true;
        this.container.classList.add('is-editing');
        this.container.addEventListener('click', this.onClickCapture, true);
        this.container.addEventListener('click', this.onClick);
        this.container.addEventListener('keydown', this.onKey);
        this.container.addEventListener('pointerdown', this.onDown);
        this.refresh();
    }

    stop() {
        if(!this.active) return;
        this.active = false;
        this.cancelDrag();
        this.container.classList.remove('is-editing');
        this.container.removeEventListener('click', this.onClickCapture, true);
        this.container.removeEventListener('click', this.onClick);
        this.container.removeEventListener('keydown', this.onKey);
        this.container.removeEventListener('pointerdown', this.onDown);
        this.container.querySelectorAll('.le-bar').forEach(b => b.remove());
    }

    name(id) { return this.opts.nameOf?.(id) ?? id; }

    // (re)adds the bar to every tile; call after the page renders again
    refresh() {
        if(!this.active) return;
        for(const el of this.tiles()) {
            el.querySelector(':scope > .le-bar')?.remove();
            const id = el.dataset.tile, size = el.dataset.size, name = esc(this.name(id));
            const sizes = this.opts.sizesOf(id) ?? [];
            el.insertAdjacentHTML('beforeend', `
                <div class="le-bar">
                    <button type="button" class="le-btn le-handle" data-le-handle aria-label="Move ${name}" title="Drag, or use the arrow keys">
                        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 5h2v2H9zm4 0h2v2h-2zM9 11h2v2H9zm4 0h2v2h-2zm-4 6h2v2H9zm4 0h2v2h-2z"/></svg>
                    </button>
                    <span class="le-name">${name}</span>
                    <button type="button" class="le-btn le-hide" data-le-hide aria-label="Remove ${name}">
                        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6.4 5 5 6.4 10.6 12 5 17.6 6.4 19l5.6-5.6 5.6 5.6 1.4-1.4-5.6-5.6L19 6.4 17.6 5 12 10.6z"/></svg>
                    </button>
                    ${sizes.length > 1 ? `<button type="button" class="le-btn le-size" data-le-size aria-label="Size of ${name}: ${esc(size)}">${esc(SIZE_LABEL[size] ?? size)}</button>` : ''}
                </div>`);
        }
        if(this.focusId) {
            this.tiles().find(el => el.dataset.tile === this.focusId)?.querySelector('[data-le-handle]')?.focus();
            this.focusId = null;
        }
    }

    tiles() { return [...this.container.querySelectorAll(':scope > [data-tile]')]; }

    indexOf(el) {
        const id = el?.closest('[data-tile]')?.dataset.tile;
        return this.opts.list().findIndex(t => t.id === id);
    }

    apply(op, said) {
        const next = editList(this.opts.list(), op, this.opts.sizesOf);
        this.opts.onChange(next);
        if(said) this.opts.announce?.(said(next));
    }

    click(e) {
        const i = this.indexOf(e.target);
        if(i < 0) return;
        const id = this.opts.list()[i].id;
        if(e.target.closest('[data-le-size]')) {
            this.focusId = null;
            this.apply({size: i}, next => `${this.name(id)}: ${SIZE_LABEL[next[i].size] ?? next[i].size}`);
        } else if(e.target.closest('[data-le-hide]')) {
            this.apply({hide: i}, () => `${this.name(id)} removed`);
        }
    }

    key(e) {
        if(!e.target.closest('[data-le-handle]')) return;
        const i = this.indexOf(e.target);
        if(i < 0) return;
        const id = this.opts.list()[i].id;
        const len = this.opts.list().length;
        let op = null, said = null;
        if(e.key === 'ArrowUp' || e.key === 'ArrowLeft') {
            if(i > 0) op = {move: [i, i - 1]}, said = () => `${this.name(id)} moved to place ${i}`;
        } else if(e.key === 'ArrowDown' || e.key === 'ArrowRight') {
            if(i < len - 1) op = {move: [i, i + 1]}, said = () => `${this.name(id)} moved to place ${i + 2}`;
        } else if(e.key === 'Enter' || e.key === ' ') {
            op = {size: i}; said = next => `${this.name(id)}: ${SIZE_LABEL[next[i].size] ?? next[i].size}`;
        } else if(e.key === 'Delete' || e.key === 'Backspace') {
            op = {hide: i}; said = () => `${this.name(id)} removed`;
        } else return;
        e.preventDefault();
        if(!op) return;
        if(!op.hide) this.focusId = id;
        this.apply(op, said);
    }

    // --- dragging ---

    down(e) {
        const handle = e.target.closest('[data-le-handle]');
        if(!handle || (e.button ?? 0) !== 0) return;
        const from = this.indexOf(handle);
        if(from < 0) return;
        const touch = e.pointerType === 'touch' || e.pointerType === 'pen';
        this.drag = {id: this.opts.list()[from].id, from, to: from, x0: e.clientX, y0: e.clientY, live: !touch, moved: false};
        if(touch) this.drag.timer = setTimeout(() => { if(this.drag) this.drag.live = true; this.mark(); }, HOLD_MS);
        else e.preventDefault();
        this.onMove = ev => this.move(ev);
        this.onUp = ev => this.up(ev);
        this.onCancel = () => this.cancelDrag();
        document.addEventListener('pointermove', this.onMove);
        document.addEventListener('pointerup', this.onUp);
        document.addEventListener('pointercancel', this.onCancel);
        handle.setPointerCapture?.(e.pointerId);
    }

    move(e) {
        const d = this.drag;
        if(!d) return;
        const dist = Math.hypot(e.clientX - d.x0, e.clientY - d.y0);
        if(!d.live) {
            if(dist > SLOP) this.cancelDrag();       // a swipe, not a hold: let the page scroll
            return;
        }
        if(dist > 4) d.moved = true;
        e.preventDefault?.();
        d.to = this.slotAt(e.clientX, e.clientY);
        d.edge = this.edgeAt(e.clientX);
        this.mark();
    }

    up(e) {
        const d = this.drag;
        if(!d) return;
        const {id, from, live, moved, edge} = d;
        const to = live && moved ? this.slotAt(e.clientX, e.clientY) : from;
        this.cancelDrag();
        if(!live || !moved) return;
        if(edge && this.opts.onDragEdge) { this.opts.onDragEdge(edge, id); return; }
        if(to === from) return;
        this.apply({move: [from, to]}, () => `${this.name(id)} moved to place ${to + 1}`);
    }

    cancelDrag() {
        if(!this.drag) return;
        clearTimeout(this.drag.timer);
        this.drag = null;
        document.removeEventListener('pointermove', this.onMove);
        document.removeEventListener('pointerup', this.onUp);
        document.removeEventListener('pointercancel', this.onCancel);
        this.mark();
    }

    // the drop place: the tile under the pointer, else the nearest one
    slotAt(x, y) {
        const tiles = this.tiles();
        let best = this.drag?.from ?? 0, bestDist = Infinity;
        tiles.forEach((el, i) => {
            const r = el.getBoundingClientRect();
            const inside = x >= r.left && x <= r.right && y >= r.top && y <= r.bottom;
            const dist = inside ? -1 : Math.hypot(x - (r.left + r.right) / 2, y - (r.top + r.bottom) / 2);
            if(dist < bestDist) { bestDist = dist; best = i; }
        });
        return best;
    }

    edgeAt(x) {
        if(!this.opts.onDragEdge) return null;
        const r = this.container.getBoundingClientRect();
        if(!(r.width > 0)) return null;
        if(x <= r.left + EDGE) return 'left';
        if(x >= r.right - EDGE) return 'right';
        return null;
    }

    mark() {
        const d = this.drag;
        this.tiles().forEach((el, i) => {
            el.classList.toggle('le-dragging', !!d?.live && i === d.from);
            el.classList.toggle('le-drop', !!d?.live && d.moved && !d.edge && i === d.to && i !== d.from);
        });
        this.container.dataset.leEdge = d?.live && d.edge ? d.edge : '';
    }
}

export { editList, editLocked, LayoutEditor };
