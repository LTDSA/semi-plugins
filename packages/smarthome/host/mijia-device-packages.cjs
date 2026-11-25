const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { zipFile } = require('./mijia-plugin-assets.cjs');
const { reportProgress, subscribeProgress } = require('./mijia-download-progress.cjs');
const { assert, error } = require('../browser/contracts.cjs');
const MAX_PACKAGE = 128 * 1024 * 1024;
const digest = (value, algorithm = 'sha256') => crypto.createHash(algorithm).update(value).digest('hex');
const check = signal => assert(!signal?.aborted, '加载已取消', 'CANCELLED');

function pluginMetadata(result, model) {
    const groups = ['full_define_plugin_info', 'increment_plugin_info', 'stand_plugin_info', 'latest_info'];
    const found = groups.flatMap(name => Array.isArray(result?.[name]) ? result[name] : []).find(item => item.model === model && item.platform === 1);
    assert(found, '米家服务器未提供该设备的 Android 插件', 'PLUGIN_UNAVAILABLE');
    assert(Number.isSafeInteger(found.plugin_id) && found.plugin_id > 0 && Number.isSafeInteger(found.version) && found.version >= 0, '插件下载信息无效', 'PLUGIN_INVALID');
    const base = { model, pluginId: found.plugin_id, version: found.version, packageId: found.plugin_package_id, sdkVersion: found.sdk_version,
        devMode: Number.isInteger(found.dev_mode) ? found.dev_mode : null, homePageMore: Number.isInteger(found.homepage_more) ? found.homepage_more : 1 };
    // 官方默认插件登记没有独立 ZIP。必须同时匹配类型、增量登记和空包三项，不能把坏地址当成标准页。
    const standardRegistration = found.dev_mode === 0 && found.size === 0 && found.download_url === '' && found.md5sum === '' &&
        Array.isArray(result.increment_plugin_info) && result.increment_plugin_info.some(item => item.model === model && item.platform === 1 && item.plugin_id === found.plugin_id && item.plugin_package_id === found.plugin_package_id && item.version === found.version);
    if (standardRegistration) return { ...base, kind: 'standard', url: '', size: 0, md5: '' };
    assert(typeof found.download_url === 'string' && found.download_url.length > 0, '插件缺少有效下载地址', 'PLUGIN_INVALID');
    let url;
    try { url = new URL(found.download_url); } catch { throw error('PLUGIN_INVALID', '插件下载地址无效'); }
    assert(url.protocol === 'https:' && url.hostname === 'iot-cdn.io.mi.com' && !url.port && !url.username && !url.password && !url.search && !url.hash && /^\/rn-plugins\/[a-zA-Z0-9_./-]+\.zip$/.test(url.pathname) && !url.pathname.includes('..'), '插件下载地址无效', 'PLUGIN_INVALID');
    assert(Number.isSafeInteger(found.size) && found.size > 0 && found.size <= MAX_PACKAGE && /^[a-f0-9]{32}$/i.test(found.md5sum), '插件下载信息无效', 'PLUGIN_INVALID');
    return { ...base, kind: found.dev_mode === 4 ? 'increment' : 'full', url: url.href, size: found.size, md5: found.md5sum.toLowerCase() };
}

function standardAsset(directory, metadata) {
    return { model: metadata.model, metadata, project: { package_path: 'miot.plugin.spec' }, directory, resources: new Map() };
}

