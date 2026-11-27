//
// The Training page's cards in the rider's order and widths (src/layout/),
// and Edit layout for them: move, size (narrow / wide / full), remove, add
// back, Reset, Cancel, Done. A phone has its own layout (every card full
// width by default).
//
//   new TrainingLayout({tools, bar, grid, cards: {form: el, week: el, …}})
//
// tools: where the Edit layout button goes; bar: where the edit bar goes;
// grid: the cards' container. Cards not in the layout are kept detached.
//

import { xf } from '../../functions.js';
import { layouts } from '../../layout/store.js';
import { TRAINING_CARDS, CARD_BY_ID, GRID_COLS, MAX_ROW_SPAN, defaultLayouts, screenClass, widthFor, heightFor, sizeForWidth } from '../../layout/tiles.js';
import { currentLayout } from '../layout.js';
import { LayoutEditor, editList } from '../layout-editor.js';
import { confirmAction } from '../confirm.js';
import { esc } from './format.js';

class TrainingLayout {
    constructor({tools, bar, grid, cards}) {
        this.$grid = grid;
        this.cards = cards;
        this.editing = false;
        for(const [id, el] of Object.entries(cards)) el.dataset.tile = id;

        tools.insertAdjacentHTML('afterbegin', `<button type="button" class="btn btn--secondary" data-tl-edit>Edit layout</button>`);
        this.$button = tools.querySelector('[data-tl-edit]');
        bar.innerHTML = `
            <div class="tl-edit" hidden>
                <p class="tl-edit__note"></p>
                <div class="tl-edit__actions">
                    <button type="button" class="btn btn--secondary" data-tl="add">Add card</button>
                    <button type="button" class="btn btn--secondary" data-tl="reset">Reset</button>
                    <button type="button" class="btn btn--secondary" data-tl="cancel">Cancel</button>
                    <button type="button" class="btn btn--primary" data-tl="done">Done</button>
                </div>
                <span class="tl-live" aria-live="polite"></span>
            </div>
            <dialog class="dialog tl-tray" aria-label="Add a card">
                <h2 class="tl-tray__title">Add a card</h2>
                <div class="tl-tray__list"></div>
                <form method="dialog"><button class="btn btn--secondary">Close</button></form>
            </dialog>`;
        this.$bar = bar.querySelector('.tl-edit');
        this.$note = bar.querySelector('.tl-edit__note');
        this.$live = bar.querySelector('.tl-live');
        this.$tray = bar.querySelector('.tl-tray');
        this.$list = bar.querySelector('.tl-tray__list');

        this.$button.addEventListener('click', () => this.editing ? this.done() : this.begin());
        this.$bar.addEventListener('click', e => {
            const b = e.target.closest('[data-tl]');
            if(b) ({add: () => this.openTray(), reset: () => this.reset(), cancel: () => this.cancel(), done: () => this.done()})[b.dataset.tl]?.();
        });
        this.$list.addEventListener('click', e => {
            const b = e.target.closest('[data-tl-add]');
            if(b) this.add(b.dataset.tlAdd);
        });
        xf.sub('layouts:changed', () => { if(!this.editing) this.apply(); });
        window.addEventListener('resize', () => {
            const cls = screenClass(currentLayout());
            if(cls === this.cls) return;
            if(this.editing) this.cancel();
            this.apply();
        });
        this.apply();
    }

    layout() { return this.editing ? this.draft : layouts.get(); }

    all() { return this.layout().training[this.cls].cards; }

    visible() {
        return this.all().filter(c => !c.hidden).map(c => {
            const out = {id: c.id, size: c.size};
            if(c.w != null) out.w = c.w;
            if(c.h != null) out.h = c.h;
            return out;
        });
    }

