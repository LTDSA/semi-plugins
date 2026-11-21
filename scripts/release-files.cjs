const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const semver = require('semver');

const root = path.resolve(__dirname, '..');

function releaseFile(id, version) {
    if (!/^(?:@[a-z0-9._-]+\/)?[a-z0-9._-]+$/.test(id)
        || id.split('/').some(part => ['.', '..', '@.', '@..'].includes(part))
        || semver.valid(version) !== version) throw new Error('Invalid archive identity');
    return `packages/${id}/${version}.tgz`;
}

function packages() {
    return fs.readdirSync(path.join(root, 'packages')).sort().flatMap(dir => {
        const cwd = path.join(root, 'packages', dir);
        const file = path.join(cwd, 'package.json');
        if (!fs.existsSync(file)) return [];
        const pkg = JSON.parse(fs.readFileSync(file, 'utf8'));
        if (!pkg.semi || pkg.private) return [];
        releaseFile(pkg.name, pkg.version);
        return [{ cwd, pkg }];
    });
}

function integrity(file) {
    return 'sha512-' + createHash('sha512').update(fs.readFileSync(file)).digest('base64');
}

module.exports = { packages, releaseFile, integrity };
