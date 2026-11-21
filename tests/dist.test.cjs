const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { stageDist, readIndex } = require('../scripts/stage-dist.cjs');
const { releaseFile, integrity } = require('../scripts/release-files.cjs');
const { planRelease } = require('../scripts/plan-release.cjs');

test('release planning skips archived versions, packs new ones, and can retry publication', () => {
    const name = '@semi-app/miplay';
    const current = [{ name, version: '1.0.0', description: 'Edited metadata' }, { name: '@semi-app/other', version: '2.0.0' }];
    const archived = [{ id: name, version: '1.0.0' }, { id: '@semi-app/other', version: '2.0.0' }];
    assert.deepEqual(planRelease(current, archived), { pack: [], publish: [] });
    assert.deepEqual(planRelease(current, archived, true), { pack: [], publish: [name, '@semi-app/other'] });
    current[0].version = '1.0.1';
    assert.deepEqual(planRelease(current, archived), { pack: [name], publish: [name] });
    assert.deepEqual(planRelease(current, []), { pack: [name, '@semi-app/other'], publish: [name, '@semi-app/other'] });
});

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

test('dist migrates existing package filenames without replacing the bytes', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'semi-dist-migration-'));
    try {
        const dist = path.join(root, 'dist');
        const source = path.join(root, 'packed');
        const previous = 'packages/miplay/1.0.0.tgz';
        const next = releaseFile('miplay', '1.0.0');
        assert.equal(next, 'tgz/miplay-1.0.0.tgz');
        const oldPath = path.join(dist, previous);
        fs.mkdirSync(path.dirname(oldPath), { recursive: true });
        fs.writeFileSync(oldPath, 'first release');
        const checksum = integrity(oldPath);
        const plugin = { id: 'miplay', version: '1.0.0', icon: 'music', integrity: checksum };
        const index = path.join(dist, 'index.json');
        fs.writeFileSync(index, JSON.stringify({ version: 1, packages: [{ ...plugin, file: previous }] }));
        const packed = path.join(source, next);
        fs.mkdirSync(path.dirname(packed), { recursive: true });
        fs.copyFileSync(oldPath, packed);
        fs.writeFileSync(path.join(source, 'index.json'), JSON.stringify({ version: 1, packages: [{ ...plugin, file: next }] }));
        stageDist(source, dist);
        assert(!fs.existsSync(oldPath));
        assert.equal(integrity(path.join(dist, next)), checksum);
        assert.deepEqual(readIndex(index), [{ ...plugin, file: next }]);
        stageDist(source, dist);
        assert.deepEqual(readIndex(index), [{ ...plugin, file: next }]);
    } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('dist replaces retired unscoped releases with the scoped package at its short filename', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'semi-dist-scope-'));
    try {
        const dist = path.join(root, 'dist');
        const source = path.join(root, 'packed');
        const filename = 'tgz/miplay-1.0.0.tgz';
        assert.equal(releaseFile('@semi-app/miplay', '1.0.0'), filename);
        function fixture(dir, id, bytes) {
            const output = path.join(dir, filename);
            fs.mkdirSync(path.dirname(output), { recursive: true });
            fs.writeFileSync(output, bytes);
            fs.writeFileSync(path.join(dir, 'index.json'), JSON.stringify({
                version: 1, packages: [{ id, version: '1.0.0', file: filename, integrity: integrity(output) }],
            }));
        }
        fixture(dist, 'miplay', 'unscoped bytes');
        fixture(source, '@semi-app/miplay', 'scoped bytes');
        stageDist(source, dist);
        const index = path.join(dist, 'index.json');
        const entries = readIndex(index);
        assert.equal(entries.find(item => item.id === '@semi-app/miplay').file, filename);
        assert.deepEqual(entries.map(item => item.id), ['@semi-app/miplay']);
        assert(!fs.existsSync(path.join(dist, 'archive/unscoped/miplay-1.0.0.tgz')));
        assert.equal(fs.readFileSync(path.join(dist, filename), 'utf8'), 'scoped bytes');
        stageDist(source, dist);
        assert.deepEqual(readIndex(index), entries);
    } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
