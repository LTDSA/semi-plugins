const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { integrity, releaseFile } = require('../scripts/release-files.cjs');
const { publishRelease, publishSelection } = require('../scripts/publish.cjs');

const plugin = { id: '@semi-app/miplay', version: '1.0.1', integrity: 'expected' };
const metadata = {
    name: plugin.id,
    version: plugin.version,
    dist: { integrity: plugin.integrity, tarball: 'https://registry.npmjs.org/@semi-app/miplay/-/miplay-1.0.1.tgz' },
};

test('a successful npm publish completes without querying public metadata again', async () => {
    const calls = [];
    await publishRelease(plugin, 'archive.tgz', {
        async lookup(id, version) { calls.push(['lookup', id, version]); return null; },
        async publish(archive, value) { calls.push(['publish', archive, value.id]); },
    });
    assert.deepEqual(calls, [['lookup', plugin.id, plugin.version], ['publish', 'archive.tgz', plugin.id]]);
});

test('publication can be retried for an already published archive without submitting it again', async () => {
    const publish = () => assert.fail('The immutable archive must not be published again');
    await publishRelease(plugin, 'archive.tgz', { lookup: async () => metadata, publish });
    await assert.rejects(publishRelease(plugin, 'archive.tgz', {
        lookup: async () => ({ ...metadata, dist: { ...metadata.dist, integrity: 'different' } }),
        publish,
    }), /integrity does not match/);
});

test('a failed npm publish is reported without running a public metadata check afterwards', async () => {
    let lookups = 0;
    await assert.rejects(publishRelease(plugin, 'archive.tgz', {
        async lookup() { lookups++; return null; },
        async publish() { throw new Error('npm rejected the upload'); },
    }), /npm rejected the upload/);
    assert.equal(lookups, 1);
});

test('a package failure does not prevent the next archive from being verified for the catalog', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'semi-publish-test-'));
    try {
        const entries = new Map();
        const selection = [
            { pkg: { name: '@semi-app/miplay', version: '1.0.1' } },
            { pkg: { name: '@semi-app/smarthome', version: '1.0.2' } },
        ];
        for (const { pkg } of selection) {
            const file = releaseFile(pkg.name, pkg.version);
            const archive = path.join(root, file);
            fs.mkdirSync(path.dirname(archive), { recursive: true });
            fs.writeFileSync(archive, pkg.name);
            entries.set(file, { id: pkg.name, version: pkg.version, file, integrity: integrity(archive) });
        }
        const attempted = [];
        const result = await publishSelection(selection, entries, root, root, {
            async release(entry) {
                attempted.push(entry.id);
                if (entry.id === '@semi-app/miplay') throw new Error('version not visible');
            },
            async generate(_archive, _directory, id) {
                assert.equal(id, '@semi-app/smarthome');
                return { color: 'green' };
            },
        });
        assert.deepEqual(attempted, selection.map(({ pkg }) => pkg.name));
        assert.deepEqual(result.failures, ['@semi-app/miplay@1.0.1: version not visible']);
        assert.deepEqual(result.published.map(({ id, color }) => ({ id, color })), [{ id: '@semi-app/smarthome', color: 'green' }]);
    } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
