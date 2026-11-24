/**
 * @jest-environment jsdom
 */
import '../training/fake-idb.js';
import { riders } from '../../src/riders.js';
import { api } from '../../src/account/api.js';
import '../../src/views/rider-menu.js';

HTMLDialogElement.prototype.showModal ??= function() { this.setAttribute('open', ''); };
HTMLDialogElement.prototype.close ??= function() { this.removeAttribute('open'); };

async function accountTab(server, account) {
    jest.spyOn(api, 'probe').mockResolvedValue(server);
    if(account) riders.linkAccount(riders.current().id, {accountId: 'a1', role: 'rider', ...account});
    document.body.innerHTML = '<rider-menu></rider-menu>';
    const el = document.querySelector('rider-menu');
    el.tab = 'account';
    await el.open();
    return el.querySelector('.rm--body');
}

describe('the Account tab offline', () => {
    afterEach(() => jest.restoreAllMocks());

    test('signed in: still signed in, things sync later; not "no account server"', async () => {
        const body = await accountTab({available: false, offline: true}, {username: 'dj', token: 't'});
        expect(body.querySelector('[data-k="offline"]').textContent).toMatch(/can't be reached right now/);
        expect(body.textContent).toMatch(/still signed in/);
        expect(body.textContent).toMatch(/@dj/);
        expect(body.textContent).not.toMatch(/No account server/);
        expect(body.querySelector('[data-act="signout"]')).toBeNull();
    });

    test('not signed in: offline, sign in later', async () => {
        const body = await accountTab({available: false, offline: true}, {token: null});
        expect(body.textContent).toMatch(/Sign in when this device can reach/);
    });

    test('no server at this address: as before', async () => {
        const body = await accountTab({available: false});
        expect(body.textContent).toMatch(/No account server found at this address/);
    });
});
