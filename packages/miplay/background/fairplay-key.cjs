const fs = require('fs');
const path = require('path');
let engine;
function invalid() { return Object.assign(new Error('Invalid FairPlay audio key'), { code: 'INVALID_FAIRPLAY_KEY' }); }
exports.unwrapFairplayKey = function unwrapFairplayKey(message, wrapped) {
    if (!Buffer.isBuffer(message) || message.length !== 164 || message.subarray(0, 4).toString() !== 'FPLY'
        || message[4] !== 3 || message[5] !== 1 || message[6] !== 3 || message[12] > 3
        || !Buffer.isBuffer(wrapped) || wrapped.length !== 72 || wrapped.subarray(0, 4).toString() !== 'FPLY') throw invalid();
    if (!engine) {
        const module = new WebAssembly.Module(fs.readFileSync(path.join(__dirname, 'playfair.wasm')));
        if (WebAssembly.Module.imports(module).length) throw new Error('FairPlay module must not import host capabilities');
        engine = new WebAssembly.Instance(module).exports;
        engine._initialize?.();
    }
    const memory = new Uint8Array(engine.memory.buffer);
    try {
        memory.set(message, engine.key_message_buffer());
        memory.set(wrapped, engine.wrapped_key_buffer());
        if (engine.unwrap_key() !== 0) throw invalid();
        const start = engine.plain_key_buffer();
        return Buffer.from(memory.subarray(start, start + 16));
    } finally { engine.wipe_key_buffers(); }
};
