/**
 * @jest-environment jsdom
 */
import '../training/fake-idb.js';
import { riders } from '../../src/riders.js';
import { api } from '../../src/account/api.js';
import '../../src/views/rider-menu.js';

HTMLDialogElement.prototype.showModal ??= function() { this.setAttribute('open', ''); };
HTMLDialogElement.prototype.close ??= function() { this.removeAttribute('open'); };

const flush = () => new Promise(r => setTimeout(r, 0));
const TOKENS = [{id: 'k1', name: 'Claude Code on my PC', scope: 'plan', createdAt: Date.UTC(2026, 10, 26), lastUsedAt: null}];

async function accountTab(get) {
    jest.spyOn(api, 'probe').mockResolvedValue({available: true});
    jest.spyOn(api, 'get').mockImplementation(async path => get(path));
    riders.linkAccount(riders.current().id, {accountId: 'a1', role: 'rider', username: 'dj', token: 't'});
    document.body.innerHTML = '<rider-menu></rider-menu>';
    const el = document.querySelector('rider-menu');
    el.tab = 'account';
    await el.open();
    await flush();
    return el.querySelector('.rm--body');
}

const server = tokens => path => path === '/me/tokens' ? {tokens} :
    {strava: {available: false}, intervals: {connected: false}, garmin: {connected: false}};

describe('AI access on the Account tab', () => {
    afterEach(() => jest.restoreAllMocks());

    test('lists the keys with what they may do and when they were used', async () => {
        const body = await accountTab(server(TOKENS));
        const row = body.querySelector('[data-ai="k1"]');
        expect(row.textContent).toMatch(/Claude Code on my PC/);
        expect(row.textContent).toMatch(/changes your plan/);
        expect(row.textContent).toMatch(/not used yet/);
        expect(body.querySelector('[data-k="ai-access"]').textContent).toMatch(/goes to that app's provider/);
    });

    test('a new key is shown once, with how to use it', async () => {
        const body = await accountTab(server([]));
        const post = jest.spyOn(api, 'post').mockResolvedValue({token: 'sst_abc', access: TOKENS[0]});
        const form = body.querySelector('[data-form="ai-access"]');
        form.elements.name.value = 'Claude Code on my PC';
        form.elements.scope.value = 'plan';
        form.dispatchEvent(new Event('submit', {bubbles: true, cancelable: true}));
        await flush(); await flush();
        expect(post).toHaveBeenCalledWith('/me/tokens', {name: 'Claude Code on my PC', scope: 'plan'});
        expect(body.querySelector('[data-k="ai-key"]').value).toBe('sst_abc');
        expect(body.querySelector('[data-k="ai-new"]').textContent).toMatch(/shown only once/);
    });

    test('remove asks to confirm, then revokes', async () => {
        const body = await accountTab(server(TOKENS));
        const del = jest.spyOn(api, 'delete').mockResolvedValue({ok: true});
        const btn = body.querySelector('[data-act="revoke-ai"]');
        btn.click();
        await flush();
        expect(del).not.toHaveBeenCalled();
        btn.click();
        await flush();
        expect(del).toHaveBeenCalledWith('/me/tokens/k1');
    });
});
