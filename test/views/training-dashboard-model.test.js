/**
 * @jest-environment jsdom
 */
import '../training/browser-stubs.js';
import { session, setWprime, applyModel, loadWprime } from '../../src/views/training-dashboard.js';

beforeEach(() => {
    localStorage.clear();
    applyModel({cp: 250, wprime: loadWprime(), source: 'settings'});
});

describe('the typed W′ and the rider model', () => {
    test('while the model is in use, a typed W′ (or one from the account) is stored but W′bal keeps the model\'s', () => {
        applyModel({cp: 270, wprime: 18400, source: 'model'});
        setWprime(20000);
        expect(loadWprime()).toBe(20000);
        expect(session.wprime).toBe(18400);
        expect(session.cp).toBe(270);
    });
    test('back to the settings: the typed W′ again', () => {
        applyModel({cp: 270, wprime: 18400, source: 'model'});
        setWprime(22000);
        applyModel({cp: 250, wprime: 22000, source: 'settings'});
        expect(session.wprime).toBe(22000);
        expect(session.cp).toBeNull();
    });
    test('without the model, setWprime sets W′bal\'s W′', () => {
        setWprime(21000);
        expect(session.wprime).toBe(21000);
    });
});
