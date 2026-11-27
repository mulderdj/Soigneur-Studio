// @ts-check
//
// Riders on this device
//
// Each rider gets their own settings (localStorage keys) and their own
// workouts, rides and session (an IndexedDB database). The first rider,
// "default", uses Auuki's original keys, so existing data stays where it is.
//
// A rider can be linked to an account on the self-hosted account server; the
// link (account id, username and session token) lives in the registry below.
// Switching riders reloads the page so every model starts from that rider's
// data.
//

import { isValidAvatar } from './avatar.js';

const REGISTRY_KEY = 'auuki:riders';
const DEFAULT_ID = 'default';

function uuid() {
    if(globalThis.crypto?.randomUUID) return crypto.randomUUID();
    return 'r' + Math.random().toString(36).slice(2) + Date.now().toString(36);
}

function readRegistry() {
    try {
        const reg = JSON.parse(localStorage.getItem(REGISTRY_KEY));
        if(reg && Array.isArray(reg.riders) && reg.riders.length > 0) {
            if(!reg.riders.some(r => r.id === reg.current)) reg.current = reg.riders[0].id;
            return reg;
        }
    } catch(e) {}
    return {current: DEFAULT_ID, riders: [{id: DEFAULT_ID, name: 'Rider 1'}]};
}

let registry = readRegistry();

function writeRegistry() {
    try { localStorage.setItem(REGISTRY_KEY, JSON.stringify(registry)); } catch(e) {}
    window.dispatchEvent(new CustomEvent('riders:changed', {detail: {data: registry}}));
}

function current() {
    return registry.riders.find(r => r.id === registry.current) ?? registry.riders[0];
}

function find(id) {
    return registry.riders.find(r => r.id === id);
}

function list() {
    return registry.riders.map(r => ({...r, current: r.id === registry.current}));
}

// localStorage key for the current rider
function key(k) {
    const id = current().id;
    return id === DEFAULT_ID ? k : `rider:${id}:${k}`;
}

// IndexedDB database name for the current rider
function dbName(name) {
    const id = current().id;
    return id === DEFAULT_ID ? name : `${name}@${id}`;
}

function cleanName(name, fallback) {
    const s = String(name ?? '').trim().slice(0, 40);
    return s || fallback;
}

function add(name) {
    const rider = {id: uuid(), name: cleanName(name, `Rider ${registry.riders.length + 1}`)};
    registry.riders.push(rider);
    writeRegistry();
    return rider;
}

function rename(id, name) {
    const r = find(id);
    if(!r) return;
    r.name = cleanName(name, r.name);
    writeRegistry();
}

function setAvatar(id, avatar) {
    const r = find(id);
    if(!r) return;
    if(avatar === null || avatar === undefined || avatar === '') {
        if(!('avatar' in r)) return;
        delete r.avatar;
    } else {
        if(!isValidAvatar(avatar)) throw new Error('Invalid avatar.');
        if(r.avatar === avatar) return;
        r.avatar = avatar;
    }
    writeRegistry();
}

// removes the rider and everything stored for them on this device
async function remove(id) {
    if(id === DEFAULT_ID || id === registry.current) {
        throw new Error('Switch to another rider before removing this one.');
    }
    const r = find(id);
    if(!r) return;
    registry.riders = registry.riders.filter(x => x.id !== id);
    writeRegistry();

    const prefix = `rider:${id}:`;
    for(let i = localStorage.length - 1; i >= 0; i--) {
        const k = localStorage.key(i);
        if(k && k.startsWith(prefix)) localStorage.removeItem(k);
    }
    try { indexedDB.deleteDatabase(`store@${id}`); } catch(e) {}
}

function switchTo(id) {
    if(!find(id) || id === registry.current) return;
    registry.current = id;
    writeRegistry();
    window.location.reload();
}

// account link: {accountId, username, role, token}
function linkAccount(id, account) {
    const r = find(id);
    if(!r) return;
    r.account = {
        accountId: account.accountId,
        username: account.username,
        role: account.role,
        token: account.token,
    };
    if(account.displayName) r.name = cleanName(account.displayName, r.name);
    writeRegistry();
}

function updateAccount(id, patch) {
    const r = find(id);
    if(!r || !r.account) return;
    Object.assign(r.account, patch);
    writeRegistry();
}

function unlinkAccount(id) {
    const r = find(id);
    if(!r) return;
    delete r.account;
    writeRegistry();
}

function riderForAccount(accountId) {
    return registry.riders.find(r => r.account?.accountId === accountId);
}

const riders = {
    DEFAULT_ID,
    current,
    find,
    list,
    key,
    dbName,
    add,
    rename,
    setAvatar,
    remove,
    switchTo,
    linkAccount,
    updateAccount,
    unlinkAccount,
    riderForAccount,
};

export { riders };
