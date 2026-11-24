/**
 * @jest-environment jsdom
 */
import { editList, LayoutEditor, editLocked } from '../../src/views/layout-editor.js';

const SIZES = {power: ['small', 'wide', 'large'], hr: ['small', 'wide', 'large'], cad: ['small', 'wide', 'large'], chart: ['wide', 'large']};
const NAMES = {power: 'Power', hr: 'Heart Rate', cad: 'Cadence', chart: 'Live chart'};
const list = () => [{id: 'power', size: 'large'}, {id: 'hr', size: 'small'}, {id: 'cad', size: 'small'}, {id: 'chart', size: 'large'}];
const sizesOf = id => SIZES[id];

describe('list operations', () => {
    test('move', () => {
        expect(editList(list(), {move: [0, 2]}, sizesOf).map(t => t.id)).toEqual(['hr', 'cad', 'power', 'chart']);
        expect(editList(list(), {move: [3, 0]}, sizesOf).map(t => t.id)).toEqual(['chart', 'power', 'hr', 'cad']);
        expect(editList(list(), {move: [0, 9]}, sizesOf).map(t => t.id)).toEqual(['hr', 'cad', 'chart', 'power']);
    });
    test('size cycles through the tile\'s sizes', () => {
        expect(editList(list(), {size: 1}, sizesOf)[1].size).toBe('wide');
        expect(editList(list(), {size: 0}, sizesOf)[0].size).toBe('small');
        expect(editList(list(), {size: 3}, sizesOf)[3].size).toBe('wide');
    });
    test('hide and add', () => {
        expect(editList(list(), {hide: 1}, sizesOf).map(t => t.id)).toEqual(['power', 'cad', 'chart']);
        expect(editList(list().slice(0, 1), {add: {id: 'hr', size: 'small'}}, sizesOf)).toEqual([{id: 'power', size: 'large'}, {id: 'hr', size: 'small'}]);
        expect(editList(list(), {add: {id: 'hr', size: 'small'}}, sizesOf)).toHaveLength(4); // already there
    });
    test('the input list is left alone', () => {
        const l = list();
        editList(l, {move: [0, 2]}, sizesOf);
        expect(l[0].id).toBe('power');
    });
});

describe('editing is locked while riding', () => {
    test('watch running or paused, or a workout started', () => {
        expect(editLocked({watchStatus: 'stopped', workoutStatus: 'stopped'})).toBe(false);
        expect(editLocked({})).toBe(false);
        expect(editLocked({watchStatus: 'started'})).toBe(true);
        expect(editLocked({watchStatus: 'paused'})).toBe(true);
        expect(editLocked({workoutStatus: 'started'})).toBe(true);
    });
});

function setup() {
    const container = document.createElement('div');
    document.body.innerHTML = '';
    document.body.append(container);
    let current = list();
    const render = () => {
        container.innerHTML = current.map((t, i) => `<div data-tile="${t.id}" data-size="${t.size}"><span class="inner">${t.id}</span></div>`).join('');
        [...container.querySelectorAll('[data-tile]')].forEach((el, i) => {
            el.getBoundingClientRect = () => ({left: i * 100, right: i * 100 + 90, top: 0, bottom: 90, width: 90, height: 90});
        });
    };
    render();
    const changes = [], said = [];
    const editor = new LayoutEditor(container, {
        list: () => current,
        sizesOf, nameOf: id => NAMES[id],
        onChange: next => { changes.push(next); current = next; render(); editor.refresh(); },
        announce: text => said.push(text),
    });
    editor.start();
    return {container, editor, changes, said, get current() { return current; }};
}

const pointer = (type, el, x, pointerType = 'mouse') => {
    const e = new MouseEvent(type, {bubbles: true, cancelable: true, clientX: x, clientY: 40, button: 0});
    Object.defineProperty(e, 'pointerType', {value: pointerType});
    Object.defineProperty(e, 'pointerId', {value: 1});
    el.dispatchEvent(e);
};

describe('the editor on the page', () => {
    test('every tile gets a handle, a size and a hide button; stop removes them', () => {
        const t = setup();
        expect(t.container.querySelectorAll('[data-le-handle]')).toHaveLength(4);
        expect(t.container.querySelector('[data-tile="hr"] [data-le-size]').textContent).toMatch(/small/i);
        expect(t.container.classList.contains('is-editing')).toBe(true);
        t.editor.stop();
        expect(t.container.querySelectorAll('[data-le-handle]')).toHaveLength(0);
        expect(t.container.classList.contains('is-editing')).toBe(false);
    });
    test('size and hide buttons', () => {
        const t = setup();
        t.container.querySelector('[data-tile="hr"] [data-le-size]').click();
        expect(t.current[1].size).toBe('wide');
        t.container.querySelector('[data-tile="cad"] [data-le-hide]').click();
        expect(t.current.map(x => x.id)).toEqual(['power', 'hr', 'chart']);
        expect(t.said.at(-1)).toBe('Cadence removed');
    });
    test('keys on a handle move, size and hide, and say what happened', () => {
        const t = setup();
        const key = (id, k) => t.container.querySelector(`[data-tile="${id}"] [data-le-handle]`)
            .dispatchEvent(new KeyboardEvent('keydown', {key: k, bubbles: true, cancelable: true}));
        key('hr', 'ArrowDown');
        expect(t.current.map(x => x.id)).toEqual(['power', 'cad', 'hr', 'chart']);
        expect(t.said.at(-1)).toBe('Heart Rate moved to place 3');
        expect(document.activeElement?.closest('[data-tile]')?.dataset.tile).toBe('hr'); // focus follows
        key('hr', 'ArrowLeft');
        expect(t.current.map(x => x.id)).toEqual(['power', 'hr', 'cad', 'chart']);
        key('power', 'Enter');
        expect(t.current[0].size).toBe('small');
        key('chart', 'Delete');
        expect(t.current.map(x => x.id)).toEqual(['power', 'hr', 'cad']);
    });
    test('a mouse drag over two tiles moves the tile there', () => {
        const t = setup();
        const handle = t.container.querySelector('[data-tile="power"] [data-le-handle]');
        pointer('pointerdown', handle, 45);
        pointer('pointermove', handle, 160);
        pointer('pointermove', handle, 250);
        pointer('pointerup', handle, 250);
        expect(t.current.map(x => x.id)).toEqual(['hr', 'cad', 'power', 'chart']);
        expect(t.said.at(-1)).toBe('Power moved to place 3');
    });
    test('a finger that moves at once scrolls; holding first drags', () => {
        jest.useFakeTimers();
        const t = setup();
        const handle = () => t.container.querySelector('[data-tile="power"] [data-le-handle]');
        pointer('pointerdown', handle(), 45, 'touch');
        pointer('pointermove', handle(), 250, 'touch');
        pointer('pointerup', handle(), 250, 'touch');
        expect(t.changes).toHaveLength(0);
        pointer('pointerdown', handle(), 45, 'touch');
        jest.advanceTimersByTime(350);
        pointer('pointermove', handle(), 250, 'touch');
        pointer('pointerup', handle(), 250, 'touch');
        expect(t.current.map(x => x.id)).toEqual(['hr', 'cad', 'power', 'chart']);
        jest.useRealTimers();
    });
    test('while editing, a tap on a tile does not reach it (no tile switching)', () => {
        const t = setup();
        let reached = 0;
        t.container.querySelector('[data-tile="hr"] .inner').addEventListener('click', () => reached++);
        t.container.querySelector('[data-tile="hr"] .inner').click();
        expect(reached).toBe(0);
    });
});
