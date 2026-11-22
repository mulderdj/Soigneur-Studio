/**
 * @jest-environment jsdom
 */
import { models } from '../src/models/models.js';

describe('page model', () => {
    test('accepts the four pages', () => {
        for(const p of ['home', 'training', 'workouts', 'settings']) {
            expect(models.page.set(p)).toBe(p);
        }
    });
    test('falls back to home for unknown pages', () => {
        expect(models.page.set('report')).toBe('home');
    });
});
