/**
 * @jest-environment jsdom
 */
import { layouts } from '../../src/layout/store.js';
import { defaultLayouts } from '../../src/layout/tiles.js';
import { TrainingLayout } from '../../src/views/training/training-layout.js';

const IDS = ['form', 'week', 'health', 'calendar', 'volume', 'curve', 'zones', 'ftp'];

function size(w, h) {
    Object.defineProperty(window, 'innerWidth', {value: w, configurable: true});
    Object.defineProperty(window, 'innerHeight', {value: h, configurable: true});
}

function setup() {
    document.body.innerHTML = `<div class="tp-tools"></div><div class="tp-layout"></div><div class="training"></div>`;
    const cards = Object.fromEntries(IDS.map(id => { const el = document.createElement('div'); el.className = 'card'; el.textContent = id; return [id, el]; }));
    const tl = new TrainingLayout({
        tools: document.querySelector('.tp-tools'), bar: document.querySelector('.tp-layout'),
        grid: document.querySelector('.training'), cards,
    });
    return {tl, cards, grid: document.querySelector('.training')};
}

const shown = grid => [...grid.children].map(c => c.dataset.tile);

beforeEach(() => {
    localStorage.clear();
    layouts.save(defaultLayouts());
    size(1440, 900);
    HTMLDialogElement.prototype.showModal ??= function() { this.open = true; };
    HTMLDialogElement.prototype.close ??= function() { this.open = false; };
});

describe('the Training cards', () => {
    test('in the layout\'s order, with their sizes; hidden cards are left out', () => {
        const l = defaultLayouts();
        l.training.large.cards = [{id: 'ftp', size: 'full'}, {id: 'form', size: 'wide'}, ...l.training.large.cards.filter(c => !['ftp', 'form', 'zones'].includes(c.id)), {id: 'zones', size: 'narrow', hidden: true}];
        layouts.save(l);
        const {grid, cards} = setup();
        expect(shown(grid)).toEqual(['ftp', 'form', 'week', 'health', 'calendar', 'volume', 'curve']);
        expect(cards.ftp.dataset.size).toBe('full');
        expect(cards.zones.isConnected).toBe(false);
    });

    test('a phone gets the phone layout (every card full width)', () => {
        size(390, 844);
        const {grid} = setup();
        expect([...grid.children].every(c => c.dataset.size === 'full')).toBe(true);
    });

    test('a layout change from the account re-arranges, unless editing', () => {
        const {tl, grid} = setup();
        const l = defaultLayouts(); l.training.large.cards.reverse();
        layouts.applyRemote(l);
        expect(shown(grid)[0]).toBe('ftp');
    });
});

describe('editing the Training cards', () => {
    test('Edit layout: move, size and remove, then Done saves', () => {
        const {tl, grid} = setup();
        document.querySelector('[data-tl-edit]').click();
        expect(grid.classList.contains('is-editing')).toBe(true);
        expect(grid.querySelectorAll('[data-le-handle]')).toHaveLength(8);
        grid.querySelector('[data-tile="week"] [data-le-size]').click();
        grid.querySelector('[data-tile="zones"] [data-le-hide]').click();
        grid.querySelector('[data-tile="ftp"] [data-le-handle]').dispatchEvent(new KeyboardEvent('keydown', {key: 'ArrowUp', bubbles: true}));
        document.querySelector('[data-tl="done"]').click();
        const saved = layouts.get().training.large.cards;
        expect(saved.find(c => c.id === 'week').size).toBe('full');
        expect(saved.find(c => c.id === 'zones').hidden).toBe(true);
        expect(saved.filter(c => !c.hidden).map(c => c.id).slice(-2)).toEqual(['ftp', 'curve']);
        expect(grid.classList.contains('is-editing')).toBe(false);
    });

    test('on a phone the cards are full width, so there is no size button', () => {
        size(390, 844);
        const {grid} = setup();
        document.querySelector('[data-tl-edit]').click();
        expect(grid.querySelector('[data-le-size]')).toBeNull();
        expect(grid.querySelectorAll('[data-le-handle]')).toHaveLength(8);
    });

    test('Add card lists the hidden cards and brings one back', () => {
        const {grid} = setup();
        document.querySelector('[data-tl-edit]').click();
        grid.querySelector('[data-tile="zones"] [data-le-hide]').click();
        document.querySelector('[data-tl="add"]').click();
        expect([...document.querySelectorAll('[data-tl-add]')].map(b => b.dataset.tlAdd)).toEqual(['zones']);
        document.querySelector('[data-tl-add="zones"]').click();
        expect(shown(grid).at(-1)).toBe('zones');
    });

    test('Cancel and Reset', () => {
        const {grid} = setup();
        document.querySelector('[data-tl-edit]').click();
        grid.querySelector('[data-tile="zones"] [data-le-hide]').click();
        document.querySelector('[data-tl="cancel"]').click();
        expect(shown(grid)).toContain('zones');
        document.querySelector('[data-tl-edit]').click();
        grid.querySelector('[data-tile="zones"] [data-le-hide]').click();
        window.confirm = () => true;
        document.querySelector('[data-tl="reset"]').click();
        expect(shown(grid)).toContain('zones');
    });

    test('a card that hides itself (Health without data) is still there to move while editing', () => {
        const {grid, cards} = setup();
        cards.health.hidden = true;
        document.querySelector('[data-tl-edit]').click();
        expect(cards.health.querySelector('[data-le-handle]')).not.toBeNull();
        expect(cards.health.dataset.lePlaceholder).toBe('true');
        document.querySelector('[data-tl="done"]').click();
        expect(cards.health.dataset.lePlaceholder).toBeUndefined();
    });
});
