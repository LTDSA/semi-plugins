const fs = require('node:fs/promises');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { createElement } = require('react');
const { renderToStaticMarkup } = require('react-dom/server');
const { build } = require('esbuild');
const sharp = require('sharp');

const root = path.resolve(__dirname, '..');
const maxIcon = 2 * 1024 * 1024;
const themes = ['light', 'dark'];
const colors = new Set(['red', 'pink', 'purple', 'violet', 'indigo', 'blue', 'light-blue', 'cyan', 'teal', 'green', 'light-green', 'lime', 'yellow', 'amber', 'orange', 'grey']);
const toolIcons = {
    config: 'IconConfig', 'settings-2': 'Settings2', music: 'IconMusic',
    'tablet-smartphone': 'TabletSmartphone', wifi_protected_setup: 'IconWifi',
    settings_ethernet: 'EthernetPort', speed: 'IconPulse', terminal: 'IconTerminal', folder: 'IconFolder',
};
const sidebarIcons = { chart: 'IconChart', config: 'IconConfig', intro: 'IconIntro', switch: 'IconSwitch', token: 'IconToken', tree: 'IconTree' };
let glyphs;

function archiveEntry(archive, entry) {
    return execFileSync('tar', ['-xOzf', archive, '--', 'package/' + entry], { maxBuffer: maxIcon });
}

function readIcon(archive, value) {
    if (!value.startsWith('./') || value.includes('\\') || value.slice(2).split('/').some(part => !part || part === '.' || part === '..')) {
        throw new Error('Icon must refer to a file inside the package');
    }
    const bytes = archiveEntry(archive, value.slice(2));
    if (/\.svg$/i.test(value) || bytes.toString('utf8', 0, 512).trimStart().startsWith('<')) {
        const svg = bytes.toString('utf8');
        // Rasterize self-contained SVG only. Local ID references keep gradients/masks working.
        if (/<!DOCTYPE|<!ENTITY|@import/i.test(svg)
            || /(?:href\s*=\s*["']|url\(\s*["']?)(?!#)[^\s"')]+/i.test(svg)) {
            throw new Error('Icon SVG has an external resource');
        }
    }
    return bytes;
}

async function loadGlyphs() {
    const output = await build({
        bundle: true, platform: 'node', format: 'cjs', write: false,
        external: ['react', 'react/jsx-runtime'],
        loader: { '.css': 'empty', '.svg': 'dataurl' },
        stdin: { resolveDir: root, contents: `
            export { IconPuzzle, IconMusic, IconFolder, IconPulse, IconTerminal, IconWifi, EthernetPort, TabletSmartphone, Settings2 } from './vendor/plugin-ui/icons.js';
            export { IconConfig, IconChart, IconIntro, IconSwitch, IconToken, IconTree } from './vendor/plugin-ui/labIcons.js';
        ` },
    });
    const result = { exports: {} };
    // This bundle contains only the two repository-owned imports above and their pinned icon libraries.
    new Function('module', 'exports', 'require', output.outputFiles[0].text)(result, result.exports, require);
    return result.exports;
}

async function glyph(theme, name, color) {
    glyphs ||= loadGlyphs();
    const svg = /<svg\b[\s\S]*?<\/svg>/.exec(renderToStaticMarkup(createElement((await glyphs)[name])))?.[0];
    if (!svg) throw new Error(`Unable to render icon ${name}`);
    const css = await fs.readFile(path.resolve(path.dirname(require.resolve('@douyinfe/semi-ui')), '../../dist/css/semi.css'), 'utf8');
    const tints = [...css.matchAll(new RegExp('--semi-' + color + '-5:\\s*([0-9, ]+);', 'g'))];
    const tint = tints[theme === 'dark' ? 1 : 0]?.[1];
    if (!tint) throw new Error(`Missing ${theme} token for ${color}`);
    return Buffer.from(svg.replace(/currentColor/gi, `rgb(${tint})`)
        .replace(/(width|height)="1em"/g, '$1="64"')
        .replace(/^<svg(?![^>]*xmlns=)/, '<svg xmlns="http://www.w3.org/2000/svg"'));
}

function iconFiles(id) {
    if (!/^(?:@[a-z0-9._-]+\/)?[a-z0-9._-]+$/.test(id) || id.split('/').some(part => ['.', '..', '@.', '@..'].includes(part))) {
        throw new Error('Invalid icon identity');
    }
    return Object.fromEntries(themes.map(theme => [theme, `./icons/${id}/${theme}.webp`]));
}

async function generateIconPreviews(archive, output, id) {
    const pkg = JSON.parse(archiveEntry(archive, 'package.json'));
    if (pkg.name !== id) throw new Error('Icon package identity mismatch');
    const manifest = pkg.semi;
    const custom = manifest.icon?.startsWith('./');
    if (manifest.iconDark !== undefined && (!custom || typeof manifest.iconDark !== 'string')) throw new Error('Dark icon requires a package icon');
    const sidebar = manifest.contributes?.sidebar?.find(item => item.icon)?.icon;
    const select = (map, key) => Object.hasOwn(map, key) ? map[key] : undefined;
    const name = select(toolIcons, manifest.icon) || select(sidebarIcons, sidebar);
    const color = custom || name ? (colors.has(manifest.color) ? manifest.color : 'blue') : 'grey';
    const iconUrl = iconFiles(id);
    for (const theme of themes) {
        const file = path.join(output, iconUrl[theme]);
        const input = custom ? readIcon(archive, theme === 'dark' && manifest.iconDark !== undefined ? manifest.iconDark : manifest.icon)
            : await glyph(theme, name || 'IconPuzzle', color);
        await fs.mkdir(path.dirname(file), { recursive: true });
        await sharp(input, { limitInputPixels: 4 * 1024 * 1024 }).resize(64, 64, {
            fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 },
        }).ensureAlpha().webp({ lossless: true }).toFile(file);
    }
    return { iconUrl, color };
}

module.exports = { generateIconPreviews, iconFiles };
