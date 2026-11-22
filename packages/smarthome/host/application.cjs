const path = require('path');
const { id: OWNER } = require('./identity.cjs');
async function readMedia(url, { query, signal, maxBytes, responseType = 'json' }) {
    const { semi } = await import('@semi-app/plugin-sdk');
    const response = await semi.request({ url, query, signal, maxBytes, responseType: responseType === 'arraybuffer' ? 'arraybuffer' : 'text', timeout: 10000, redirect: 'manual' });
    if (response.statusCode < 200 || response.statusCode >= 300) {
        throw Object.assign(new Error('网络请求失败'), { response: { status: response.statusCode } });
    }
    return response.data;
}
function install({ electron, packageRoot, accountClient }) {
    const { app } = electron; let pluginHost, unregisterPrivate;
    const { createMijiaService } = require('./mijia.cjs');
    const { createMijiaImages, IMAGE_LIMIT } = require('./mijia-images.cjs');
    const { createMijiaDebug } = require('./mijia-debug.cjs');
    const debugMijia = createMijiaDebug({ enabled: !app.isPackaged, emit: data => pluginHost?.logMijiaResponse(data) });
    const images = createMijiaImages({
        getProduct: async (model, signal) => {
            const uri = 'https://home.mi.com/cgi-op/api/v1/baike/v2/product';
            try {
                const response = await readMedia(uri, { query: { model }, signal, maxBytes: 1024 * 1024 });
                if (!signal?.aborted) debugMijia({ uri, params: { model }, response });
                return response;
            } catch (e) {
                if (!signal?.aborted) debugMijia({ uri, params: { model }, error: { code: e.code || 'IMAGE_UNAVAILABLE', httpStatus: e.response?.status ?? null } });
                throw e;
            }
        },
        download: async (url, signal) => Buffer.from(await readMedia(url, { signal, responseType: 'arraybuffer', maxBytes: IMAGE_LIMIT })),
    });
    const mijiaOptions = {
        getSession: () => null, getRouterId: () => null, postSigned: () => { throw new Error('请先登录账号'); }, images, debug: debugMijia,
        getSpec: async (type, signal) => {
            const uri = 'https://miot-spec.org/miot-spec-v2/instance';
            try {
                const response = await readMedia(uri, { query: { type }, signal, maxBytes: 2 * 1024 * 1024 });
                if (!signal?.aborted) debugMijia({ uri, params: { type }, response });
                return response;
            } catch (e) {
                if (!signal?.aborted) debugMijia({ uri, params: { type }, error: { code: e.code || 'MIOT_SPEC_ERROR', httpStatus: e.response?.status ?? null } });
                throw e;
            }
        },
        getSpecTranslations: async (urn, signal) => {
            const uri = 'https://miot-spec.org/instance/v2/multiLanguage';
            try {
                const response = await readMedia(uri, { query: { urn }, signal, maxBytes: 2 * 1024 * 1024 });
                if (!response?.data || typeof response.data !== 'object' || Array.isArray(response.data)) throw Object.assign(new Error('规格翻译格式异常'), { code: 'MIOT_SPEC_ERROR' });
                if (!signal?.aborted) debugMijia({ uri, params: { urn }, response });
                return response;
            } catch (e) {
                if (!signal?.aborted) debugMijia({ uri, params: { urn }, error: { code: e.code || 'MIOT_SPEC_ERROR', httpStatus: e.response?.status ?? null } });
                throw e;
            }
        },
    };
    const mijia = createMijiaService(mijiaOptions);
    const { MijiaPluginAssets } = require('./mijia-plugin-assets.cjs');
    const mijiaAssets = new MijiaPluginAssets({ userData: app.getPath('userData'), adapterFile: path.join(packageRoot, 'dist/mijia-runtime.js') });
    const scopes = new Map();
    function servicesFor(pluginId, accountId) {
        const auth = accountClient(accountId);
        if (!auth) return null;
        const key = `${pluginId}:${accountId || ''}`;
        if (scopes.get(key)?.identity !== auth.identity) scopes.set(key, { identity: auth.identity, mijia: createMijiaService({ ...mijiaOptions, getSession: auth.current, postSigned: args => auth.call('xiaomi.auth', 'request', { purpose: 'mijia', path: args.uri, method: 'POST', payload: JSON.stringify(args.data) }, args.signal), getRouterId: () => null }) });
        return scopes.get(key);
    }
    const accountServices = (pluginId, accountId) => pluginId === OWNER ? servicesFor(pluginId, accountId) : null;
    return { accountServices, accountRemoved(id) { for (const key of scopes.keys()) if (key.endsWith(':' + id)) scopes.delete(key); }, dispose() { unregisterPrivate?.(); mijiaAssets.loading?.controller.abort(); for (const job of mijiaAssets.devices?.jobs.values() || []) job.controller.abort(); scopes.clear(); }, integration: host => require('./integration.cjs').integrate(host, { mijia, mijiaAssets }),
        setHost(host) { pluginHost = host; unregisterPrivate = require('./private-api.cjs').registerPrivateAPI(host, servicesFor); host.cache.registerDirectories(OWNER, [{ category: '设备插件', folder: 'mijia-device-plugins' }, { category: '米家运行资源', folder: 'mijia-runtime' }]); },
    };
}
module.exports = { install };
