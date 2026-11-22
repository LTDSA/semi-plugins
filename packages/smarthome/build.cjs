const fs = require('node:fs');
const path = require('node:path');
const { builtinModules, createRequire } = require('node:module');
const { build } = require('vite');
const react = require('@vitejs/plugin-react');
const esbuild = require('esbuild');

const root = __dirname;
const outDir = path.join(root, 'dist');
const runtime = path.join(root, 'runtime');
const runtimeRequire = createRequire(path.join(runtime, 'package.json'));
const browser = file => path.join(root, 'browser', file);
const builtins = new Set(builtinModules.map(name => name.replace(/^node:/, '')));

function copyLicenses(result) {
    const dependencies = new Set();
    for (const input of Object.keys(result.metafile.inputs)) {
        const parts = path.resolve(root, input).split(path.sep);
        const start = parts.lastIndexOf('node_modules') + 1;
        if (!start) continue;
        const end = start + (parts[start].startsWith('@') ? 2 : 1);
        dependencies.add(parts.slice(0, end).join(path.sep));
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

function browserBuildOptions() {
    const aliases = {
        fs: browser('fs.cjs'), path: require.resolve('path-browserify'), crypto: browser('crypto.cjs'), zlib: browser('zlib.cjs'),
        [path.join(root, 'host/storage.cjs')]: browser('storage.cjs'),
    };
    return {
        absWorkingDir: root, entryPoints: [browser('main.mjs')], outfile: path.join(outDir, 'browser-backend.js'),
        bundle: true, platform: 'browser', format: 'iife', target: 'chrome140', inject: [browser('buffer.mjs')], metafile: true,
        plugins: [{ name: 'sandbox-browser-modules', setup(build) {
            build.onResolve({ filter: /.*/ }, args => {
                const name = args.path.startsWith('.') ? path.resolve(args.resolveDir, args.path) : args.path;
                if (Object.hasOwn(aliases, name)) return { path: aliases[name] };
                if (builtins.has(name.replace(/^node:/, '')) || name === 'electron') throw new Error('沙箱后台禁止 Node 模块：' + name);
            });
        } }],
    };
}

async function main() {
    await build({
        configFile: false, root, base: './', plugins: [react()],
        build: {
            outDir, emptyOutDir: true,
            rollupOptions: { input: ['index.html', 'device-plugin.html', 'settings.html', 'tray.html'].map(file => path.join(root, file)) },
        },
    });

    const background = await esbuild.build(browserBuildOptions());
    fs.copyFileSync(path.join(root, 'background.html'), path.join(outDir, 'background.html'));

    const adapter = await esbuild.build({
        absWorkingDir: root, entryPoints: [path.join(runtime, 'adapter.jsx')], outfile: path.join(outDir, 'mijia-runtime.js'),
        bundle: true, format: 'iife', platform: 'browser', target: 'chrome130', minify: true, legalComments: 'eof', metafile: true,
        define: { 'process.env.NODE_ENV': '"production"' },
        plugins: [{ name: 'isolated-react', setup(build) {
            build.onResolve({ filter: /^(react|react-dom)$/ }, args => ({ path: runtimeRequire.resolve(args.path) }));
        } }],
    });
    copyLicenses(background);
    copyLicenses(adapter);
}

if (require.main === module) main().catch(error => { console.error(error); process.exitCode = 1; });
module.exports = { browserBuildOptions };
