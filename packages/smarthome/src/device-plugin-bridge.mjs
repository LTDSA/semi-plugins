const CHANNEL = 'semi-mijia-device-v1';
const storageNamespace = new Map();
async function persistentStorageKey(did, key) {
    if (typeof key !== 'string' || !key || key.length > 128) throw new Error('缓存键无效');
    const source = `${did}\0${key}`;
    if (storageNamespace.has(source)) return storageNamespace.get(source);
    const digest = new Uint8Array(await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(source)));
    const storageKey = 'mijia-host:' + Array.from(digest, byte => byte.toString(16).padStart(2, '0')).join('');
    if (storageNamespace.size > 512) storageNamespace.clear();
    storageNamespace.set(source, storageKey);
    return storageKey;
}

// opaque-origin iframe 没有 SDK；仅其真实 contentWindow 可通过此有限桥接操作当前页面。
export function createDevicePluginBridge({ frame, runtime, did, sdk, onClose, onReady, onError, onUnsupported, onNavigate }) {
    const pending = new Map();
    let disposed = false, visible = true;
    const send = message => { if (!disposed) frame.contentWindow?.postMessage({ channel: CHANNEL, ...message }, '*'); };
    const cancel = () => { for (const request of pending.values()) request.abort(); pending.clear(); };
    const handle = async event => {
        if (disposed || event.source !== frame.contentWindow || event.origin !== 'null' || event.data?.channel !== CHANNEL) return;
        const message = event.data;
        if (message.type === 'close') { onClose(); return; }
        if (message.type === 'loaded') { send({ type: 'visibility', visible }); onReady(); return; }
        if (message.type === 'error') { if (typeof message.message === 'string') console.error('[米家设备插件]', message.message.slice(0, 1000)); onError('设备插件加载失败，请重试'); return; }
        if (message.type === 'unsupported') { onUnsupported?.(); return; }
        if (message.type === 'cancel') { pending.get(message.id)?.abort(); return; }
        if (message.type !== 'request' || typeof message.id !== 'string' || !/^r\d{1,12}$/.test(message.id) || pending.has(message.id)) return;
        const fail = (code, text) => send({ type: 'reply', id: message.id, ok: false, error: { code, message: text } });
        if (!visible) { fail('RUNTIME_HIDDEN', '设备页面不可见'); return; }
        const write = message.method === 'write';
        const storageOperation = ['storage-get', 'storage-set', 'storage-remove'].includes(message.method);
        if (storageOperation) {
            const params = message.params;
            if (!params || typeof params !== 'object' || Array.isArray(params) || typeof params.key !== 'string' || !params.key || params.key.length > 128) { fail('INVALID_ARGUMENT', '页面缓存参数无效'); return; }
            if (message.method === 'storage-set') {
                if (params.value === undefined) { fail('INVALID_ARGUMENT', '页面缓存值无效'); return; }
                try {
                    const serialized = JSON.stringify(params.value);
                    if (serialized.length > 256 * 1024) { fail('QUOTA_EXCEEDED', '页面缓存值过大'); return; }
                } catch { fail('INVALID_ARGUMENT', '页面缓存值不能序列化'); return; }
            }
            const controller = new AbortController(); pending.set(message.id, controller);
            try {
                const storageKey = await persistentStorageKey(did, params.key);
                let value = null;
                if (message.method === 'storage-get') ({ data: value } = await sdk.getStorage({ key: storageKey }));
                else if (message.method === 'storage-set') await sdk.setStorage({ key: storageKey, data: params.value });
                else await sdk.removeStorage({ key: storageKey });
                if (!controller.signal.aborted) send({ type: 'reply', id: message.id, ok: true, value });
            } catch (e) {
                if (!controller.signal.aborted) fail(e.code || 'STORAGE_ERROR', e.message || '页面缓存操作失败');
            } finally { pending.delete(message.id); }
            return;
        }
        if (pending.size >= (write ? 8 : 128)) { fail('QUOTA_EXCEEDED', '操作过于频繁'); return; }
        const operation = ['plugin-host', 'history', 'authorized-devices', 'check-version', 'gateway-rssi', 'cloud-read', 'cloud-write', 'cloud-native-call', 'action'].includes(message.method);
        if (!['read', 'write', 'plugin-host', 'history', 'authorized-devices', 'check-version', 'gateway-rssi', 'cloud-read', 'cloud-write', 'cloud-native-call', 'action'].includes(message.method)) { fail('INVALID_ARGUMENT', '设备请求无效'); return; }
        if (operation) {
            if (!message.params || typeof message.params !== 'object' || message.method !== 'cloud-write' && Array.isArray(message.params)) { fail('INVALID_ARGUMENT', '设备查询参数无效'); return; }
        } else if (!Array.isArray(message.properties) || !message.properties.length || message.properties.length > 100) { fail('INVALID_ARGUMENT', '设备请求无效'); return; }
        if (!operation && message.params !== undefined && (write || !message.params || typeof message.params !== 'object' || Object.keys(message.params).length !== 1 || ![1, 2, 3].includes(message.params.datasource))) { fail('INVALID_ARGUMENT', '属性数据来源无效'); return; }
        const properties = [];
        for (const prop of operation ? [] : message.properties) {
            if (!prop || prop.did !== did || Object.keys(prop).some(k => !['did', 'siid', 'piid', ...(write ? ['value'] : [])].includes(k)) || !Number.isInteger(prop.siid) || prop.siid <= 0 || !Number.isInteger(prop.piid) || prop.piid <= 0 || (write && typeof prop.value !== 'boolean' && !Number.isFinite(prop.value))) { fail('INVALID_ARGUMENT', '设备属性无效'); return; }
            properties.push({ siid: prop.siid, piid: prop.piid, ...(write ? { value: prop.value } : {}) });
        }
        const controller = new AbortController(); pending.set(message.id, controller);
        try {
            const options = { signal: controller.signal, timeout: 30000 };
            const value = message.method === 'plugin-host' ? await sdk.mijia.callDevicePluginHost(runtime.id, message.params.command, message.params.params, { ...options, timeout: 600000 })
                : message.method === 'history' ? await sdk.mijia.getDevicePluginHistory(runtime.id, message.params, options)
                : message.method === 'authorized-devices' ? await sdk.mijia.getDevicePluginAuthorizedDevices(runtime.id, message.params.model, options)
                    : message.method === 'check-version' ? await sdk.mijia.getDevicePluginVersion(runtime.id, message.params.pid, options)
                        : message.method === 'gateway-rssi' ? await sdk.mijia.getDevicePluginGatewayInfo(runtime.id, message.params.mac, options)
                        : message.method === 'cloud-read' ? await sdk.mijia.getDevicePluginCloudRead(runtime.id, message.params.api, message.params.params, options)
                        : message.method === 'cloud-write' ? await sdk.mijia.setDevicePluginCloudWrite(runtime.id, message.params.api, message.params.params, options)
                        : message.method === 'cloud-native-call' ? await sdk.mijia.getDevicePluginCloudCall(runtime.id, message.params.api, message.params.params, options)
                        : message.method === 'action' ? await sdk.mijia.doDevicePluginAction(runtime.id, { ...message.params, did }, options)
                        : await sdk.mijia[write ? 'setDevicePluginProperties' : 'getDevicePluginProperties'](runtime.id, properties, { ...options, ...(!write && message.params ? { datasource: message.params.datasource } : {}) });
            if (message.method === 'plugin-host' && message.params.command === 'navigate' && value) {
                if (controller.signal.aborted || disposed) await sdk.mijia.closeDevicePlugin(value.id).catch(() => {});
                else { send({ type: 'reply', id: message.id, ok: true, value: null }); onNavigate?.(value); }
            } else if (!controller.signal.aborted) send({ type: 'reply', id: message.id, ok: true, value });
        } catch (e) {
            if (!controller.signal.aborted) {
                fail(e.code || 'DEVICE_ERROR', e.message || '设备操作失败');
                if (['CONTEXT_CHANGED', 'AUTH_REQUIRED', 'AUTH_EXPIRED', 'RUNTIME_CLOSED'].includes(e.code)) onClose();
            }
        } finally { pending.delete(message.id); }
    };
    return {
        handle,
        setVisible(value) { visible = Boolean(value); if (!visible) cancel(); send({ type: 'visibility', visible }); },
        dispose() { disposed = true; cancel(); },
    };
}

export { CHANNEL };
