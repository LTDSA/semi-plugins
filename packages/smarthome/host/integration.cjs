const { assert } = require('../browser/contracts.cjs');
const { MijiaRuntime, PREFIX: MIJIA_RUNTIME_PREFIX } = require('./runtime.cjs');
const { validateMijiaCall } = require('./contracts.cjs');
const { id: OWNER, origin } = require('./identity.cjs');
const CSP = "default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; connect-src 'none'; frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'";
function integrate(host, { mijia, mina, mijiaAssets, requiredPermissions = () => [] } = {}) {
    for (const [key, value] of Object.entries({ mijia, mina })) if (value) host['_' + key] = value;
    for (const key of ['mijia', 'mina', 'mijiaRuntime']) Object.defineProperty(host, key, {
        configurable: true, get() { return this.accountScope?.getStore()?.[key === 'mijiaRuntime' ? 'runtime' : key] || this['_' + key]; }, set(value) { this['_' + key] = value; },
    });
    const makeRuntime = service => new MijiaRuntime({ mijia: service, assets: mijiaAssets, isDark: () => host.electron.nativeTheme.shouldUseDarkColors, powerSaveBlocker: host.electron.powerSaveBlocker });
    host._mijiaRuntime = mijia && mijiaAssets ? makeRuntime(mijia) : null;
    host.logMijiaResponse = function (data) {
        if (this.electron.app.isPackaged) return;
        const scope = this.accountScope.getStore();
        if (this.accountRegistry && !scope) return;
        for (const instance of this.instances.values()) {
            if (scope && this.accountServicesFor(instance.item.manifest.id, instance.accountBinding?.accountId) !== scope) continue;
            if (instance.item.manifest.id === OWNER) this.emit(instance, 'mijia.debug', data);
        }
    }
    const runtimeFor = instance => host.accountServicesFor(instance.item.manifest.id, instance.accountBinding?.accountId)?.runtime || host._mijiaRuntime;
    const owns = instance => instance.item.manifest.id === OWNER;
    return {
        releaseInstance(instance, services) { if (owns(instance)) (services?.runtime || runtimeFor(instance))?.release(instance); },
        visibilityChanged(instance, visible) { if (owns(instance)) runtimeFor(instance)?.setVisible?.(instance, visible); },
        allowsFrame: (instance, url) => owns(instance) && Boolean(runtimeFor(instance)?.permitsFrame?.(instance, url)),
        availability(item) { if (!host.accountRegistry && item.manifest.requires?.includes('mijia') && typeof host.mijia?.hasSession === 'function' && !host.mijia.hasSession()) return { available: false, code: 'CAPABILITY_UNAVAILABLE', reason: '请先使用米家账号远程登录' }; },
        accountOnly: (item, scope) => host.accountRegistry && scope !== 'device' && (item.manifest.requires?.includes('mijia') || item.manifest.permissions.some(p => /^(mijia|mina)\./.test(p))),
        accountCapabilities: values => [...values, 'mijia'],
        initialCapabilities: () => host.mijia?.hasSession?.() ? ['mijia'] : [],
        hasAccount: () => host.mijia?.hasSession?.(),
        requiresAccount: method => /^(mijia|mina)\./.test(method) && method !== 'mijia.plugin.close',
        cacheSensitive: method => method === 'mijia.plugin.open',
        accountRevision: () => host.mijia?.getSessionRevision?.(),
        authorize(instance, method, params) {
            if (!method.startsWith('mijia.') || method === 'mijia.account') return false;
            assert(instance.item.manifest.id === OWNER, '米家业务入口仅属于智能设备插件，请使用声明的服务', 'PERMISSION_DENIED');
            validateMijiaCall(method, params); return true;
        },
        requiredPermissions(method, params) { return method.startsWith('mijia.') ? [] : requiredPermissions(method, params).filter(p => !host.accountRegistry || p !== 'mijia.account'); },
        async accountRequest(instance, method, p, signal) { if (method !== 'permissions.request' || !(p.permissions || [p.permission]).includes('mijia.account')) return null; return { handled: true, value: await (async () => {
            if (method === 'permissions.request' && (p.permissions || [p.permission]).includes('mijia.account')) {
                await host.accountRegistry.request(instance.item, 'account.xiaomi.com', { signal, runtimeId: instance.id });
                const remaining = (p.permissions || [p.permission]).filter(permission => permission !== 'mijia.account');
                if (!p.permissions) return true;
                return { 'mijia.account': true, ...(remaining.length ? await host.permissions.requestMany(instance.item, remaining, p.reason, instance.id) : {}) };
            }
        })() }; },
        prepareServices(services) { if (services?.mijia && !services.runtime && mijiaAssets) services.runtime = makeRuntime(services.mijia); },
        policy(item, policy) { return item.manifest.id === OWNER ? policy.replace("frame-src 'none'", `frame-src ${origin}${MIJIA_RUNTIME_PREFIX}`) : policy; },
        async resource(item, binding, request, url) {
            const id = item.manifest.id;
        if (url.pathname.startsWith(MIJIA_RUNTIME_PREFIX)) {
                    assert(!host.accountRegistry || host.accountRegistry.session(id), '请先登录账号', 'AUTH_REQUIRED');
                    host.check(item);
                    assert(id === OWNER && host.mijiaRuntime, '设备插件资源不可访问');
                    const resource = await host.mijiaRuntime.resource(id, url.pathname, { streamFiles: request.streamFiles });
                    if (resource.filePath) return resource;
                    return new Response(resource.data, { headers: resource.headers });
                }
                const image = url.pathname.match(/^\/\.semi\/mijia-images\/([^/]+)$/);
                if (image) {
                    host.check(item);
                    assert(id === OWNER && host.mijia, '设备图片不可访问');
                    assert(host.accountRegistry ? host.accountRegistry.session(id) : host.mijia?.hasSession?.(), '请先请求账号登录', 'AUTH_REQUIRED');
                    const did = decodeURIComponent(image[1]);
                    assert(/^[a-zA-Z0-9._:-]{1,256}$/.test(did), '设备标识无效');
                    const result = await host.mijia.getDeviceImage(did, request.signal);
                    return new Response(result.data, { headers: { 'Content-Type': result.contentType, 'Content-Security-Policy': CSP, 'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'no-store' } });
                }

            return null;
        },
        async clearCache(item) { const id = item.manifest.id;
            if (id === OWNER && host.mijiaRuntime) {
                for (const instance of [...host.instances.values()]) if (instance.item === item) {
                    runtimeFor(instance)?.release(instance);
                    if (instance.layer) host.closeInstance(instance);
                    for (const request of host.requests.values()) if (request.instance === instance.id) request.controller.abort();
                }
                const assets = host.mijiaRuntime.assets;
                const jobs = [assets.loading, ...(assets.devices?.jobs.values() || [])].filter(Boolean);
                for (const job of jobs) job.controller.abort();
                await Promise.allSettled(jobs.map(job => job.promise));
                assets.loaded = false;
            }

        },
        async request(instance, method, p, signal) {
            if (!method.startsWith('mijia.plugin.')) return null;
            assert(instance.item.manifest.id === OWNER, '米家运行时属于智能设备插件', 'PERMISSION_DENIED');
            validateMijiaCall(method, p);
            const item = instance.item, m = item.manifest;
            return { handled: true, value: await (async () => {
        if (method.startsWith('mijia.plugin.')) {

            assert(host.mijiaRuntime, '设备插件运行时不可用', 'PLUGIN_UNAVAILABLE');
            if (method !== 'mijia.plugin.close') host.check(item);
            if (method === 'mijia.plugin.runtime-info') return host.mijiaRuntime.assets.getInfo();
            if (method === 'mijia.plugin.host-call') return host.mijiaRuntime.hostCall(instance, p.id, p.command, p.params, signal);
            if (method === 'mijia.plugin.open') return host.mijiaRuntime.open(instance, p.did, signal, { download: p.download }, progress => {
                if (p.progressId && !signal.aborted) host.emit(instance, 'mijia.plugin.download-progress', { ...progress, progressId: p.progressId });
            });
            if (method === 'mijia.plugin.close') return host.mijiaRuntime.close(instance, p.id);
            if (method === 'mijia.plugin.history') return host.mijiaRuntime.history(instance, p.id, p.params, signal);
            if (method === 'mijia.plugin.action') return host.mijiaRuntime.doAction(instance, p.id, p.params, signal);
            if (method === 'mijia.plugin.authorized-devices') return host.mijiaRuntime.authorizedDevices(instance, p.id, p.model, signal);
            if (method === 'mijia.plugin.check-version') return host.mijiaRuntime.checkVersion(instance, p.id, p.pid, signal);
            if (method === 'mijia.plugin.gateway-info') return host.mijiaRuntime.gatewayInfo(instance, p.id, p.mac, signal);
            if (method === 'mijia.plugin.cloud-read') return host.mijiaRuntime.cloudRead(instance, p.id, p.api, p.params, signal);
            if (method === 'mijia.plugin.cloud-write') return host.mijiaRuntime.cloudWrite(instance, p.id, p.api, p.params, signal);
            if (method === 'mijia.plugin.cloud-call') {
                return host.mijiaRuntime.cloudCall(instance, p.id, p.api, p.params, signal);
            }
            return host.mijiaRuntime.properties(instance, p.id, p.properties, signal, method === 'mijia.plugin.write', p.datasource);
        }

            })() };
        },
    };
}
module.exports = { integrate };
