// 只读云端方法的声明式映射；写操作仍由宿主白名单拒绝。
const direct = {
    getUserStatistics: '/v2/user/statistics',
    getDeviceSetting: '/device/getsetting',
    getDeviceSettingV2: '/v2/device/getsettingv2',
    getDevicesConfig: '/v2/device/range_get_extra_data',
    getDeviceData: '/user/get_user_device_data',
    getDeviceDataV2: '/v2/user/get_user_device_data',
    getUserDeviceLog: '/v2/user/get_user_device_log',
    getUserColl: '/user/get_user_coll',
    getMapfileUrl: '/home/getmapfileurl',
    getRobomapUrl: '/home/getrobomapurl',
    getAppConfig: '/service/getappconfig',
    getAppConfigV2: '/service/getappconfigv2',
    getUserDeviceDataTab: '/v2/user/getuserdevicedatatab',
    getRangeOpenConfig: '/v2/home/range_get_open_config',
    rangeGetOpenConfig: '/v2/home/range_get_open_config',
    getUserPDData: '/user/getpdata',
    getTempUnit: '/v2/user/get_common_config',
    getInterimFileUrl: '/v2/home/get_interim_file_url',
    getFileUrl: '/home/getfileurl',
    getBleLockBindInfo: '/device/blelockbindinfo',
    getNFCCard: '/v2/nfckey/get_nfc_card',
    getIDFY: '/scene/idfy_get',
    getThirdConfig: '/device/getThirdConfig',
    getAreaPropInfo: '/location/area_prop_info',
    getProtocolUrls: '/v2/plugin/get_protocol',
};

const native = new Set([
    'getUserStatistics',
    'getDeviceSetting',
    'getDevicesConfig',
    'getAppConfig',
    'getNFCCard',
    'getIDFY',
    'getRangeOpenConfig',
]);

const args = {
    getUserInfo: uid => ['/home/profile', { uid }],
    getUserInfoList: uids => ['/home/profiles', { uids }],
    getCountry: (params = {}) => ['/home/getcountry', params],
    getLatestVersion: model => ['/home/latest_version', { model }],
    getLatestVersionV2: did => ['/v2/device/latest_ver', { did }],
    getAutoUpgradeConfig: did => ['/v2/device/get_auto_upgrade_config', { did }],
    getVirtualGroupSubDevices: groupDid => ['/v2/groupv2/query_status', { group_did: [groupDid] }],
    getVirtualGroupSubDevicesTags: groupDid => ['/v2/groupv2/query_tags', { group_did: [groupDid] }],
    getVoiceCtrlDevices: did => ['/voicectrl/ai_devs', { did }],
    getVoiceVtrlDevices: did => ['/voicectrl/ai_devs', { did }],
    getUserDeviceAuth: did => ['/user/get_device_auth', { did }],
    getWeatherInfo: did => ['/location/weather', { did }],
    getHomeDevice: (params = {}) => ['/home/device_list', { getHuamiDevices: true, ...params }],
    loadMembers: type => ['/v2/user/get_member', { type }],
};

function firmwareList(result) {
    const list = Array.isArray(result?.list) ? result.list : Array.isArray(result) ? result : result ? [result] : [];
    return list.map(item => ({
        isUpdating: item.updating,
        isLatest: item.isLatest,
        isForce: item.force,
        description: item.description,
        curVersion: item.curr,
        newVersion: item.latest,
        hasNewFirmware: !item.updating && !item.isLatest,
    }));
}

function updateInfo(result) {
    const item = Array.isArray(result?.list) ? result.list[0] : null;
    if (!item) return { needUpgrade: false, force: false, upgrading: false };
    const upgrading = ['downloading', 'downloaded', 'installing'].includes(item.ota_status);
    return {
        needUpgrade: !item.isLatest && item.latest !== item.curr && item.ota_status !== 'failed',
        force: Boolean(item.force),
        upgrading,
        latestVersion: item.latest,
    };
}

const custom = {
    getAvailableFirmwareForDids: {
        build: deviceIDs => ['/home/multi_checkversion', { dids: deviceIDs }],
        transform: firmwareList,
    },
    getMultiSwitchName: {
        build: did => ['/device/deviceinfo', { get_sub_relation: true, dids: [did] }],
        transform: result => result?.list?.[0]?.member_ship || Promise.reject(Object.assign(new Error('按键名称响应无效'), { code: 'MIJIA_ERROR' })),
    },
    getDeviceTimeZone: {
        build: did => ['/v2/device/get_extra_data', { did, keys: ['timezone'] }],
        native: true,
    },
    getFirmwareUpdateInfo: {
        build: did => ['/v2/device/multi_check_device_version', {
            app_level: '11.8.707',
            platform: 'android',
            check_reqs: [{ did, plugin_level: '1' }],
        }],
        transform: updateInfo,
    },
    checkFirmwareAutoUpgradeOpen: {
        async call(cloudRead, did) {
            const config = await cloudRead('/v2/device/multi_check_device_version', {});
            if (Number(config?.auto_upgrade_switch) !== 1) return { code: 0, data: false };
            const list = await cloudRead('/v2/device/auto_upgrade_list', { dids: [did] });
            const item = Array.isArray(list?.list) ? list.list.find(entry => String(entry?.did) === String(did)) : null;
            return item?.switch_config ? { code: 0, data: Number(item.switch_config.active) === 1 } : Promise.reject(Object.assign(new Error('固件自动升级配置无效'), { code: 'MIJIA_ERROR' }));
        },
    },
};

export const smarthomeReadMethods = Object.freeze({
    ...Object.fromEntries(Object.entries(direct).map(([method, api]) => [method, { api, args: 'params', native: native.has(method) }])),
    ...Object.fromEntries(Object.entries(args).map(([method, build]) => [method, { build, native: native.has(method) }])),
    ...custom,
});

export function createSmarthomeReadApi(cloudRead) {
    const api = {};
    const finish = async (definition, promise) => {
        const result = await promise;
        if (definition.native) return { code: 0, message: 'ok', result };
        return result;
    };
    for (const [method, definition] of Object.entries(smarthomeReadMethods)) {
        if (definition.call) api[method] = (...values) => definition.call(cloudRead, ...values);
        else api[method] = (...values) => {
            const [apiName, params] = definition.build ? definition.build(...values) : [definition.api, values[0]];
            const request = cloudRead(apiName, params);
            return finish(definition, definition.transform ? request.then(definition.transform) : request);
        };
    }
    return api;
}
