const fs = require('node:fs');
const path = require('node:path');
const semver = require('semver');
const { releaseFile, integrity } = require('./release-files.cjs');

function readIndex(file) {
    const index = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (index.version !== 1 || !Array.isArray(index.packages)) throw new Error('Unsupported dist index');
    return index.packages;
}

const identity = item => item.id + ':' + item.version;
const archiveUnscoped = file => file.replace(/^tgz\//, 'archive/unscoped/');

function stageDist(source, destination) {
    const output = path.join(destination, 'index.json');
    const previous = fs.existsSync(output) ? readIndex(output) : [];
    const incoming = readIndex(path.join(source, 'index.json'));
    const prefix = '@semi-app/';
    const retired = new Set(incoming.filter(item => item.id.startsWith(prefix)).map(item => item.id.slice(prefix.length)));
    const records = new Map();
    const removals = [];
    const occupied = new Set();
    for (const item of previous) {
        const file = releaseFile(item.id, item.version);
        const legacy = `packages/${item.id}/${item.version}.tgz`;
        const archivedUnscoped = !item.id.includes('/') && item.file === archiveUnscoped(file);
        if (item.file !== file && item.file !== legacy && !archivedUnscoped) throw new Error(`Invalid dist path: ${item.file}`);
        if (records.has(identity(item)) || occupied.has(item.file)) throw new Error(`Duplicate dist entry: ${item.file}`);
        occupied.add(item.file);
        const from = path.join(destination, item.file);
        if (retired.has(item.id)) {
            removals.push(from);
            continue;
        }
        records.set(identity(item), { item, from, dest: archivedUnscoped ? item.file : file, existing: true });
    }
    for (const item of incoming) {
        const file = releaseFile(item.id, item.version);
        const from = path.join(source, file);
        if (item.file !== file || integrity(from) !== item.integrity) throw new Error(`Invalid package: ${file}`);
        const old = records.get(identity(item));
        if (old) {
            if (old.item.integrity !== item.integrity || integrity(old.from) !== old.item.integrity) {
                throw new Error(`An existing version cannot be replaced: ${item.id}@${item.version}`);
            }
            old.item = item;
        } else {
            records.set(identity(item), { item, from, dest: file, existing: false });
        }
    }

    const destinations = new Map();
    for (const record of records.values()) {
        if (destinations.has(record.dest)) throw new Error(`Duplicate archive filename: ${record.dest}`);
        destinations.set(record.dest, record);
    }

    const moves = [];
    const copies = [];
    for (const [file, { item, from, existing }] of destinations) {
        const to = path.join(destination, file);
        if (from === to) continue;
        if (fs.existsSync(to) && !occupied.has(file)) throw new Error(`Unindexed archive already exists: ${file}`);
        if (integrity(from) !== item.integrity) throw new Error(`Invalid archive: ${item.file}`);
        (existing ? moves : copies).push({ from, to, file });
    }
    // Remove retired packages only after validating all replacement archives and paths.
    for (const file of removals) fs.rmSync(file, { force: true });
    for (const { from, to } of moves) {
        fs.mkdirSync(path.dirname(to), { recursive: true });
        fs.renameSync(from, to);
    }
    for (const { from, to } of copies) {
        fs.mkdirSync(path.dirname(to), { recursive: true });
        fs.copyFileSync(from, to, fs.constants.COPYFILE_EXCL);
    }
    const packages = [...destinations].map(([file, { item }]) => ({ ...item, file }))
        .sort((a, b) => a.id.localeCompare(b.id, 'en') || semver.compare(a.version, b.version));
    fs.writeFileSync(output, JSON.stringify({ version: 1, packages }, null, 2) + '\n');
}

if (require.main === module) {
    const [source, destination] = process.argv.slice(2);
    if (!source || !destination) throw new Error('Usage: stage-dist.cjs <packed-directory> <dist-checkout>');
    stageDist(source, destination);
}

module.exports = { readIndex, stageDist };
