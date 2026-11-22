const CryptoJS = require('crypto-js');
module.exports = {
    randomUUID: () => globalThis.crypto.randomUUID(),
    randomBytes(size) { return Buffer.from(globalThis.crypto.getRandomValues(new Uint8Array(size))); },
    createHash(algorithm) {
        const hash = ({ sha256: CryptoJS.algo.SHA256, md5: CryptoJS.algo.MD5 })[algorithm]?.create();
        if (!hash) throw new Error('不支持的摘要算法');
        return { update(value) { hash.update(typeof value === 'string' ? value : CryptoJS.lib.WordArray.create(new Uint8Array(value))); return this; }, digest(encoding) { const result = hash.finalize().toString(CryptoJS.enc.Hex); return encoding === 'hex' ? result : Buffer.from(result, 'hex'); } };
    },
};
