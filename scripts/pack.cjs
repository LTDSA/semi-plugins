const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { execFileSync } = require('node:child_process');
const semver = require('semver');
const { generateIconPreviews } = require('./icon-previews.cjs');
const { packages, releaseFile, integrity } = require('./release-files.cjs');

async function main() {
    const output = process.argv[2] ? path.resolve(process.argv[2]) : fs.mkdtempSync(path.join(os.tmpdir(), 'semi-plugin-pack-'));
    fs.mkdirSync(output, { recursive: true });
    if (fs.readdirSync(output).length) throw new Error('Pack output directory must be empty');
    const entries = [];
    for (const { cwd, pkg } of packages(process.env.SEMI_RELEASE_PACKAGES)) {
        if (!semver.validRange(pkg.engines?.semi || 'invalid')) throw new Error(`Invalid engines.semi: ${pkg.name}`);
        const work = fs.mkdtempSync(path.join(os.tmpdir(), 'semi-npm-pack-'));
        try {
            const [result] = JSON.parse(execFileSync('npm',
                ['pack', '--ignore-scripts', '--json', '--pack-destination', work], { cwd, encoding: 'utf8' }));
            const files = new Set(result.files.map(file => file.path));
            const background = typeof pkg.semi.background === 'string' ? pkg.semi.background : pkg.semi.background?.entry;
            for (const entry of ['package.json', background, ...(pkg.semi.contributes?.views || []).map(view => view.entry)].filter(Boolean)) {
                if (!files.has(entry)) throw new Error(`Missing entry: ${pkg.name}/${entry}`);
            }
            if ([...files].some(name => name !== 'package.json' && !/^(dist\/|README|LICENSE)/i.test(name))) {
                throw new Error(`Unexpected pack contents: ${pkg.name}`);
            }
            if (result.size > 32 * 1024 * 1024 || result.unpackedSize > 64 * 1024 * 1024 || result.files.length > 2000
                || result.files.some(file => file.size > 16 * 1024 * 1024)) throw new Error(`Pack is over Semi limits: ${pkg.name}`);
            if (result.name !== pkg.name || result.version !== pkg.version || path.basename(result.filename) !== result.filename) {
                throw new Error('Unexpected npm pack identity');
            }
            const from = path.join(work, result.filename);
            const checksum = integrity(from);
            if (checksum !== result.integrity) throw new Error('npm pack integrity mismatch');
            const file = releaseFile(pkg.name, pkg.version);
            const to = path.join(output, file);
            fs.mkdirSync(path.dirname(to), { recursive: true });
            fs.copyFileSync(from, to, fs.constants.COPYFILE_EXCL);
            const author = typeof pkg.author === 'string' ? pkg.author.split(/[<(]/, 1)[0].trim() : pkg.author?.name?.trim() || '';
            const { color } = await generateIconPreviews(to, output, pkg.name);
            entries.push({
                file, id: pkg.name, version: pkg.version, semi: pkg.engines.semi,
                name: pkg.semi.displayName || pkg.name, author, description: pkg.description || '', icon: pkg.semi.icon,
                color,
                integrity: checksum,
            });
            console.log(`${pkg.name}@${pkg.version}: ${to}`);
        } finally { fs.rmSync(work, { recursive: true, force: true }); }
    }
    if (!entries.length) throw new Error('No plugin packages');
    fs.writeFileSync(path.join(output, 'index.json'), JSON.stringify({ version: 1, packages: entries }, null, 2) + '\n');
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
