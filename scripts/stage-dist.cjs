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
    const existing = new Map();
    const migrations = [];
    const copies = [];
    for (const item of previous) {
        const file = releaseFile(item.id, item.version);
        const legacy = `packages/${item.id}/${item.version}.tgz`;
        if (item.file !== file && item.file !== legacy) throw new Error(`Invalid dist path: ${item.file}`);
        if (existing.has(file)) throw new Error(`Duplicate archive filename: ${file}`);
        const archived = path.join(destination, item.file);
        if (item.file === legacy) {
            const target = path.join(destination, file);
            if (fs.existsSync(target) || integrity(archived) !== item.integrity) throw new Error(`Cannot migrate archive: ${item.file}`);
            migrations.push({ from: archived, to: target });
        }
        existing.set(file, { item: { ...item, file }, archived });
    }
    for (const item of readIndex(path.join(source, 'index.json'))) {
        const file = releaseFile(item.id, item.version);
        const from = path.join(source, file);
        const to = path.join(destination, file);
        if (item.file !== file || integrity(from) !== item.integrity) throw new Error(`Invalid package: ${file}`);
        const old = existing.get(file);
        if (old) {
            if (old.item.id !== item.id || old.item.version !== item.version) throw new Error(`Duplicate archive filename: ${file}`);
            if (old.item.integrity !== item.integrity || integrity(old.archived) !== old.item.integrity) {
                throw new Error(`An existing version cannot be replaced: ${item.id}@${item.version}`);
            }
            existing.set(file, { ...old, item });
            continue;
        }
        if (fs.existsSync(to)) throw new Error(`Unindexed archive already exists: ${file}`);
        copies.push({ from, to });
        existing.set(file, { item, archived: from });
    }
    fs.mkdirSync(path.join(destination, 'tgz'), { recursive: true });
    for (const { from, to } of migrations) fs.renameSync(from, to);
    for (const { from, to } of copies) fs.copyFileSync(from, to, fs.constants.COPYFILE_EXCL);
    const packages = [...existing.values()].map(entry => entry.item)
        .sort((a, b) => a.id.localeCompare(b.id, 'en') || semver.compare(a.version, b.version));
    fs.writeFileSync(output, JSON.stringify({ version: 1, packages }, null, 2) + '\n');
}

if (require.main === module) {
    const [source, destination] = process.argv.slice(2);
    if (!source || !destination) throw new Error('Usage: stage-dist.cjs <packed-directory> <dist-checkout>');
    stageDist(source, destination);
}

module.exports = { readIndex, stageDist };
