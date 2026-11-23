/**
 * @jest-environment jsdom
 */
import { createThresholds } from '../../src/training/thresholds.js';

describe('threshold heart rate settings', () => {
    beforeEach(() => localStorage.clear());

    test('the rider\'s own values, Garmin\'s, and the merge of both', () => {
        const changes = [];
        const t = createThresholds({key: k => `rider1:${k}`, onChange: v => changes.push(v)});
        expect(t.own()).toEqual({cycling: null, running: null});
        t.setGarmin({cycling: 165, running: 172});
        expect(t.effective()).toEqual({cycling: 165, running: 172});
        t.setOwn({cycling: '158', running: ''});
        expect(t.own()).toEqual({cycling: 158, running: null});
        expect(t.effective()).toEqual({cycling: 158, running: 172});
        expect(changes).toEqual([{cycling: 158, running: null}]);
        // another rider on this device has their own
        const other = createThresholds({key: k => `rider2:${k}`});
        expect(other.own()).toEqual({cycling: null, running: null});
    });

    test('nonsense values are ignored', () => {
        const t = createThresholds({key: k => k});
        t.setOwn({cycling: 'abc', running: 300});
        expect(t.own()).toEqual({cycling: null, running: null});
        localStorage.setItem('training:hrThresholds', '{broken');
        expect(t.own()).toEqual({cycling: null, running: null});
    });
});
