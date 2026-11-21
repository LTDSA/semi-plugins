const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawnSync } = require('child_process');
const root = __dirname;
const directory = path.join(root, 'background/vendor/playfair');
const cache = fs.mkdtempSync(path.join(os.tmpdir(), 'semi-playfair-build-'));
try {
    const sources = ['playfair.c', 'omg_hax.c', 'modified_md5.c', 'sap_hash.c', 'hand_garble.c', 'wasm-wrapper.c'];
    const exports = ['key_message_buffer', 'wrapped_key_buffer', 'plain_key_buffer', 'unwrap_key', 'wipe_key_buffers'];
    const args = ['cc', '-target', 'wasm32-wasi', '-mexec-model=reactor', '-O2', '-fwrapv', '-fno-strict-aliasing', '-DNDEBUG',
        ...sources.map(name => path.join(directory, name)), ...exports.map(name => `-Wl,--export=${name}`),
        '-Wl,-z,stack-size=65536', '-Wl,--initial-memory=1048576', '-Wl,--max-memory=1048576', '-Wl,--strip-all', '-o', path.join(root, 'background/playfair.wasm')];
    const result = spawnSync(process.env.SEMI_ZIG || 'zig', args, { stdio: 'inherit', shell: false,
        env: { ...process.env, ZIG_GLOBAL_CACHE_DIR: path.join(cache, 'global'), ZIG_LOCAL_CACHE_DIR: path.join(cache, 'local') } });
    if (result.error || result.status !== 0) throw new Error('FairPlay WASM 构建失败；请使用 Zig 0.14.1，或通过 SEMI_ZIG 指定编译器。');
} finally { fs.rmSync(cache, { recursive: true, force: true }); }
