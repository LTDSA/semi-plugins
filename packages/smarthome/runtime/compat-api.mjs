import { officialApi } from './official-api.mjs';

// 官方公开方法必须存在；真实支持的方法保留原实现，其余统一返回受控错误。
export function fillOfficialApi(target, surface, unsupported, label = surface) {
    const methods = officialApi[surface];
    if (!methods) throw new Error(`未知官方 API 面: ${surface}`);
    if (Object.getPrototypeOf(target) === Object.prototype) {
        // 官方 SDK 会扩展 Device / Host.ui 的 constructor.prototype。
        // 普通对象的 constructor 是 Object，必须保留实例扩展语义并隔离全局原型。
        class SdkObject {}
        Object.setPrototypeOf(target, SdkObject.prototype);
    }
    for (const method of methods) {
        if (typeof target[method] !== 'function') target[method] = unsupported(`${label}.${method}`);
    }
    return target;
}

export function officialApiMethods(surface) {
    return officialApi[surface] ? [...officialApi[surface]] : [];
}
