export function withMijia(core) {
    const identifier = () => crypto.randomUUID();
    const on = (...args) => core.onEvent(...args);
    const invoke = (method, params = {}, options = {}) => core.callBackground(method, params, options);
    const mijia = {
        getDeviceList: (options = {}) => invoke('mijia.devices.list', {}, options),
        getHomes: (options = {}) => invoke('mijia.homes.list', {}, options),
        getHomeDevices: (homeId, options = {}) => invoke('mijia.home.devices', { homeId }, options),
        getHomeAggregationStates: (homeId, options = {}) => invoke('mijia.home.aggregations', { homeId }, options),
        getDevicePowerStates: (dids, options = {}) => invoke('mijia.power.get', { dids }, options),
        getDeviceStates: (dids, options = {}) => invoke('mijia.states.get', { dids }, options),
        setDevicePower: (did, on, options = {}) => invoke('mijia.power.set', { did, on }, options),
        setDeviceCurtain: (did, action, options = {}) => invoke('mijia.curtain.set', { did, action }, options),
        getDevicePluginRuntimeInfo: (options = {}) => invoke('mijia.plugin.runtime-info', {}, options),
        openDevicePlugin: async (did, options = {}) => {
            const { download, onDownloadProgress, ...callOptions } = options;
            const progressId = onDownloadProgress ? identifier() : undefined;
            const off = progressId ? on('mijia.plugin.download-progress', progress => {
                if (progress.progressId === progressId) { const { progressId: _id, ...value } = progress; onDownloadProgress(value); }
            }) : () => {};
            try { return await invoke('mijia.plugin.open', { did, ...(download === undefined ? {} : { download }), ...(progressId ? { progressId } : {}) }, { timeout: 600000, ...callOptions }); }
            finally { off(); }
        },
        closeDevicePlugin: id => invoke('mijia.plugin.close', { id }),
        callDevicePluginHost: (id, command, params, options = {}) => invoke('mijia.plugin.host-call', { id, command, params }, { timeout: 600000, ...options }),
        getDevicePluginProperties: (id, properties, options = {}) => invoke('mijia.plugin.read', { id, properties, ...(options.datasource !== undefined ? { datasource: options.datasource } : {}) }, options),
        getDevicePluginHistory: (id, params, options = {}) => invoke('mijia.plugin.history', { id, params }, options),
        doDevicePluginAction: (id, params, options = {}) => invoke('mijia.plugin.action', { id, params }, options),
        getDevicePluginAuthorizedDevices: (id, model, options = {}) => invoke('mijia.plugin.authorized-devices', { id, model }, options),
        getDevicePluginVersion: (id, pid, options = {}) => invoke('mijia.plugin.check-version', { id, pid }, options),
        getDevicePluginGatewayInfo: (id, mac, options = {}) => invoke('mijia.plugin.gateway-info', { id, mac }, options),
        getDevicePluginCloudRead: (id, api, params, options = {}) => invoke('mijia.plugin.cloud-read', { id, api, params }, options),
        setDevicePluginCloudWrite: (id, api, params, options = {}) => invoke('mijia.plugin.cloud-write', { id, api, params }, options),
        getDevicePluginCloudCall: (id, api, params, options = {}) => invoke('mijia.plugin.cloud-call', { id, api, params }, options),
        setDevicePluginProperties: (id, properties, options = {}) => invoke('mijia.plugin.write', { id, properties }, options),
    };
    return { ...core, mijia };
}
