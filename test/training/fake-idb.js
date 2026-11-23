// fake-indexeddb clones values with structuredClone, which Jest's jsdom
// environment doesn't provide; a pass-through clone is enough for tests
if(typeof globalThis.structuredClone !== 'function') {
    globalThis.structuredClone = (value) => value;
}
require('fake-indexeddb/auto');
