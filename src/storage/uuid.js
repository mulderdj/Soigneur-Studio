// @ts-check

/**
 * Generate an RFC 4122 version 4 UUID string.
 * Uses `crypto.randomUUID()` when available (HTTPS / localhost), falling back
 * to `crypto.getRandomValues()` on plain HTTP contexts, and finally a math PRNG
 * fallback if Web Crypto is unavailable.
 * @returns {string}
 */
function uuid() {
    const webCrypto = globalThis.crypto;
    if (typeof webCrypto?.randomUUID === 'function') {
        return webCrypto.randomUUID();
    }

    const bytes = new Uint8Array(16);
    if (typeof webCrypto?.getRandomValues === 'function') {
        webCrypto.getRandomValues(bytes);
    } else {
        for (let i = 0; i < 16; i++) {
            bytes[i] = (Math.random() * 256) >>> 0;
        }
    }

    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;

    const hex = Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export { uuid };
