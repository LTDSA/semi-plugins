import definitions from './official-service-api.json' assert { type: 'json' };

export function serviceMethod(surface, method) {
    return definitions[surface]?.[method] || null;
}

export function createServiceApi(surface, call) {
    const target = {};
    for (const [method, definition] of Object.entries(definitions[surface] || {})) {
        target[method] = async (params = {}) => {
            const result = await call(definition.mode, definition.api, params);
            // ircontroller 在官方 SDK 中使用 nativeCall，调用方依赖完整响应包裹。
            return surface === 'ircontroller' ? { code: 0, message: 'ok', result } : result;
        };
    }
    return target;
}

export function serviceMethods(surface) {
    return Object.keys(definitions[surface] || {});
}
