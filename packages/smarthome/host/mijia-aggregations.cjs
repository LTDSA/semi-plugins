const { assert } = require('../browser/contracts.cjs');
const { splitIdentity } = require('./mijia-split.cjs');
const { cardSize } = require('./mijia-card-size.cjs');

const propertyKey = p => `${p.did}:${p.siid}.${p.piid}`;
const propertyId = value => typeof value === 'string' && /^prop\.([1-9]\d*)\.([1-9]\d*)$/.exec(value);
const numeric = value => typeof value === 'number' && Number.isFinite(value) ? value
    : typeof value === 'string' && /^-?\d+(\.\d+)?$/.test(value.trim()) ? Number(value) : null;
const bool = value => value === true || value === 1 ? true : value === false || value === 0 ? false : null;

function environment(info) {
    const values = [];
    for (const [key, unit, min, max] of [['temp', '°C', -100, 200], ['hum', '%', 0, 100], ['pm25', '', 0, 10000]]) {
        const value = numeric(info?.[key]);
        if (value !== null && value >= min && value <= max) values.push(`${key === 'pm25' ? 'PM2.5 ' : ''}${value}${unit}`);
    }
    return values.join(' ｜ ') || '环境数据未知';
}

// 成员与属性映射来自官方 HomeRoomCategoryApi，不按型号、设备名或整机主开关推断。
function createMijiaAggregations({ request, getSpec, getContext, getDevice, checkSession }) {
    const specs = new Map();
    async function specFor(raw, session, signal) {
        if (!raw.spec_type || !getSpec) return null;
        const cached = specs.get(raw.spec_type);
        if (cached && Date.now() - cached.time < 86400000) return cached.spec;
        try {
            const spec = await getSpec(raw.spec_type, signal);
            if (spec?.type !== raw.spec_type || !Array.isArray(spec.services)) return null;
            specs.set(raw.spec_type, { spec, time: Date.now() });
            if (specs.size > 256) specs.delete(specs.keys().next().value);
            return spec;
        } catch (error) { checkSession(signal, session); return null; }
    }
    return async (session, homeId, signal) => {
        checkSession(signal, session);
        const context = getContext(session, homeId);
        assert(context, '请先加载当前家庭设备', 'HOME_NOT_FOUND');
        if (!context.aggregations.size) return [];
        const response = await request(session, '/smh/get_home_data_new', {
            home_id: Number(context.home.id), owner_id: Number(context.home.uid), modules: [...context.aggregations],
        }, signal);
        assert(Array.isArray(response.modules) && response.modules.length <= 20, '聚合数据格式异常', 'MIJIA_ERROR');
        const modules = new Map(response.modules.filter(m => m && context.aggregations.has(m.name)).map(m => [m.name, m]));
        const groups = new Map(), targets = new Map(), rawDevices = new Map();
        const roomIds = new Set((context.home.roomlist || []).map(room => String(room.id)));
        for (const id of context.aggregations) {
            const module = modules.get(id), members = [], seen = new Set();
            if (module?.status === true && id !== 'env') for (const room of module.data?.room_data || []) {
                if (!roomIds.has(String(room.room_id))) continue;
                for (const item of room.data?.devs || []) {
                    const did = String(item?.did || '');
                    const raw = context.members.has(did) ? getDevice(session, did) : null;
                    if (!raw || item.model && raw.model !== item.model) continue;
                    const split = splitIdentity(raw);
                    const parent = split?.valid && context.members.has(split.parentId) ? getDevice(session, split.parentId) : null;
                    const targetRaw = !split ? raw : parent && parent.model === raw.model
                        ? { ...parent, spec_type: parent.spec_type || raw.spec_type } : null;
                    const properties = [];
                    let wirelessOnly = Boolean(item.target_props?.length);
                    for (const prop of id === 'camera' ? [] : item.target_props || []) {
                        const match = propertyId(prop?.[id === 'curtain' ? 'current_position' : 'on']);
                        if (!match) { wirelessOnly = false; continue; }
                        const siid = Number(match[1]), piid = Number(match[2]);
                        if (!Number.isSafeInteger(siid) || !Number.isSafeInteger(piid)) continue;
                        if (!targetRaw || split && (!split.valid || split.moduleId !== siid)) { wirelessOnly = false; continue; }
                        if (id === 'light' && (item.wireless || []).some(w => String(w.sid) === String(siid) && w.status === 'wireless')) continue;
                        wirelessOnly = false;
                        const target = { did: String(targetRaw.did), siid, piid };
                        properties.push(propertyKey(target)); targets.set(propertyKey(target), target);
                        rawDevices.set(target.did, targetRaw);
                    }
                    // 明确转无线的通道不再是灯；其他缺失映射保留为未知。
                    if (wirelessOnly && id === 'light') continue;
                    const key = properties.length ? [...new Set(properties)].sort().join(',') : `${did}:unknown`;
                    if (seen.has(key)) continue;
                    seen.add(key);
                    members.push({ roomId: String(room.room_id), online: raw.isOnline === true || raw.isOnline === 1, properties: [...new Set(properties)] });
                }
            }
            groups.set(id, { available: module?.status === true, members });
        }
        assert(targets.size <= 1000 && rawDevices.size <= 500, '聚合成员数量过多', 'QUOTA_EXCEEDED');
        const descriptions = new Map(), queue = [...rawDevices.values()].filter(raw => raw.isOnline === true || raw.isOnline === 1);
        const pendingSpecs = new Map();
        let cursor = 0;
        await Promise.all(Array.from({ length: Math.min(4, queue.length) }, async () => {
            while (cursor < queue.length) {
                const raw = queue[cursor++];
                if (!pendingSpecs.has(raw.spec_type)) pendingSpecs.set(raw.spec_type, specFor(raw, session, signal));
                descriptions.set(String(raw.did), await pendingSpecs.get(raw.spec_type));
            }
        }));
        checkSession(signal, session);
        const readable = new Map();
        for (const [key, target] of targets) {
            const raw = rawDevices.get(target.did);
            if (!(raw.isOnline === true || raw.isOnline === 1)) continue;
            const properties = (descriptions.get(target.did)?.services || []).filter(service => service.iid === target.siid)
                .flatMap(service => (service.properties || []).filter(p => p.iid === target.piid));
            const property = properties.length === 1 && properties[0];
            if (property && (property.access?.includes('read') || property.access?.includes('notify'))) readable.set(key, { target, property });
        }
        const rows = new Map(), params = [...readable.values()].map(value => value.target);
        for (let offset = 0; offset < params.length; offset += 100) {
            const result = await request(session, '/miotspec/prop/get', { params: params.slice(offset, offset + 100), datasource: 1 }, signal);
            assert(Array.isArray(result), '聚合属性响应格式异常', 'MIJIA_ERROR');
            for (const row of result) if (row && readable.has(propertyKey(row))) rows.set(propertyKey(row), row);
        }
        checkSession(signal, session);
        assert(getContext(session, homeId) === context, '家庭设备已刷新，请重新读取聚合状态', 'CONTEXT_CHANGED');
        return [...context.aggregations].map(id => {
            const group = groups.get(id);
            if (!group.available) return { id, subtitle: '状态未知', active: null };
            if (id === 'env') return { id, subtitle: environment(modules.get(id)?.data?.home_data?.env_info), active: null };
            // 官方摄像机聚合展示总数；图案固定，不使用灯光的开关文案。
            if (id === 'camera') return { id, subtitle: group.members.length ? `摄像机 (${group.members.length})` : '暂无设备', active: null };
            const members = group.members.map(member => {
                if (!member.online) return { ...member, on: false };
                const states = member.properties.map(key => {
                    const row = rows.get(key), property = readable.get(key)?.property;
                    if (row?.code !== 0 || !property) return null;
                    if (id !== 'curtain') return bool(row.value);
                    const value = typeof row.value === 'number' && Number.isFinite(row.value) ? row.value : null;
                    const range = property['value-range'];
                    return value !== null && Array.isArray(range) && range[0] === 0 && range[1] > 0 && value >= 0 && value <= range[1] ? value > 0 : null;
                });
                return { ...member, on: states.some(value => value === true) ? true : states.length && states.every(value => value === false) ? false : null };
            });
            const active = members.filter(m => m.on === true);
            // 首页聚合按房间计数，同一房间任一成员开启便算一个开启房间。
            const activeRooms = new Set(active.map(member => member.roomId));
            const count = activeRooms.size;
            const unknown = members.some(member => member.on === null && !activeRooms.has(member.roomId));
            const subtitle = !members.length ? '暂无设备' : unknown ? '状态未知' : count ? `${count} ${id === 'light' ? '个房间亮灯' : '个房间窗帘打开'}` : id === 'light' ? '灯全关着' : '窗帘全闭合';
            return { id, subtitle, active: unknown || !members.length ? null : count > 0 };
        }).map(state => {
            const size = cardSize(modules.get(state.id)?.card_size);
            return size === 'medium' ? state : { ...state, cardSize: size };
        });
    };
}

module.exports = { createMijiaAggregations };
