const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { stageDist, readIndex } = require('../scripts/stage-dist.cjs');
const { releaseFile, integrity } = require('../scripts/release-files.cjs');

test('dist preserves prior versions and rejects replacement of the same version', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'semi-dist-test-'));
    function packed(version, content) {
        const dir = fs.mkdtempSync(path.join(root, 'source-'));
        const file = releaseFile('@example/plugin', version);
        const archive = path.join(dir, file);
        fs.mkdirSync(path.dirname(archive), { recursive: true });
        fs.writeFileSync(archive, content);
        const item = { id: '@example/plugin', version, file, integrity: integrity(archive) };
        fs.writeFileSync(path.join(dir, 'index.json'), JSON.stringify({ version: 1, packages: [item] }));
        return dir;
    }
    try {
        const dist = path.join(root, 'dist');
        const first = packed('1.0.0', 'first package bytes');
        stageDist(first, dist);
        stageDist(packed('1.1.0', 'second package bytes'), dist);
        stageDist(first, dist);
        const index = path.join(dist, 'index.json');
        const entries = readIndex(index);
        assert.deepEqual(entries.map(entry => entry.version), ['1.0.0', '1.1.0']);
        assert.equal(fs.readFileSync(path.join(dist, entries[0].file), 'utf8'), 'first package bytes');
        assert.throws(() => stageDist(packed('1.0.0', 'modified bytes'), dist), /cannot be replaced/);
        assert.deepEqual(readIndex(index), entries);
    } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
