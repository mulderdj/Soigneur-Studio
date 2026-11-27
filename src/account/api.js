// @ts-check
//
// Client for the self-hosted account server (server/app.js), served on the
// same origin under /api.
//

import { riders } from '../riders.js';

class ApiError extends Error {
    constructor(status, message, reason = null) {
        super(message);
        this.status = status;
        this.reason = reason;      // the server's machine-readable reason, where it gives one
    }
}

let availability; // Promise<{available, needsSetup, signup}> or {available: false, offline: true}

// is an account server behind /api? (no server -> 404/502 from the static host)
function probe(force = false) {
    if(availability && !force) return availability;
    availability = (async () => {
        if(navigator.onLine === false) return {available: false, offline: true};
        try {
            const res = await fetch('/api/setup', {headers: {Accept: 'application/json'}});
            if(!res.ok || !String(res.headers.get('content-type')).includes('json')) return {available: false};
            const s = await res.json();
            return {available: true, needsSetup: !!s.needsSetup, signup: !!s.signup};
        } catch(e) {
            return {available: false, offline: true};   // no answer at all: not reachable now, not "no server"
        }
    })();
    // an unreachable server is asked again next time
    availability.then(s => { if(s.offline) availability = null; });
    return availability;
}

function tokenOf(rider = riders.current()) {
    return rider?.account?.token;
}

/**
 * @param {string} method
 * @param {string} path
 * @param {{body?: any, token?: string, raw?: boolean}} [opts]
 */
async function request(method, path, {body, token = tokenOf(), raw = false} = {}) {
    let res;
    try {
        res = await fetch(`/api${path}`, {
            method,
            headers: {
                Accept: 'application/json',
                ...(body !== undefined ? {'Content-Type': 'application/json'} : {}),
                ...(token ? {Authorization: `Bearer ${token}`} : {}),
            },
            body: body !== undefined ? JSON.stringify(body) : undefined,
        });
    } catch(e) {
        throw new ApiError(0, 'The account server cannot be reached.');
    }
    if(raw && res.ok) return res;
    let data = null;
    try { data = await res.json(); } catch(e) {}
    if(!res.ok) {
        if(res.status === 401 && token) {
            window.dispatchEvent(new CustomEvent('account:signed-out', {detail: {data: data?.error}}));
        }
        throw new ApiError(res.status, data?.error ?? `Request failed (${res.status}).`, data?.reason ?? null);
    }
    return data;
}

const api = {
    probe,
    get:    (path, opts) => request('GET', path, opts),
    post:   (path, body, opts = {}) => request('POST', path, {...opts, body}),
    put:    (path, body, opts = {}) => request('PUT', path, {...opts, body}),
    patch:  (path, body, opts = {}) => request('PATCH', path, {...opts, body}),
    delete: (path, opts) => request('DELETE', path, opts),
    raw:    (path, opts = {}) => request('GET', path, {...opts, raw: true}),
};

export { api, ApiError };
