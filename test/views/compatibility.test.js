import { compatibilityProblem } from '../../src/views/compatibility.js';

describe('why Bluetooth is missing, and what to do', () => {
    test('a plain http page on another address: secure context, not the browser', () => {
        const p = compatibilityProblem({secure: false, bluetooth: false, host: '192.168.1.116:1240', userAgent: 'Mozilla/5.0 (X11; Linux x86_64) Chrome/146.0'});
        expect(p.kind).toBe('insecure');
        expect(p.text).toMatch(/secure/);
        expect(p.text).toMatch(/192\.168\.1\.116:1240/);
        expect(p.text).toMatch(/https:\/\/192\.168\.1\.116:8443/);
        expect(p.text).toMatch(/localhost/);
        expect(p.text).not.toMatch(/NOT supported|Flux|dvmarinoff/);
    });

    test('iOS: no Bluetooth in any browser', () => {
        const p = compatibilityProblem({secure: true, bluetooth: false, host: 'x', userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) CriOS/130'});
        expect(p.kind).toBe('ios');
        expect(p.text).toMatch(/iPhone|iPad/);
    });

    test('a browser without Bluetooth (Firefox, Safari)', () => {
        const p = compatibilityProblem({secure: true, bluetooth: false, host: 'localhost:8080', userAgent: 'Mozilla/5.0 Firefox/140.0'});
        expect(p.kind).toBe('browser');
        expect(p.text).toMatch(/Chrome|Edge/);
    });

    test('everything fine: no problem', () => {
        expect(compatibilityProblem({secure: true, bluetooth: true, host: 'localhost', userAgent: 'Chrome'})).toBeNull();
    });
});
