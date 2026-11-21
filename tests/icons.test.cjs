const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { execFileSync } = require('node:child_process');
const sharp = require('sharp');
const { generateIconPreviews } = require('../scripts/icon-previews.cjs');

test('package and standard icons generate transparent WebP for both themes', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'semi-previews-test-'));
    try {
        const pkg = path.join(root, 'package');
        fs.mkdirSync(pkg);
        const preview = async (name, semi) => {
            fs.writeFileSync(path.join(pkg, 'package.json'), JSON.stringify({ name, version: '1.0.0', semi }));
            const archive = path.join(root, 'plugin.tgz');
            execFileSync('tar', ['-czf', archive, 'package'], { cwd: root });
            const { iconUrl, color } = await generateIconPreviews(archive, root, name);
            assert.equal(iconUrl.light, './icons/' + name + '/light.webp');
            assert.equal(iconUrl.dark, './icons/' + name + '/dark.webp');
            assert.equal(color, 'purple');
            const bytes = {};
            for (const [theme, file] of Object.entries(iconUrl)) {
                const image = sharp(path.join(root, file));
                const info = await image.metadata();
                assert.equal(info.format, 'webp');
                assert(info.hasAlpha && info.width === 64 && info.height === 64);
                const rgba = await image.raw().toBuffer();
                assert.equal(rgba[3], 0, 'corner must remain transparent');
                assert(rgba.some((value, i) => i % 4 === 3 && value > 0), 'foreground must be present');
                bytes[theme] = rgba;
            }
            return bytes;
        };
        for (const icon of ['music', 'tablet-smartphone', 'config']) {
            const rendered = await preview('example-' + icon, { icon, color: 'purple' });
            if (icon !== 'config') assert.notDeepEqual(rendered.light, rendered.dark);
        }
        const svg = color => `<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32"><circle cx="16" cy="16" r="12" fill="${color}"/></svg>`;
        fs.writeFileSync(path.join(pkg, 'light.svg'), svg('#111'));
        fs.writeFileSync(path.join(pkg, 'dark.svg'), svg('#eee'));
        const custom = await preview('@sample/custom', { icon: './light.svg', iconDark: './dark.svg', color: 'purple' });
        assert.notDeepEqual(custom.light, custom.dark);
        const single = await preview('@sample/single', { icon: './light.svg', color: 'purple' });
        assert.deepEqual(single.light, single.dark);
    } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
