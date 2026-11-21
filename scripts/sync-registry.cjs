const fs = require('node:fs');
const path = require('node:path');
const semver = require('semver');

const { iconFiles } = require('./icon-previews.cjs');
const [published, destination, previews] = process.argv.slice(2);
if (!published || !destination || !previews) throw new Error('Usage: sync-registry.cjs <published-json> <registry-json> <preview-directory>');
const additions = JSON.parse(fs.readFileSync(published, 'utf8'));
const current = fs.existsSync(destination) ? JSON.parse(fs.readFileSync(destination, 'utf8')) : { version: 1, plugins: [] };
if (current.version !== 1 || !Array.isArray(current.plugins)) throw new Error('Unsupported registry schema');
const entries = new Map(current.plugins.map(entry => [entry.id, entry]));
for (const entry of additions) {
    const previous = entries.get(entry.id);
    if (previous && semver.gt(previous.version, entry.version)) continue;
    if (previous?.version === entry.version && previous.integrity !== entry.integrity) throw new Error('Published version checksum changed');
    for (const [theme, file] of Object.entries(iconFiles(entry.id))) {
        if (entry.iconUrl?.[theme] !== file) throw new Error('Invalid preview path');
        const target = path.join(path.dirname(destination), file);
        fs.mkdirSync(path.dirname(target), { recursive: true });
        fs.copyFileSync(path.join(previews, file), target);
    }
    entries.set(entry.id, entry);
}
fs.mkdirSync(path.dirname(destination), { recursive: true });
fs.writeFileSync(destination, JSON.stringify({ version: 1, plugins: [...entries.values()].sort((a, b) => a.id.localeCompare(b.id, 'en')) }, null, 2) + '\n');
