// @ts-check
import { LocalStorageItem } from './local-storage.js';
import { idb, createIdbManager, DEFAULT_STORES } from './idb.js';
import { uuid } from './uuid.js';

const storage = Object.freeze({
    LocalStorageItem,
    idb,
    uuid,
});

export { storage, LocalStorageItem, idb, createIdbManager, DEFAULT_STORES, uuid };