    apply() {
        const layoutName = currentLayout();
        this.cls = screenClass(layoutName);
        const seen = new Set();
        for(const c of this.all()) {
            const el = this.cards[c.id];
            if(!el) continue;
            seen.add(c.id);
            if(c.hidden) { el.remove(); continue; }
            const w = widthFor(c, layoutName, 'training');
            const h = heightFor(c, 'training');
            el.dataset.size = c.w != null ? sizeForWidth(w, 'training') : c.size;
            el.dataset.w = String(w);
            el.dataset.h = String(h);
            el.style.gridColumn = `span ${w}`;
            el.style.gridRow = h > 1 ? `span ${h}` : '';
            el.style.setProperty('--row-span', String(h));
            this.$grid.append(el);          // in order
        }
        for(const [id, el] of Object.entries(this.cards)) if(!seen.has(id)) el.remove();
        this.placeholders();
    }

    // a card that hides itself (Health without data) shows while editing
    placeholders() {
        for(const el of Object.values(this.cards)) {
            if(this.editing && el.hidden && el.isConnected) el.dataset.lePlaceholder = 'true';
            else delete el.dataset.lePlaceholder;
        }
    }

    // the edited visible list back into the full list: hidden cards after it
    setVisible(list) {
        const on = new Set(list.map(c => c.id));
        const hidden = this.all().filter(c => !on.has(c.id)).map(c => ({...c, hidden: true}));
        this.draft.training[this.cls].cards = [...list.map(c => ({...c, hidden: false})), ...hidden];
        this.apply();
        this.editor?.refresh();
    }

    begin() {
        if(this.editing) return;
        layouts.beginEdit();
        this.draft = layouts.get();
        this.editing = true;
        this.$bar.hidden = false;
        this.$note.textContent = `Editing the ${this.cls} layout`;
        this.$button.setAttribute('aria-pressed', 'true');
        this.apply();
        this.editor = new LayoutEditor(this.$grid, {
            list: () => this.visible(),
            sizesOf: id => CARD_BY_ID.get(id)?.sizes ?? [],
            nameOf: id => CARD_BY_ID.get(id)?.name ?? id,
            grid: {
                maxW: GRID_COLS,
                maxH: MAX_ROW_SPAN,
                widthOf: c => widthFor(c, currentLayout(), 'training'),
                heightOf: c => heightFor(c, 'training'),
            },
            onChange: list => this.setVisible(list),
            announce: text => { this.$live.textContent = text; },
        });
        this.editor.start();
        this.placeholders();
    }

    end() {
        this.editor?.stop();
        this.editor = null;
        this.editing = false;
        this.draft = null;
        this.$bar.hidden = true;
        this.$button.setAttribute('aria-pressed', 'false');
        if(this.$tray.open) this.$tray.close();
    }

    done() {
        if(!this.editing) return;
        const mine = this.draft.training[this.cls];
        this.end();
        layouts.saveSection('training', this.cls, mine);   // only Training, this screen class
        layouts.endEdit();
        this.apply();
    }

    cancel() {
        if(!this.editing) return;
        this.end();
        layouts.endEdit();
        this.apply();
    }

    async reset() {
        if(!this.editing) return;
        const ok = await confirmAction({
            title: 'Reset Training layout?',
            message: `Reset the ${this.cls} Training layout to the defaults?`,
            confirmLabel: 'Reset',
            danger: true,
        });
        if(!ok || !this.editing) return;
        this.draft.training[this.cls] = defaultLayouts().training[this.cls];
        this.apply();
        this.editor?.refresh();
        this.placeholders();
    }

    openTray() {
        const hidden = this.all().filter(c => c.hidden);
        this.$list.innerHTML = hidden.length ? hidden.map(c => `
            <button type="button" class="rs-tray__item" data-tl-add="${c.id}"><strong>${esc(CARD_BY_ID.get(c.id)?.name ?? c.id)}</strong></button>`).join('') :
            '<p class="card__note">Every card is on the page.</p>';
        this.$tray.showModal?.();
    }

    add(id) {
        const def = CARD_BY_ID.get(id);
        if(!def) return;
        const was = this.all().find(c => c.id === id);
        this.setVisible(editList(this.visible(), {add: {id, size: was?.size ?? def.size}}, () => []));
        this.$live.textContent = `${def.name} added`;
        if(this.$tray.open) this.$tray.close();
    }
}

export { TrainingLayout, TRAINING_CARDS };
