/**
 * @jest-environment jsdom
 */
import './training/fake-idb.js';
import { MAX_AVATAR_LEN, isValidAvatar } from '../src/avatar.js';
import { riders } from '../src/riders.js';
import { api } from '../src/account/api.js';
import '../src/views/rider-menu.js';

HTMLDialogElement.prototype.showModal ??= function() { this.setAttribute('open', ''); };
HTMLDialogElement.prototype.close ??= function() { this.removeAttribute('open'); };

const VALID_PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
const VALID_WEBP = 'data:image/webp;base64,UklGRh4AAABXRUJQVlA4TBEAAAAvAAAAAAfQ//73v/+BiOh/AAA=';
const VALID_JPEG = 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AVN//2Q==';

describe('isValidAvatar', () => {
    test('accepts valid jpeg, png, and webp base64 data URLs within MAX_AVATAR_LEN', () => {
        expect(isValidAvatar(VALID_PNG)).toBe(true);
        expect(isValidAvatar(VALID_WEBP)).toBe(true);
        expect(isValidAvatar(VALID_JPEG)).toBe(true);

        const prefix = 'data:image/webp;base64,';
        const exactMax = prefix + 'A'.repeat(MAX_AVATAR_LEN - prefix.length);
        expect(exactMax.length).toBe(MAX_AVATAR_LEN);
        expect(isValidAvatar(exactMax)).toBe(true);
    });

    test('rejects svg, external URLs, scripts, oversized strings, and non-strings', () => {
        const prefix = 'data:image/webp;base64,';
        const tooLong = prefix + 'A'.repeat(MAX_AVATAR_LEN - prefix.length + 1);
        const bad = [
            null,
            undefined,
            123,
            {},
            '',
            'data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=',
            'data:image/gif;base64,R0lGODlhAQABAIAAAP///wAAACH5BAEAAAAALAAAAAABAAEAAAICRAEAOw==',
            'https://example.com/avatar.png',
            'javascript:alert(1)',
            'data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg==',
            'data:image/png;base64,',
            'data:image/png;base64,not valid!@#',
            tooLong,
        ];
        for(const val of bad) {
            expect(isValidAvatar(val)).toBe(false);
        }
    });
});

describe('riders.setAvatar', () => {
    afterEach(() => {
        riders.setAvatar(riders.current().id, null);
    });

    test('persists a valid avatar in auuki:riders, dispatches riders:changed, and clears with null', () => {
        const id = riders.current().id;
        const onChanged = jest.fn();
        window.addEventListener('riders:changed', onChanged);
        try {
            riders.setAvatar(id, VALID_WEBP);
            expect(riders.current().avatar).toBe(VALID_WEBP);
            const saved = JSON.parse(localStorage.getItem('auuki:riders'));
            expect(saved.riders.find(r => r.id === id).avatar).toBe(VALID_WEBP);
            expect(onChanged).toHaveBeenCalledTimes(1);

            riders.setAvatar(id, null);
            expect(riders.current().avatar).toBeUndefined();
            const cleared = JSON.parse(localStorage.getItem('auuki:riders'));
            expect(cleared.riders.find(r => r.id === id).avatar).toBeUndefined();
            expect(onChanged).toHaveBeenCalledTimes(2);
        } finally {
            window.removeEventListener('riders:changed', onChanged);
        }
    });

    test('throws on invalid avatar values', () => {
        const id = riders.current().id;
        expect(() => riders.setAvatar(id, 'data:image/svg+xml;base64,PHN2Zz4=')).toThrow(/Invalid avatar/);
        expect(() => riders.setAvatar(id, 'https://example.com/a.jpg')).toThrow(/Invalid avatar/);
    });
});

describe('RiderMenu avatar rendering', () => {
    beforeEach(() => {
        riders.setAvatar(riders.current().id, null);
        jest.spyOn(api, 'probe').mockResolvedValue({available: true, needsSetup: false, signup: false});
        jest.spyOn(api, 'get').mockResolvedValue({
            strava: {available: false, connected: false},
            intervals: {connected: false},
            garmin: {connected: false},
            tokens: [],
        });
    });

    afterEach(() => {
        riders.setAvatar(riders.current().id, null);
        riders.unlinkAccount(riders.current().id);
        jest.restoreAllMocks();
        document.body.innerHTML = '';
    });

    test('renders initial without avatar, img with avatar, and removes photo via button', async () => {
        document.body.innerHTML = '<rider-menu></rider-menu>';
        const el = document.querySelector('rider-menu');
        await el.open();

        // Initially shows initial letter and no Remove photo button
        expect(el.querySelector('.rm--pill .rm--avatar img')).toBeNull();
        expect(el.querySelector('.rm--pill .rm--avatar').textContent.trim()).toBe('R');
        expect(el.querySelector('.rm--body .rm--avatar img')).toBeNull();
        expect(el.querySelector('[data-act="remove-avatar"]')).toBeNull();

        // Set avatar: pill, Riders list, and Account card show <img> and Remove photo button
        riders.setAvatar(riders.current().id, VALID_PNG);
        el.render();

        const pillImg = el.querySelector('.rm--pill .rm--avatar img.rm--avatar-img');
        expect(pillImg).not.toBeNull();
        expect(pillImg.getAttribute('src')).toBe(VALID_PNG);

        const rowImg = el.querySelector('.rm--body .rm--row .rm--avatar img.rm--avatar-img');
        expect(rowImg).not.toBeNull();
        expect(rowImg.getAttribute('src')).toBe(VALID_PNG);
        expect(el.querySelector('[data-act="remove-avatar"]')).not.toBeNull();

        // Account card also renders <img> and Remove photo button
        riders.linkAccount(riders.current().id, {accountId: 'a1', username: 'dj', role: 'rider', token: 'tok'});
        el.tab = 'account';
        el.render();
        const cardImg = el.querySelector('.rm--card .rm--avatar.rm--big img.rm--avatar-img');
        expect(cardImg).not.toBeNull();
        expect(cardImg.getAttribute('src')).toBe(VALID_PNG);

        // Clicking Remove photo clears the avatar and reverts to initial
        el.querySelector('[data-act="remove-avatar"]').click();
        expect(riders.current().avatar).toBeUndefined();
        expect(el.querySelector('.rm--pill .rm--avatar img')).toBeNull();
        expect(el.querySelector('.rm--card .rm--avatar img')).toBeNull();
        expect(el.querySelector('[data-act="remove-avatar"]')).toBeNull();
    });
});
