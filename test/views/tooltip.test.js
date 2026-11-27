/**
 * @jest-environment jsdom
 */
import { ChartTooltip, placeTooltip } from '../../src/views/charts/tooltip.js';

describe('placeTooltip', () => {
    test('places above the plot centered over the cursor when there is room', () => {
        expect(placeTooltip({x: 300, plotTop: 200}, {width: 200, height: 100}, {width: 1000, height: 800, bottomInset: 68}))
            .toEqual({left: 200, top: 92});
        // clamps horizontally near the left and right edges while staying above the plot
        expect(placeTooltip({x: 40, plotTop: 200}, {width: 200, height: 100}, {width: 1000, height: 800, bottomInset: 68}))
            .toEqual({left: 8, top: 92});
        expect(placeTooltip({x: 960, plotTop: 200}, {width: 200, height: 100}, {width: 1000, height: 800, bottomInset: 68}))
            .toEqual({left: 792, top: 92});
    });

    test('falls back beside the cursor inside the plot when there is not enough room above', () => {
        expect(placeTooltip({x: 100, plotTop: 80}, {width: 200, height: 100}, {width: 1000, height: 800, bottomInset: 68}))
            .toEqual({left: 114, top: 88});
        expect(placeTooltip({x: 850, plotTop: 80}, {width: 200, height: 100}, {width: 1000, height: 800, bottomInset: 68}))
            .toEqual({left: 636, top: 88});
    });

    test('clamps horizontally inside narrow viewports and vertically above the bottom bar', () => {
        expect(placeTooltip({x: 150, plotTop: 650}, {width: 260, height: 200}, {width: 320, height: 800, bottomInset: 64}))
            .toEqual({left: 20, top: 442});
        expect(placeTooltip({x: -20, plotTop: -40}, {width: 200, height: 100}, {width: 600, height: 400, bottomInset: 0}))
            .toEqual({left: 8, top: 8});
    });
});

describe('ChartTooltip', () => {
    beforeEach(() => {
        document.body.innerHTML = '';
        Object.defineProperty(window, 'innerWidth', {value: 1000, configurable: true});
        Object.defineProperty(window, 'innerHeight', {value: 800, configurable: true});
    });

    test('uses popover="manual" when supported and keeps only one tooltip open at a time', () => {
        const make = () => {
            const owner = document.createElement('div');
            const el = document.createElement('div');
            let open = false;
            el.showPopover = jest.fn(() => { open = true; });
            el.hidePopover = jest.fn(() => { open = false; });
            el.matches = sel => sel === ':popover-open' && open;
            owner.append(el);
            document.body.append(owner);
            return {owner, el, tip: new ChartTooltip(el, {owner})};
        };
        const a = make();
        const b = make();

        expect(a.el.getAttribute('popover')).toBe('manual');
        expect(a.el.classList.contains('chart-tip')).toBe(true);

        a.tip.show({html: '<b>A</b>', x: 200, plotTop: 100});
        expect(a.el.hidden).toBe(false);
        expect(a.el.showPopover).toHaveBeenCalledTimes(1);

        b.tip.show({html: '<b>B</b>', x: 300, plotTop: 150});
        expect(a.el.hidden).toBe(true);
        expect(a.el.hidePopover).toHaveBeenCalledTimes(1);
        expect(b.el.hidden).toBe(false);
        expect(b.el.showPopover).toHaveBeenCalledTimes(1);

        // scrolling hides the active tooltip so it never drifts from its chart
        window.dispatchEvent(new Event('scroll'));
        expect(b.el.hidden).toBe(true);
        expect(b.el.hidePopover).toHaveBeenCalledTimes(1);
    });

    test('gracefully falls back when Popover API is unavailable', () => {
        const el = document.createElement('div');
        document.body.append(el);
        const tip = new ChartTooltip(el);
        expect(el.hasAttribute('popover')).toBe(false);
        tip.show({html: 'Fallback', x: 100, plotTop: 50});
        expect(el.hidden).toBe(false);
        expect(el.style.left).toBe('100px');
        expect(el.style.top).toBe('42px');
        tip.hide();
        expect(el.hidden).toBe(true);
    });
});
