const { inflateSync } = require('fflate');
module.exports = { inflateRawSync(data, { maxOutputLength } = {}) {
    // ZIP metadata bounds allocation before decompression; reject dishonest output lengths too.
    const result = inflateSync(data, { out: new Uint8Array(maxOutputLength) }); if (result.length > maxOutputLength) throw new Error('解压内容过大'); return Buffer.from(result);
} };
