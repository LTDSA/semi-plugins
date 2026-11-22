const { assert } = require('../browser/contracts.cjs');
const { splitIdentity } = require('./mijia-split.cjs');

const key = prop => `${prop.siid}.${prop.piid}`;
const serviceName = service => service.type?.split(':')[3];
const modeNumber = value => typeof value === 'number' && Number.isInteger(value) ? value
    : typeof value === 'string' && /^-?\d+$/.test(value) ? Number(value) : null;
function validValue(prop, value) {
    if (prop.format === 'string') return typeof value === 'string' && value.length <= 32768;
    if (prop.format === 'bool') return typeof value === 'boolean';
    if (!Number.isFinite(value) || !/^(u?int(8|16|32|64)?|float)$/.test(prop.format)) return false;
    if (prop.format !== 'float' && !Number.isSafeInteger(value)) return false;
    if (prop.format.startsWith('uint') && value < 0) return false;
    const bits = /^(u?)int(8|16|32)$/.exec(prop.format);
    if (bits && (value < (bits[1] ? 0 : -(2 ** (Number(bits[2]) - 1))) || value > 2 ** (Number(bits[2]) - (bits[1] ? 0 : 1)) - 1)) return false;
    if (prop['value-list'] && !prop['value-list'].some(item => item.value === value)) return false;
    if (prop['value-range']) {
        const [min, max, step] = prop['value-range'];
        if (![min, max, step].every(Number.isFinite) || step <= 0 || value < min || value > max) return false;
        const steps = (value - min) / step;
        if (Math.abs(steps - Math.round(steps)) > 1e-6) return false;
    }
    return true;
}

