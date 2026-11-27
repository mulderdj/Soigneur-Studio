// @ts-check
import { exists, existance, empty } from '../functions.js';
import { uuid } from './uuid.js';

const DEFAULT_STORES = [
    'session',
    'workouts',
    'activity',
    'rideSummaries',
    'plan',
    'externalRides',
    'hiddenRides',
    'wellness',
    'rideRatings',
];

function wrapRequest(request) {
    return new Promise((resolve, reject) => {
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
    });
}

function getIndexedDB() {
    if (typeof window !== 'undefined' && window.indexedDB) {
        return window.indexedDB;
    }
    return globalThis.indexedDB;
}

function createIdbManager() {
    /** @type {IDBDatabase | undefined} */
    let database;

    function attachConnection(conn) {
        database = conn;
        database.onversionchange = () => database?.close();
    }

    function createStore(name, keyPath = 'id') {
        if (!database) return;
        if (!database.objectStoreNames.contains(name)) {
            database.createObjectStore(name, { keyPath });
        }
    }

    function ensureStores(storeNames, keyPaths = []) {
        storeNames.forEach((storeName, idx) => {
            createStore(storeName, existance(keyPaths[idx], 'id'));
        });
    }

    function open(name, version = 6, storeNames = DEFAULT_STORES) {
        const factory = getIndexedDB();
        const request = factory.open(name, version);

        return new Promise((resolve, reject) => {
            request.onupgradeneeded = () => {
                attachConnection(request.result);
                ensureStores(storeNames);
            };
            request.onerror = () => reject(request.error);
            request.onsuccess = () => {
                attachConnection(request.result);
                resolve(request.result);
            };
        });
    }

    async function start(name = '', version = 6, stores = DEFAULT_STORES) {
        if (!exists(name) || empty(name)) {
            throw new Error('idb.start requires a non-empty database name');
        }
        await open(name, version, stores);
    }

    function deleteStore(name) {
        if (!database) return Promise.resolve({});
        try {
            database.deleteObjectStore(name);
            return Promise.resolve({});
        } catch {
            return Promise.resolve({});
        }
    }

    function runStoreOp(storeName, method, arg = undefined, mode = /** @type {IDBTransactionMode} */ ('readonly')) {
        if (!database || !database.objectStoreNames.contains(storeName)) {
            return undefined;
        }

        const tx = database.transaction(storeName, mode);
        const store = tx.objectStore(storeName);
        const req = arg === undefined ? store[method]() : store[method](arg);

        return wrapRequest(req).catch(() => []);
    }

    function add(storeName, item) {
        return runStoreOp(storeName, 'add', item, 'readwrite');
    }

    function put(storeName, item) {
        return runStoreOp(storeName, 'put', item, 'readwrite');
    }

    function get(storeName, key) {
        return runStoreOp(storeName, 'get', key, 'readonly');
    }

    function getAll(storeName) {
        return runStoreOp(storeName, 'getAll', undefined, 'readonly');
    }

    function remove(storeName, key) {
        return runStoreOp(storeName, 'delete', key, 'readwrite');
    }

    function clear(storeName) {
        return runStoreOp(storeName, 'clear', undefined, 'readwrite');
    }

    function setId(item, explicitId = undefined) {
        if (!exists(item.id)) {
            item.id = exists(explicitId) ? explicitId : uuid();
        }
        return item;
    }

    return Object.freeze({
        start,
        open,
        createStore,
        deleteStore,
        add,
        put,
        get,
        getAll,
        remove,
        clear,
        setId,
    });
}

const idb = createIdbManager();

export { idb, createIdbManager, DEFAULT_STORES };
