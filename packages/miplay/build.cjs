const fs = require('node:fs');
const path = require('node:path');
const { build } = require('vite');
const react = require('@vitejs/plugin-react');
const esbuild = require('esbuild');

async function main() {
    const root = __dirname;
    const outDir = path.join(root, 'dist');
    await build({
        configFile: false,
        root,
        base: './',
        plugins: [react()],
        build: {
            outDir,
            emptyOutDir: true,
            rollupOptions: { input: ['index.html', 'tray.html'].map(file => path.join(root, file)) },
        },
    });
    const background = path.join(outDir, 'background');
    // Keep runtime assets and corresponding third-party source beside the bundle.
    const source = path.join(root, 'background');
    for (const name of ['playfair.wasm', 'vendor']) fs.cpSync(path.join(source, name), path.join(background, name), { recursive: true });
    const { metafile } = await esbuild.build({
        absWorkingDir: root,
        entryPoints: ['background/main.cjs'],
        outfile: path.join(background, 'main.cjs'),
        bundle: true,
        platform: 'node',
        format: 'cjs',
        target: 'node24',
        metafile: true,
    });
    const dependencies = new Set();
    for (const input of Object.keys(metafile.inputs)) {
        const segments = path.resolve(root, input).split(path.sep);
        const offset = segments.lastIndexOf('node_modules') + 1;
        if (!offset) continue;
        const end = offset + (segments[offset].startsWith('@') ? 2 : 1);
        dependencies.add(segments.slice(0, end).join(path.sep));
    }
    for (const directory of dependencies) {
        const { name } = JSON.parse(fs.readFileSync(path.join(directory, 'package.json'), 'utf8'));
        const target = path.join(outDir, 'licenses', name);
        for (const file of fs.readdirSync(directory, { withFileTypes: true })) {
            if (!file.isFile() || !/^(license|licence|copying|notice)([.-]|$)/i.test(file.name)) continue;
            fs.mkdirSync(target, { recursive: true });
            fs.copyFileSync(path.join(directory, file.name), path.join(target, file.name));
        }
    }
}

main().catch(error => { console.error(error); process.exitCode = 1; });
