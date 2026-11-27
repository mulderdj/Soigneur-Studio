// @ts-check
import { equals, isString } from '../functions.js';
import { uuid } from '../storage/uuid.js';

const DialogMsg = Object.freeze({
    noAuth: ':no-auth',
});

const OAuthService = Object.freeze({
    strava: 'strava',
    intervals: 'intervals',
    trainingPeaks: 'trainingPeaks',
});

function StateParam() {
    const storageKey = 'oauth-state';

    function getSessionStorage() {
        return typeof sessionStorage !== 'undefined' ? sessionStorage : undefined;
    }

    function encode(serviceName) {
        return `${serviceName}_${uuid()}`;
    }

    function decode(param) {
        if (!isString(param)) {
            return { service: '', id: '' };
        }
        const [service = '', id = ''] = param.split('_');
        return { service, id };
    }

    function store(state) {
        if (!isString(state)) return;
        getSessionStorage()?.setItem(storageKey, state);
    }

    function restore() {
        const saved = getSessionStorage()?.getItem(storageKey);
        return isString(saved) ? saved : '';
    }

    function consume(state) {
        const saved = restore();
        const matches = !equals(saved, '') && equals(saved, state);
        if (matches) {
            getSessionStorage()?.removeItem(storageKey);
        }
        return matches;
    }

    return Object.freeze({
        encode,
        decode,
        store,
        restore,
        consume,
    });
}

const stateParam = StateParam();

export {
    OAuthService,
    DialogMsg,
    StateParam,
    stateParam,
};
