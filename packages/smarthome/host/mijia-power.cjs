const { assert, error } = require('../browser/contracts.cjs');
const { splitIdentity } = require('./mijia-split.cjs');
const { findCurtain, curtainState } = require('./mijia-curtain.cjs');

const urnName = (type, kind) => typeof type === 'string' ? type.match(new RegExp(`^urn:miot-spec-v2:${kind}:([^:]+):`))?.[1] : null;
// 官方卡片的空调伴侣使用 air-conditioner 主服务；其余类型优先匹配自身主服务。
const PRIMARY_SERVICE_ALIASES = { 'air-condition-outlet': 'air-conditioner' };
function findPowerProperty(spec) {
    const candidates = [];
    const kind = urnName(spec?.type, 'device');
    if (kind === 'curtain') return null;
    const alias = PRIMARY_SERVICE_ALIASES[kind];
    for (const service of Array.isArray(spec?.services) ? spec.services : []) {
        if (!service || typeof service !== 'object') continue;
        const name = urnName(service.type, 'service');
        if (!(name && (name === kind || name === alias)) || !Number.isInteger(service.iid) || service.iid < 1) continue;
        if (spec.services.filter(other => other?.iid === service.iid).length !== 1) continue;
        for (const property of Array.isArray(service.properties) ? service.properties : []) {
            if (!property || typeof property !== 'object') continue;
            if (service.properties.filter(other => other?.iid === property.iid).length !== 1) continue;
            if (urnName(property.type, 'property') === 'on' && property.format === 'bool' && Array.isArray(property.access)
                && property.access.includes('read') && property.access.includes('write') && Number.isInteger(property.iid) && property.iid > 0) {
                candidates.push({ siid: service.iid, piid: property.iid, service: name });
            }
        }
    }
    const primary = candidates.filter(item => item.service === kind);
    const choices = primary.length ? primary : candidates;
    // 多路开关或组合设备没有唯一主开关时，不猜测要控制哪一项。
    return choices.length === 1 ? { siid: choices[0].siid, piid: choices[0].piid } : null;
}
const humidity = { name: 'relative-humidity', label: '湿度', unit: '%', specUnit: 'percentage', min: 0, max: 100 };
const temperature = { name: 'temperature', label: '温度', unit: '°C', specUnit: 'celsius' };
const particles = { name: 'pm2.5-density', label: 'PM2.5', unit: ' μg/m³', specUnit: 'micrograms-per-cubic-meter', min: 0 };
const READING_RULES = {
    light: [{ name: 'brightness', label: '亮度', unit: '%', specUnit: 'percentage', min: 0, max: 100 }],
    humidifier: [humidity], dehumidifier: [humidity],
    'air-conditioner': [temperature], heater: [temperature], 'water-heater': [temperature],
    thermostat: [temperature], 'electric-blanket': [temperature], kettle: [temperature], 'water-dispenser': [temperature],
    'temperature-humidity-sensor': [temperature, humidity],
    'air-purifier': [particles], 'air-fresh': [particles], 'air-monitor': [particles, temperature, humidity],
    curtain: [{ name: 'current-position', label: '开合比例', unit: '%', specUnit: 'percentage', min: 0, max: 100 }],
    router: [{ name: 'connected-device-number', label: '连接设备数', unit: '', specUnit: 'none', min: 0, integer: true }],
    'illumination-sensor': [{ name: 'illumination', label: '照度', unit: ' lx', specUnit: 'lux', min: 0 }],
};
function findReadingProperties(spec) {
    const kind = urnName(spec?.type, 'device');
    return (READING_RULES[kind] || []).flatMap(rule => {
        // 环境实测值优先；不把目标湿度／目标温度或屏幕亮度当作当前读数。
        const services = ['brightness', 'connected-device-number'].includes(rule.name) ? [kind] : ['environment', kind];
        for (const name of services) {
            const candidates = [];
            for (const service of Array.isArray(spec?.services) ? spec.services : []) {
                if (urnName(service?.type, 'service') !== name || !Number.isInteger(service.iid) || service.iid < 1) continue;
                if (spec.services.filter(other => other?.iid === service.iid).length !== 1) continue;
                for (const property of Array.isArray(service.properties) ? service.properties : []) {
                    if (urnName(property?.type, 'property') !== rule.name || !Array.isArray(property.access) || !property.access.includes('read')
                        || !['uint8', 'uint16', 'uint32', 'int8', 'int16', 'int32', 'int', 'float', 'double'].includes(property.format)
                        || !Number.isInteger(property.iid) || property.iid < 1 || property['value-list']) continue;
                    if (service.properties.filter(other => other?.iid === property.iid).length !== 1) continue;
                    if (property.unit && property.unit !== 'none' && property.unit !== rule.specUnit) continue;
                    const range = property['value-range'];
                    const min = Array.isArray(range) && Number.isFinite(range[0]) ? Math.max(range[0], rule.min ?? -Infinity) : rule.min;
                    const max = Array.isArray(range) && Number.isFinite(range[1]) ? Math.min(range[1], rule.max ?? Infinity) : rule.max;
                    candidates.push({ ...rule, siid: service.iid, piid: property.iid, min, max });
                }
            }
            if (candidates.length) return candidates.length === 1 ? candidates : [];
        }
        return [];
    });
}
function findStatusProperties(spec) {
    const kind = urnName(spec?.type, 'device');
    const air = ['air-conditioner', 'air-condition-outlet'].includes(kind);
    if (!air && !['fan', 'ceiling-fan'].includes(kind)) return [];
    const services = air ? ['air-conditioner'] : [kind, 'fan-control'];
    const names = air ? ['mode'] : ['mode', 'fan-level'];
    return names.flatMap(name => {
        for (const serviceName of services) {
            const candidates = [];
            for (const service of Array.isArray(spec.services) ? spec.services : []) {
                if (urnName(service?.type, 'service') !== serviceName || !Number.isInteger(service.iid) || service.iid < 1) continue;
                for (const property of Array.isArray(service.properties) ? service.properties : []) {
                    if (urnName(property?.type, 'property') !== name || !Number.isInteger(property.iid) || property.iid < 1
                        || !Array.isArray(property.access) || !property.access.includes('read')
                        || !['uint8', 'uint16', 'uint32', 'int8', 'int16', 'int32', 'int', 'string'].includes(property.format)) continue;
                    const choices = property['value-list'];
                    const range = property['value-range'];
                    const enumerated = Array.isArray(choices) && choices.length > 0;
                    if (!enumerated && (name !== 'fan-level' || !Array.isArray(range) || range.length < 3
                        || !range.every(Number.isFinite) || range[0] < 0 || range[1] < range[0] || range[2] <= 0
                        || ![undefined, 'none', 'percentage'].includes(property.unit))) continue;
                    candidates.push({ name, kind, siid: service.iid, piid: property.iid,
                        choices: enumerated ? choices : null, range, unit: property.unit });
                }
            }
            if (candidates.length) return candidates.length === 1 ? candidates : [];
        }
        return [];
    });
}
const MODE_NAMES = {
    auto: '自动', automatic: '自动', cool: '制冷', cooling: '制冷', heat: '制热', heating: '制热',
    dry: '除湿', drying: '除湿', dehumidification: '除湿', fan: '送风', fanonly: '送风', ventilation: '送风',
    straightwind: '直吹风', directbreeze: '直吹风', naturalwind: '自然风', naturalbreeze: '自然风',
    sleepwind: '睡眠风', sleepbreeze: '睡眠风',
};
const cleanText = value => typeof value === 'string' && value.trim() && value.length <= 128 ? value.trim().replace(/\s+/g, ' ') : null;
function statusTranslations(data) {
    const result = new Map();
    for (const [key, value] of Object.entries(data?.data?.zh_cn || {})) {
        const match = key.match(/^service:(\d+):property:(\d+):valuelist:(\d+)$/);
        const text = cleanText(value);
        if (match && text) result.set(match.slice(1).map(Number).join(':'), text);
    }
    return result;
}
function statusText(property, value, translations) {
    if (property.choices) {
        const indices = property.choices.flatMap((choice, index) => choice && choice.value === value ? [index] : []);
        if (indices.length !== 1) return null;
        const index = indices[0], choice = property.choices[index];
        const description = cleanText(choice.description);
        const comment = cleanText(choice.comment);
        let text = translations.get(`${property.siid}:${property.piid}:${index}`)
            || (comment && /[\u3400-\u9fff]/.test(comment) ? comment : null) || description;
        if (!text) return null;
        if (property.name === 'mode') {
            const key = text.toLowerCase().replace(/[^a-z]/g, '');
            text = MODE_NAMES[key] || (key === 'sleep' ? property.kind.startsWith('air-condition') ? '睡眠' : '睡眠风' : text);
        } else {
            const level = text.match(/^(?:level\s*(\d+)|(\d+)\s*[档挡])$/i);
            if (level) text = `${level[1] || level[2]} 挡`;
        }
        return text;
    }
    const [min, max, step] = property.range;
    if (typeof value !== 'number' || !Number.isInteger(value) || value < min || value > max
        || Math.abs((value - min) / step - Math.round((value - min) / step)) > 1e-6) return null;
    return property.unit === 'percentage' ? `${value}%` : `${value} 挡`;
}
const booleanValue = value => value === true || value === 1 ? true : value === false || value === 0 ? false : null;
const rowFor = (rows, did, property) => rows.find(row => row && String(row.did) === did && row.siid === property.siid && row.piid === property.piid);
function pause(ms, signal) {
    return new Promise((resolve, reject) => {
        const finish = () => { signal?.removeEventListener('abort', cancel); resolve(); };
        const timer = setTimeout(finish, ms);
        const cancel = () => { clearTimeout(timer); signal?.removeEventListener('abort', cancel); reject(error('CANCELLED', '请求已取消')); };
        signal?.addEventListener('abort', cancel, { once: true });
        if (signal?.aborted) cancel();
    });
}
async function mapLimit(items, limit, fn) {
    const output = new Map();
    let cursor = 0;
    await Promise.all(Array.from({ length: Math.min(items.length, limit) }, async () => {
        while (cursor < items.length) { const item = items[cursor++]; output.set(item, await fn(item)); }
    }));
    return output;
}
function createMijiaPower({ getSpec, getSpecTranslations, request, getDevice, checkSession }) {
    const cache = new Map();
    const writes = new WeakMap();
    async function descriptor(urn, signal) {
        if (typeof urn !== 'string' || !/^urn:miot-spec-v2:device:[a-zA-Z0-9:-]{1,256}$/.test(urn) || !getSpec) return null;
        const cached = cache.get(urn);
        if (cached?.expires > Date.now()) return cached.descriptor;
        const spec = await getSpec(urn, signal);
        assert(spec && spec.type === urn && Array.isArray(spec.services), '设备开关规格返回异常', 'MIOT_SPEC_ERROR');
        const statuses = findStatusProperties(spec);
        let translations = new Map(), translationFailed = false;
        if (statuses.some(property => property.choices) && getSpecTranslations) {
            try { translations = statusTranslations(await getSpecTranslations(urn, signal)); }
            catch { translationFailed = true; } // 中文翻译失败仍可用规格注释；稍后再试。
        }
        const switches = new Map();
        const seen = new Set();
        for (const service of spec.services) {
            if (urnName(service?.type, 'service') !== 'switch' || !Number.isSafeInteger(service.iid) || service.iid < 1) continue;
            // 同一个服务编号重复也视为歧义，不能让后项覆盖前项。
            const power = findPowerProperty({ type: 'urn:miot-spec-v2:device:switch:', services: [service] });
            switches.set(service.iid, seen.has(service.iid) ? null : power);
            seen.add(service.iid);
        }
        const descriptor = { power: findPowerProperty(spec), curtain: findCurtain(spec), switches, readings: findReadingProperties(spec), statuses, translations };
        cache.delete(urn); cache.set(urn, { descriptor, expires: Date.now() + (translationFailed ? 60000 : 86400000) });
        if (cache.size > 256) cache.delete(cache.keys().next().value);
        return descriptor;
    }
    function target(session, did) {
        const device = getDevice(session, did);
        const split = splitIdentity(device);
        if (!split) return { did, urn: device.spec_type, split: false };
        if (!split.valid) return { did: null, urn: null, split: true };
        // 列表可能只返回拆分后的键；已授权的子设备记录本身就包含父设备关系。
        let parent;
        try { parent = getDevice(session, split.parentId); }
        catch (e) { if (e.code !== 'DEVICE_NOT_FOUND') throw e; }
        return { did: split.parentId, urn: parent?.spec_type || device.spec_type, siid: split.moduleId, split: true };
    }
    const scoped = (descriptor, target) => target.split
        ? { power: descriptor?.switches.get(target.siid), readings: [], statuses: [] }
        : descriptor;
    async function getStates(session, dids, signal, includeReadings = false) {
        checkSession(session, signal);
        const targets = dids.map(did => target(session, did));
        const types = [...new Set(targets.map(item => item.urn))];
        const properties = await mapLimit(types, 4, async urn => {
            try { return await descriptor(urn, signal); }
            catch (e) {
                checkSession(session, signal);
                return null; // 规格失败不影响其他设备，下一次刷新再查询。
            }
        });
        checkSession(session, signal);
        const specs = targets.map(item => scoped(properties.get(item.urn), item));
        const states = specs.map((spec, index) => ({ did: dids[index], supported: Boolean(spec?.power), on: null,
            ...(includeReadings ? { readings: [], statuses: [], ...(spec?.curtain ? { curtain: curtainState(spec.curtain, [], targets[index].did) } : {}) } : {}) }));
        const rawParams = targets.flatMap((item, index) => {
            const spec = specs[index];
            return [...(spec?.power ? [spec.power] : []), ...(includeReadings ? [...(spec?.readings || []), ...(spec?.statuses || []), ...[spec?.curtain?.position, spec?.curtain?.status].filter(Boolean)] : [])]
                .map(property => ({ did: item.did, siid: property.siid, piid: property.piid }));
        });
        const params = [...new Map(rawParams.map(p => [JSON.stringify(p), p])).values()];
        if (!params.length) return states;
        // 设备状态包含多项属性，继续保持云端单次属性数量有界。
        const rows = [];
        for (let index = 0; index < params.length; index += 100) {
            const result = await request(session, '/miotspec/prop/get', { params: params.slice(index, index + 100) }, signal);
            assert(Array.isArray(result), '设备状态返回异常', 'MIJIA_ERROR');
            rows.push(...result);
        }
        for (const state of states) {
            const index = dids.indexOf(state.did), targetDid = targets[index].did;
            const spec = specs[index];
            if (spec?.power) {
                const row = rowFor(rows, targetDid, spec.power);
                state.on = row?.code === 0 ? booleanValue(row.value) : null;
                if (state.on === null) state.error = row?.code ? `读取开关状态失败（${row.code}）` : '开关状态未知，请刷新';
            }
            if (includeReadings) for (const property of spec?.readings || []) {
                const row = rowFor(rows, targetDid, property);
                const value = row?.value;
                if (row?.code !== 0 || typeof value !== 'number' || !Number.isFinite(value)
                    || value < (property.min ?? -Infinity) || value > (property.max ?? Infinity) || property.integer && !Number.isSafeInteger(value)) continue;
                state.readings.push({ name: property.name, label: property.label, value: Number(value.toFixed(2)), unit: property.unit });
            }
            if (includeReadings) for (const property of spec?.statuses || []) {
                const row = rowFor(rows, targetDid, property);
                if (row?.code !== 0 || !['number', 'string'].includes(typeof row.value)
                    || typeof row.value === 'number' && !Number.isFinite(row.value)) continue;
                const text = statusText(property, row.value, spec.translations);
                if (text) state.statuses.push({ name: property.name, value: row.value, text });
            }
            if (includeReadings && spec?.curtain) state.curtain = curtainState(spec.curtain, rows, targetDid);
        }
        return states;
    }
    return {
        getStates,
        async setCurtain(session, did, action, signal) {
            assert(['open', 'pause', 'close'].includes(action), '未知窗帘操作');
            checkSession(session, signal);
            const item = target(session, did);
            const online = () => [true, 1].includes(getDevice(session, did).isOnline);
            assert(!item.split && online(), '窗帘离线或关联无效', 'CURTAIN_UNAVAILABLE');
            const lock = JSON.stringify([item.did, item.siid ?? null]);
            let pending = writes.get(session);
            if (!pending) { pending = new Set(); writes.set(session, pending); }
            assert(!pending.has(lock), '设备正在操作中', 'DEVICE_BUSY');
            pending.add(lock);
            try {
                const curtain = (await descriptor(item.urn, signal))?.curtain;
                checkSession(session, signal);
                assert(curtain?.supported && Object.hasOwn(curtain.commands, action), '设备不支持该窗帘操作', 'CURTAIN_UNSUPPORTED');
                assert(online(), '窗帘已离线', 'CURTAIN_UNAVAILABLE');
                assert(JSON.stringify(target(session, did)) === JSON.stringify(item), '设备配置已变化，请刷新', 'CONTEXT_CHANGED');
                const property = { siid: curtain.motor.siid, piid: curtain.motor.piid };
                // 电机指令只发一次；返回已接受，不将运动中的窗帘伪装为到达终点。
                const rows = await request(session, '/miotspec/prop/set', { params: [{ did: item.did, ...property, value: curtain.commands[action] }] }, signal);
                checkSession(session, signal);
                const row = Array.isArray(rows) && rowFor(rows, item.did, property);
                assert(row && [0, 1].includes(row.code), row ? `设备拒绝窗帘操作（${row.code}）` : '未收到窗帘操作结果', 'DEVICE_ERROR');
                let state = null;
                try { [state] = await getStates(session, [did], signal, true); }
                catch (e) { checkSession(session, signal); if (['AUTH_REQUIRED', 'AUTH_EXPIRED'].includes(e.code)) throw e; }
                return { accepted: true, state };
            } finally { pending.delete(lock); }
        },
        async setState(session, did, on, signal) {
            assert(typeof on === 'boolean', '开关值必须为布尔值');
            checkSession(session, signal);
            const item = target(session, did);
            const lock = JSON.stringify([item.did, item.siid ?? null]);
            let pending = writes.get(session);
            if (!pending) { pending = new Set(); writes.set(session, pending); }
            assert(!pending.has(lock), '设备开关正在操作中', 'DEVICE_BUSY');
            pending.add(lock);
            try {
                // 在写入前重新确认可读状态，不能把未知／离线状态当成关闭。
                const [current] = await getStates(session, [did], signal);
                assert(current.supported, '设备没有唯一的标准开关', 'POWER_UNSUPPORTED');
                assert(typeof current.on === 'boolean', '无法读取设备当前状态，请刷新后重试', 'POWER_STATE_UNKNOWN');
                if (current.on === on) return current;
                const { power: property } = scoped(await descriptor(item.urn, signal), item);
                checkSession(session, signal);
                assert(JSON.stringify(target(session, did)) === JSON.stringify(item), '设备按键配置已变化，请刷新', 'CONTEXT_CHANGED');
                let writeError;
                try {
                    const rows = await request(session, '/miotspec/prop/set', { params: [{ did: item.did, ...property, value: on }] }, signal);
                    assert(Array.isArray(rows), '开关操作返回异常', 'MIJIA_ERROR');
                    const row = rowFor(rows, item.did, property);
                    // MIoT 0 = 完成，1 = 已接受、正在执行；1 不是设备拒绝。
                    assert(row && [0, 1].includes(row.code), row ? `设备拒绝开关操作（${row.code}）` : '未收到设备开关操作结果', 'DEVICE_ERROR');
                }
                catch (e) {
                    checkSession(session, signal);
                    if (['AUTH_REQUIRED', 'AUTH_EXPIRED'].includes(e.code)) throw e;
                    writeError = e;
                }
                // 设备执行和云端状态同步均可能延迟；只重试读取，写指令始终只发一次。
                let actual = { did, supported: true, on: null, error: '指令已发送，状态未确认，请刷新' };
                for (const delay of [0, 400, 800, 1600]) {
                    if (delay) await pause(delay, signal);
                    checkSession(session, signal);
                    try {
                        [actual] = await getStates(session, [did], signal);
                        if (actual.on === on) return actual;
                    } catch (e) {
                        checkSession(session, signal);
                        if (['AUTH_REQUIRED', 'AUTH_EXPIRED'].includes(e.code)) throw e;
                        actual = { did, supported: true, on: null, error: '指令已发送，状态未确认，请刷新' };
                    }
                }
                // 即使写响应丢失／异常，只要回读确认已到目标状态，就不会误报失败。
                if (writeError) throw writeError;
                return actual.on === null ? actual : { ...actual, error: '指令已接受，设备状态尚未同步，请稍后刷新' };
            } finally { pending.delete(lock); }
        },
    };
}
module.exports = { createMijiaPower, findPowerProperty, findReadingProperties };
