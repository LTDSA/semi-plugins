const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const semver = require('semver');
const { packages, releaseFile, integrity } = require('./release-files.cjs');
const { readIndex } = require('./stage-dist.cjs');
const { generateIconPreviews } = require('./icon-previews.cjs');

const registry = 'https://registry.npmjs.org';

async function versionOnNpm(id, version) {
    const reply = await fetch(`${registry}/${encodeURIComponent(id)}/${version}`, {
        headers: { accept: 'application/json' },
        cache: 'no-store',
        redirect: 'error',
        signal: AbortSignal.timeout(15000),
    });
    if (reply.status === 404) return null;
    if (!reply.ok) throw new Error(`npm lookup: HTTP ${reply.status}`);
    return reply.json();
}

function publishArchive(archive, plugin) {
    execFileSync('npm', ['publish', archive, '--ignore-scripts', '--access', 'public',
        '--registry', registry, '--tag', semver.prerelease(plugin.version) ? 'next' : 'latest'], { stdio: 'inherit' });
}

async function publishRelease(plugin, archive, { lookup = versionOnNpm, publish = publishArchive } = {}) {
    const metadata = await lookup(plugin.id, plugin.version);
    if (!metadata) {
        await publish(archive, plugin);
        return;
    }
    const spec = `${plugin.id}@${plugin.version}`;
    if (metadata.name !== plugin.id || metadata.version !== plugin.version) {
        throw new Error(`Public npm identity does not match: ${spec}`);
    }
    if (metadata.dist?.integrity !== plugin.integrity) {
        throw new Error(`Public npm integrity does not match the archive: ${spec}`);
    }
    if (new URL(metadata.dist.tarball).origin !== registry) {
        throw new Error(`Public npm tarball has an unexpected origin: ${spec}`);
    }
}

async function publishSelection(selection, entries, dist, previews, {
    release = publishRelease, generate = generateIconPreviews,
} = {}) {
    const published = [];
    const failures = [];
    for (const { pkg } of selection) {
        const spec = `${pkg.name}@${pkg.version}`;
        try {
            const file = releaseFile(pkg.name, pkg.version);
            const entry = entries.get(file);
            if (entry?.id !== pkg.name || entry.version !== pkg.version) throw new Error(`Missing dist entry: ${file}`);
            const { file: _file, ...plugin } = entry;
            const archive = path.resolve(dist, file);
            if (integrity(archive) !== plugin.integrity) throw new Error(`Dist integrity mismatch: ${file}`);
            await release(plugin, archive);
            if (!semver.prerelease(plugin.version)) published.push({ ...plugin, ...await generate(archive, previews, plugin.id) });
        } catch (error) {
            failures.push(`${spec}: ${error.message}`);
        }
    }
    return { published, failures };
}

async function main() {
    const [dist, output, previews] = process.argv.slice(2);
    if (!dist || !output || !previews) throw new Error('Usage: publish.cjs <dist-checkout> <published-json> <preview-directory>');
    const entries = new Map(readIndex(path.join(dist, 'index.json')).map(entry => [entry.file, entry]));
    const { published, failures } = await publishSelection(packages(process.env.SEMI_RELEASE_PACKAGES), entries, dist, previews);
    fs.writeFileSync(output, JSON.stringify(published, null, 2) + '\n');
    if (process.env.GITHUB_OUTPUT) fs.appendFileSync(process.env.GITHUB_OUTPUT, `published=${published.length}\n`);
    for (const failure of failures) console.error(failure);
    if (failures.length) process.exitCode = 1;
}

if (require.main === module) main().catch(error => { console.error(error.message); process.exitCode = 1; });
module.exports = { publishRelease, publishSelection };
