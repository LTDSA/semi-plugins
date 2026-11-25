const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const zlib = require('zlib');
const pinned = require('../assets/mijia-runtime.json');
const { assert, error } = require('../browser/contracts.cjs');
const { reportProgress, subscribeProgress } = require('./mijia-download-progress.cjs');

const MAX_ENTRY = 64 * 1024 * 1024;
const sha256 = data => crypto.createHash('sha256').update(data).digest('hex');
const cancelled = signal => assert(!signal?.aborted, '加载已取消', 'CANCELLED');
async function sha256File(file, signal) {
    if (fs.promises.digest) return fs.promises.digest(file, { signal });
    const hash = crypto.createHash('sha256');
    for await (const chunk of fs.createReadStream(file, { signal })) hash.update(chunk);
    return hash.digest('hex');
}
const imageName = name => /\.(png|jpe?g|webp|svg)$/i.test(name);
const imageKey = name => path.basename(name, path.extname(name)).replace(/[^a-zA-Z0-9]/g, '').toLowerCase() + path.extname(name).toLowerCase();
const crcTable = Array.from({ length: 256 }, (_, n) => {
    for (let i = 0; i < 8; i++) n = n & 1 ? 0xedb88320 ^ n >>> 1 : n >>> 1;
    return n >>> 0;
});
function crc32(data) {
    let value = 0xffffffff;
    for (const byte of data) value = crcTable[(value ^ byte) & 255] ^ value >>> 8;
    return (value ^ 0xffffffff) >>> 0;
}

// 只解出所需的普通文件；不使用系统解压器，不执行 APK/设备包的任何代码。
async function readZip(read, size) {
    assert(size >= 22 && size <= 300 * 1024 * 1024, '插件压缩包大小异常', 'PLUGIN_INVALID');
    const tail = await read(Math.max(0, size - 65557), Math.min(size, 65557));
    let end = -1;
    for (let i = tail.length - 22; i >= 0; i--) if (tail.readUInt32LE(i) === 0x06054b50 && i + 22 + tail.readUInt16LE(i + 20) === tail.length) { end = i; break; }
    assert(end >= 0 && tail.readUInt16LE(end + 4) === 0 && tail.readUInt16LE(end + 6) === 0, '插件压缩包格式异常', 'PLUGIN_INVALID');
    const count = tail.readUInt16LE(end + 10), length = tail.readUInt32LE(end + 12), offset = tail.readUInt32LE(end + 16);
    assert(count < 20000 && count === tail.readUInt16LE(end + 8) && length <= 16 * 1024 * 1024 && offset + length <= size - 22, '插件压缩包索引异常', 'PLUGIN_INVALID');
    const central = await read(offset, length), entries = new Map();
    let cursor = 0;
    for (let i = 0; i < count; i++) {
        assert(cursor + 46 <= length && central.readUInt32LE(cursor) === 0x02014b50, '插件压缩包索引损坏', 'PLUGIN_INVALID');
        const nameLength = central.readUInt16LE(cursor + 28), extraLength = central.readUInt16LE(cursor + 30), commentLength = central.readUInt16LE(cursor + 32);
        assert(cursor + 46 + nameLength + extraLength + commentLength <= length, '插件文件名损坏', 'PLUGIN_INVALID');
        const name = central.subarray(cursor + 46, cursor + 46 + nameLength).toString('utf8');
        assert(name && !/[\\\x00-\x1f]/.test(name) && !name.startsWith('/') && !name.split('/').includes('..') && !entries.has(name), '插件压缩包路径无效', 'PLUGIN_INVALID');
        entries.set(name, {
            name, flags: central.readUInt16LE(cursor + 8), method: central.readUInt16LE(cursor + 10), crc: central.readUInt32LE(cursor + 16),
            compressed: central.readUInt32LE(cursor + 20), size: central.readUInt32LE(cursor + 24), offset: central.readUInt32LE(cursor + 42),
            mode: central.readUInt32LE(cursor + 38) >>> 16,
        });
        cursor += 46 + nameLength + extraLength + commentLength;
    }
    assert(cursor === length, '插件压缩包索引长度异常', 'PLUGIN_INVALID');
    return {
        entries,
        async get(name) {
            const entry = entries.get(name);
            assert(entry && !name.endsWith('/') && !(entry.flags & 1) && [0, 8].includes(entry.method) && (entry.mode & 0xf000) !== 0xa000 && entry.size <= MAX_ENTRY && entry.compressed <= MAX_ENTRY, '插件资源不可解包', 'PLUGIN_INVALID');
            const header = await read(entry.offset, 30);
            assert(header.readUInt32LE(0) === 0x04034b50 && header.readUInt16LE(8) === entry.method, '插件文件头异常', 'PLUGIN_INVALID');
            const nameLength = header.readUInt16LE(26), extraLength = header.readUInt16LE(28);
            const localName = (await read(entry.offset + 30, nameLength)).toString('utf8');
            assert(localName === name, '插件资源索引不一致', 'PLUGIN_INVALID');
            const start = entry.offset + 30 + nameLength + extraLength;
            assert(start + entry.compressed <= offset, '插件资源越界', 'PLUGIN_INVALID');
            const compressed = await read(start, entry.compressed);
            const data = entry.method === 0 ? compressed : zlib.inflateRawSync(compressed, { maxOutputLength: entry.size });
            assert(data.length === entry.size && crc32(data) === entry.crc, '插件资源校验失败', 'PLUGIN_INVALID');
            return data;
        },
    };
}
async function zipBuffer(buffer) {
    return readZip(async (offset, length) => { assert(offset >= 0 && offset + length <= buffer.length, '资源越界'); return buffer.subarray(offset, offset + length); }, buffer.length);
}
async function zipFile(file) {
    const handle = await fs.promises.open(file, 'r');
    try {
        const zip = await readZip(async (offset, length) => {
            const data = Buffer.alloc(length);
            const { bytesRead } = await handle.read(data, 0, length, offset);
            assert(bytesRead === length, '压缩包读取不完整', 'PLUGIN_INVALID'); return data;
        }, (await handle.stat()).size);
        return { ...zip, close: () => handle.close() };
    } catch (e) { await handle.close(); throw e; }
}
async function downloadRuntime(file, signal, onProgress = () => {}) {
    cancelled(signal);
    const { semi } = await import('@semi-app/plugin-sdk');
    onProgress({ phase: 'download', loaded: 0, total: pinned.size });
    const result = await semi.downloadFile({
        url: pinned.url, filePath: file, signal, timeout: 600000, maxBytes: pinned.size, redirect: 'manual',
        onProgress: ({ loaded }) => onProgress({ phase: 'download', loaded, total: pinned.size }),
    });
    assert(result.statusCode === 200 && result.bytesWritten === pinned.size, '米家插件下载校验失败，请重试', 'PLUGIN_INVALID');
}

