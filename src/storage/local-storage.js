// @ts-check
import { equals, exists, existance } from '../functions.js';
import { riders } from '../riders.js';

/**
 * Rider-scoped localStorage item wrapper with validation and serialization.
 * @param {{
 *   key?: string,
 *   fallback?: any,
 *   isValid?: (val: any) => boolean,
 *   parse?: (raw: string) => any,
 *   encode?: (val: any) => string,
 * }} [options]
 */
function LocalStorageItem(options = {}) {
    const key = options.key;
    if (!exists(key)) {
        throw new Error('LocalStorageItem requires a storage key');
    }

    const fallback = existance(options.fallback, '');
    const isValid = existance(options.isValid, val => exists(val));
    const parse = existance(options.parse, raw => raw);
    const encode = existance(options.encode, val => String(val));

    function scopedKey() {
        return riders.key(key);
    }

    function storage() {
        return typeof window !== 'undefined' ? window.localStorage : globalThis.localStorage;
    }

    function get() {
        const raw = storage().getItem(scopedKey());
        if (!exists(raw)) {
            return fallback;
        }
        return parse(raw);
    }

    function set(value) {
        if (isValid(value)) {
            storage().setItem(scopedKey(), encode(value));
            return value;
        }
        storage().setItem(scopedKey(), encode(fallback));
        return fallback;
    }

    function restore() {
        const current = get();
        if (equals(current, fallback)) {
            set(fallback);
        }
        return get();
    }

    function remove() {
        storage().removeItem(scopedKey());
    }

    return Object.freeze({
        restore,
        get,
        set,
        remove,
    });
}

export { LocalStorageItem };
