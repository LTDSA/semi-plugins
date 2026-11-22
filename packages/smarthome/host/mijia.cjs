const params = require('../assets/mijia-device-list.json');
const { assert, error } = require('../browser/contracts.cjs');
const { createMijiaPower } = require('./mijia-power.cjs');
const { splitIdentity } = require('./mijia-split.cjs');
const { imageUrl } = require('./mijia-images.cjs');
const { createMijiaDevicePlugin } = require('./mijia-device-plugin.cjs');
const { createMijiaAggregations } = require('./mijia-aggregations.cjs');
const { deviceCardSize } = require('./mijia-card-size.cjs');
const { excludedByComFlag, listExclusions } = require('./mijia-visibility.cjs');
const officialCloudApi = require('../runtime/official-cloud-api.json');
const officialServiceApi = require('../runtime/official-service-api.json');

const record = value => value && typeof value === 'object' && !Array.isArray(value);
const ids = values => Array.isArray(values) ? [...new Set(values.filter(v => typeof v === 'string' || typeof v === 'number').map(String))] : [];
const AGGREGATIONS = { light: '灯光', env: '环境', curtain: '窗帘', camera: '摄像机' };
const irWriteApis = new Set(Object.values(officialServiceApi.ircontroller || {})
    .filter(method => method.mode === 'write' && method.target !== 'unbound')
    .map(method => method.api));
const cloudWriteApis = new Set([
    '/device/setsetting', '/device/delsetting',
    '/v2/device/set_extra_data', '/v2/device/del_extra_data',
    '/user/set_user_device_data', '/user/del_user_device_data',
    '/user/set_user_coll', '/user/edit_user_coll', '/user/del_user_coll',
    '/user/set_user_config', '/user/set_third_user_config',
    '/v2/device/batch_set_props',
]);
const irReadApis = new Set(Object.values(officialServiceApi.ircontroller || {})
    .filter(method => method.mode === 'read')
    .map(method => method.api));
const irControllerReadApis = new Set(['/v2/ircode/controller/functions', '/v2/ircode/controller/keys']);
const controllerNumber = value => Number.isSafeInteger(value) || typeof value === 'string' && /^\d+$/.test(value) ? Number(value) : null;
function containsController(value, controllerId, seen = new Set(), depth = 0) {
    if (!value || typeof value !== 'object' || depth > 12 || seen.has(value)) return false;
    seen.add(value);
    if (Array.isArray(value)) return value.some(item => containsController(item, controllerId, seen, depth + 1));
    for (const key of ['controller_id', 'controllerId', 'remote_id', 'remoteId', 'ac_controller_id', 'id']) {
        if (controllerNumber(value[key]) === controllerId) return true;
    }
    return Object.values(value).some(item => containsController(item, controllerId, seen, depth + 1));
}
const ordered = (members, order) => {
    const remaining = new Set(members);
    return [...ids(order).filter(id => remaining.delete(id)), ...remaining];
};
const modeNumber = value => typeof value === 'number' && Number.isInteger(value) ? value
    : typeof value === 'string' && /^-?\d+$/.test(value) ? Number(value) : null;
const splitParentsOf = devices => new Set(devices.map(splitIdentity).filter(split => split?.valid).map(split => split.parentId));
function homeVisibility(device, splitParents, exclusions = listExclusions([device])) {
    const reasons = [...(exclusions.get(String(device.did)) || [])];
    // freqFlag 和 show_mode 只影响首页；hide_mode 和组成员规则在列表构造前过滤。
    if ([false, 0, 'false', '0'].includes(device.freqFlag)) reasons.push('freqFlag=false');
    const showMode = modeNumber(device.show_mode);
    if (showMode !== null && showMode <= 0) reasons.push(`show_mode=${showMode}`);
    if (splitParents?.has(String(device.did))) reasons.push('split-parent');
    return { showOnHome: reasons.length === 0, reasons };
}
function displayDevice(device, splitParents, exclusions) {
    assert(record(device), '米家设备信息格式异常', 'MIJIA_ERROR');
    // 原始记录可能含本地控制 token；只返回展示字段。
    return {
        did: String(device.did ?? ''),
        name: typeof device.name === 'string' ? device.name : '未命名设备',
        model: typeof device.model === 'string' ? device.model : '',
        isOnline: device.isOnline === true || device.isOnline === 1,
        showOnHome: homeVisibility(device, splitParents, exclusions).showOnHome,
        ...(deviceCardSize(device.comFlag) !== 'medium' ? { cardSize: deviceCardSize(device.comFlag) } : {}),
    };
}

