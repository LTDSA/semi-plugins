const fs = require('node:fs');
const { packages } = require('./release-files.cjs');
const { readIndex } = require('./stage-dist.cjs');

function planRelease(current, archived, retry = false) {
    const versions = new Set(archived.map(({ id, version }) => `${id}@${version}`));
    const pack = current.filter(({ name, version }) => !versions.has(`${name}@${version}`)).map(({ name }) => name);
    return { pack, publish: retry ? current.map(({ name }) => name) : pack };
}

if (require.main === module) {
    const [index, event] = process.argv.slice(2);
    const archived = fs.existsSync(index) ? readIndex(index) : [];
    const plan = planRelease(packages().map(({ pkg }) => pkg), archived, event === 'workflow_dispatch');
    for (const [name, selection] of Object.entries(plan)) console.log(`${name}=${JSON.stringify(selection)}`);
}

module.exports = { planRelease };