// RAM bundle 解码只恢复容器中的原始模块和启动段；不修改任何工厂、入口或设备逻辑。
function decodeBundle(data) {
    if (data.length < 4 || data.readUInt32LE(0) !== 0xfb0bd1e5) return data;
    assert(data.length >= 12, '插件模块索引损坏', 'PLUGIN_INVALID');
    const count = data.readUInt32LE(4), size = data.readUInt32LE(8), base = 12 + count * 8;
    assert(count > 0 && count < 100000 && size > 0 && base + size <= data.length, '插件模块索引越界', 'PLUGIN_INVALID');
    const stripNull = bytes => bytes.at(-1) === 0 ? bytes.subarray(0, bytes.length - 1) : bytes;
    const modules = [], ranges = [];
    for (let i = 0; i < count; i++) {
        const offset = data.readUInt32LE(12 + i * 8), length = data.readUInt32LE(16 + i * 8);
        if (!length) continue;
        assert(offset >= size && base + offset + length <= data.length, '插件模块越界', 'PLUGIN_INVALID');
        ranges.push([offset, offset + length]);
        const source = stripNull(data.subarray(base + offset, base + offset + length));
        assert(source.subarray(0, 4).toString() === '__d(', '插件模块格式不支持', 'PLUGIN_INVALID');
        modules.push(source);
    }
    ranges.sort((a, b) => a[0] - b[0]);
    assert(ranges.every((range, i) => !i || range[0] >= ranges[i - 1][1]), '插件模块索引重叠', 'PLUGIN_INVALID');
    return Buffer.concat(modules.flatMap(source => [source, Buffer.from('\n')]).concat(stripNull(data.subarray(base, base + size))));
}
async function downloadPackage(metadata, file, signal, onProgress) {
    check(signal);
    const { semi } = await import('@semi-app/plugin-sdk');
    const result = await semi.downloadFile({
        url: metadata.url, filePath: file, signal, maxBytes: metadata.size, redirect: 'manual',
        onProgress: ({ loaded }) => onProgress({ phase: 'download', loaded, total: metadata.size }),
    });
    assert(result.statusCode === 200 && result.bytesWritten === metadata.size, '设备插件下载失败', 'PLUGIN_DOWNLOAD_FAILED');
}
class MijiaDevicePackages {
    constructor({ userData, download = downloadPackage }) {
        this.root = path.join(userData, 'mijia-device-plugins'); this.download = download; this.jobs = new Map();
    }
    directory(model, expected) { return path.join(this.root, digest(expected ? `${model}:${expected.pluginId}:${expected.version}:${expected.md5}` : model)); }
    async cached(model, expected) {
        const directory = this.directory(model, expected);
        try {
            const marker = JSON.parse(await fs.promises.readFile(path.join(directory, 'ready.json'), 'utf8'));
            assert(marker.model === model && [1, 2].includes(marker.schema), '插件缓存无效');
            const standard = marker.schema === 2 && marker.metadata.kind === 'standard';
            const metadata = pluginMetadata({ [standard ? 'increment_plugin_info' : 'latest_info']: [{ model, platform: 1, plugin_id: marker.metadata.pluginId, plugin_package_id: marker.metadata.packageId, version: marker.metadata.version, sdk_version: marker.metadata.sdkVersion, dev_mode: marker.metadata.devMode ?? (standard ? 0 : marker.metadata.kind === 'increment' ? 4 : 1), homepage_more: marker.metadata.homePageMore, download_url: marker.metadata.url, size: marker.metadata.size, md5sum: marker.metadata.md5 }] }, model);
            const stat = await fs.promises.lstat(directory);
            assert(stat.isDirectory() && !stat.isSymbolicLink(), '插件缓存目录无效');
            if (standard) {
                assert(digest(JSON.stringify(marker.metadata)) === marker.sha256, '标准插件登记缓存校验失败');
                return standardAsset(directory, metadata);
            }
            assert((await fs.promises.stat(path.join(directory, 'package.zip'))).size === metadata.size, '插件缓存大小异常');
            const archive = await fs.promises.readFile(path.join(directory, 'package.zip'));
            assert(archive.length === metadata.size && digest(archive, 'md5') === metadata.md5 && digest(archive) === marker.sha256, '插件缓存校验失败');
            // 原 ZIP 是缓存权威；校验后重新创建派生资源索引，不相信缓存中的脚本路径或入口。
            return await this.inspect(directory, metadata);
        } catch { return null; }
    }
    async ensure(model, metadataProvider, signal, expected, onProgress) {
        check(signal);
        const cached = await this.cached(model, expected);
        check(signal); if (cached && (!expected || cached.metadata.pluginId === expected.pluginId && cached.metadata.version === expected.version && cached.metadata.md5 === expected.md5)) return cached;
        // 同型号共享下载，但一个页面取消不能终止其他调用方。
        const jobKey = expected ? `${model}:${expected.pluginId}:${expected.version}:${expected.md5}` : model;
        if (!this.jobs.has(jobKey)) {
            const controller = new AbortController();
            const job = { controller, clients: 0, listeners: new Set() };
            job.promise = this.load(model, metadataProvider, controller.signal, expected, progress => reportProgress(job, progress)).finally(() => { if (this.jobs.get(jobKey) === job) this.jobs.delete(jobKey); });
            this.jobs.set(jobKey, job);
        }
        const job = this.jobs.get(jobKey); job.clients++;
        let abort;
        const interrupted = new Promise((_resolve, reject) => { abort = () => reject(error('CANCELLED', '加载已取消')); signal?.addEventListener('abort', abort, { once: true }); });
        const off = subscribeProgress(job, onProgress);
        try { const result = await Promise.race([job.promise, interrupted]); check(signal); return result; }
        finally { off(); signal?.removeEventListener('abort', abort); if (--job.clients === 0 && this.jobs.get(jobKey) === job) job.controller.abort(); }
    }
    async load(model, metadataProvider, signal, expected, onProgress = () => {}) {
        const metadata = pluginMetadata(await metadataProvider(signal), model);
        assert(!expected || metadata.pluginId === expected.pluginId && metadata.version === expected.version && metadata.md5 === expected.md5, '标准包版本已变化，请重试', 'CONTEXT_CHANGED');
        check(signal); await fs.promises.mkdir(this.root, { recursive: true });
        const stage = await fs.promises.mkdtemp(path.join(this.root, 'loading-'));
        try {
            if (metadata.kind === 'standard') {
                await fs.promises.writeFile(path.join(stage, 'ready.json'), JSON.stringify({ schema: 2, model, metadata, sha256: digest(JSON.stringify(metadata)) }), { mode: 0o600 });
                check(signal);
                const directory = this.directory(model, expected);
                await fs.promises.rm(directory, { recursive: true, force: true });
                await fs.promises.rename(stage, directory);
                return standardAsset(directory, metadata);
            }
            const file = path.join(stage, 'package.zip');
            let loaded = 0;
            onProgress({ phase: 'download', loaded: 0, total: metadata.size });
            try {
                await this.download(metadata, file, signal, progress => {
                    if (signal.aborted) return;
                    loaded = progress.loaded;
                    onProgress(progress);
                });
                loaded = metadata.size;
            } finally {
                if (!signal.aborted) onProgress({ phase: 'verify', loaded, total: metadata.size });
            }
            check(signal);
            const archive = await fs.promises.readFile(file);
            assert(archive.length === metadata.size && digest(archive, 'md5') === metadata.md5, '设备插件下载校验失败', 'PLUGIN_INVALID');
            const result = await this.inspect(stage, metadata, signal);
            await fs.promises.writeFile(path.join(stage, 'ready.json'), JSON.stringify({ schema: 1, model, metadata, sha256: digest(archive) }), { mode: 0o600 });
            check(signal);
            const directory = this.directory(model, expected);
            await fs.promises.rm(directory, { recursive: true, force: true });
            await fs.promises.rename(stage, directory);
            return { ...result, directory };
        } finally { await fs.promises.rm(stage, { recursive: true, force: true }); }
    }
    async inspect(directory, metadata, signal) {
        const zip = await zipFile(path.join(directory, 'package.zip'));
        try {
            const project = JSON.parse((await zip.get('android/project.json')).toString('utf8'));
            assert(project.platform === 'android' && typeof project.package_path === 'string' && (!project.bundle_type || ['plain-bundle', 'indexed-ram-bundle'].includes(project.bundle_type)), '此插件格式暂不支持', 'PLUGIN_FORMAT_UNSUPPORTED');
            assert(Number(project.min_sdk_api_level) <= 10118, '该插件需要更新版本的米家运行环境', 'PLUGIN_SDK_UNSUPPORTED');
            await fs.promises.rm(path.join(directory, 'files'), { recursive: true, force: true });
            let total = 0; const resources = new Map();
            for (const [name, entry] of zip.entries) {
                if (!name.startsWith('android/') || name.endsWith('/')) continue;
                check(signal); total += entry.size;
                assert(total <= 192 * 1024 * 1024, '插件解包超过允许大小', 'PLUGIN_INVALID');
                // 原文件逐字节解包；可执行入口始终仅在受限 iframe 中加载。
                const data = await zip.get(name);
                const target = path.join(directory, 'files', name);
                await fs.promises.mkdir(path.dirname(target), { recursive: true });
                await fs.promises.writeFile(target, data, { mode: 0o600 });
                if (/\.(png|jpe?g|webp|svg|gif|json|html|ttf|otf|woff2?)$/i.test(name)) {
                    const key = path.basename(name, path.extname(name)).replace(/[^a-zA-Z0-9]/g, '').toLowerCase() + path.extname(name).toLowerCase();
                    // 不同密度图片优先 mdpi；同键仍有原始文件路径可访问。
                    if (!resources.has(key) || name.includes('/drawable-mdpi/')) resources.set(key, name);
                }
            }
            const bundle = await zip.get('android/main.bundle');
            const script = decodeBundle(bundle);
            await fs.promises.writeFile(path.join(directory, 'device.js'), script, { mode: 0o600 });
            return { model: metadata.model, metadata, project, directory, resources };
        } finally { await zip.close(); }
    }
    file(asset, name) {
        let file;
        if (name === 'device.js') file = path.join(asset.directory, name);
        else if (name.startsWith('assets/')) {
            const resource = asset.resources.get(name.slice(7));
            if (resource) file = path.join(asset.directory, 'files', resource);
        }
        assert(file, '设备插件资源不存在', 'PLUGIN_UNAVAILABLE');
        return file;
    }
    async get(asset, name) {
        const file = this.file(asset, name);
        const stat = await fs.promises.stat(file);
        assert(stat.isFile() && stat.size <= 64 * 1024 * 1024, '设备插件资源不可读取', 'PLUGIN_UNAVAILABLE');
        return fs.promises.readFile(file);
    }
}
module.exports = { MijiaDevicePackages, pluginMetadata, decodeBundle, downloadPackage };
