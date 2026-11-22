//
// Client for the self-hosted account server (server/app.js), served on the
// same origin under /api.
//

import { riders } from '../riders.js';

class ApiError extends Error {
    constructor(status, message) {
        super(message);
        this.status = status;
    }
}

let availability; // Promise<{available, needsSetup, signup}>

// is an account server behind /api? (no server -> 404/502 from the static host)
function probe(force = false) {
    if(availability && !force) return availability;
    availability = (async () => {
        try {
            const res = await fetch('/api/setup', {headers: {Accept: 'application/json'}});
            if(!res.ok || !String(res.headers.get('content-type')).includes('json')) return {available: false};
            const s = await res.json();
            return {available: true, needsSetup: !!s.needsSetup, signup: !!s.signup};
        } catch(e) {
            return {available: false};
        }
    })();
    return availability;
}

function tokenOf(rider = riders.current()) {
    return rider?.account?.token;
}

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
        throw new ApiError(res.status, data?.error ?? `Request failed (${res.status}).`);
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
