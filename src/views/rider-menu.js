// @ts-check
//
// <rider-menu>: rider switcher, account sign-in, saved sensors, ride history
// and user management, in one dialog opened from a pill in the header.
//

import { xf } from '../functions.js';
import { riders } from '../riders.js';
import { sensors } from '../sensors.js';
import { api, ApiError } from '../account/api.js';
import { syncNow, status as syncStatus } from '../account/sync.js';
import { syncCounts, garminCounts } from './training/format.js';

function esc(s) {
    return String(s ?? '').replace(/[&<>"']/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c]));
}

function initial(name) {
    return esc(String(name ?? '?').trim().charAt(0).toUpperCase() || '?');
}

function fmtDate(ts) {
    if(!ts) return '';
    return new Date(ts).toLocaleDateString([], {day: 'numeric', month: 'short', year: 'numeric'});
}

function fmtDuration(s) {
    s = Math.round(s || 0);
    const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60);
    return h > 0 ? `${h} h ${String(m).padStart(2, '0')} min` : `${m} min`;
}

// Strava sends the rider back to /?connect=strava&result=...; read it at load
const connectReturn = (() => {
    try {
        const params = new URL(window.location.href).searchParams;
        if(params.get('connect') !== 'strava') return null;
        const out = {result: params.get('result'), message: params.get('message')};
        ['connect', 'result', 'message'].forEach(k => params.delete(k));
        const qs = params.toString();
        window.history.replaceState({}, document.title, window.location.pathname + (qs ? `?${qs}` : ''));
        return out;
    } catch(e) { return null; }
})();

const GARMIN_IMPORT_URL = 'https://connect.garmin.com/modern/import-data';

const UPLOAD_LABEL = {
    queued: 'Waiting',
    uploading: 'Sending',
    retrying: 'Will retry',
    done: 'Sent',
    failed: 'Failed',
};

const SYNC_LABEL = {
    off: 'This device only',
    syncing: 'Syncing',
    ok: 'Synced',
    offline: 'Offline, will retry',
    error: 'Sync problem',
};

// the Garmin card: sync status, and a warning before the key expires
function garminStatus(g) {
    const lines = [];
    if(g.sync?.lastRun) {
        const when = new Date(g.sync.lastRun).toLocaleString([], {day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit'});
        lines.push(`<small class="rm--icu-sync">Synced ${esc(when)}: ${esc(garminCounts(g.sync))}.</small>`);
    } else {
        lines.push('<small class="rm--icu-sync">First sync on its way: 90 days of health data and 2 years of activities.</small>');
    }
    if(g.expiresOn) {
        const days = Math.ceil((Date.parse(g.expiresOn) - Date.now()) / 86400000);
        if(days <= 7) {
            lines.push(`<small class="rm--icu-sync rm--error">${days < 0 ? 'The key has expired' : `The key expires ${days === 0 ? 'today' : `in ${days} day${days === 1 ? '' : 's'}`}`}. Create a new one on Garmin Connect and paste it here.</small>`);
        } else {
            lines.push(`<small class="rm--icu-sync">Key valid until ${esc(new Date(g.expiresOn).toLocaleDateString([], {day: 'numeric', month: 'short', year: 'numeric'}))}.</small>`);
        }
    }
    if(g.sync?.error) lines.push(`<small class="rm--icu-sync rm--error">${esc(g.sync.error)}</small>`);
    return lines.join('');
}

// the intervals.icu sync status on its account card
function intervalsSync(sync) {
    if(!sync) return '';
    const when = sync.lastRun ?
          `Synced ${new Date(sync.lastRun).toLocaleString([], {day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit'})}: ${syncCounts(sync)}.` :
          'First sync on its way.';
    const plan = sync.planSkipped > 0 ? ` ${sync.planSkipped} planned workout${sync.planSkipped === 1 ? '' : 's'} couldn't be sent (no .zwo).` : '';
    return `<small class="rm--icu-sync">${esc(when + plan)}</small>${sync.error ? `<small class="rm--icu-sync rm--error">${esc(sync.error)}</small>` : ''}`;
}

class RiderMenu extends HTMLElement {
    connectedCallback() {
        this.tab = 'riders';
        this.server = {available: false};
        this.flash = '';

        this.innerHTML = `
            <button type="button" class="rm--pill pill" aria-haspopup="dialog">
                <span class="rm--avatar"></span>
                <span class="rm--name sr-only"></span>
                <span class="rm--dot" aria-hidden="true"></span>
            </button>
            <dialog class="rm--dialog" aria-label="Riders and account">
                <div class="rm--head">
                    <nav class="rm--tabs tabs" role="tablist"></nav>
                    <button type="button" class="rm--close" aria-label="Close">×</button>
                </div>
                <div class="rm--flash flash" role="status" hidden></div>
                <div class="rm--body"></div>
            </dialog>`;

        /** @type {HTMLElement} */
        this.$pill   = this.querySelector('.rm--pill');
        this.$dialog = this.querySelector('dialog');
        this.$tabs   = this.querySelector('.rm--tabs');
        this.$body   = this.querySelector('.rm--body');
        /** @type {HTMLElement} */
        this.$flash  = this.querySelector('.rm--flash');

        this.$pill.addEventListener('click', () => this.open());
        this.querySelector('.rm--close').addEventListener('click', () => this.$dialog.close());
        this.$dialog.addEventListener('click', e => { if(e.target === this.$dialog) this.$dialog.close(); });
        this.$tabs.addEventListener('click', e => {
            /** @type {HTMLElement|null} */
            const b = /** @type {Element} */ (e.target).closest('[data-tab]');
            if(b) { this.tab = b.dataset.tab; this.flash = ''; this.render(); }
        });
        this.$body.addEventListener('click', e => this.onClick(e));
        this.$body.addEventListener('submit', e => this.onSubmit(e));
        this.$body.addEventListener('change', e => this.onChange(e));

        this.abort = new AbortController();
        const signal = {signal: this.abort.signal};
        window.addEventListener('riders:changed', () => this.renderPill(), signal);
        xf.sub('account:sync', () => { this.renderPill(); if(this.$dialog.open && this.tab === 'account') this.render(); }, signal);
        xf.sub('sensors:changed', () => { if(this.$dialog.open && this.tab === 'sensors') this.render(); }, signal);
        xf.sub('sensor:reconnect-result', ({identifier, ok}) => {
            if(!ok && this.$dialog.open && this.tab === 'sensors') {
                this.say(`${sensors.ROLES[identifier] ?? 'Sensor'} not found. Is it awake and in range?`, 'warn');
            }
        }, signal);
        window.addEventListener('account:signed-out', () => {
            const r = riders.current();
            if(r.account) riders.updateAccount(r.id, {token: null});
            this.renderPill();
        }, signal);

        api.probe().then(s => { this.server = s; this.renderPill(); });
        // back online: ask the server again, so the Account tab shows the account
        window.addEventListener('online', () => api.probe(true).then(s => {
            this.server = s;
            this.renderPill();
            if(this.$dialog.open) this.render();
        }), signal);
        this.renderPill();

        if(connectReturn) {
            const messages = {
                connected: ['Strava connected. New rides upload automatically.', 'good'],
                cancelled: ['Strava connection cancelled.', 'warn'],
                error: [connectReturn.message || 'Strava could not be connected.', 'warn'],
            };
            const [text, level] = messages[connectReturn.result] ?? messages.error;
            setTimeout(() => {
                this.tab = 'account';
                this.open().then(() => this.say(text, level));
            }, 300);
        }
    }

    // --- pill ---

    renderPill() {
        const r = riders.current();
        const s = r.account ? (r.account.token ? syncStatus().state : 'error') : 'off';
        this.$pill.querySelector('.rm--avatar').innerHTML = initial(r.name);
        this.$pill.querySelector('.rm--name').textContent = r.name;
        this.$pill.dataset.sync = s;
        const label = r.account && !r.account.token ? 'Signed out' : SYNC_LABEL[s];
        this.$pill.title = `${r.name}: ${label}. Click to switch rider or manage your account.`;
        this.$pill.setAttribute('aria-label', `${r.name}, ${label}: riders and account`);
    }

    // --- dialog ---

    async open() {
        this.server = await api.probe(true);
        this.flash = '';
        this.render();
        if(!this.$dialog.open) this.$dialog.showModal();
    }

    say(text, level = 'good') {
        this.flash = text;
        this.$flash.textContent = text;
        this.$flash.dataset.level = level;
        this.$flash.hidden = !text;
    }

    tabs() {
        const r = riders.current();
        const t = [['riders', 'Riders'], ['account', 'Account'], ['sensors', 'Sensors']];
        if(r.account?.token) t.push(['rides', 'Ride history']);
        if(r.account?.token && r.account.role === 'admin') t.push(['users', 'Users']);
        if(!t.some(([k]) => k === this.tab)) this.tab = 'riders';
        return t;
    }

    render() {
        this.$tabs.innerHTML = this.tabs().map(([k, label]) =>
            `<button type="button" class="tabs__tab" role="tab" data-tab="${k}" aria-selected="${k === this.tab}">${label}</button>`).join('');
        this.$flash.hidden = !this.flash;
        this[`render_${this.tab}`]();
    }

    render_riders() {
        const list = riders.list();
        this.$body.innerHTML = `
            <p class="rm--lead">Each rider has their own FTP, weight, W′, workouts, rides and saved sensors on this device.</p>
            <ul class="rm--list">
                ${list.map(r => `
                <li class="rm--row list-row${r.current ? ' is-current' : ''}">
                    <span class="rm--avatar">${initial(r.name)}</span>
                    <span class="rm--who">
                        <b>${esc(r.name)}</b>
                        <small>${r.account ? `Account @${esc(r.account.username)}${r.account.token ? '' : ', signed out'}` : 'This device only'}</small>
                    </span>
                    <span class="rm--actions">
                        ${r.current ? '<span class="rm--tag badge">Riding now</span>' :
                          `<button type="button" class="btn rm--btn" data-act="switch" data-id="${esc(r.id)}">Switch</button>`}
                        <button type="button" class="btn rm--btn rm--quiet btn--quiet" data-act="rename" data-id="${esc(r.id)}">Rename</button>
                        ${!r.current && r.id !== riders.DEFAULT_ID ?
                          `<button type="button" class="btn rm--btn rm--quiet rm--danger btn--quiet btn--danger" data-act="remove" data-id="${esc(r.id)}">Remove</button>` : ''}
                    </span>
                </li>`).join('')}
            </ul>
            <form class="rm--form rm--inline" data-form="add-rider">
                <label class="field">New rider <input class="input" name="name" maxlength="40" placeholder="Name" required></label>
                <button type="submit" class="btn rm--btn rm--primary btn--primary">Add rider</button>
            </form>
            <p class="rm--note">Switching reloads the app with that rider's data. Removing a rider deletes their data from this device only.</p>`;
    }

    render_account() {
        const r = riders.current();
        if(this.server.offline) {
            const s = syncStatus();
            this.$body.innerHTML = r.account?.token ? `
                <div class="rm--card">
                    <span class="rm--avatar rm--big">${initial(r.name)}</span>
                    <span class="rm--who"><b>${esc(r.name)}</b><small>@${esc(r.account.username)}</small></span>
                    <span class="rm--sync" data-sync="offline">${esc(s.state === 'offline' && s.message ? s.message : SYNC_LABEL.offline)}</span>
                </div>
                <p class="rm--lead" data-k="offline">Your account server can't be reached right now.</p>
                <p class="rm--note">You're still signed in. Rides and changes are kept on this device and sync when it can reach your Soigneur server again. Connected services and account settings come back then too.</p>` : `
                <p class="rm--lead" data-k="offline">Your account server can't be reached right now.</p>
                <p class="rm--note">Riders still work on this device. Sign in when this device can reach your Soigneur server again.</p>`;
            return;
        }
        if(!this.server.available) {
            this.$body.innerHTML = `
                <p class="rm--lead">No account server found at this address.</p>
                <p class="rm--note">Riders still work on this device. To sync riders across devices, run Soigneur Studio with Docker Compose, which starts the account server next to the app.</p>`;
            return;
        }
        if(r.account?.token) {
            const s = syncStatus();
            this.$body.innerHTML = `
                <div class="rm--card">
                    <span class="rm--avatar rm--big">${initial(r.name)}</span>
                    <span class="rm--who"><b>${esc(r.name)}</b><small>@${esc(r.account.username)}, ${r.account.role === 'admin' ? 'admin' : 'rider'}</small></span>
                    <span class="rm--sync" data-sync="${esc(s.state)}">${esc(s.message || (SYNC_LABEL[s.state] ?? s.state))}</span>
                </div>
                <p class="rm--note">FTP, weight, W′, imported workouts and every saved ride sync to your account.</p>
                <div class="rm--buttons">
                    <button type="button" class="btn rm--btn rm--primary btn--primary" data-act="sync">Sync now</button>
                    <button type="button" class="btn rm--btn" data-act="signout">Sign out</button>
                </div>
                <h3 class="rm--h">Connected services</h3>
                <div class="rm--connections" data-k="connections"><p class="rm--empty">Loading…</p></div>
                <h3 class="rm--h">AI access</h3>
                <div class="rm--ai" data-k="ai-access"><p class="rm--empty">Loading…</p></div>
                <h3 class="rm--h">Display name</h3>
                <form class="rm--form rm--inline" data-form="display-name">
                    <input class="input" name="displayName" maxlength="64" value="${esc(r.name)}" aria-label="Display name" required>
                    <button type="submit" class="btn rm--btn">Save</button>
                </form>
                <h3 class="rm--h">Change password</h3>
                <form class="rm--form" data-form="password">
                    <label class="field">Current password <input class="input" name="currentPassword" type="password" autocomplete="current-password" required></label>
                    <label class="field">New password <input class="input" name="newPassword" type="password" autocomplete="new-password" minlength="8" required></label>
                    <button type="submit" class="btn rm--btn">Change password</button>
                </form>`;
            this.renderConnections();
            this.renderAiAccess();
            return;
        }
        const relink = r.account && !r.account.token;
        this.$body.innerHTML = `
            ${this.server.needsSetup ? `
                <p class="rm--lead">This server has no accounts yet. The first account becomes the admin, who then creates accounts for the other riders.</p>
                <form class="rm--form" data-form="register">
                    <label class="field">Username <input class="input" name="username" autocomplete="username" required pattern="[A-Za-z0-9][A-Za-z0-9._\\-]{1,31}"></label>
                    <label class="field">Display name <input class="input" name="displayName" maxlength="64" value="${esc(r.name)}"></label>
                    <label class="field">Password <input class="input" name="password" type="password" autocomplete="new-password" minlength="8" required></label>
                    <button type="submit" class="btn rm--btn rm--primary btn--primary">Create admin account</button>
                </form>` : `
                <p class="rm--lead">${relink ? `Sign in again as @${esc(r.account.username)} to resume syncing.` :
                    `Sign in to sync <b>${esc(r.name)}</b> across your devices.`}</p>
                <form class="rm--form" data-form="login">
                    <label class="field">Username <input class="input" name="username" autocomplete="username" required value="${relink ? esc(r.account.username) : ''}"></label>
                    <label class="field">Password <input class="input" name="password" type="password" autocomplete="current-password" required></label>
                    <button type="submit" class="btn rm--btn rm--primary btn--primary">Sign in</button>
                </form>
                ${this.server.signup ? `
                <h3 class="rm--h">New here?</h3>
                <form class="rm--form" data-form="register">
                    <label class="field">Username <input class="input" name="username" autocomplete="username" required pattern="[A-Za-z0-9][A-Za-z0-9._\\-]{1,31}"></label>
                    <label class="field">Display name <input class="input" name="displayName" maxlength="64" value="${esc(r.name)}"></label>
                    <label class="field">Password <input class="input" name="password" type="password" autocomplete="new-password" minlength="8" required></label>
                    <button type="submit" class="btn rm--btn">Create account</button>
                </form>` : '<p class="rm--note">No account yet? Ask the admin of this server to create one.</p>'}`}
            <p class="rm--note">Signing in links the account to the rider you are on now (<b>${esc(r.name)}</b>). Their local data is kept and merged.</p>`;
    }

    async renderConnections() {
        const $c = this.$body.querySelector('[data-k="connections"]');
        if(!$c) return;
        let c;
        try {
            c = await api.get('/me/connections');
        } catch(e) {
            $c.innerHTML = `<p class="rm--empty">${esc(e.message)}</p>`;
            return;
        }
        if(!$c.isConnected) return;
        const auto = (service, on) => `
            <label class="rm--check rm--small"><input type="checkbox" data-change="auto-upload" data-service="${service}" ${on ? 'checked' : ''}> Send new rides automatically</label>`;
        $c.innerHTML = `
            <div class="rm--service">
                <span class="rm--svc rm--svc-strava" aria-hidden="true">S</span>
                <div class="rm--svc-body">
                    <b>Strava</b>
                    ${!c.strava.available ? `<small>Not set up on this server yet. The admin adds a Strava API app (see the documentation).</small>` :
                      c.strava.connected ? `<small>Connected${c.strava.athlete ? ` as ${esc(c.strava.athlete)}` : ''}.</small>${auto('strava', c.strava.autoUpload)}` :
                      `<small>Rides upload to your own Strava profile.</small>`}
                </div>
                <div class="rm--svc-actions">
                    ${c.strava.available ? (c.strava.connected ?
                        '<button type="button" class="btn rm--btn rm--quiet btn--quiet" data-act="disconnect" data-id="strava">Disconnect</button>' :
                        '<button type="button" class="btn rm--btn rm--strava" data-act="connect-strava">Connect with Strava</button>') : ''}
                </div>
            </div>
            <div class="rm--service">
                <span class="rm--svc rm--svc-intervals" aria-hidden="true">i</span>
                <div class="rm--svc-body">
                    <b>intervals.icu</b>
                    ${c.intervals.connected ? `<small>Connected${c.intervals.athlete ? ` as ${esc(c.intervals.athlete)}` : ''}${c.intervals.athleteId ? ` (${esc(c.intervals.athleteId)})` : ''}.</small>${intervalsSync(c.intervals.sync)}${auto('intervals', c.intervals.autoUpload)}` : `
                    <small>Paste your personal API key: intervals.icu, Settings, Developer Settings near the bottom of the page.</small>
                    <form class="rm--inline" data-form="intervals-key">
                        <input class="input" name="apiKey" autocomplete="off" spellcheck="false" placeholder="API key" aria-label="intervals.icu API key" required>
                        <button type="submit" class="btn rm--btn">Connect</button>
                    </form>`}
                </div>
                <div class="rm--svc-actions">
                    ${c.intervals.connected ? `<button type="button" class="btn rm--btn" data-act="sync-intervals">Sync now</button>
                        <button type="button" class="btn rm--btn rm--quiet btn--quiet" data-act="disconnect" data-id="intervals">Disconnect</button>` : ''}
                </div>
            </div>
            <div class="rm--service">
                <span class="rm--svc rm--svc-garmin" aria-hidden="true">G</span>
                <div class="rm--svc-body">
                    <b>Garmin Connect</b>
                    ${c.garmin?.connected ? `<small>Connected. Your health data (HRV, resting heart rate, sleep, Body Battery) and activities come in every 15 minutes.</small>${garminStatus(c.garmin)}` : `
                    <small>Paste your Personal API key: Garmin Connect on the web, Settings, Personal API Key. It brings in your health data (HRV, resting heart rate, sleep, Body Battery) and activities.</small>
                    ${c.garmin?.sync?.error ? `<small class="rm--icu-sync rm--error">${esc(c.garmin.sync.error)}</small>` : ''}
                    <form class="rm--inline rm--garmin-form" data-form="garmin-key">
                        <input class="input" name="apiKey" autocomplete="off" spellcheck="false" placeholder="Personal API key" aria-label="Garmin Personal API key" required>
                        <label class="field rm--garmin-expiry">Expires on <input class="input" type="date" name="expiresOn" aria-label="Expiry date of the key (optional)"></label>
                        <button type="submit" class="btn rm--btn">Connect</button>
                    </form>
                    <small>For your own use: Garmin's personal key is for the account holder's own data.</small>`}
                    <small>Sending rides to Garmin is for approved businesses only. Use <i>Send to Garmin</i> in Ride history: it downloads the ride and opens Garmin's import page.</small>
                </div>
                <div class="rm--svc-actions">
                    ${c.garmin?.connected ? `<button type="button" class="btn rm--btn" data-act="sync-garmin">Sync now</button>
                        <button type="button" class="btn rm--btn rm--quiet btn--quiet" data-act="disconnect" data-id="garmin">Disconnect</button>` : ''}
                </div>
            </div>`;
    }

    // named tokens for an AI app (MCP server); a new one is shown once
    async renderAiAccess(created = null) {
        const $a = this.$body.querySelector('[data-k="ai-access"]');
        if(!$a) return;
        let tokens;
        try {
            ({tokens} = await api.get('/me/tokens'));
        } catch(e) {
            $a.innerHTML = `<p class="rm--empty">${esc(e.message)}</p>`;
            return;
        }
        if(!$a.isConnected) return;
        const when = t => t ? new Date(t).toLocaleDateString(undefined, {day: 'numeric', month: 'short', year: 'numeric'}) : null;
        $a.innerHTML = `
            <p class="rm--note">Lets an AI app (Claude Code, ChatGPT, Gemini, a local model) read your training through Soigneur's MCP server and, if you allow it, plan workouts. What it reads goes to that app's provider, or stays home with a local model.</p>
            ${created ? `
            <div class="rm--ai-new" data-k="ai-new">
                <b>Copy this key now: it's shown only once.</b>
                <div class="rm--inline">
                    <input class="input rm--mono" readonly value="${esc(created.token)}" aria-label="New AI access key" data-k="ai-key">
                    <button type="button" class="btn rm--btn" data-act="copy-ai-key">Copy</button>
                </div>
                <small>Put it in your AI app's MCP settings as <code>SOIGNEUR_TOKEN</code>.</small>
            </div>` : ''}
            ${tokens.map(t => `
            <div class="rm--service" data-ai="${esc(t.id)}">
                <span class="rm--svc rm--svc-ai" aria-hidden="true">AI</span>
                <div class="rm--svc-body">
                    <b>${esc(t.name)}</b>
                    <small>${t.scope === 'plan' ? 'Reads your training and changes your plan' : 'Reads your training'}. Created ${when(t.createdAt)}, ${t.lastUsedAt ? `last used ${when(t.lastUsedAt)}` : 'not used yet'}.</small>
                </div>
                <div class="rm--svc-actions">
                    <button type="button" class="btn rm--btn rm--quiet btn--quiet" data-act="revoke-ai" data-id="${esc(t.id)}">Remove</button>
                </div>
            </div>`).join('')}
            <form class="rm--form" data-form="ai-access">
                <label class="field">Name <input class="input" name="name" maxlength="60" placeholder="Claude Code on my PC" required></label>
                <label class="field">May
                    <select class="input" name="scope">
                        <option value="read">read my training</option>
                        <option value="plan">read my training and change my plan</option>
                    </select>
                </label>
                <button type="submit" class="btn rm--btn">Create a key</button>
            </form>`;
    }

    render_sensors() {
        const list = sensors.list();
        const can = sensors.canReconnect();
        this.$body.innerHTML = `
            <p class="rm--lead">The last sensor you connected for each role is saved for <b>${esc(riders.current().name)}</b> on this device.</p>
            ${list.length === 0 ? '<p class="rm--empty">No saved sensors yet. Connect your trainer or heart-rate strap once and it appears here.</p>' : `
            <ul class="rm--list">
                ${list.map(d => `
                <li class="rm--row list-row">
                    <span class="rm--who"><b>${esc(d.role)}</b><small>${esc(d.name)}, saved ${fmtDate(d.savedAt)}</small></span>
                    <span class="rm--actions"><button type="button" class="btn rm--btn rm--quiet btn--quiet" data-act="forget-sensor" data-id="${esc(d.identifier)}">Forget</button></span>
                </li>`).join('')}
            </ul>`}
            <label class="rm--check"><input type="checkbox" data-change="auto" ${sensors.isAuto() ? 'checked' : ''}> Reconnect saved sensors when the app opens</label>
            <div class="rm--buttons">
                <button type="button" class="btn rm--btn rm--primary btn--primary" data-act="reconnect" ${list.length && can ? '' : 'disabled'}>Reconnect now</button>
                ${list.length ? '<button type="button" class="btn rm--btn rm--quiet btn--quiet" data-act="forget-all">Forget all</button>' : ''}
            </div>
            ${can ? '' : `
            <div class="rm--hint">
                <p><b>This browser can't reconnect without the device list yet.</b> Chrome and Edge only allow it with persistent Bluetooth permissions turned on:</p>
                <ol>
                    <li>Open <code>${sensors.FLAG_URL}</code> and set it to Enabled.</li>
                    <li>On Linux, also enable <code>chrome://flags/#enable-experimental-web-platform-features</code>.</li>
                    <li>Relaunch the browser, then connect each sensor once more.</li>
                </ol>
                <p>Until then, the Controllable and HRM buttons work as before.</p>
            </div>`}`;
    }

    async render_rides() {
        clearTimeout(this.ridesTimer);
        if(!this.$body.querySelector('.rm--table')) this.$body.innerHTML = '<p class="rm--empty">Loading rides…</p>';
        try {
            const [{activities}, c] = await Promise.all([api.get('/me/activities'), api.get('/me/connections')]);
            if(this.tab !== 'rides' || !this.$dialog.open) return;
            const linked = {strava: c.strava.connected, intervals: c.intervals.connected};
            const safeUrl = u => (typeof u === 'string' && /^https?:\/\//i.test(u) ? u : null);
            const cell = (a, service, label) => {
                const u = a.uploads?.[service];
                if(u?.status === 'done') {
                    const href = safeUrl(u.url);
                    return href ? `<a class="rm--sent" href="${esc(href)}" target="_blank" rel="noopener" title="${esc(u.error ?? 'Open')}">${label}</a>` :
                                  `<span class="rm--sent" title="${esc(u.error ?? '')}">${label}</span>`;
                }
                if(u && u.status !== 'failed') return `<span class="rm--up" data-status="${esc(u.status)}" title="${esc(u.error ?? '')}">${label}: ${esc(UPLOAD_LABEL[u.status] ?? u.status)}</span>`;
                if(!linked[service]) return '';
                return `<button type="button" class="btn rm--btn rm--quiet${u ? ' rm--danger' : ''}" data-act="send" data-service="${service}" data-id="${esc(a.id)}" title="${esc(u?.error ?? '')}">${u ? `${label}: retry` : `Send to ${label}`}</button>`;
            };
            const pending = activities.some(a => Object.values(a.uploads ?? {}).some(u => !['done', 'failed'].includes(u.status)));
            this.$body.innerHTML = activities.length === 0 ?
                '<p class="rm--empty">No rides on your account yet. Rides you save from now on are uploaded automatically.</p>' : `
                <p class="rm--lead">${activities.length} ride${activities.length === 1 ? '' : 's'} on your account, newest first.</p>
                <div class="rm--scroll"><table class="rm--table rm--rides">
                    <thead><tr><th>Date</th><th>Workout</th><th>Time</th><th>TSS</th><th>Sent to</th><th></th></tr></thead>
                    <tbody>${activities.map(a => `
                        <tr>
                            <td>${fmtDate(a.timestamp)}</td>
                            <td>${esc(a.name)}</td>
                            <td>${fmtDuration(a.duration)}</td>
                            <td>${Number.isFinite(a.stats?.tss) ? a.stats.tss : '--'}</td>
                            <td class="rm--sends">
                                ${cell(a, 'strava', 'Strava')}
                                ${cell(a, 'intervals', 'intervals.icu')}
                                <button type="button" class="btn rm--btn rm--quiet btn--quiet" data-act="garmin" data-id="${esc(a.id)}" title="Downloads the .fit and opens Garmin Connect's import page">Send to Garmin</button>
                            </td>
                            <td class="rm--right">
                                <button type="button" class="btn rm--btn rm--quiet btn--quiet" data-act="download" data-id="${esc(a.id)}">.fit</button>
                                <button type="button" class="btn rm--btn rm--quiet rm--danger btn--quiet btn--danger" data-act="delete-ride" data-id="${esc(a.id)}">Delete</button>
                            </td>
                        </tr>`).join('')}</tbody>
                </table></div>
                ${!linked.strava && !linked.intervals ? '<p class="rm--note">Connect Strava or intervals.icu under Account to send rides there automatically.</p>' : ''}`;
            if(pending) this.ridesTimer = setTimeout(() => { if(this.tab === 'rides' && this.$dialog.open) this.render_rides(); }, 3000);
        } catch(e) {
            this.$body.innerHTML = `<p class="rm--empty">${esc(e.message)}</p>`;
        }
    }

    async downloadRide(id) {
        const res = await api.raw(`/me/activities/${encodeURIComponent(id)}/fit`);
        const blob = await res.blob();
        const name = (res.headers.get('content-disposition') ?? '').match(/filename="([^"]+)"/)?.[1] ?? 'ride.fit';
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = name;
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(a.href), 1000);
        return name;
    }

    async render_users() {
        this.$body.innerHTML = '<p class="rm--empty">Loading users…</p>';
        try {
            const {users, signup} = await api.get('/users');
            if(this.tab !== 'users') return;
            const me = riders.current().account?.accountId;
            this.$body.innerHTML = `
                <p class="rm--lead">${users.length} account${users.length === 1 ? '' : 's'} on this server. Self sign-up is ${signup ? 'open (ALLOW_SIGNUP=true)' : 'closed; you create the accounts'}.</p>
                <div class="rm--scroll"><table class="rm--table">
                    <thead><tr><th>Rider</th><th>Role</th><th>Status</th><th></th></tr></thead>
                    <tbody>${users.map(u => `
                        <tr data-user="${esc(u.id)}">
                            <td><b>${esc(u.displayName)}</b><br><small>@${esc(u.username)}${u.id === me ? ' (you)' : ''}</small></td>
                            <td><select class="input" data-change="role" data-id="${esc(u.id)}" aria-label="Role of ${esc(u.username)}">
                                <option value="rider" ${u.role === 'rider' ? 'selected' : ''}>Rider</option>
                                <option value="admin" ${u.role === 'admin' ? 'selected' : ''}>Admin</option>
                            </select></td>
                            <td>${u.disabled ? '<span class="rm--tag badge rm--off">Disabled</span>' : '<span class="rm--tag badge">Active</span>'}</td>
                            <td class="rm--right">
                                <button type="button" class="btn rm--btn rm--quiet btn--quiet" data-act="reset" data-id="${esc(u.id)}">Reset password</button>
                                <button type="button" class="btn rm--btn rm--quiet btn--quiet" data-act="${u.disabled ? 'enable' : 'disable'}" data-id="${esc(u.id)}">${u.disabled ? 'Enable' : 'Disable'}</button>
                                ${u.id === me ? '' : `<button type="button" class="btn rm--btn rm--quiet rm--danger btn--quiet btn--danger" data-act="delete-user" data-id="${esc(u.id)}">Delete</button>`}
                            </td>
                        </tr>`).join('')}</tbody>
                </table></div>
                <h3 class="rm--h">Add a rider account</h3>
                <form class="rm--form rm--grid" data-form="add-user">
                    <label class="field">Username <input class="input" name="username" required pattern="[A-Za-z0-9][A-Za-z0-9._\\-]{1,31}"></label>
                    <label class="field">Display name <input class="input" name="displayName" maxlength="64"></label>
                    <label class="field">Temporary password <input class="input" name="password" type="text" minlength="8" required autocomplete="off"></label>
                    <label class="field">Role <select class="input" name="role"><option value="rider">Rider</option><option value="admin">Admin</option></select></label>
                    <button type="submit" class="btn rm--btn rm--primary btn--primary">Create account</button>
                </form>
                <p class="rm--note">Give the rider their username and temporary password; they can change it under Account.</p>`;
        } catch(e) {
            this.$body.innerHTML = `<p class="rm--empty">${esc(e.message)}</p>`;
        }
    }

    // two-step confirmation for destructive buttons
    confirmed(btn, label = 'Click again to confirm') {
        if(btn.dataset.armed === '1') return true;
        btn.dataset.armed = '1';
        btn.dataset.label = btn.textContent;
        btn.textContent = label;
        setTimeout(() => {
            if(btn.isConnected) { btn.dataset.armed = ''; btn.textContent = btn.dataset.label; }
        }, 4000);
        return false;
    }

    async onClick(e) {
        /** @type {HTMLElement|null} */
        const b = /** @type {Element} */ (e.target).closest('[data-act]');
        if(!b) return;
        const id = b.dataset.id;
        try {
            switch(b.dataset.act) {
            case 'switch':
                riders.switchTo(id);
                break;
            case 'rename': {
                const row = b.closest('.rm--row');
                const r = riders.find(id);
                row.querySelector('.rm--who').innerHTML =
                    `<form class="rm--inline" data-form="rename" data-id="${esc(id)}"><input class="input" name="name" maxlength="40" value="${esc(r.name)}" aria-label="Rider name" required><button type="submit" class="btn rm--btn">Save</button></form>`;
                row.querySelector('input').focus();
                break;
            }
            case 'remove':
                if(!this.confirmed(b, 'Delete their data?')) return;
                await riders.remove(id);
                this.say('Rider removed from this device.');
                this.render();
                break;
            case 'sync':
                await syncNow();
                this.render();
                break;
            case 'sync-garmin':
                await api.post('/me/garmin/sync', {});
                this.say('Garmin sync started. New health data and activities show up on the Training page in a minute.');
                setTimeout(() => syncNow().then(() => this.render()).catch(() => {}), 30 * 1000);
                break;
            case 'sync-intervals':
                await api.post('/me/intervals/sync', {});
                this.say('intervals.icu sync started. New rides and workouts show up on the Training page in a minute.');
                setTimeout(() => syncNow().then(() => this.render()).catch(() => {}), 30 * 1000);
                break;
            case 'signout': {
                const r = riders.current();
                try { await api.post('/auth/logout', {}); } catch(err) {}
                riders.unlinkAccount(r.id);
                this.say('Signed out. The rider and their data stay on this device.');
                this.render();
                break;
            }
            case 'forget-sensor':
                sensors.forget(id);
                break;
            case 'forget-all':
                if(!this.confirmed(b)) return;
                sensors.forgetAll();
                break;
            case 'reconnect':
                sensors.reconnectAll();
                this.say('Looking for your sensors…');
                break;
            case 'download':
                await this.downloadRide(id);
                break;
            case 'garmin': {
                // open the import page inside the click, then download the file
                window.open(GARMIN_IMPORT_URL, '_blank', 'noopener');
                const name = await this.downloadRide(id);
                this.say(`Downloaded ${name}. On Garmin's import page, choose that file.`);
                break;
            }
            case 'send':
                await api.post(`/me/activities/${encodeURIComponent(id)}/upload/${b.dataset.service}`, {});
                this.render_rides();
                break;
            case 'connect-strava': {
                const {url} = await api.post('/me/connections/strava/start', {});
                window.location.assign(url);
                break;
            }
            case 'disconnect':
                if(!this.confirmed(b, 'Disconnect?')) return;
                await api.delete(`/me/connections/${encodeURIComponent(id)}`);
                this.say(id === 'garmin' ? 'Garmin disconnected. The health data and activities already here stay.' :
                         `${id === 'strava' ? 'Strava' : 'intervals.icu'} disconnected. Rides already sent stay there.`);
                this.renderConnections();
                break;
            case 'copy-ai-key': {
                /** @type {HTMLInputElement} */
                const $k = this.$body.querySelector('[data-k="ai-key"]');
                try { await navigator.clipboard.writeText($k.value); this.say('Key copied.'); }
                catch(e) { $k.select(); this.say('Select the key and copy it.'); }
                break;
            }
            case 'revoke-ai':
                if(!this.confirmed(b, 'Remove access?')) return;
                await api.delete(`/me/tokens/${encodeURIComponent(id)}`);
                this.say('AI access removed. That app can no longer read your training.');
                this.renderAiAccess();
                break;
            case 'delete-ride':
                if(!this.confirmed(b, 'Delete ride?')) return;
                await api.delete(`/me/activities/${encodeURIComponent(id)}`);
                this.render();
                break;
            case 'reset': {
                const cell = b.closest('td');
                cell.innerHTML = `<form class="rm--inline" data-form="reset" data-id="${esc(id)}"><input class="input" name="password" minlength="8" required placeholder="New password" autocomplete="off" aria-label="New password"><button type="submit" class="btn rm--btn">Set</button></form>`;
                cell.querySelector('input').focus();
                break;
            }
            case 'disable':
            case 'enable':
                await api.patch(`/users/${encodeURIComponent(id)}`, {disabled: b.dataset.act === 'disable'});
                this.render();
                break;
            case 'delete-user':
                if(!this.confirmed(b, 'Delete account and rides?')) return;
                await api.delete(`/users/${encodeURIComponent(id)}`);
                this.say('Account deleted.');
                this.render();
                break;
            }
        } catch(err) {
            this.say(err.message, 'warn');
        }
    }

    async onChange(e) {
        const el = e.target;
        try {
            if(el.dataset.change === 'auto') sensors.setAuto(el.checked);
            if(el.dataset.change === 'auto-upload') {
                await api.patch(`/me/connections/${encodeURIComponent(el.dataset.service)}`, {autoUpload: el.checked});
                this.say(el.checked ? 'New rides will be sent automatically.' : 'New rides will not be sent automatically.');
            }
            if(el.dataset.change === 'role') {
                await api.patch(`/users/${encodeURIComponent(el.dataset.id)}`, {role: el.value});
                this.say('Role updated.');
                this.render();
            }
        } catch(err) {
            this.say(err.message, 'warn');
            this.render();
        }
    }

    async onSubmit(e) {
        /** @type {HTMLFormElement|null} */
        const form = /** @type {Element} */ (e.target).closest('form[data-form]');
        if(!form) return;
        e.preventDefault();
        const data = Object.fromEntries(new FormData(form).entries());
        /** @type {HTMLButtonElement|null} */
        const button = form.querySelector('[type="submit"]');
        if(button) button.disabled = true;
        try {
            switch(form.dataset.form) {
            case 'add-rider': {
                const r = riders.add(data.name);
                this.say(`${r.name} added. Switch to them to set their FTP and sensors.`);
                this.render();
                break;
            }
            case 'rename':
                riders.rename(form.dataset.id, data.name);
                this.render();
                break;
            case 'login':
            case 'register': {
                const path = form.dataset.form === 'login' ? '/auth/login' : '/auth/register';
                const res = await api.post(path, data, {token: null});
                this.signedIn(res);
                break;
            }
            case 'display-name': {
                const res = await api.patch('/me', {displayName: data.displayName});
                const r = riders.current();
                riders.rename(r.id, res.user.displayName);
                this.say('Display name saved.');
                this.render();
                break;
            }
            case 'password':
                await api.patch('/me', {currentPassword: data.currentPassword, newPassword: data.newPassword});
                this.say('Password changed. Other devices need to sign in again.');
                this.render();
                break;
            case 'add-user':
                await api.post('/users', {...data, displayName: data.displayName || undefined});
                this.say(`Account @${String(data.username).toLowerCase()} created.`);
                this.render();
                break;
            case 'garmin-key':
                await api.put('/me/connections/garmin', {apiKey: data.apiKey, ...(data.expiresOn ? {expiresOn: data.expiresOn} : {})});
                this.say('Garmin connected. Your health data and activities are on their way; the first sync takes a few minutes.');
                this.renderConnections();
                setTimeout(() => syncNow().then(() => this.render()).catch(() => {}), 60 * 1000);
                break;
            case 'intervals-key':
                await api.put('/me/connections/intervals', {apiKey: data.apiKey});
                this.say('intervals.icu connected. New rides upload automatically.');
                this.renderConnections();
                break;
            case 'ai-access': {
                const created = await api.post('/me/tokens', {name: data.name, scope: data.scope});
                await this.renderAiAccess(created);
                break;
            }
            case 'reset':
                await api.patch(`/users/${encodeURIComponent(form.dataset.id)}`, {password: data.password});
                this.say('Password reset. That rider is signed out everywhere.');
                this.render();
                break;
            }
        } catch(err) {
            this.say(err instanceof ApiError ? err.message : String(err.message ?? err), 'warn');
            if(button) button.disabled = false;
        }
    }

    // link the account to a rider on this device and start syncing
    signedIn({token, user}) {
        const account = {accountId: user.id, username: user.username, role: user.role, token, displayName: user.displayName};
        const existing = riders.riderForAccount(user.id);
        const current = riders.current();
        if(existing && existing.id !== current.id) {
            riders.linkAccount(existing.id, account);
            riders.switchTo(existing.id);
            return;
        }
        if(current.account && current.account.accountId !== user.id) {
            const r = riders.add(user.displayName);
            riders.linkAccount(r.id, account);
            riders.switchTo(r.id);
            return;
        }
        riders.linkAccount(current.id, account);
        this.server.needsSetup = false;
        this.say(`Signed in as @${user.username}. Syncing…`);
        this.render();
        syncNow().then(() => { if(this.tab === 'account') this.render(); });
    }

    disconnectedCallback() {
        this.abort?.abort();
        clearTimeout(this.ridesTimer);
    }
}

customElements.define('rider-menu', RiderMenu);

export { RiderMenu };
