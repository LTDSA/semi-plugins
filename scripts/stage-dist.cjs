const fs = require('node:fs');
const path = require('node:path');
const semver = require('semver');
const { releaseFile, integrity } = require('./release-files.cjs');

function readIndex(file) {
    const index = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (index.version !== 1 || !Array.isArray(index.packages)) throw new Error('Unsupported dist index');
    return index.packages;
}

function stageDist(source, destination) {
    const output = path.join(destination, 'index.json');
    const previous = fs.existsSync(output) ? readIndex(output) : [];
    const existing = new Map(previous.map(item => [releaseFile(item.id, item.version), item]));
    const incoming = readIndex(path.join(source, 'index.json'));
    for (const item of incoming) {
        const file = releaseFile(item.id, item.version);
        const from = path.join(source, file);
        const to = path.join(destination, file);
        if (item.file !== file || integrity(from) !== item.integrity) throw new Error(`Invalid package: ${file}`);
        const old = existing.get(file);
        if (old) {
            if (old.integrity !== item.integrity || integrity(to) !== old.integrity) {
                throw new Error(`An existing version cannot be replaced: ${item.id}@${item.version}`);
            }
            existing.set(file, item);
            continue;
        }
        fs.mkdirSync(path.dirname(to), { recursive: true });
        fs.copyFileSync(from, to, fs.constants.COPYFILE_EXCL);
        existing.set(file, item);
    }
    const packages = [...existing.values()].sort((a, b) => a.id.localeCompare(b.id, 'en') || semver.compare(a.version, b.version));
    fs.writeFileSync(output, JSON.stringify({ version: 1, packages }, null, 2) + '\n');
}

if (require.main === module) {
    const [source, destination] = process.argv.slice(2);
    if (!source || !destination) throw new Error('Usage: stage-dist.cjs <packed-directory> <dist-checkout>');
    stageDist(source, destination);
}

module.exports = { readIndex, stageDist };
