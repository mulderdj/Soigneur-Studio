/**
 * @jest-environment jsdom
 */
import '../../src/views/data-views.js';

describe('navigation-stack switch', () => {
    test('switches tabs even when a tab has no elements on the page', () => {
        const Nav = customElements.get('navigation-stack');
        const view = document.createElement('div');
        const link = document.createElement('div');
        const other = {$view: document.createElement('div'), $link: document.createElement('div')};
        other.$view.classList.add('active');
        const elements = {editor: {$view: view, $link: link}, gone: {$view: null, $link: null}, other};
        expect(() => Nav.prototype.switch.call({}, 'editor', elements)).not.toThrow();
        expect(view.classList.contains('active')).toBe(true);
        expect(other.$view.classList.contains('active')).toBe(false);
    });
});