// 云端家庭与设备是账号能力，不由插件选择连接通道或账号。
function createMijiaService({ getSession, postSigned, images, getSpec, getSpecTranslations, debug, getRouterId = () => getSession()?.routerId }) {
    let cacheSession, sessionRevision = 0;
    const getSessionRevision = () => {
        const session = getSession();
        if (session !== cacheSession) { cacheSession = session; sessionRevision++; }
        return sessionRevision;
    };
    let imageSession;
    let homesSession, knownHomes = [];
    const homeContexts = new Map();
    const imageDevices = new Map();
    let memberIcons = new Map();
    function remember(session, list) {
        if (imageSession !== session) { imageDevices.clear(); memberIcons = new Map(); homeContexts.clear(); imageSession = session; }
        for (const device of list) imageDevices.set(String(device.did), { ...imageDevices.get(String(device.did)), ...device });
    }
    const hasSession = () => { const session = getSession(); return Boolean(session?.userId); };
    function account() {
        assert(hasSession(), '请先使用米家账号远程登录', 'AUTH_REQUIRED');
        return getSession();
    }
    async function request(session, uri, data, signal, options = {}) {
        assert(!signal?.aborted, '请求已取消', 'CANCELLED');
        assert(getSession() === session, '米家账号已变化，请刷新', 'CONTEXT_CHANGED');
        let response;
        try {
            response = await postSigned({ ssecurity: session.ssecurity, uri, data, signal, timeout: 20000 });
        } catch (e) {
            if (!signal?.aborted && getSession() === session) debug?.({ uri, params: data, error: { code: e.code || 'MIJIA_UNAVAILABLE', httpStatus: e.response?.status ?? null } });
            if (signal?.aborted || e.code === 'ERR_CANCELED') throw error('CANCELLED', '请求已取消');
            if ([401, 403].includes(e.response?.status)) throw error('AUTH_EXPIRED', '米家登录已失效，请重新远程登录');
            throw error('MIJIA_UNAVAILABLE', '获取米家数据失败，请检查网络后重试');
        }
        assert(!signal?.aborted, '请求已取消', 'CANCELLED');
        assert(getSession() === session, '米家账号已变化，请刷新', 'CONTEXT_CHANGED');
        debug?.({ uri, params: data, response });
        if (/auth error/i.test(response?.message || '')) throw error('AUTH_EXPIRED', '米家登录已失效，请重新远程登录');
        assert(response?.code === 0 && (options.allowScalar || record(response.result) || Array.isArray(response.result)), '米家接口返回异常，请稍后重试', 'MIJIA_ERROR');
        return response.result;
    }
    async function keyIcons(session, parentId, signal) {
        const cache = memberIcons;
        const cached = cache.get(parentId);
        if (cached?.icons) return cached.icons;
        // 同一页面同时加载多个按键图片时，共用同一取消范围内的读取。
        if (cached?.promise && cached.signal === signal) return cached.promise;
        const entry = { signal };
        entry.promise = (async () => {
            const result = await request(session, '/v2/device/deviceinfo', { dids: [parentId], get_sub_relation: true }, signal);
            assert(Array.isArray(result.list), '按键信息格式异常', 'MIJIA_ERROR');
            const parent = result.list.find(item => String(item?.did) === parentId);
            const icons = new Map();
            if (record(parent?.member_ship)) for (const [key, member] of Object.entries(parent.member_ship)) {
                // id 必须与键一致，不按数组顺序或按键名称匹配。
                if (record(member) && String(member.id) === key && imageUrl(member.icon)) icons.set(key, imageUrl(member.icon));
            }
            entry.icons = icons;
            return icons;
        })();
        cache.set(parentId, entry);
        if (cache.size > 256) cache.delete(cache.keys().next().value);
        try { return await entry.promise; }
        catch (e) { if (cache.get(parentId) === entry) cache.delete(parentId); throw e; }
    }
    async function devices(session, signal) {
        const result = await request(session, '/v2/home/device_list_page', { ...params }, signal);
        assert(Array.isArray(result.list) && result.list.every(record), '米家设备列表格式异常', 'MIJIA_ERROR');
        memberIcons = new Map(); // 手动刷新列表时重新读取图标，旧在途请求不能填充新缓存。
        remember(session, result.list);
        return result.list;
    }
    async function homes(session, signal) {
        const result = await request(session, '/v2/homeroom/gethome', { limit: 150, fetch_share: true, fetch_share_dev: true, plat_form: 0, app_ver: 9 }, signal);
        assert(Array.isArray(result.homelist), '米家家庭列表格式异常', 'MIJIA_ERROR');
        const list = [...result.homelist, ...(Array.isArray(result.share_home_list) ? result.share_home_list : [])];
        assert(list.every(home => record(home) && /^\d+$/.test(String(home.id)) && /^\d+$/.test(String(home.uid))), '米家家庭信息格式异常', 'MIJIA_ERROR');
        knownHomes = [...new Map(list.map(home => [String(home.id), home])).values()];
        homesSession = session;
        return knownHomes;
    }
    async function homeDevices(session, home, signal) {
        const result = await request(session, '/v2/home/home_device_list', {
            home_owner: Number(home.uid), home_id: Number(home.id), limit: 200,
            get_split_device: true, support_smart_home: true, get_cariot_device: true, get_third_device: true,
        }, signal);
        const list = result.device_info ?? result.list;
        assert(Array.isArray(list) && list.every(record), '米家家庭设备格式异常', 'MIJIA_ERROR');
        remember(session, list);
        return list;
    }
    const roomsOf = home => (Array.isArray(home.roomlist) ? home.roomlist : []).filter(room => record(room) && room.id != null);
    const memberIds = home => ids([...ids(home.dids), ...roomsOf(home).flatMap(room => ids(room.dids))]);
    const aggregationStates = createMijiaAggregations({ request, getSpec,
        getContext: (session, homeId) => homesSession === session && imageSession === session ? homeContexts.get(homeId) : null,
        getDevice: (session, did) => imageSession === session ? imageDevices.get(did) : null,
        checkSession: (signal, session) => {
            assert(!signal?.aborted, '请求已取消', 'CANCELLED');
            assert(getSession() === session, '米家账号已变化，请刷新', 'CONTEXT_CHANGED');
        },
    });
    const power = createMijiaPower({
        getSpec, getSpecTranslations, request,
        checkSession: (session, signal) => {
            assert(!signal?.aborted, '请求已取消', 'CANCELLED');
            assert(getSession() === session, '米家账号已变化，请刷新', 'CONTEXT_CHANGED');
        },
        getDevice: (session, did) => {
            const device = imageSession === session && imageDevices.get(did);
            assert(device, '设备不属于当前账号或尚未加载，请刷新设备列表', 'DEVICE_NOT_FOUND');
            return device;
        },
    });
    const devicePlugin = createMijiaDevicePlugin({
        getSpec, getSpecTranslations, request,
        getParentDeviceInfo: (session, raw) => {
            const parent = imageSession === session && raw.parent_id != null && imageDevices.get(String(raw.parent_id));
            if (!parent || String(parent.did) === String(raw.did)) return undefined;
            return { did: String(parent.did), model: typeof parent.model === 'string' ? parent.model : '', name: typeof parent.name === 'string' ? parent.name.slice(0, 256) : '', isOnline: parent.isOnline === true || parent.isOnline === 1 };
        },
        getRoomContext: (session, raw) => {
            if (homesSession !== session) return {};
            const did = String(raw.did);
            const home = knownHomes.find(home => memberIds(home).some(id => id === did || splitIdentity(imageDevices.get(id))?.parentId === did));
            if (!home) return {};
            const rooms = roomsOf(home);
            const room = rooms.find(room => ids(room.dids).includes(did));
            return {
                roomInfo: { homeId: String(home.id), homeName: home.name, ...(room ? { roomId: String(room.id), roomName: room.name } : {}) },
                roomNames: Object.fromEntries(rooms.filter(room => typeof room.name === 'string').map(room => [String(room.id), room.name])),
            };
        },
        getParentDevice: async (session, did, signal) => {
            if (imageSession !== session || !imageDevices.has(did)) await devices(session, signal);
        },
        checkSession: (session, signal) => {
            assert(!signal?.aborted, '请求已取消', 'CANCELLED');
            assert(getSession() === session, '米家账号已变化，请重新打开设备', 'CONTEXT_CHANGED');
        },
        getDevice: (session, did) => {
            const device = imageSession === session && imageDevices.get(did);
            assert(device, '设备不属于当前账号或尚未加载，请刷新设备列表', 'DEVICE_NOT_FOUND');
            return device;
        },
    });
    async function verifyIrController(session, did, controllerId, signal) {
        const id = controllerNumber(controllerId);
        assert(id !== null && id > 0, '红外遥控器编号无效');
        const controllers = await request(session, '/v2/irdevice/controllers', { parent_id: did }, signal);
        if (containsController(controllers, id)) return;
        // 空调伴侣的本体匹配配置可能没有云端虚拟遥控器记录；由当前设备确认，不能猜列表成员。
        const model = await request(session, `/home/rpc/${did}`, { id: 1, method: 'get_ac_model', params: [] }, signal);
        const result = Array.isArray(model) ? model : model?.code == null || model.code === 0 ? model?.result : null;
        assert(!model?.error && Array.isArray(result) && result.length >= 2 && controllerNumber(result[1]) === id, '红外遥控器不属于当前设备', 'PERMISSION_DENIED');
    }
    function normalizeCloudParams(params, did, session) {
        const normalize = (value, key = '', depth = 0) => {
            assert(depth <= 8, '云端接口参数层级过深', 'CLOUD_API_NOT_ALLOWED');
            if (Array.isArray(value)) {
                if (['dids', 'uids'].includes(key)) assert(value.every(item => String(item) === String(key === 'dids' ? did : session.userId) || key === 'uids' && item === '$owner'), '云端接口不能查询其他设备或账号', 'CLOUD_API_NOT_ALLOWED');
                return value.map(item => key === 'uids' && item === '$owner' ? String(session.userId) : normalize(item, key, depth + 1));
            }
            if (!record(value)) return value;
            const normalized = {};
            for (const [childKey, child] of Object.entries(value)) {
                if (['did', 'deviceID', 'device_id', 'parent_id'].includes(childKey)) assert(String(child) === did, '云端接口不能操作其他设备', 'CLOUD_API_NOT_ALLOWED');
                if (['uid', 'ownerId'].includes(childKey)) {
                    assert(child === '$owner' || String(child) === String(session.userId), '云端接口不能操作其他账号', 'CLOUD_API_NOT_ALLOWED');
                    normalized[childKey] = String(session.userId);
                } else normalized[childKey] = normalize(child, childKey, depth + 1);
            }
            return normalized;
        };
        return normalize(params);
    }
    function validateIrWrite(api, params, did) {
        const text = (value, max = 256) => typeof value === 'string' && value.length > 0 && value.length <= max;
        const number = value => Number.isInteger(value) && value > 0;
        const exact = (allowed) => {
            assert(Object.keys(params).every(key => allowed.includes(key)), '红外接口包含不支持的参数');
        };
        if (api === '/v2/irdevice/controller/add') {
            exact(['name', 'parent_id', 'category', 'controller_id', 'lineup_id']);
            assert(text(params.name) && String(params.parent_id) === did && number(params.category), '红外遥控器添加参数无效');
            if (params.controller_id !== undefined) assert(number(params.controller_id), '红外遥控器编号无效');
            if (params.lineup_id !== undefined) assert(text(params.lineup_id, 128), '红外遥控器 lineup 无效');
        } else if (api === '/v2/irdevice/send_key') {
            exact(['did', 'controller_id', 'key_id', 'ac_key', 'target_key']);
            assert(String(params.did) === did && number(params.controller_id), '红外发送目标无效');
            assert(Boolean(number(params.key_id)) !== Boolean(text(params.ac_key, 32768)), '红外按键参数无效');
            // 官方标准页总会携带 target_key；普通码库为空，定向码库使用 P/M/T/S/D。
            if (params.target_key !== undefined) assert(typeof params.target_key === 'string' && params.target_key.length <= 32, '红外目标按键无效');
        } else if (api === '/v2/irdevice/controller/del') {
            exact(['did']);
            assert(String(params.did) === did, '红外遥控器删除目标无效');
        } else if (api === '/v2/irdevice/controller/update') {
            exact(['did', 'keys']);
            assert(String(params.did) === did && Array.isArray(params.keys) && params.keys.length > 0 && params.keys.length <= 100, '红外遥控器更新参数无效');
            for (const key of params.keys) {
                assert(record(key) && Object.keys(key).every(name => ['code', 'name', 'key_id'].includes(name)) && text(key.code, 32768) && text(key.name) && (key.key_id === undefined || number(key.key_id)), '红外遥控器按键无效');
            }
        } else if (api === '/v2/irdevice/controller/key/update') {
            exact(['did', 'name', 'key_id']);
            assert(String(params.did) === did && text(params.name) && (params.key_id === undefined || number(params.key_id)), '红外按键更新参数无效');
        } else if (api === '/v2/irdevice/controller/key/del') {
            exact(['did', 'key_id']);
            assert(String(params.did) === did && (number(params.key_id) || typeof params.key_id === 'string' && params.key_id.length > 0 && params.key_id.length <= 128), '红外按键删除参数无效');
        } else if (api === '/v2/irdevice/controller/key/click') {
            exact(['did', 'controller_id', 'key_id']);
            assert(String(params.did) === did && number(params.controller_id) && number(params.key_id), '红外按键发送参数无效');
        }
        return { controllerId: params.controller_id };
    }
    function validateCloudWrite(api, params, did, current) {
        if (irWriteApis.has(api)) {
            assert(record(params), '红外写入参数无效');
            return validateIrWrite(api, params, did);
        }
        if (api === '/user/set_user_config') {
            assert(Array.isArray(params) && params.length > 0 && params.length <= 100, '用户云端配置参数无效');
            for (const item of params) {
                assert(record(item) && Object.keys(item).every(key => ['component_id', 'key', 'data'].includes(key)), '用户云端配置项结构无效');
                assert(Number.isInteger(item.component_id) && item.component_id >= 0, '用户云端配置组件编号无效');
                assert(Number.isInteger(item.key) && item.key >= 0 || typeof item.key === 'string' && item.key.length > 0 && item.key.length <= 128, '用户云端配置键无效');
                assert(item.data !== undefined, '用户云端配置值缺失');
                assert(JSON.stringify(item.data).length <= 4096, '用户云端配置项过大');
            }
            return {};
        }
        if (api === '/user/set_third_user_config') {
            const entries = Array.isArray(params) ? params : [params];
            assert(entries.length > 0 && entries.length <= 1001, '第三方云端配置参数无效');
            for (const item of entries) {
                assert(record(item) && Object.keys(item).every(key => ['model', 'key', 'data'].includes(key)), '第三方云端配置项结构无效');
                assert(item.model === current.model, '第三方云端配置型号与当前设备不一致', 'CLOUD_API_NOT_ALLOWED');
                assert(Number.isInteger(item.key) && item.key >= 0 || typeof item.key === 'string' && item.key.length > 0 && item.key.length <= 128, '第三方云端配置键无效');
                assert(item.data !== undefined, '第三方云端配置值缺失');
                assert(JSON.stringify(item.data).length <= 4096, '第三方云端配置项过大');
            }
            return {};
        }
        if (['/device/setsetting', '/device/delsetting'].includes(api)) {
            const keys = Object.keys(params);
            assert(keys.every(key => ['did', 'settings'].includes(key)) && keys.includes('did'), '设备设置写入参数无效');
            if (api.endsWith('setsetting')) {
                assert(record(params.settings) && Object.keys(params.settings).length > 0 && Object.keys(params.settings).length <= 50, '设备设置内容无效');
                for (const [key, value] of Object.entries(params.settings)) assert(typeof key === 'string' && key.length <= 128 && typeof value === 'string' && value.length <= 1000, '设备设置值过大');
            } else {
                assert(Array.isArray(params.settings) && params.settings.length > 0 && params.settings.length <= 50 && params.settings.every(key => typeof key === 'string' && key.length <= 128), '设备设置删除参数无效');
            }
            return {};
        }
        if (['/v2/device/set_extra_data', '/v2/device/del_extra_data'].includes(api)) {
            assert(String(params.did) === did && Object.keys(params).every(key => ['did', 'extra_data', 'keys'].includes(key)), '设备扩展数据参数无效');
            if (api.endsWith('set_extra_data')) {
                assert(record(params.extra_data) && Object.keys(params.extra_data).length > 0 && Object.keys(params.extra_data).length <= 50, '设备扩展数据内容无效');
                for (const [key, value] of Object.entries(params.extra_data)) assert(typeof key === 'string' && key.length <= 128 && typeof value === 'string' && value.length <= 1024, '设备扩展数据值过大');
            } else {
                assert(Array.isArray(params.keys) && params.keys.length > 0 && params.keys.length <= 50 && params.keys.every(key => typeof key === 'string' && key.length <= 128), '设备扩展数据删除参数无效');
            }
            return {};
        }
        if (api === '/user/set_user_device_data') {
            assert(Object.keys(params).every(key => ['did', 'type', 'key', 'value', 'time'].includes(key)) && ['prop', 'event', 'store'].includes(params.type) && typeof params.key === 'string' && params.key.length <= 128 && typeof params.value === 'string' && params.value.length <= 4096 && (params.time === undefined || Number.isSafeInteger(params.time) && params.time >= 0), '设备历史数据写入参数无效');
            return {};
        }
        if (api === '/user/del_user_device_data') {
            assert(Object.keys(params).every(key => ['did', 'type', 'key', 'time', 'value'].includes(key)) && typeof params.type === 'string' && params.type.length <= 128 && typeof params.key === 'string' && params.key.length <= 128 && Number.isSafeInteger(params.time) && params.time >= 0 && (params.value === undefined || typeof params.value === 'string' && params.value.length <= 4096), '设备历史数据删除参数无效');
            return {};
        }
        if (api === '/user/set_user_coll') {
            assert(Object.keys(params).every(key => ['did', 'name', 'content'].includes(key)) && typeof params.name === 'string' && params.name.length > 0 && params.name.length <= 256 && typeof params.content === 'string' && params.content.length <= 4096, '设备收藏写入参数无效');
            return {};
        }
        if (api === '/v2/device/batch_set_props') {
            assert(Array.isArray(params) && params.length > 0 && params.length <= 100, '设备数据写入参数无效');
            for (const item of params) {
                assert(record(item) && Object.keys(item).every(key => ['did', 'props'].includes(key)) && String(item.did) === did && record(item.props) && Object.keys(item.props).length > 0 && Object.keys(item.props).length <= 100, '设备数据写入项无效');
                for (const [key, value] of Object.entries(item.props)) {
                    assert(typeof key === 'string' && key.length > 0 && key.length <= 128 && !/^privacy/i.test(key), '设备数据键无效');
                    assert(typeof value === 'string' && value.length <= 4096, '设备数据值过大');
                }
            }
            return {};
        }
        if (api === '/user/edit_user_coll') {
            assert(Object.keys(params).every(key => ['coll_id', 'newname', 'content'].includes(key)) && typeof params.coll_id === 'string' && params.coll_id.length <= 128 && (params.newname === undefined || typeof params.newname === 'string' && params.newname.length > 0 && params.newname.length <= 256) && (params.content === undefined || typeof params.content === 'string' && params.content.length <= 4096), '设备收藏编辑参数无效');
            return {};
        }
        if (api === '/user/del_user_coll') {
            assert(Object.keys(params).every(key => ['did', 'coll_id'].includes(key)) && typeof params.coll_id === 'string' && params.coll_id.length <= 128, '设备收藏删除参数无效');
            return {};
        }
        if (api === `/home/rpc/${did}`) {
            assert(record(params) && Object.keys(params).every(key => ['method', 'params'].includes(key)), '设备 RPC 参数无效');
            assert(params.method === 'set_ac_model', '设备 RPC 方法不在写入白名单', 'CLOUD_API_NOT_ALLOWED');
            assert(Array.isArray(params.params) && params.params.length <= 16 && params.params.every(value => typeof value === 'boolean' || typeof value === 'number' || typeof value === 'string' && value.length <= 256), '设备 RPC 参数无效');
            return {};
        }
        throw error('CLOUD_API_NOT_ALLOWED', '云端接口不在设备插件写入白名单');
    }
    return {
        hasSession,
        getSessionRevision, // 仅供宿主判断内存视图缓存失效，不向插件暴露账号或凭据。
        getDevicePluginIdentity() { const session = account(); return { accountId: String(session.userId), region: 'CN' }; },
        reportDevicePluginLaunch: response => debug?.({ uri: 'semi://mijia/plugin-launch', params: {}, response }),
        reportDevicePluginReadFailure: response => debug?.({ uri: 'semi://mijia/plugin-data', params: {}, response }),
        async getDevicePluginLaunchData(did, operation, params, signal) {
            const session = account();
            assert(imageSession === session && imageDevices.has(did), '设备不属于当前账号或尚未加载', 'DEVICE_NOT_FOUND');
            if (operation === 'categories') return request(session, '/v2/plugin/category_standard_model', { api_version: 10118, app_platform: 'Android' }, signal);
            if (operation === 'metadata') {
                assert(typeof params.model === 'string' && /^[a-zA-Z0-9_.-]{1,128}$/.test(params.model), '标准包型号无效');
                return request(session, '/v2/plugin/fetch_plugin', { latest_req: { region: 'CN', app_platform: 'Android', api_version: 10118, plugins: [{ model: params.model }], package_type: '' } }, signal);
            }
            if (operation === 'support') {
                assert(Number.isSafeInteger(params.pluginId) && params.pluginId > 0 && Number.isSafeInteger(params.version) && params.version >= 0, '标准包版本无效');
                return request(session, '/v2/plugin/get_support_models', { plugin_id: params.pluginId, version: params.version }, signal);
            }
            if (operation === 'custom') return request(session, '/v2/plugin/get_standard_operation', { latest_req: { api_version: 10118, app_platform: 'Android', plugins: [{ model: imageDevices.get(did).model }], package_type: 'rn' } }, signal);
            assert(false, '启动配置操作无效');
        },
        async getDevicePluginMetadata(did, signal) {
            const session = account();
            const raw = imageSession === session && imageDevices.get(did);
            assert(raw && typeof raw.model === 'string', '设备不属于当前账号或尚未加载', 'DEVICE_NOT_FOUND');
            return request(session, '/v2/plugin/fetch_plugin', { latest_req: { region: 'CN', app_platform: 'Android', api_version: 10118, plugins: [{ model: raw.model }], package_type: '' } }, signal);
        },
        getDevicePluginContext: (did, signal) => devicePlugin.describe(account(), did, signal),
        doDevicePluginAction: (did, params, binding, signal) => devicePlugin.action(account(), did, params, binding, signal),
        getDevicePluginHistory: (did, params, binding, signal) => devicePlugin.history(account(), did, params, binding, signal),
        async getDevicePluginAuthorizedDevices(did, model, signal) {
            const session = account();
            const current = imageSession === session && imageDevices.get(did);
            assert(current, '设备不属于当前账号或尚未加载', 'DEVICE_NOT_FOUND');
            assert(typeof model === 'string' && /^[a-zA-Z0-9._:-]{1,128}$/.test(model), '授权设备型号无效');
            const list = await devices(session, signal);
            const ownerId = String(session.userId);
            return { result: list.filter(device => device.model === model).map(device => {
                const memberOwner = String(device.uid ?? ownerId);
                const productId = modeNumber(device.pid) ?? 0;
                return {
                    did: String(device.did ?? ''), name: typeof device.name === 'string' ? device.name.slice(0, 256) : '',
                    model: device.model, product_id: productId,
                    product_name: typeof device.product_name === 'string' ? device.product_name.slice(0, 256) : typeof device.name === 'string' ? device.name.slice(0, 256) : model,
                    deviceIconReal: '', mac: String(device.mac ?? device.did ?? ''), ownerId,
                    share_flag: memberOwner !== ownerId,
                };
            }) };
        },
        async getDevicePluginVersion(did, pid, signal) {
            const session = account();
            const current = imageSession === session && imageDevices.get(did);
            assert(current, '设备不属于当前账号或尚未加载', 'DEVICE_NOT_FOUND');
            const deviceType = typeof pid === 'string' && /^\d{1,8}$/.test(pid) ? Number(pid) : pid;
            assert(Number.isInteger(deviceType) && deviceType >= 0, '固件检查设备类型无效');
            return request(session, '/home/checkversion', { did, pid: deviceType }, signal);
        },
        async getDevicePluginCloudRead(did, api, params, signal) {
            const session = account();
            const current = imageSession === session && imageDevices.get(did);
            assert(current, '设备不属于当前账号或尚未加载', 'DEVICE_NOT_FOUND');
            if (api === `/home/rpc/${did}`) {
                assert(record(params) && Object.keys(params).every(key => ['method', 'params'].includes(key)) && ['get_ac_model', 'get_prop'].includes(params.method), '设备 RPC 方法不在读取白名单', 'CLOUD_API_NOT_ALLOWED');
                assert(Array.isArray(params.params) && (params.method === 'get_ac_model' ? params.params.length === 0
                    : params.params.length > 0 && params.params.length <= 100 && params.params.every(name => typeof name === 'string' && /^[a-zA-Z0-9_.-]{1,128}$/.test(name))), '设备 RPC 查询参数无效');
                return request(session, api, { id: 1, method: params.method, params: params.params }, signal);
            }
            assert(typeof api === 'string' && (Object.hasOwn(officialCloudApi, api) || irReadApis.has(api)), '云端接口不在官方 SDK 白名单', 'CLOUD_API_NOT_ALLOWED');
            assert(officialCloudApi[api] === 'read' || irReadApis.has(api), '写操作不能通过通用云端读取接口调用', 'CLOUD_API_NOT_ALLOWED');
            assert(params && typeof params === 'object', '云端接口参数无效');
            const serialized = JSON.stringify(params);
            assert(serialized.length <= 64 * 1024, '云端接口参数过大');
            const normalized = normalizeCloudParams(params, did, session);
            if (api === '/user/get_third_user_config') assert(normalized.model === current.model, '云端配置型号与当前设备不一致', 'CLOUD_API_NOT_ALLOWED');
            if (irControllerReadApis.has(api)) await verifyIrController(session, did, normalized.controller_id, signal);
            return request(session, api, normalized, signal);
        },
        async getDevicePluginCloudWrite(did, api, params, signal) {
            const session = account();
            const current = imageSession === session && imageDevices.get(did);
            assert(current, '设备不属于当前账号或尚未加载', 'DEVICE_NOT_FOUND');
            assert(params && typeof params === 'object', '云端写入参数无效');
            assert(JSON.stringify(params).length <= 256 * 1024, '云端写入参数过大');
            const validated = validateCloudWrite(api, params, did, current);
            const normalized = normalizeCloudParams(params, did, session);
            if (validated.controllerId !== undefined) await verifyIrController(session, did, validated.controllerId, signal);
            return request(session, api, normalized, signal, { allowScalar: true });
        },
        getDevicePluginProperties: (did, properties, binding, signal, datasource) => devicePlugin.read(account(), did, properties, binding, signal, datasource),
        async getDevicePluginImage(did, url, signal) {
            const session = account();
            assert(imageSession === session && imageDevices.has(did) && images && imageUrl(url), '设备图片不可用', 'IMAGE_UNAVAILABLE');
            const image = await images.get({ icon: url }, signal);
            assert(getSession() === session && !signal?.aborted, '账号已变化或图片请求取消', 'CANCELLED');
            return image;
        },
        setDevicePluginProperties: (did, properties, binding, signal) => devicePlugin.write(account(), did, properties, binding, signal),
        async getDevicePluginCloudCall(did, api, params, signal) {
            const write = officialCloudApi[api] === 'write' || irWriteApis.has(api) || cloudWriteApis.has(api) || api === `/home/rpc/${did}` && params?.method === 'set_ac_model';
            const result = write ? await this.getDevicePluginCloudWrite(did, api, params, signal)
                : await this.getDevicePluginCloudRead(did, api, params, signal);
            // 官方 nativeCall 把完整响应交给调用方；standardCall 由 SDK 端解出 result。
            return { code: 0, message: 'ok', result };
        },
        async getDevicePluginGatewayInfo(did, mac, signal) {
            const session = account();
            const current = imageSession === session && imageDevices.get(did);
            assert(current, '设备不属于当前账号或尚未加载', 'DEVICE_NOT_FOUND');
            assert(typeof mac === 'string' && /^[0-9A-Fa-f:.-]{4,32}$/.test(mac), '蓝牙设备 MAC 无效');
            const sameMac = device => String(device.mac ?? '').toUpperCase().replace(/-/g, ':') === mac.toUpperCase().replace(/-/g, ':');
            const target = sameMac(current) ? current : [...imageDevices.values()].find(sameMac);
            assert(target, '蓝牙设备不属于当前账号', 'DEVICE_NOT_FOUND');
            return { rssi: modeNumber(target.rssi), isOnline: target.isOnline === true || target.isOnline === 1 };
        },
        getDevicePowerStates: (dids, signal) => power.getStates(account(), dids, signal),
        getDeviceStates: (dids, signal) => power.getStates(account(), dids, signal, true),
        setDevicePower: (did, on, signal) => power.setState(account(), did, on, signal),
        setDeviceCurtain: (did, action, signal) => power.setCurtain(account(), did, action, signal),
        async getDeviceList(signal) {
            const list = await devices(account(), signal);
            const exclusions = listExclusions(list);
            const visible = list.filter(device => !exclusions.has(String(device.did)));
            const splitParents = splitParentsOf(visible);
            return visible.map(device => displayDevice(device, splitParents, exclusions));
        },
        async getDeviceImage(did, signal) {
            const session = account();
            const device = imageSession === session && imageDevices.get(did);
            assert(device && images, '设备图片不可用，请刷新设备列表', 'IMAGE_UNAVAILABLE');
            const split = splitIdentity(device);
            let icon = split?.valid && imageUrl(split.icon);
            if (split?.valid && !icon) {
                try {
                    const icons = await keyIcons(session, split.parentId, signal);
                    icon = icons.get(String(split.moduleId));
                } catch (e) {
                    if (['CANCELLED', 'CONTEXT_CHANGED', 'AUTH_REQUIRED', 'AUTH_EXPIRED'].includes(e.code)) throw e;
                    // 旧型号或无按键图标配置仍使用设备图片，不阻断整个页面。
                }
            }
            const image = await images.get(icon ? { ...device, icon_real: icon } : device, signal);
            assert(getSession() === session, '米家账号已变化，请刷新', 'CONTEXT_CHANGED');
            return image;
        },
        async getDeviceLocations(dids, signal) {
            assert(Array.isArray(dids) && dids.length <= 2000 && dids.every(did => typeof did === 'string' && /^[a-zA-Z0-9._:-]{1,256}$/.test(did)), '设备标识无效');
            if (!dids.length) return [];
            const session = account();
            const [list, catalog] = await Promise.all([homes(session, signal), devices(session, signal)]);
            const known = new Set(catalog.map(device => String(device.did)));
            const wanted = new Set(dids);
            const matches = new Map(dids.map(did => [did, []]));
            for (const home of list) {
                let members = new Set(memberIds(home));
                if (dids.some(did => !members.has(did))) {
                    const records = await homeDevices(session, home, signal);
                    for (const device of records) { const did = String(device.did); members.add(did); known.add(did); }
                }
                for (const did of wanted) if (members.has(did)) {
                    const rooms = roomsOf(home).filter(room => ids(room.dids).includes(did));
                    matches.get(did).push({ homeName: home.name || '', roomName: rooms.length === 1 ? rooms[0].name || '' : '' });
                }
            }
            assert(getSession() === session && !signal?.aborted, '账号已变化或请求取消', 'CONTEXT_CHANGED');
            return dids.filter(did => known.has(did)).map(did => ({ did, ...(matches.get(did).length === 1 ? matches.get(did)[0] : {}) }));
        },
        async getHomes(signal) {
            const session = account();
            const routerId = String(getRouterId() || '');
            const [list, catalog] = await Promise.all([homes(session, signal), devices(session, signal)]);
            const router = routerId && catalog.find(device => {
                const did = String(device.did || '');
                return (did.startsWith('miwifi.') ? did.slice(7) : String(device.partner_id || '')) === routerId;
            });
            const did = router && String(router.did);
            let current = did && list.find(home => memberIds(home).includes(did));
            // 与登录页相同：gethome 的 dids 在部分账号中不完整，反查家庭设备。
            if (did && !current) {
                for (const home of list) {
                    if ((await homeDevices(session, home, signal)).some(device => String(device.did) === did)) { current = home; break; }
                }
            }
            assert(String(getRouterId() || '') === routerId, '当前路由器已变化，请刷新', 'CONTEXT_CHANGED');
            return {
                homes: list.map(home => ({ id: String(home.id), name: home.name || '未命名家庭' })),
                defaultHomeId: current ? String(current.id) : null,
            };
        },
        async getHomeDevices(homeId, signal) {
            assert(typeof homeId === 'string' && /^\d+$/.test(homeId), '无效家庭 ID');
            const session = account();
            // owner_uid 从账号可访问的家庭取得，插件不能自报 owner 或 endpoint。
            const home = (await homes(session, signal)).find(home => String(home.id) === homeId);
            assert(home, '家庭不存在或已无权访问，请刷新家庭列表', 'HOME_NOT_FOUND');
            const [catalog, members, result] = await Promise.all([
                devices(session, signal), homeDevices(session, home, signal),
                // 当前米家客户端请求 V2 全屋／房间排序；同一响应中的旧字段可能长期保留旧顺序。
                request(session, '/v2/home/get_union_order', {
                    home_id: [Number(home.id)], owner_uid: Number(home.uid), platform: 'android', source: '',
                    get_front_order: true, get_room_order: true, get_cate_order: false,
                    get_front_order_v2: true, get_room_order_v2: true,
                }, signal),
            ]);
            assert(Array.isArray(result.info), '米家设备排序格式异常', 'MIJIA_ERROR');
            // 新家庭可能尚未保存顺序；追加新设备，忽略已删除设备和重复 did。
            const order = result.info.find(info => String(info?.home_id) === homeId) || {};
            assert(['front_order', 'room_order', 'front_order_v2', 'room_order_v2'].every(key => order[key] === undefined || Array.isArray(order[key])), '米家设备排序格式异常', 'MIJIA_ERROR');
            // 字段存在但为空表示没有保存 V2 顺序，不能回退到另一份过期顺序。
            const frontOrder = order.front_order_v2 ?? order.front_order;
            const map = new Map(catalog.map(device => [String(device.did), device]));
            for (const device of members) map.set(String(device.did), { ...map.get(String(device.did)), ...device });
            const rawHomeIds = ids([...members.map(device => device.did), ...memberIds(home)]).filter(did => map.has(did));
            // 只用当前家庭的组记录；隐藏成员不能被旧排序或房间补齐重新加入。
            const exclusions = listExclusions(rawHomeIds.map(did => map.get(did)));
            const allIds = rawHomeIds.filter(did => !exclusions.has(did));
            const all = new Set(allIds);
            const roomOrders = (order.room_order_v2 ?? order.room_order ?? []).filter(record);
            const rooms = roomsOf(home).map(room => {
                const roomOrder = roomOrders.find(o => String(o.room_id) === String(room.id));
                return {
                    id: String(room.id), name: room.name || '未命名房间',
                    // did_order 可残留设备移动前的房间；它只排序，不提供房间成员。
                    deviceIds: ordered(ids(room.dids).filter(did => all.has(did)), roomOrder?.did_order),
                };
            });
            const assigned = new Set(rooms.flatMap(room => room.deviceIds));
            for (const room of roomOrders) {
                if (!rooms.some(r => r.id === String(room.room_id)) && ['mijia.roomid.default', 'mijia.roomid.share'].includes(room.room_id)) {
                    const deviceIds = ids(room.did_order).filter(did => all.has(did) && !assigned.has(did));
                    for (const did of deviceIds) assigned.add(did);
                    if (deviceIds.length) rooms.push({ id: room.room_id, name: room.room_id === 'mijia.roomid.share' ? '共享设备' : '未分配房间', deviceIds });
                }
            }
            const roomMap = new Map(rooms.map(room => [room.id, room]));
            const roomIds = ordered([...roomMap.keys()], roomOrders.map(room => room.room_id));
            const sortedRooms = roomIds.map(id => roomMap.get(id));
            // 未记录在全屋顺序中的设备沿用房间顺序，再补充未分配的家庭成员。
            const homeIds = ordered(allIds, sortedRooms.flatMap(room => room.deviceIds));
            const deviceIds = ordered(homeIds, frontOrder);
            // 聚合是 V2 序列中的独立条目；缺少标记时不能按设备种类自行创建。
            const aggregations = new Set(ids(order.front_order_v2).filter(id => !all.has(id) && Object.hasOwn(AGGREGATIONS, id)));
            const entries = ordered([...deviceIds, ...aggregations], frontOrder).map(id => aggregations.has(id)
                ? { type: 'aggregation', id, name: AGGREGATIONS[id] } : { type: 'device', did: id });
            // 隐藏卡片不删除真实物理成员，聚合仍按服务器 target_props 读取状态。
            const aggregateMembers = new Set(rawHomeIds.filter(did => !excludedByComFlag(map.get(did))));
            for (const did of [...aggregateMembers]) {
                const split = splitIdentity(map.get(did));
                if (split?.valid && imageDevices.has(split.parentId)) aggregateMembers.add(split.parentId);
            }
            homeContexts.set(homeId, { home, members: aggregateMembers, aggregations });
            // 只根据当前家庭实际存在的拆分按键隐藏原设备，不使用其他家庭或旧缓存中的关系。
            const splitParents = splitParentsOf(deviceIds.map(did => map.get(did)));
            // 只记录展示字段，用于比较两个列表来源，避免原始 token 等进入诊断摘要。
            const flags = device => ({ freqFlag: device?.freqFlag ?? null, hide_mode: device?.hide_mode ?? null, show_mode: device?.show_mode ?? null, comFlag: device?.comFlag ?? null });
            const catalogMap = new Map(catalog.map(device => [String(device.did), device]));
            const memberMap = new Map(members.map(device => [String(device.did), device]));
            debug?.({ uri: 'semi://mijia/home-visibility', params: { homeId }, response: { devices: ordered(rawHomeIds, frontOrder).map(did => ({
                did, name: displayDevice(map.get(did)).name, ...homeVisibility(map.get(did), splitParents, exclusions),
                catalog: flags(catalogMap.get(did)), home: flags(memberMap.get(did)),
            })) } });
            return {
                devices: deviceIds.map(did => displayDevice(map.get(did), splitParents, exclusions)),
                rooms: sortedRooms.map(room => ({ ...room, deviceIds: room.deviceIds.filter(did => !splitParents.has(did)) })),
                entries,
            };
        },
        getHomeAggregationStates(homeId, signal) {
            assert(typeof homeId === 'string' && /^\d{1,20}$/.test(homeId), '无效家庭 ID');
            return aggregationStates(account(), homeId, signal);
        },
    };
}
module.exports = { createMijiaService };
