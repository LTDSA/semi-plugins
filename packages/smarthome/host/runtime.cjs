const crypto = require('crypto');
const { assert, error } = require('../browser/contracts.cjs');
const { id: OWNER, origin, resourceHost } = require('./identity.cjs');
const { imageUrl } = require('./mijia-images.cjs');

const PREFIX = '/.semi/mijia-runtime/';
const MIME = { html: 'text/html', js: 'text/javascript', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', svg: 'image/svg+xml', gif: 'image/gif', json: 'application/json', ttf: 'font/ttf', otf: 'font/otf', woff: 'font/woff', woff2: 'font/woff2' };
function linkedSignal(...signals) {
    const controller = new AbortController();
    const abort = () => controller.abort();
    for (const signal of signals) { if (signal?.aborted) controller.abort(); else signal?.addEventListener('abort', abort, { once: true }); }
    return { signal: controller.signal, dispose: () => signals.forEach(signal => signal?.removeEventListener('abort', abort)) };
}

class MijiaRuntime {
    constructor({ mijia, assets, isDark = () => false, powerSaveBlocker }) { this.mijia = mijia; this.assets = assets; this.isDark = isDark; this.powerSaveBlocker = powerSaveBlocker; this.leases = new Map(); this.generations = new Map(); }
    setVisible(instance, visible) {
        for (const lease of this.leases.values()) if (lease.owner === instance.id) this.updateScreenLock(lease, visible && lease.keepScreenOn);
    }
    updateScreenLock(lease, enabled) {
        if (enabled && lease.screenBlocker === undefined) lease.screenBlocker = this.powerSaveBlocker.start('prevent-display-sleep');
        else if (!enabled && lease.screenBlocker !== undefined) { this.powerSaveBlocker.stop(lease.screenBlocker); delete lease.screenBlocker; }
    }
    release(instance) {
        this.generations.delete(instance.id);
        for (const [id, lease] of this.leases) if (lease.owner === instance.id) { this.updateScreenLock(lease, false); lease.controller.abort(); this.leases.delete(id); }
    }
    async open(instance, did, signal, options = {}, onProgress = () => {}) {
        assert(instance.item.manifest.id === OWNER && (instance.viewId === 'main' || instance.layer && instance.viewId === 'device-plugin' && instance.params.did === did), '此页面不能运行设备插件', 'PERMISSION_DENIED');
        this.release(instance);
        const generation = Symbol(); this.generations.set(instance.id, generation);
        const revision = this.mijia.getSessionRevision();
        const ready = await this.assets.isReady();
        assert(!signal.aborted && !instance.closed && this.generations.get(instance.id) === generation && this.mijia.getSessionRevision() === revision, '加载已取消或账号已变化', 'CONTEXT_CHANGED');
        const reportReady = loaded => onProgress({ phase: 'ready', resource: 'runtime', loaded, total: loaded, percent: 100 });
        if (ready) reportReady(0);
        const context = await this.mijia.getDevicePluginContext(did, signal);
        did = context.device.did;
        assert(!signal.aborted && !instance.closed && this.generations.get(instance.id) === generation && this.mijia.getSessionRevision() === revision, '加载已取消或账号已变化', 'CONTEXT_CHANGED');
        assert(options.download === true || ready, '首次使用需要下载共享运行资源', 'PLUGIN_DOWNLOAD_REQUIRED');
        let lastTime = 0, lastPhase;
        const progress = value => {
            if (signal.aborted || instance.closed || this.generations.get(instance.id) !== generation || this.mijia.getSessionRevision() !== revision) return;
            const { loaded, total, phase } = value;
            const now = Date.now();
            if (phase === lastPhase && now - lastTime < 100) return;
            lastTime = now; lastPhase = phase;
            onProgress({ phase, resource: 'runtime', loaded, total, percent: total > 0 ? Math.min(99, Math.floor(loaded / total * 100)) : 0 });
        };
        if (!ready) progress({ phase: 'metadata', loaded: 0, total: this.assets.downloadSize });
        await this.assets.ensure(signal, progress);
        assert(!signal.aborted && !instance.closed && this.generations.get(instance.id) === generation && this.mijia.getSessionRevision() === revision, '加载已取消或账号已变化', 'CONTEXT_CHANGED');
        if (!ready) reportReady(this.assets.downloadSize);
        const deviceProgress = ({ phase, loaded, total }) => {
            if (signal.aborted || instance.closed || this.generations.get(instance.id) !== generation || this.mijia.getSessionRevision() !== revision) return;
            const percent = total > 0 ? Math.max(0, Math.min(100, loaded / total * 100)) : 0;
            onProgress({ phase, resource: 'device', loaded, total, percent });
        };
        const selected = this.assets.launch ? await this.assets.launch.select({ mijia: this.mijia, assets: this.assets, context, did, signal, onProgress: deviceProgress }) : null;
        const devicePackage = selected ? selected.devicePackage : this.assets.devices ? await this.assets.devices.ensure(context.device.model, downloadSignal => this.mijia.getDevicePluginMetadata(did, downloadSignal), signal, undefined, deviceProgress) : null;
        assert(!signal.aborted && !instance.closed && this.generations.get(instance.id) === generation && this.mijia.getSessionRevision() === revision, '加载已取消或账号已变化', 'CONTEXT_CHANGED');
        const id = crypto.randomBytes(24).toString('hex');
        const base = `${origin}${PREFIX}${id}/`;
        this.leases.set(id, { owner: instance.id, plugin: instance.item.manifest.id, revision, did, context: selected ? { ...context, resource: selected.resource } : context, launch: selected?.launch, devicePackage, base, controller: new AbortController(), writing: false });
        return { id, did, url: `${base}index.html` };
    }
    async hostCall(instance, id, command, params, signal) {
        const lease = this.lease(id, instance);
        assert(instance.visible, '设备页面不可见', 'RUNTIME_HIDDEN');
        if (command === 'vendor-read') {
            const linked = linkedSignal(signal, lease.controller.signal);
            try {
                const value = await require('./mijia-vendor-read.cjs').vendorRead(params, lease.context.device, this.mijia.getDevicePluginIdentity().accountId, linked.signal);
                this.lease(id, instance);
                let json;
                try { json = JSON.parse(value.body); } catch { return value; }
                value.body = JSON.stringify(this.imageReferences(lease, json, '', 0, true));
                return value;
            } finally { linked.dispose(); }
        }
        if (command === 'keep-screen-on') {
            assert(typeof params.enabled === 'boolean' && Object.keys(params).length === 1, '屏幕常亮参数无效');
            assert(this.powerSaveBlocker, '宿主未提供屏幕常亮能力', 'UNSUPPORTED');
            lease.keepScreenOn = params.enabled;
            this.updateScreenLock(lease, params.enabled);
            return null;
        }
        assert(this.assets.launch && lease.launch, '此运行资源不支持样式切换', 'PLUGIN_UNAVAILABLE');
        if (command === 'set-homepage') {
            this.assets.launch.setPreference(this.mijia, lease.context.device.model, params.homepage_type);
            lease.launch.preference = params.homepage_type;
            return null;
        }
        assert(command === 'navigate', '设备页面操作无效');
        const mode = params.mode === 'back' ? lease.back : params.mode;
        if (!mode) return null;
        assert(!lease.navigating && !lease.writing, '设备页面正在操作，请稍后重试', 'PROPERTY_BUSY');
        lease.navigating = true;
        const linked = linkedSignal(signal, lease.controller.signal);
        try {
            const context = await this.mijia.getDevicePluginContext(lease.did, linked.signal);
            const selected = await this.assets.launch.select({ mijia: this.mijia, assets: this.assets, context, did: lease.did, signal: linked.signal, mode });
            this.lease(id, instance);
            assert(!linked.signal.aborted, '页面已关闭', 'CANCELLED');
            const nextId = crypto.randomBytes(24).toString('hex');
            const base = `${origin}${PREFIX}${nextId}/`;
            const next = { ...lease, context: { ...context, resource: selected.resource }, devicePackage: selected.devicePackage, launch: selected.launch, base,
                controller: new AbortController(), writing: false, navigating: false, images: new Map(),
                back: mode === 'traditional' && lease.launch.style === 'standard' ? 'standard' : null,
                page: { entrance: params.pageName || 'main', params: params.pageParams || {} } };
            delete next.screenBlocker;
            next.keepScreenOn = false;
            this.leases.set(nextId, next);
            this.close(instance, id);
            return { id: nextId, did: lease.did, url: `${base}index.html` };
        } finally { linked.dispose(); lease.navigating = false; }
    }
    lease(id, instance) {
        const lease = this.leases.get(id);
        assert(lease && (!instance || lease.owner === instance.id), '设备页面已关闭', 'RUNTIME_CLOSED');
        if (lease.revision !== this.mijia.getSessionRevision()) {
            this.updateScreenLock(lease, false);
            lease.controller.abort(); this.leases.delete(id);
            throw error('CONTEXT_CHANGED', '米家账号已变化，请重新打开设备');
        }
        return lease;
    }
    close(instance, id) {
        const lease = this.leases.get(id);
        if (!lease) return null;
        assert(lease.owner === instance.id, '不能关闭其他页面', 'PERMISSION_DENIED');
        this.updateScreenLock(lease, false); lease.controller.abort(); this.leases.delete(id); return null;
    }
    permitsFrame(instance, url) {
        try {
            const target = new URL(url), match = target.pathname.match(/^\/\.semi\/mijia-runtime\/([a-f0-9]{48})\/(index\.html|assets\/([a-z0-9]+\.html))$/);
            if (!match || target.protocol !== 'semi-plugin:' || target.hostname !== resourceHost || target.search || target.hash) return false;
            const lease = this.lease(match[1], instance);
            return lease.plugin === instance.item.manifest.id && (match[2] === 'index.html' || lease.devicePackage?.resources?.has(match[3]));
        } catch { return false; }
    }
    async properties(instance, id, properties, signal, write, datasource) {
        const lease = this.lease(id, instance);
        assert(instance.visible, '设备页面不可见', 'RUNTIME_HIDDEN');
        if (write) assert(!lease.writing && !lease.navigating, '上次操作尚未完成', 'PROPERTY_BUSY');
        const linked = linkedSignal(signal, lease.controller.signal);
        if (write) lease.writing = true;
        try {
            const method = write ? 'setDevicePluginProperties' : 'getDevicePluginProperties';
            const result = await this.mijia[method](lease.did, properties, lease.context.binding, linked.signal, datasource);
            this.lease(id, instance);
            assert(!linked.signal.aborted, '操作已取消', 'CANCELLED');
            if (!write && result.some(item => item.code !== 0)) this.mijia.reportDevicePluginReadFailure?.({ kind: 'properties', datasource, failed: result.filter(item => item.code !== 0).map(({ siid, piid, code }) => ({ siid, piid, code })) });
            return result;
        } finally { if (write) lease.writing = false; linked.dispose(); }
    }
    async doAction(instance, id, params, signal) {
        const lease = this.lease(id, instance);
        assert(!lease.navigating, '页面正在切换', 'PROPERTY_BUSY');
        assert(instance.visible, '设备页面不可见', 'RUNTIME_HIDDEN');
        const linked = linkedSignal(signal, lease.controller.signal);
        try {
            const result = await this.mijia.doDevicePluginAction(lease.did, params, lease.context.binding, linked.signal);
            this.lease(id, instance);
            assert(!linked.signal.aborted, '操作已取消', 'CANCELLED');
            return result;
        } finally { linked.dispose(); }
    }
    async history(instance, id, params, signal) {
        const lease = this.lease(id, instance);
        assert(instance.visible, '设备页面不可见', 'RUNTIME_HIDDEN');
        const linked = linkedSignal(signal, lease.controller.signal);
        try {
            const result = await this.mijia.getDevicePluginHistory(lease.did, params, lease.context.binding, linked.signal);
            this.lease(id, instance);
            assert(!linked.signal.aborted, '操作已取消', 'CANCELLED');
            return result;
        } finally { linked.dispose(); }
    }
    async authorizedDevices(instance, id, model, signal) {
        const lease = this.lease(id, instance);
        assert(instance.visible, '设备页面不可见', 'RUNTIME_HIDDEN');
        const linked = linkedSignal(signal, lease.controller.signal);
        try {
            const result = await this.mijia.getDevicePluginAuthorizedDevices(lease.did, model, linked.signal);
            this.lease(id, instance);
            assert(!linked.signal.aborted, '操作已取消', 'CANCELLED');
            return result;
        } finally { linked.dispose(); }
    }
    async checkVersion(instance, id, pid, signal) {
        const lease = this.lease(id, instance);
        assert(instance.visible, '设备页面不可见', 'RUNTIME_HIDDEN');
        const linked = linkedSignal(signal, lease.controller.signal);
        try {
            const result = await this.mijia.getDevicePluginVersion(lease.did, pid, linked.signal);
            this.lease(id, instance);
            assert(!linked.signal.aborted, '操作已取消', 'CANCELLED');
            return result;
        } finally { linked.dispose(); }
    }
    async gatewayInfo(instance, id, mac, signal) {
        const lease = this.lease(id, instance);
        assert(instance.visible, '设备页面不可见', 'RUNTIME_HIDDEN');
        const linked = linkedSignal(signal, lease.controller.signal);
        try {
            const result = await this.mijia.getDevicePluginGatewayInfo(lease.did, mac, linked.signal);
            this.lease(id, instance);
            assert(!linked.signal.aborted, '操作已取消', 'CANCELLED');
            return result;
        } finally { linked.dispose(); }
    }
    async cloudRead(instance, id, api, params, signal) {
        const lease = this.lease(id, instance);
        assert(instance.visible, '设备页面不可见', 'RUNTIME_HIDDEN');
        const linked = linkedSignal(signal, lease.controller.signal);
        try {
            const result = await this.mijia.getDevicePluginCloudRead(lease.did, api, params, linked.signal);
            this.lease(id, instance);
            assert(!linked.signal.aborted, '操作已取消', 'CANCELLED');
            return this.imageReferences(lease, result);
        } catch (error) {
            if (error.code !== 'CANCELLED') this.mijia.reportDevicePluginReadFailure?.({ kind: 'cloud', api: typeof api === 'string' && /^\/[a-zA-Z0-9/_-]{1,160}$/.test(api) ? api.replace(/\/home\/rpc\/[^/]+$/, '/home/rpc/<device>') : '<invalid-api>', code: error.code || 'MIJIA_ERROR' });
            throw error;
        } finally { linked.dispose(); }
    }
    async cloudWrite(instance, id, api, params, signal) {
        const lease = this.lease(id, instance);
        assert(!lease.navigating, '页面正在切换', 'PROPERTY_BUSY');
        assert(instance.visible, '设备页面不可见', 'RUNTIME_HIDDEN');
        const linked = linkedSignal(signal, lease.controller.signal);
        try {
            const result = await this.mijia.getDevicePluginCloudWrite(lease.did, api, params, linked.signal);
            this.lease(id, instance);
            assert(!linked.signal.aborted, '操作已取消', 'CANCELLED');
            return result;
        } finally { linked.dispose(); }
    }
    async cloudCall(instance, id, api, params, signal) {
        const lease = this.lease(id, instance);
        assert(instance.visible, '设备页面不可见', 'RUNTIME_HIDDEN');
        const linked = linkedSignal(signal, lease.controller.signal);
        try {
            const result = await this.mijia.getDevicePluginCloudCall(lease.did, api, params, linked.signal);
            this.lease(id, instance);
            assert(!linked.signal.aborted, '操作已取消', 'CANCELLED');
            return this.imageReferences(lease, result);
        } finally { linked.dispose(); }
    }
    imageReferences(lease, value, key = '', depth = 0, allImages = false) {
        if (depth > 16) return value;
        if (typeof value === 'string' && (allImages || ['proxy_category_icon', 'icon'].includes(key))) {
            const url = imageUrl(value);
            if (url) {
                const id = crypto.createHash('sha256').update(url).digest('hex');
                lease.images ||= new Map();
                assert(lease.images.has(id) || lease.images.size < 128, '设备页面图片数量过多', 'QUOTA_EXCEEDED');
                lease.images.set(id, url);
                return `${lease.base}images/${id}`;
            }
        }
        if (Array.isArray(value)) return value.map(item => this.imageReferences(lease, item, key, depth + 1, allImages));
        if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([name, item]) => [name, this.imageReferences(lease, item, name, depth + 1, allImages)]));
        return value;
    }
    async resource(plugin, pathname, { streamFiles = false } = {}) {
        const match = pathname.match(/^\/\.semi\/mijia-runtime\/([a-f0-9]{48})\/(index\.html|bootstrap\.js|adapter\.js|sdk\.js|plugin\.js|device\.js|device-icon|images\/[a-f0-9]{64}|assets\/[a-z0-9]+\.(?:png|jpe?g|webp|svg|gif|json|html|ttf|otf|woff2?))$/);
        assert(match, '资源不存在', 'PLUGIN_UNAVAILABLE');
        const lease = this.lease(match[1]);
        assert(lease.plugin === plugin, '资源不可访问', 'PERMISSION_DENIED');
        const file = match[2];
        // 明确列出资源域：sandbox 子 frame 为 opaque origin，不依赖 'self'。
        const htmlAsset = file.startsWith('assets/') && file.endsWith('.html');
        const csp = `sandbox allow-scripts; default-src 'none'; script-src ${htmlAsset ? "'unsafe-inline'" : lease.base}; style-src 'unsafe-inline'; img-src ${lease.base} data: blob:; connect-src ${htmlAsset ? "'none'" : lease.base}; font-src ${lease.base} data:; frame-src ${htmlAsset ? "'none'" : lease.base}; object-src 'none'; base-uri 'none'; form-action 'none'`;
        const standard = lease.launch ? lease.launch.style === 'standard' : !lease.devicePackage || ['increment', 'standard'].includes(lease.devicePackage.metadata.kind);
        const shared = !lease.devicePackage || lease.devicePackage.shared || !lease.launch && standard;
        let data, filePath, contentType = MIME[file.split('.').pop()] || 'application/octet-stream';
        if (file === 'index.html') data = `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1"><title>设备</title><style>html,body,#app{width:100%;height:100%;margin:0;overflow:hidden}body{background:${this.isDark() ? '#16161a' : '#fff'}}#app{display:flex;flex-direction:column}*{box-sizing:border-box}</style><div id="app"></div><script src="${lease.base}bootstrap.js"></script><script src="${lease.base}adapter.js"></script><script src="${lease.base}sdk.js"></script><script src="${lease.base}${shared && standard ? 'plugin.js' : 'device.js'}"></script></html>`;
        else if (file === 'bootstrap.js') data = `window.__SEMI_MIJIA_BOOT=${JSON.stringify({ ...lease.context, device: { ...lease.context.device, iconURL: `${lease.base}device-icon` }, launch: lease.launch, page: lease.page, canGoBack: Boolean(lease.back), package: lease.devicePackage ? { kind: standard ? 'standard' : lease.devicePackage.metadata.kind, project: lease.devicePackage.project, pluginId: lease.launch ? lease.devicePackage.metadata.pluginId : standard ? 1006883 : lease.devicePackage.metadata.pluginId, version: lease.devicePackage.metadata.version } : null, base: lease.base, dark: this.isDark() }).replace(/</g, '\\u003c').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029')};`;
        else if (file === 'device-icon') {
            // 图标始终绑定本句柄的真实设备，复用宿主产品图片／按键图标缓存。
            const image = await this.mijia.getDeviceImage(lease.did, lease.controller.signal);
            data = image.data; contentType = image.contentType;
        }
        else if (file.startsWith('images/')) {
            const url = lease.images?.get(file.slice(7));
            assert(url, '图片不属于当前设备页面', 'PERMISSION_DENIED');
            const image = await this.mijia.getDevicePluginImage(lease.did, url, lease.controller.signal);
            data = image.data; contentType = image.contentType;
        } else if (lease.devicePackage && (file === 'device.js' || file.startsWith('assets/'))) {
            assert(file !== 'device.js' || !shared && lease.devicePackage.metadata.kind !== 'standard', '此设备使用官方标准插件', 'PLUGIN_UNAVAILABLE');
            if (streamFiles && file === 'device.js') filePath = this.assets.devices.file(lease.devicePackage, file);
            else {
                try { if (shared) throw error('PLUGIN_UNAVAILABLE', '共享资源'); data = await this.assets.devices.get(lease.devicePackage, file); }
                catch (e) { if (file === 'device.js') throw e; data = await this.assets.get(file); }
            }
        } else {
            assert(standard || file !== 'plugin.js', '此设备未加载标准插件', 'PLUGIN_UNAVAILABLE');
            if (streamFiles && file.endsWith('.js')) filePath = this.assets.file(file);
            else data = await this.assets.get(file);
        }
        if (htmlAsset) {
            contentType = 'text/html;charset=utf-8';
            const bridge = `<script>window.ReactNativeWebView={postMessage:data=>parent.postMessage({channel:'semi-mijia-webview',data:String(data)},'*')};window.addEventListener('message',event=>{if(event.source===parent)document.dispatchEvent(new MessageEvent('message',{data:event.data}));});</script>`;
            const html = data.toString('utf8');
            data = Buffer.from(/<head(?:\s[^>]*)?>/i.test(html) ? html.replace(/<head(?:\s[^>]*)?>/i, head => head + bridge) : html.replace(/^(<!doctype[^>]*>)?/i, prefix => prefix + bridge));
        }
        this.lease(match[1]);
        return { data, filePath, headers: { 'Content-Type': contentType, 'Content-Security-Policy': csp, 'Access-Control-Allow-Origin': '*', 'Cross-Origin-Resource-Policy': 'cross-origin', 'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'no-store' } };
    }
}

module.exports = { MijiaRuntime, linkedSignal, PREFIX };
