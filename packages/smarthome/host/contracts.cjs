const { assert } = require('../browser/contracts.cjs');
function validateMijiaCall(method, p) {
    if (['mijia.devices.list', 'mijia.homes.list'].includes(method)) assert(Object.keys(p).length === 0, '米家账号和请求地址由插件绑定');
    if (['mijia.home.devices', 'mijia.home.aggregations'].includes(method)) assert(Object.keys(p).length === 1 && typeof p.homeId === 'string' && /^\d{1,20}$/.test(p.homeId), '仅接受家庭 ID，米家账号和请求地址由插件绑定');
    const deviceId = value => typeof value === 'string' && /^[a-zA-Z0-9._:-]{1,256}$/.test(value);
    if (['mijia.plugin.runtime-info', 'mijia.plugin.open', 'mijia.plugin.close', 'mijia.plugin.host-call', 'mijia.plugin.read', 'mijia.plugin.write', 'mijia.plugin.history', 'mijia.plugin.authorized-devices', 'mijia.plugin.check-version', 'mijia.plugin.gateway-info', 'mijia.plugin.cloud-read', 'mijia.plugin.cloud-write', 'mijia.plugin.cloud-call', 'mijia.plugin.action'].includes(method)) {
        if (method === 'mijia.plugin.runtime-info') assert(Object.keys(p).length === 0, '运行资源信息不接受参数');
        else if (method === 'mijia.plugin.open') assert(Object.keys(p).every(key => ['did', 'download', 'progressId'].includes(key)) && deviceId(p.did) && (p.download === undefined || typeof p.download === 'boolean') && (p.progressId === undefined || typeof p.progressId === 'string' && /^[a-zA-Z0-9-]{1,128}$/.test(p.progressId)), '设备 ID 或下载选项无效');
        else {
            assert(typeof p.id === 'string' && /^[a-f0-9]{48}$/.test(p.id), '设备页面标识无效');
            if (method === 'mijia.plugin.close') assert(Object.keys(p).length === 1, '关闭设备页面只接受页面标识');
            else if (method === 'mijia.plugin.host-call') {
                assert(Object.keys(p).length === 3 && ['set-homepage', 'navigate', 'keep-screen-on', 'vendor-read'].includes(p.command) && p.params && typeof p.params === 'object' && !Array.isArray(p.params), '设备页面操作无效');
                if (p.command === 'set-homepage') assert(Object.keys(p.params).length === 1 && [0, 1].includes(p.params.homepage_type), '首页样式无效');
                else if (p.command === 'keep-screen-on') assert(Object.keys(p.params).length === 1 && typeof p.params.enabled === 'boolean', '屏幕常亮参数无效');
                else if (p.command === 'vendor-read') assert(Object.keys(p.params).length === 2 && typeof p.params.url === 'string' && p.params.url.length <= 4096 && p.params.headers && typeof p.params.headers === 'object' && !Array.isArray(p.params.headers) && JSON.stringify(p.params.headers).length <= 8192, '厂商读取参数无效');
                else assert(Object.keys(p.params).every(key => ['mode', 'pageName', 'pageParams'].includes(key)) && ['auto', 'standard', 'traditional', 'back'].includes(p.params.mode)
                    && (p.params.pageName === undefined || typeof p.params.pageName === 'string' && p.params.pageName.length <= 128)
                    && (p.params.pageParams === undefined || p.params.pageParams && typeof p.params.pageParams === 'object' && !Array.isArray(p.params.pageParams) && JSON.stringify(p.params.pageParams).length <= 65536), '页面导航参数无效');
            }
            else if (method === 'mijia.plugin.action') assert(Object.keys(p).length === 2 && p.params && typeof p.params === 'object' && !Array.isArray(p.params) && Object.keys(p.params).every(key => ['did', 'miid', 'siid', 'aiid', 'in'].includes(key)) && Array.isArray(p.params.in) && ['did', 'siid', 'aiid'].every(key => p.params[key] === undefined || key === 'did' || Number.isInteger(p.params[key]) && p.params[key] > 0), '设备方法参数无效');
            else if (method === 'mijia.plugin.history') assert(Object.keys(p).length === 2 && p.params && typeof p.params === 'object' && !Array.isArray(p.params), '历史查询参数无效');
            else if (method === 'mijia.plugin.authorized-devices') assert(Object.keys(p).length === 2 && typeof p.model === 'string' && /^[a-zA-Z0-9._:-]{1,128}$/.test(p.model), '授权设备型号无效');
            else if (method === 'mijia.plugin.check-version') assert(Object.keys(p).length === 2 && (Number.isInteger(p.pid) && p.pid >= 0 || typeof p.pid === 'string' && /^\d{1,8}$/.test(p.pid)), '固件检查设备类型无效');
            else if (method === 'mijia.plugin.gateway-info') assert(Object.keys(p).length === 2 && deviceId(p.mac), '蓝牙网关查询参数无效');
            else if (['mijia.plugin.cloud-read', 'mijia.plugin.cloud-call'].includes(method)) assert(Object.keys(p).length === 3 && typeof p.api === 'string' && p.params && typeof p.params === 'object', '云端读取参数无效');
            else if (method === 'mijia.plugin.cloud-write') assert(Object.keys(p).length === 3 && typeof p.api === 'string' && p.params && typeof p.params === 'object', '云端写入参数无效');
            else {
                const write = method === 'mijia.plugin.write';
                assert(Object.keys(p).every(key => ['id', 'properties', ...(!write ? ['datasource'] : [])].includes(key)) && Array.isArray(p.properties) && p.properties.length > 0 && p.properties.length <= 100, '仅接受页面标识与 1–100 项属性');
                if (!write && p.datasource !== undefined) assert([1, 2, 3].includes(p.datasource), '属性数据来源无效');
                for (const prop of p.properties) {
                    assert(prop && typeof prop === 'object' && !Array.isArray(prop) && Object.keys(prop).length === (write ? 3 : 2) && Object.keys(prop).every(k => ['siid', 'piid', ...(write ? ['value'] : [])].includes(k)) && ['siid', 'piid'].every(k => Number.isInteger(prop[k]) && prop[k] > 0), '属性参数无效');
                    if (write) assert(typeof prop.value === 'boolean' || Number.isFinite(prop.value), '属性值须为布尔或有限数值');
                }
            }
        }
        return;
    }
    if (['mijia.power.get', 'mijia.states.get'].includes(method)) assert(Object.keys(p).length === 1 && Array.isArray(p.dids) && p.dids.length > 0 && p.dids.length <= 100 && p.dids.every(deviceId) && new Set(p.dids).size === p.dids.length, '仅接受 1–100 个不重复设备 ID');
    if (method === 'mijia.power.set') assert(Object.keys(p).length === 2 && deviceId(p.did) && typeof p.on === 'boolean', '仅接受设备 ID 和布尔开关值');
    if (method === 'mijia.curtain.set') assert(Object.keys(p).length === 2 && deviceId(p.did) && ['open', 'pause', 'close'].includes(p.action), '仅接受设备 ID 和窗帘操作');
    assert(['mijia.devices.list', 'mijia.homes.list', 'mijia.home.devices', 'mijia.home.aggregations', 'mijia.power.get', 'mijia.states.get', 'mijia.power.set', 'mijia.curtain.set'].includes(method), '米家方法不存在', 'METHOD_NOT_FOUND');
}
module.exports = { validateMijiaCall };
