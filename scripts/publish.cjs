const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { packages, releaseFile, integrity } = require('./release-files.cjs');
const { readIndex } = require('./stage-dist.cjs');
const semver = require('semver');
const { generateIconPreviews } = require('./icon-previews.cjs');
const registry = 'https://registry.npmjs.org';
const [dist, output, previews] = process.argv.slice(2);

async function versionOnNpm(id, version) {
    const reply = await fetch(`${registry}/${encodeURIComponent(id)}/${version}`, {
        headers: { accept: 'application/json' }, redirect: 'error', signal: AbortSignal.timeout(15000),
    });
    if (reply.status === 404) return null;
    if (!reply.ok) throw new Error(`npm lookup: HTTP ${reply.status}`);
    return reply.json();
}

async function main() {
    if (!dist || !output || !previews) throw new Error('Usage: publish.cjs <dist-checkout> <published-json> <preview-directory>');
    const entries = new Map(readIndex(path.join(dist, 'index.json')).map(entry => [entry.file, entry]));
    const published = [];
    for (const { pkg } of packages()) {
        const file = releaseFile(pkg.name, pkg.version);
        const entry = entries.get(file);
        if (entry?.id !== pkg.name || entry.version !== pkg.version) throw new Error(`Missing dist entry: ${file}`);
        const { file: _file, ...plugin } = entry;
        const archive = path.resolve(dist, file);
        if (integrity(archive) !== plugin.integrity) throw new Error(`Dist integrity mismatch: ${file}`);
        let metadata = await versionOnNpm(plugin.id, plugin.version);
        if (!metadata) {
            execFileSync('npm', ['publish', archive, '--ignore-scripts', '--access', 'public',
                '--registry', registry, '--tag', semver.prerelease(plugin.version) ? 'next' : 'latest'], { stdio: 'inherit' });
            for (let attempt = 0; attempt < 12 && !metadata; attempt++) {
                if (attempt) await new Promise(resolve => setTimeout(resolve, 5000));
                metadata = await versionOnNpm(plugin.id, plugin.version);
            }
        }
        if (metadata?.name !== plugin.id || metadata.version !== plugin.version || metadata.dist?.integrity !== plugin.integrity
            || new URL(metadata.dist.tarball).origin !== registry) {
            throw new Error(`Public npm version does not match the artifact: ${plugin.id}@${plugin.version}`);
        }
        if (!semver.prerelease(plugin.version)) published.push({ ...plugin, ...await generateIconPreviews(archive, previews, plugin.id) });
    }
    fs.writeFileSync(output, JSON.stringify(published, null, 2) + '\n');
}

main().catch(error => { console.error(error.message); process.exitCode = 1; });