// DID、规格、账号和 endpoint 都来自宿主；向原插件提供完整公开规格，不改写页面资源。
function createMijiaDevicePlugin({ getDevice, getParentDevice, getParentDeviceInfo, getSpec, getSpecTranslations, getRoomContext, request, checkSession }) {
    const cache = new Map();
    async function context(session, did, signal, expected) {
        checkSession(session, signal);
        const raw = getDevice(session, did);
        assert(!splitIdentity(raw), '请重新打开原设备插件', 'PLUGIN_UNSUPPORTED');
        if (expected) assert(expected.model === raw.model && expected.specType === (raw.spec_type || null), '设备规格已变化，请重新打开', 'CONTEXT_CHANGED');
        // 旧式插件也可下载和启动；没有 MIoT 规格时只拒绝属性转译，不能替换它的页面。
        if (!raw.spec_type) return { raw, spec: { services: [] }, properties: new Map() };
        assert(typeof raw.spec_type === 'string' && /^urn:miot-spec-v2:device:[a-z-]+:/.test(raw.spec_type), '设备规格格式异常', 'SPEC_UNAVAILABLE');
        let entry = cache.get(raw.spec_type);
        if (!entry || Date.now() - entry.time > 86400000) {
            const spec = await getSpec(raw.spec_type, signal);
            assert(spec?.type === raw.spec_type && Array.isArray(spec.services), '设备规格格式异常', 'SPEC_UNAVAILABLE');
            entry = { spec, time: Date.now() };
            cache.set(raw.spec_type, entry);
            if (cache.size > 32) cache.delete(cache.keys().next().value);
        }
        checkSession(session, signal);
        const latest = getDevice(session, did);
        assert(latest.spec_type === raw.spec_type && latest.model === raw.model && !splitIdentity(latest), '设备规格已变化，请重新打开', 'CONTEXT_CHANGED');
        const properties = new Map();
        const services = new Set();
        for (const service of entry.spec.services) {
            assert(Number.isInteger(service.iid) && service.iid > 0 && !services.has(service.iid), '设备规格含有歧义服务', 'SPEC_UNAVAILABLE');
            services.add(service.iid);
            const ids = new Set();
            for (const prop of service.properties || []) {
                assert(Number.isInteger(prop.iid) && prop.iid > 0 && !ids.has(prop.iid), '设备规格含有歧义属性', 'SPEC_UNAVAILABLE');
                ids.add(prop.iid);
                properties.set(`${service.iid}.${prop.iid}`, prop);
            }
        }
        return { raw, spec: entry.spec, properties };
    }
    async function describe(session, did, signal) {
        const selectedId = did, split = splitIdentity(getDevice(session, did));
        if (split) {
            assert(split.valid, '拆分设备关联无效，请刷新设备列表', 'PLUGIN_UNSUPPORTED');
            await getParentDevice?.(session, split.parentId, signal);
            checkSession(session, signal);
            const parent = getDevice(session, split.parentId);
            assert(!splitIdentity(parent), '原设备关联无效，请刷新设备列表', 'PLUGIN_UNSUPPORTED');
            did = split.parentId;
        }
        const { raw, spec, properties } = await context(session, did, signal);
        let i18n = {};
        try { if (raw.spec_type) i18n = (await getSpecTranslations?.(raw.spec_type, signal))?.data || {}; }
        catch (e) { checkSession(session, signal); /* 翻译不可用不影响原页面。 */ }
        checkSession(session, signal);
        if (split) {
            const latest = splitIdentity(getDevice(session, selectedId));
            assert(latest?.valid && latest.parentId === did, '拆分设备关联已变化，请重新打开', 'CONTEXT_CHANGED');
        }
        return {
            device: { did, model: raw.model, name: typeof raw.name === 'string' ? raw.name.slice(0, 256) : '米家设备', isOnline: raw.isOnline === true || raw.isOnline === 1, isOwner: String(raw.uid || '') === String(session.userId), type: ['6', '16'].includes(String(raw.pid)) ? String(raw.pid) : '0', mac: typeof raw.mac === 'string' ? raw.mac.slice(0, 32) : '', brandId: modeNumber(raw.brand_id), parentDevice: getParentDeviceInfo?.(session, raw), freqFlag: typeof raw.freqFlag === 'boolean' ? raw.freqFlag : [0, 1].includes(modeNumber(raw.freqFlag)) ? modeNumber(raw.freqFlag) === 1 : undefined, ...getRoomContext?.(session, raw) },
            binding: { model: raw.model, specType: raw.spec_type || null },
            resource: { instance: spec, i18n, custom_config: {} },
        };
    }
    async function properties(session, did, requested, expected, signal, write = false, datasource) {
        assert(datasource === undefined || !write && [1, 2, 3].includes(datasource), '属性数据来源无效');
        const current = await context(session, did, signal, expected);
        assert(Array.isArray(requested) && requested.length > 0 && requested.length <= 100, '属性数量须为 1–100');
        const seen = new Set();
        for (const item of requested) {
            assert(item && Number.isInteger(item.siid) && item.siid > 0 && Number.isInteger(item.piid) && item.piid > 0 && Object.keys(item).every(k => ['siid', 'piid', ...(write ? ['value'] : [])].includes(k)), '属性参数无效');
            assert(!seen.has(key(item)), '不能重复操作同一属性'); seen.add(key(item));
            const prop = current.properties.get(key(item));
            // 云端 /miotspec/prop/get 对 notify 属性同样返回值；读取不能比官方云端更严格。
            assert(prop && (write ? prop.access?.includes('write') : prop.access?.includes('read') || prop.access?.includes('notify')), '属性不支持此操作', 'PROPERTY_UNSUPPORTED');
            if (write) {
                assert(typeof item.value === 'boolean' || Number.isFinite(item.value), '该属性写入暂不支持', 'PROPERTY_UNSUPPORTED');
                assert(validValue(prop, item.value), '属性值不符合设备规格');
            }
        }
        if (write) assert(current.raw.isOnline === true || current.raw.isOnline === 1, '设备已离线', 'DEVICE_OFFLINE');
        if (write) {
            const readable = requested.filter(item => current.properties.get(key(item)).access.includes('read') || current.properties.get(key(item)).access.includes('notify'));
            const before = readable.length ? await properties(session, did, readable.map(item => ({ siid: item.siid, piid: item.piid })), expected, signal) : [];
            assert(before.every(item => item.code === 0), '当前状态未知，请稍后重试', 'STATE_UNAVAILABLE');
            if (requested.every(item => before.some(state => key(state) === key(item) && state.value === item.value))) return requested.map(item => ({ did, siid: item.siid, piid: item.piid, code: 0 }));
        }
        const params = requested.map(item => ({ did, ...item }));
        const result = await request(session, write ? '/miotspec/prop/set' : '/miotspec/prop/get', { params, ...(!write && datasource !== undefined ? { datasource } : {}) }, signal);
        checkSession(session, signal);
        const latest = getDevice(session, did);
        assert(latest.spec_type === current.raw.spec_type && latest.model === current.raw.model && !splitIdentity(latest), '设备规格已变化，请重新打开', 'CONTEXT_CHANGED');
        assert(Array.isArray(result), '设备属性响应格式异常', 'MIJIA_ERROR');
        return requested.map(item => {
            const reply = result.find(r => r && String(r.did) === did && r.siid === item.siid && r.piid === item.piid);
            assert(reply && Number.isInteger(reply.code), '设备属性响应缺失', 'MIJIA_ERROR');
            const prop = current.properties.get(key(item));
            if (!write && reply.code === 0) assert(validValue(prop, reply.value), '设备属性值格式异常', 'MIJIA_ERROR');
            return { did, siid: item.siid, piid: item.piid, code: reply.code, ...(!write && reply.code === 0 ? { value: reply.value } : {}) };
        });
    }
    // SDK 的 getDeviceDataRaw 只查询当前绑定设备的固定官方历史接口。
    async function history(session, did, params, expected, signal) {
        const current = await context(session, did, signal, expected);
        assert(params && typeof params === 'object' && !Array.isArray(params), '历史查询参数无效');
        assert(Object.keys(params).every(key => ['did', 'uid', 'type', 'key', 'time_start', 'time_end', 'limit'].includes(key)), '历史查询包含不支持的参数');
        assert(['prop', 'event', 'store'].includes(params.type), '历史查询类型无效');
        assert(params.key === undefined || typeof params.key === 'string' && /^[a-zA-Z0-9_.:-]{1,128}$/.test(params.key), '历史查询键无效');
        if (params.uid !== undefined) assert(['string', 'number'].includes(typeof params.uid) && String(params.uid) === String(session.userId), '历史查询账号由宿主管理');
        // 官方文档将 time_start / time_end / limit 标为字符串；只接受安全的十进制整数形式。
        const number = (value, fallback) => {
            if (value === undefined) return fallback;
            assert(typeof value === 'number' && Number.isSafeInteger(value) || typeof value === 'string' && /^\d{1,15}$/.test(value) && Number.isSafeInteger(Number(value)), '历史查询数值无效');
            return Number(value);
        };
        const start = number(params.time_start), end = number(params.time_end);
        assert((start === undefined || start >= 0) && (end === undefined || end >= 0) && (start === undefined || end === undefined || start < end), '历史查询时间范围无效');
        const limit = number(params.limit, 20);
        assert(Number.isInteger(limit) && limit >= 1 && limit <= 500, '历史查询最多返回 1–500 条');
        const result = await request(session, '/v2/user/get_device_data_raw', { did, type: params.type, ...(params.key !== undefined ? { key: params.key } : {}), ...(start !== undefined ? { time_start: start } : {}), ...(end !== undefined ? { time_end: end } : {}), limit }, signal);
        checkSession(session, signal);
        const latest = getDevice(session, did);
        assert(latest.spec_type === current.raw.spec_type && latest.model === current.raw.model, '设备规格已变化，请重新打开', 'CONTEXT_CHANGED');
        // 保留官方 SDK 的结果结构，由设备原包自行解析数组或 result 包装。
        return result;
    }
    async function action(session, did, params, expected, signal) {
        const current = await context(session, did, signal, expected);
        assert(params && typeof params === 'object' && !Array.isArray(params) && Object.keys(params).every(k => ['did', 'miid', 'siid', 'aiid', 'in'].includes(k)), '设备方法参数无效');
        assert(Number.isInteger(params.siid) && params.siid > 0 && Number.isInteger(params.aiid) && params.aiid > 0 && Array.isArray(params.in) && params.in.length <= 100, '设备方法编号或参数无效');
        if (params.miid !== undefined) assert(Number.isInteger(params.miid) && params.miid > 0, '设备模块编号无效');
        const service = current.spec.services.find(item => item.iid === params.siid);
        const actionSpec = service?.actions?.find(item => item.iid === params.aiid);
        assert(actionSpec, '设备方法不在规格中', 'ACTION_UNSUPPORTED');
        const inputs = actionSpec.in || [];
        assert(params.in.length === inputs.length, '设备方法参数数量不匹配');
        for (const [index, piid] of inputs.entries()) {
            const prop = current.properties.get(`${params.siid}.${piid}`);
            assert(prop, '设备方法输入属性无效', 'ACTION_UNSUPPORTED');
            assert(validValue(prop, params.in[index]), '设备方法输入值不符合规格');
        }
        assert(current.raw.isOnline === true || current.raw.isOnline === 1, '设备已离线', 'DEVICE_OFFLINE');
        const result = await request(session, '/miotspec/action', { did, miid: params.miid, siid: params.siid, aiid: params.aiid, in: params.in }, signal);
        checkSession(session, signal);
        const latest = getDevice(session, did);
        assert(latest.spec_type === current.raw.spec_type && latest.model === current.raw.model && !splitIdentity(latest), '设备规格已变化，请重新打开', 'CONTEXT_CHANGED');
        assert(result && typeof result === 'object' && Number.isInteger(result.code), '设备方法响应格式异常', 'MIJIA_ERROR');
        return result;
    }
    return { describe, action, history, read: (session, did, items, expected, signal, datasource) => properties(session, did, items, expected, signal, false, datasource), write: (session, did, items, expected, signal) => properties(session, did, items, expected, signal, true) };
}

module.exports = { createMijiaDevicePlugin, validValue };
