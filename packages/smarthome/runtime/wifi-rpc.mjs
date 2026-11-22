// 官方 SDK 的 callMethodFromCloud 在桌面端只转译已有的 MIoT 属性接口。
export function createWifiRPC({ did, read, write, unsupported }) {
    const call = (method, properties) => {
        if (!['get_properties', 'set_properties'].includes(method)) return unsupported('设备 RPC')();
        if (!Array.isArray(properties)) return Promise.reject(Object.assign(new Error('属性参数无效'), { code: 'INVALID_ARGUMENT' }));
        const normalized = properties.map(prop => ({ ...prop, did: prop.did ?? did }));
        return (method === 'get_properties' ? read(normalized) : write(normalized)).then(result => ({ result }));
    };
    return {
        callMethod: call,
        callMethodFromCloud: call,
        callMethodFromLocal: call,
    };
}
