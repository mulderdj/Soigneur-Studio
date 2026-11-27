/**
 * @jest-environment jsdom
 */
import '../../src/views/editor.js';

function mountEditor() {
    document.body.innerHTML = `
        <workout-editor>
            <div class="editor-cont">
                <form>
                    <input class="editor--name editor--input" />
                    <input class="editor--author editor--input" />
                    <input class="editor--category editor--input" />
                    <textarea class="editor--description editor--input" rows="4"></textarea>
                    <div class="card editor--preview">
                        <div class="editor--preview-head">
                            <span class="editor--label">Preview</span>
                            <span class="editor--preview-meta"></span>
                        </div>
                        <div class="editor--graph"></div>
                    </div>
                    <div class="editor--body"></div>
                    <button type="button" class="editor--add"></button>
                    <button type="button" class="editor--remove"></button>
                    <button type="button" class="editor--save"></button>
                    <button type="button" class="editor--download"></button>
                </form>
            </div>
        </workout-editor>`;
    return document.querySelector('workout-editor');
}

describe('WorkoutEditor live preview', () => {
    test('renders bars on mount and updates live when editing power, duration, ramp, or adding/removing rows', () => {
        const el = mountEditor();
        const graph = el.querySelector('.editor--graph');
        const meta = el.querySelector('.editor--preview-meta');

        // Default initial row: 10:00
        expect(graph.querySelectorAll('.graph--bar-group')).toHaveLength(1);
        expect(meta.textContent).toMatch(/10:00/);

        // Edit power to 90% and add a second row
        const powerInput = el.querySelector('.editor--td.power');
        powerInput.value = '90%';
        powerInput.dispatchEvent(new Event('input', {bubbles: true}));
        expect(meta.textContent).toMatch(/10:00 · ~\d+ TSS/);

        el.querySelector('.editor--add').dispatchEvent(new Event('pointerup'));
        expect(graph.querySelectorAll('.graph--bar-group')).toHaveLength(2);
        expect(meta.textContent).toMatch(/20:00/);

        // Set ramp on second row -> multi-step ramp bar group
        const rampInputs = el.querySelectorAll('.editor--td.ramp');
        rampInputs[1].value = '110%';
        rampInputs[1].dispatchEvent(new Event('input', {bubbles: true}));
        expect(graph.querySelectorAll('.graph--bar-group')[1].querySelectorAll('.graph--bar').length).toBeGreaterThan(2);

        // Removing row updates preview back to 1 bar group
        el.querySelector('.editor--remove').dispatchEvent(new Event('pointerup'));
        expect(graph.querySelectorAll('.graph--bar-group')).toHaveLength(1);
        expect(meta.textContent).toMatch(/10:00/);
    });
});