class MijiaPluginAssets {
    constructor({ userData, adapterFile, download = downloadRuntime }) {
        this.root = path.join(userData, 'mijia-runtime'); this.adapterFile = adapterFile; this.download = download;
        const { MijiaDevicePackages } = require('./mijia-device-packages.cjs');
        this.devices = new MijiaDevicePackages({ userData });
        this.directory = path.join(this.root, pinned.version); this.loading = null; this.loaded = false;
        this.standardEnabled = true;
        const { MijiaPluginLaunch } = require('./mijia-plugin-launch.cjs');
        this.launch = new MijiaPluginLaunch({ userData, runtimeRoot: this.root, runtimeVersion: pinned.version + ':' + pinned.plugin.sha256 });
    }
    get downloadSize() { return pinned.size; }
    async isReady() {
        if (!this.loaded && await this.verify()) {
            this.loaded = true;
            try {
                const marker = JSON.parse(await fs.promises.readFile(path.join(this.directory, 'ready.json'), 'utf8'));
                this.standardEnabled = marker.standardEnabled !== false;
            } catch { this.standardEnabled = true; }
        }
        return this.loaded;
    }
    async getInfo() { return { version: await this.isReady() ? pinned.version : null }; }
    async standardPackage(candidate, raw, metadata, signal, onProgress) {
        // 只在官方 ZIP 完全相同时复用内置首页；新版本使用自己的版本目录。
        if (candidate.model === pinned.plugin.model && candidate.package === pinned.plugin.packageName && metadata.pluginId === pinned.plugin.pluginId && metadata.md5 === pinned.plugin.md5) {
            return { shared: true, metadata, project: { package_path: candidate.package }, directory: this.directory, resources: new Map() };
        }
        return this.devices.ensure(candidate.model, async () => raw, signal, metadata, onProgress);
    }
    async ensure(signal, onProgress) {
        cancelled(signal);
        if (this.loaded) return;
        if (!this.loading || this.loading.controller.signal.aborted) {
            const job = { controller: new AbortController(), clients: 0, listeners: new Set() };
            job.promise = this.load(job.controller.signal, progress => reportProgress(job, progress)).finally(() => { if (this.loading === job) this.loading = null; });
            this.loading = job;
        }
        const job = this.loading; job.clients++;
        const off = subscribeProgress(job, onProgress);
        let abort;
        const interrupted = new Promise((_resolve, reject) => { abort = () => reject(error('CANCELLED', '加载已取消')); signal?.addEventListener('abort', abort, { once: true }); });
        try { await Promise.race([job.promise, interrupted]); cancelled(signal); }
        finally {
            off();
            signal?.removeEventListener('abort', abort);
            if (--job.clients === 0 && this.loading === job) job.controller.abort();
        }
    }
    async verify() {
        try {
            const marker = JSON.parse(await fs.promises.readFile(path.join(this.directory, 'ready.json'), 'utf8'));
            if (marker.version !== pinned.version) return false;
            for (const [file, expected] of [['sdk.js', pinned.sdk.scriptSha256], ['plugin.js', pinned.plugin.scriptSha256]]) {
                const stat = await fs.promises.stat(path.join(this.directory, file));
                if (stat.size > MAX_ENTRY || await sha256File(path.join(this.directory, file)) !== expected) return false;
            }
            return true;
        } catch { return false; }
    }
    async load(signal, onProgress = () => {}) {
        if (await this.verify()) { this.loaded = true; return; }
        cancelled(signal);
        await fs.promises.mkdir(this.root, { recursive: true });
        const stage = await fs.promises.mkdtemp(path.join(this.root, 'loading-'));
        const apk = path.join(stage, 'mihome.apk'), output = path.join(stage, 'runtime');
        let archive;
        try {
            await this.download(apk, signal, onProgress);
            cancelled(signal);
            onProgress({ phase: 'verify', loaded: pinned.size, total: pinned.size });
            // 注入的下载实现同样必须通过完整校验（测试和缓存准备也不例外）。
            const stat = await fs.promises.stat(apk);
            assert(stat.size === pinned.size, '米家插件大小异常', 'PLUGIN_INVALID');
            assert(await sha256File(apk, signal) === pinned.sha256, '米家插件校验失败', 'PLUGIN_INVALID');
            onProgress({ phase: 'extract', loaded: pinned.size, total: pinned.size });
            archive = await zipFile(apk);
            const sdk = await archive.get(pinned.sdk.entry), plugin = await archive.get(pinned.plugin.entry);
            assert(sha256(sdk) === pinned.sdk.sha256 && sha256(plugin) === pinned.plugin.sha256, '米家插件版本不匹配', 'PLUGIN_INVALID');
            const standard = await zipBuffer(plugin);
            const manifest = JSON.parse((await standard.get('android/project.json')).toString('utf8'));
            assert(manifest.package_path === pinned.plugin.packageName && Number(manifest.package_prefix) === pinned.plugin.pluginId && manifest.min_sdk_api_level <= 10118, '米家插件运行版本不匹配', 'PLUGIN_INVALID');
            await fs.promises.mkdir(path.join(output, 'assets'), { recursive: true });
            for (const [file, data, expected] of [['sdk.js', sdk, pinned.sdk.scriptSha256], ['plugin.js', await standard.get('android/main.bundle'), pinned.plugin.scriptSha256]]) {
                const start = data.indexOf('__d(function');
                assert(start >= 0 && sha256(data.subarray(start)) === expected, '米家插件模块校验失败', 'PLUGIN_INVALID');
                await fs.promises.writeFile(path.join(output, file), data.subarray(start));
            }
            let total = 0;
            for (const [zip, prefix] of [[archive, 'assets/plugin_rn_sdk/'], [standard, 'android/']]) for (const [name, entry] of zip.entries) {
                if (!name.startsWith(prefix) || !imageName(name)) continue;
                cancelled(signal); total += entry.size;
                assert(total <= 64 * 1024 * 1024 && entry.size <= 4 * 1024 * 1024, '米家插件图片过大', 'PLUGIN_INVALID');
                await fs.promises.writeFile(path.join(output, 'assets', imageKey(name)), await zip.get(name));
            }
            let standardEnabled = true;
            const commonConfig = 'assets/plugin_config/rn_pluginkit_common_config.json';
            if (archive.entries.has(commonConfig)) {
                const config = JSON.parse((await archive.get(commonConfig)).toString('utf8'));
                const content = typeof config.result?.content === 'string' ? JSON.parse(config.result.content) : config.result?.content;
                standardEnabled = (content?.android?.std_plugin_enable ?? content?.both?.std_plugin_enable) !== false;
            }
            await fs.promises.writeFile(path.join(output, 'ready.json'), JSON.stringify({ version: pinned.version, standardEnabled }));
            cancelled(signal);
            await fs.promises.rm(this.directory, { recursive: true, force: true });
            await fs.promises.rename(output, this.directory);
            this.loaded = true;
            this.standardEnabled = standardEnabled;
        } catch (e) {
            if (signal.aborted) throw error('CANCELLED', '加载已取消');
            if (e.code?.startsWith('PLUGIN_')) throw e;
            throw error('PLUGIN_DOWNLOAD_FAILED', '加载米家插件失败，请检查网络后重试');
        } finally { await archive?.close(); await fs.promises.rm(stage, { recursive: true, force: true }); }
    }
    file(name) {
        assert(this.loaded, '米家插件尚未就绪', 'PLUGIN_UNAVAILABLE');
        let file;
        if (name === 'adapter.js') file = this.adapterFile;
        else if (['sdk.js', 'plugin.js'].includes(name)) file = path.join(this.directory, name);
        else if (/^assets\/[a-z0-9]+\.(png|jpe?g|webp|svg)$/.test(name)) file = path.join(this.directory, name);
        assert(file, '资源不存在', 'PLUGIN_UNAVAILABLE');
        return file;
    }
    async get(name) {
        const file = this.file(name);
        const stat = await fs.promises.stat(file);
        assert(stat.isFile() && stat.size <= MAX_ENTRY, '资源不可读取', 'PLUGIN_UNAVAILABLE');
        return fs.promises.readFile(file);
    }
}

module.exports = { MijiaPluginAssets, readZip, zipBuffer, zipFile, crc32, pinned };
