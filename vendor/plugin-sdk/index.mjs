import { SDK_VERSION } from './version.mjs';

export class SemiError extends Error {
    constructor(code, message) { super(message); this.name = 'SemiError'; this.code = code; }
}
const usesCallbacks = ({ success, fail, complete }) => [success, fail, complete].some(fn => typeof fn === 'function');
function completeWith(name, promise, { success, fail, complete }) {
    if (!usesCallbacks({ success, fail, complete })) return promise;
    const notify = (callback, result) => {
        if (typeof callback !== 'function') return;
        try { callback(result); } catch (error) { console.error('[Semi SDK] 回调执行失败', error); }
    };
    promise.then(value => {
        const result = { ...value, errMsg: name + ':ok' };
        notify(success, result); notify(complete, result);
    }, error => {
        const result = { code: error.code || 'PLUGIN_ERROR', errMsg: name + ':fail ' + error.message };
        notify(fail, result); notify(complete, result);
    });
}

function networkTask(name, options, run) {
    if (!usesCallbacks(options)) return run(options);
    const controller = new AbortController();
    const signal = options.signal ? AbortSignal.any([options.signal, controller.signal]) : controller.signal;
    const progressListeners = new Set();
    const task = { abort: () => controller.abort() };
    let onProgress = options.onProgress;
    if (name === 'downloadFile') {
        task.onProgressUpdate = callback => { progressListeners.add(callback); };
        task.offProgressUpdate = callback => { if (callback) progressListeners.delete(callback); else progressListeners.clear(); };
        onProgress = ({ loaded, total }) => {
            options.onProgress?.({ loaded, total });
            const update = { progress: total > 0 ? Math.min(100, Math.floor(loaded * 100 / total)) : 0, totalBytesWritten: loaded, totalBytesExpectedToWrite: total ?? 0 };
            for (const callback of progressListeners) {
                try { callback(update); } catch (error) { console.error('[Semi SDK] 进度处理失败', error); }
            }
        };
    }
    completeWith(name, run({ ...options, signal, ...(onProgress ? { onProgress } : {}) }).finally(() => progressListeners.clear()), options);
    return task;
}
const identifier = () => globalThis.crypto?.randomUUID?.() || `r${Date.now()}-${Math.random().toString(36).slice(2)}`;
function encodeBytes(data) {
    const bytes = new Uint8Array(data);
    let raw = '';
    for (let offset = 0; offset < bytes.length; offset += 8192) raw += String.fromCharCode(...bytes.subarray(offset, offset + 8192));
    return btoa(raw);
}
export function createSDK(initialTransport) {
    const listeners = new Map();
    const handlers = new Map();
    const registrations = [];
    const dispatches = new Map();
    let unsubscribe;
    let permissionBarrier = Promise.resolve();
    let receivedTheme;
    const transport = () => {
        const t = initialTransport || globalThis.semiPluginTransport;
        if (!t) throw new SemiError('HOST_UNAVAILABLE', '请在 Semi 插件运行时中使用 SDK');
        return t;
    };
    const invoke = async (method, params = {}, options = {}) => {
        if (!['permissions.request', 'dispatch.reply', 'app.viewOptions', 'app.viewState', 'app.backgroundInfo'].includes(method)) await permissionBarrier;
        const t = transport();
        const id = identifier();
        const timeout = Math.min(options.timeout ?? 120000, 600000);
        if (options.signal?.aborted) throw new SemiError('CANCELLED', '请求已取消');
        let timer;
        let cancel;
        const interrupted = new Promise((_resolve, reject) => {
            cancel = () => { t.cancel(id); reject(new SemiError('CANCELLED', '请求已取消')); };
            options.signal?.addEventListener('abort', cancel, { once: true });
            timer = setTimeout(() => { t.cancel(id); reject(new SemiError('TIMEOUT', '请求超时，远端操作可能仍在执行')); }, timeout);
        });
        try {
            const reply = await Promise.race([t.invoke({ version: 1, id, method, params, timeout }), interrupted]);
            if (!reply.ok) throw new SemiError(reply.error.code, reply.error.message);
            return reply.value;
        } finally { clearTimeout(timer); options.signal?.removeEventListener('abort', cancel); }
    };
    const receive = async event => {
        if (event.name === '__dispatch.cancel') { dispatches.get(event.data.id)?.abort(); return; }
        if (event.name === '__dispatch') {
            const request = event.data;
            const controller = new AbortController();
            dispatches.set(request.id, controller);
            let response;
            try {
                const handler = handlers.get(`${request.kind}:${request.name}`);
                if (!handler) throw new SemiError('HANDLER_UNAVAILABLE', '插件处理器尚未注册');
                const value = await handler({ params: request.params, caller: request.caller, requestId: request.id, signal: controller.signal });
                response = { ok: true, value: value ?? null };
            } catch (e) { response = { ok: false, error: { code: e.code || 'PLUGIN_ERROR', message: e.message || String(e) } }; }
            finally { dispatches.delete(request.id); }
            await invoke('dispatch.reply', { id: request.id, ...response }).catch(() => {});
            return;
        }
        if (event.name === 'theme.changed') receivedTheme = event.data.theme;
        for (const fn of listeners.get(event.name) || []) {
            try { fn(event.data); } catch (e) { console.error('[Semi SDK] 事件处理失败', e); }
        }
    };
    const subscribe = () => { if (!unsubscribe) unsubscribe = transport().subscribe(receive); };
    const off = (name, callback) => {
        if (callback === undefined) listeners.delete(name);
        else {
            listeners.get(name)?.delete(callback);
            if (!listeners.get(name)?.size) listeners.delete(name);
        }
    };
    const on = (name, callback) => {
        subscribe();
        if (!listeners.has(name)) listeners.set(name, new Set());
        listeners.get(name).add(callback);
        return () => off(name, callback);
    };
    const register = (kind, name, handler) => {
        subscribe();
        const key = `${kind}:${name}`;
        if (handlers.has(key)) throw new SemiError('DUPLICATE_HANDLER', '处理器已注册');
        handlers.set(key, handler);
        const registration = invoke('dispatch.register', { kind, name });
        registration.catch(() => {});
        registrations.push(registration);
        return () => { handlers.delete(key); invoke('dispatch.register', { kind, name, remove: true }).catch(() => {}); };
    };
    const provide = (kind, id, methods) => {
        const dispose = Object.entries(methods).map(([operation, handler]) => register('provider', `${kind}.${id}.${operation}`, ({ params, caller, signal }) => handler(params.params, { credentials: params.credentials, accountId: params.accountId, deviceId: params.deviceId, caller, signal })));
        return () => dispose.forEach(off => off());
    };
    const fileSystem = Object.freeze({
        stat: path => invoke('pluginFiles.stat', { path }),
        digest: (path, options) => invoke('pluginFiles.digest', { path }, options),
        readChunk: (path, offset, length) => invoke('pluginFiles.read', { path, offset, length }),
        writeChunk: (path, data, offset = 0, exclusive = false) => invoke('pluginFiles.write', { path, data, offset, exclusive }),
        mkdir: path => invoke('pluginFiles.mkdir', { path }),
        mkdtemp: path => invoke('pluginFiles.temporary', { path }),
        remove: (path, options = {}) => invoke('pluginFiles.remove', { path, ...options }),
        rename: (path, to) => invoke('pluginFiles.move', { path, to }),
    });
    return Object.freeze({
        version: SDK_VERSION,
        canIUse: name => typeof name === 'string' && Array.isArray(transport().apis) && transport().apis.includes(name),
        login: (options, callOptions = {}) => {
            const { success, fail, complete, ...params } = options;
            return completeWith('login', invoke('accounts.login', params, { timeout: 600000, ...callOptions }), options);
        },
        request: options => networkTask('request', options, async ({ signal, timeout = 30000, responseType = 'text', dataType = 'json', data, header, success, fail, complete, ...params }) => {
            if (!['text', 'arraybuffer'].includes(responseType)) throw new SemiError('INVALID_ARGUMENT', '响应类型无效');
            const binary = data instanceof ArrayBuffer;
            const { body, statusCode, headers } = await invoke('network.request', {
                ...params, headers: header, data: binary ? encodeBytes(data) : data, binary,
            }, { signal, timeout });
            const response = { statusCode, header: headers, cookies: headers['set-cookie'] || [] };
            const raw = atob(body);
            const bytes = new Uint8Array(raw.length);
            for (let index = 0; index < raw.length; index++) bytes[index] = raw.charCodeAt(index);
            if (responseType === 'arraybuffer') return { ...response, data: bytes.buffer };
            const text = new TextDecoder().decode(bytes);
            if (dataType !== 'json') return { ...response, data: text };
            try { return { ...response, data: JSON.parse(text) }; }
            catch { return { ...response, data: text }; }
        }),
        downloadFile: options => networkTask('downloadFile', options, async ({ signal, timeout = 120000, onProgress, header, success, fail, complete, ...params }) => {
            const progressId = onProgress ? identifier() : undefined;
            const off = onProgress && on('__download.progress.' + progressId, onProgress);
            try {
                const { headers, ...result } = await invoke('network.downloadFile', { ...params, headers: header, progressId }, { signal, timeout });
                return { ...result, header: headers };
            } finally { off?.(); }
        }),
        authorize: options => {
            const { scope, reason } = options;
            const result = permissionBarrier.then(() => invoke('permissions.request', { ...(Array.isArray(scope) ? { permissions: scope } : { permission: scope }), reason }, { timeout: 600000 }));
            permissionBarrier = result.then(() => {}, () => {});
            return completeWith('authorize', result.then(allowed => {
                if (Array.isArray(scope)) return usesCallbacks(options) ? { authSetting: allowed } : allowed;
                if (!allowed) throw new SemiError('PERMISSION_DENIED', '权限未获准');
            }), options);
        },
        getAppBaseInfo: () => {
            subscribe();
            const info = transport().getBaseInfo?.();
            if (!info) throw new SemiError('HOST_UNAVAILABLE', '无法读取 Semi 宿主信息');
            return receivedTheme ? { ...info, theme: receivedTheme } : { ...info };
        },
        onThemeChange: callback => { on('theme.changed', callback); },
        offThemeChange: callback => off('theme.changed', callback),
        onAppShow: callback => { on('app.show', callback); },
        offAppShow: callback => off('app.show', callback),
        onAppHide: callback => { on('app.hide', callback); },
        offAppHide: callback => off('app.hide', callback),
        markViewReady: async () => { subscribe(); await Promise.all(registrations); return invoke('app.ready'); },
        getViewOptions: () => invoke('app.viewOptions'),
        getViewState: () => invoke('app.viewState'),
        getBackgroundInfo: () => invoke('app.backgroundInfo'),
        closeCurrentView: () => invoke('app.close'),
        getDeviceList: ({ capability, version = 1 }, options = {}) => invoke('device.list', { capability, version }, options),
        callDevice: (capability, method, params = {}, { version = 1, deviceId, ...options } = {}) => invoke('device.call', { capability, version, method, params, ...(deviceId ? { deviceId } : {}) }, options),
        completeFlow: result => invoke('flows.complete', { result }),
        cancelFlow: () => invoke('flows.call', { operation: '$cancel', params: {} }),
        callFlow: (operation, params = {}, options = {}) => invoke('flows.call', { operation, params }, options),
        getProviderState: () => invoke('providers.getState'),
        updateDevice: params => invoke('providers.updateDevice', params),
        saveAccount: (provider, value, { flowId, ...options } = {}) => invoke('providers.saveAccount', { provider, value, flowId }, options),
        reconnectDevice: (deviceId, preference) => invoke('providers.reconnect', { deviceId, preference }),
        discoverProviders: (query = {}, options = {}) => invoke('providers.discover', query, options),
        registerAccountProvider: (id, methods) => provide('accountProviders', id, methods),
        registerDeviceAdapter: (id, methods) => provide('deviceAdapters', id, methods),
        registerServiceProvider: (id, methods) => provide('serviceProviders', id, methods),
        callService: (contract, method, params = {}, { version = 1, provider, accountId, ...options } = {}) => invoke('services.call', { contract, version, method, params, ...(provider ? { provider } : {}), ...(accountId ? { accountId } : {}) }, options),
        callBackground: (name, params = {}, options = {}) => handlers.has(`background:${name}`) ? handlers.get(`background:${name}`)({ params, signal: options.signal || new AbortController().signal }) : invoke('background.invoke', { name, params }, options),
        handleBackgroundCall: (name, handler) => register('background', name, ({ params, signal, caller }) => handler(params, { signal, caller })),
        emitBackgroundEvent: (name, data, options = {}) => invoke('background.emit', { name, data, ...options }),
        onBackgroundEvent: (name, fn) => on(`background.${name}`, fn),
        setBackgroundActive: (active, { tray = 'none' } = {}) => invoke('background.hold', { active, tray }),
        openView: ({ id, params = {}, target }) => invoke('views.open', { id, params, ...(target ? { target } : {}) }),
        closeView: ({ instanceId }) => invoke('views.close', { id: instanceId }),
        handleIntent: (name, handler) => register('intent', name, handler),
        invokeIntent: (name, params = {}, options = {}) => invoke('intents.invoke', { name, params, target: options.target, version: options.version ?? 1 }, options),
        registerCommand: (name, handler) => register('command', name, handler),
        executeCommand: (name, params = {}) => invoke('commands.execute', { name, params }),
        onEvent: on,
        getCache: key => invoke('cache.get', { key }),
        setCache: (key, value, category) => invoke('cache.set', { key, value, category }),
        removeCache: key => invoke('cache.remove', { key }),
        getCacheUsage: () => invoke('cache.usage'),
        registerCacheDirectories: resources => invoke('cache.registerDirectories', { resources }),
        getStorage: options => completeWith('getStorage', invoke('storage.get', { key: options.key }).then(data => ({ data })), options),
        setStorage: options => completeWith('setStorage', invoke('storage.set', { key: options.key, value: options.data }).then(() => {}), options),
        removeStorage: options => completeWith('removeStorage', invoke('storage.remove', { key: options.key }).then(() => {}), options),
        handleResourceRequest: handler => register('resource', 'fetch', handler),
        setKeepScreenOn: options => completeWith('setKeepScreenOn', invoke('system.keepAwake', { active: options.keepScreenOn }).then(() => {}), options),
        openExternal: url => invoke('system.external', { url }),
        showContextMenu: () => invoke('system.contextMenu'),
        getFileSystemManager: () => fileSystem,
        setModalLayout: open => invoke('ui.setModalOpen', { open }),
        updateSidebarItem: (id, patch) => invoke('ui.sidebar.update', { id, patch }),
        updateStatusBarItem: (id, patch) => invoke('ui.statusbar.update', { id, patch }),
        updateTrayMenuItem: (id, patch) => invoke('ui.tray.update', { id, patch }),
        createTray: (id, options) => invoke('ui.tray.create', { id, options }),
        destroyTray: id => invoke('ui.tray.destroy', { id }),
    });
}
export const semi = createSDK();
export const {
    authorize,
    callBackground,
    callDevice,
    callFlow,
    callService,
    canIUse,
    cancelFlow,
    closeCurrentView,
    closeView,
    completeFlow,
    createTray,
    destroyTray,
    discoverProviders,
    downloadFile,
    emitBackgroundEvent,
    executeCommand,
    getAppBaseInfo,
    getBackgroundInfo,
    getCache,
    getCacheUsage,
    getDeviceList,
    getFileSystemManager,
    getProviderState,
    getStorage,
    getViewOptions,
    getViewState,
    handleBackgroundCall,
    handleIntent,
    handleResourceRequest,
    invokeIntent,
    login,
    markViewReady,
    offAppHide,
    offAppShow,
    offThemeChange,
    onAppHide,
    onAppShow,
    onBackgroundEvent,
    onEvent,
    onThemeChange,
    openExternal,
    openView,
    reconnectDevice,
    registerAccountProvider,
    registerCacheDirectories,
    registerCommand,
    registerDeviceAdapter,
    registerServiceProvider,
    removeCache,
    removeStorage,
    request,
    saveAccount,
    setBackgroundActive,
    setCache,
    setKeepScreenOn,
    setModalLayout,
    setStorage,
    showContextMenu,
    updateDevice,
    updateSidebarItem,
    updateStatusBarItem,
    updateTrayMenuItem,
} = semi;
