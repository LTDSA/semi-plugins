const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { startBackend } = require('../packages/miplay/host/sdk-backend.cjs');

test('SDK backend validates the bound account and releases private handlers', async () => {
    let allowed = true;
    const handlers = new Map();
    const api = {
        getBackgroundInfo: async () => ({ plugin: { id: '@semi-app/miplay' }, target: { accountId: 'test' }, development: false }),
        getProviderState: async () => ({ defaultAccountId: 'test', accounts: allowed ? [{ id: 'test', userId: '123' }] : [] }),
        handleBackgroundCall: (name, handler) => { handlers.set(name, handler); return () => handlers.delete(name); },
        onEvent: () => () => {},
        emitBackgroundEvent: async () => {},
        callService: () => assert.fail('skipCloud must stay local'),
    };
    const backend = await startBackend(api);
    const read = () => handlers.get('mina.getSpeakers')({ skipCloud: true }, { signal: AbortSignal.timeout(1000) });
    assert.match((await read()).accountId, /^[a-f0-9]{64}$/);
    allowed = false;
    await assert.rejects(read(), { code: 'AUTH_REQUIRED' });
    backend.dispose();
    assert.equal(handlers.size, 0);
});

test('build contains loadable background, both views and PlayFair sources', () => {
    const root = path.join(__dirname, '../packages/miplay/dist');
    assert.equal(typeof require(path.join(root, 'background/main.cjs')), 'function');
    for (const entry of ['index.html', 'tray.html']) {
        const html = fs.readFileSync(path.join(root, entry), 'utf8');
        for (const match of html.matchAll(/(?:href|src)="(\.\/assets\/[^"]+)"/g)) {
            assert(fs.statSync(path.join(root, match[1])).isFile());
        }
    }
    const playfair = path.join(root, 'background');
    assert(WebAssembly.validate(fs.readFileSync(path.join(playfair, 'playfair.wasm'))));
    assert(fs.statSync(path.join(playfair, 'vendor/playfair/LICENSE.md')).isFile());
    assert(fs.statSync(path.join(playfair, 'vendor/playfair/wasm-wrapper.c')).isFile());
});
