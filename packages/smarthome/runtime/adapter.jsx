import React from 'react';
import ReactDOM from 'react-dom';
import * as Web from 'react-native-web';
import { writeAndConfirm } from './property-write.mjs';
import { adaptScrollProps } from './scroll-events.mjs';
import { NativeLottie, lottieCommands, dispatchLottie, updateLottie } from './native-lottie.jsx';
import { ArtPath } from './art-path.mjs';
import { createPhoneScreenInfo, createDarkMode, createAppearance, createAppState } from './environment.mjs';
import { createThemeStyle } from './theme-style.mjs';
import { flattenNativeStyle, createNativeStyleSheet, nativeLayoutStyle } from './native-style.mjs';
import { createPluginReact } from './plugin-react.mjs';
import { createDeviceMetadata } from './device-metadata.mjs';
import { createNetworkInfo } from './network-info.mjs';
import { createNativeFiles } from './native-files.mjs';
import { createWebView } from './web-view.jsx';
import { nativeDialogs } from './native-dialogs.jsx';
import { fillOfficialApi } from './compat-api.mjs';
import { createDeviceRpc } from './device-rpc.mjs';
import { createHostStorage } from './host-storage.mjs';
import { createSmarthomeReadApi } from './smarthome-read.mjs';
import { createServiceApi } from './service-api.mjs';
import { createCloudStorageApi } from './cloud-storage.mjs';
import { getSpecByIid, getSpecByKey } from './spec-query.mjs';
import { createNavigationCompatibility } from './navigation.mjs';
import { createNavigationBarCompatibility } from './navigation-bar.mjs';

// 此文件只在 sandbox iframe 中运行，不能导入 Semi SDK、Node 或宿主页面模块。
const boot = window.__SEMI_MIJIA_BOOT;
const CHANNEL = 'semi-mijia-device-v1';
const noop = () => {};
const send = message => window.parent.postMessage({ channel: CHANNEL, ...message }, '*');
const unsupported = name => () => Promise.reject(Object.assign(new Error(`暂不支持${name}`), { code: 'UNSUPPORTED' }));
const api = (surface, label, target = {}) => fillOfficialApi(target, surface, unsupported, label);
const listeners = new Map();
function event(name) {
    return {
        addListener(fn) { if (!listeners.has(name)) listeners.set(name, new Set()); listeners.get(name).add(fn); return { remove: () => listeners.get(name)?.delete(fn) }; },
        emit(...args) { for (const fn of listeners.get(name) || []) fn(...args); },
    };
}
const group = new Proxy({}, { get: (object, name) => object[name] ||= event(name) });
const emitter = { addListener: (name, fn) => group[name].addListener(fn), emit: (name, ...args) => group[name].emit(...args), removeAllListeners: name => listeners.delete(name), removeListener: (name, fn) => listeners.get(name)?.delete(fn) };
const pending = new Map();
let serial = 0, visible = true, disposed = false, switching = false, pollTimer, pollController, writeQueue = Promise.resolve(), writing = 0;
let readVersion = 0;
const subscribed = new Map();
const propertyValues = new Map();
const reportConfig = new Map();
const readableProperty = (siid, piid) => boot.resource.instance.services.some(service => service.iid === siid && service.properties?.some(prop => prop.iid === piid && (prop.access?.includes('read') || prop.access?.includes('notify'))));
const close = () => boot.canGoBack ? navigatePlugin('back') : (send({ type: 'close' }), Promise.resolve());
window.addEventListener('keydown', event => { if (event.key === 'Escape') { event.preventDefault(); close(); } });
window.addEventListener('error', event => { send({ type: 'error', message: String(event.error?.stack || event.message || '运行环境错误').slice(0, 1000) }); console.error('[米家运行环境]', event.error?.stack || event.message); });
window.addEventListener('unhandledrejection', event => {
    event.preventDefault();
    // 官方插件常有不影响页面的 stray rejection；只记日志，不把页面判成加载失败。
    console.error('[米家设备插件] 异步任务失败', event.reason?.stack || event.reason?.message || event.reason);
});
window.addEventListener('message', event => {
    if (event.source !== window.parent || event.data?.channel !== CHANNEL) return;
    const message = event.data;
    if (message.type === 'reply') {
        const call = pending.get(message.id);
        if (call) { pending.delete(message.id); message.ok ? call.resolve(message.value) : call.reject(Object.assign(new Error(message.error?.message || '设备操作失败'), { code: message.error?.code })); }
    }
    if (message.type === 'visibility') {
        visible = Boolean(message.visible); clearTimeout(pollTimer);
        if (!visible) { pollController?.abort(); cancelPending(); }
        else schedule(0);
    }
});
function cancelPending() {
    for (const [id, call] of pending) { send({ type: 'cancel', id }); call.reject(Object.assign(new Error('请求已取消'), { code: 'CANCELLED' })); }
    pending.clear();
}
window.addEventListener('pagehide', () => { disposed = true; clearTimeout(pollTimer); pollController?.abort(); cancelPending(); });
async function invoke(method, properties, signal, params) {
    if (disposed || !visible || signal?.aborted || switching && method !== 'plugin-host') throw Object.assign(new Error('设备页面不可见或正在切换'), { code: 'CANCELLED' });
    const id = `r${++serial}`;
    let timer, abort;
    try {
        return await new Promise((resolve, reject) => {
            abort = () => { pending.delete(id); send({ type: 'cancel', id }); reject(Object.assign(new Error('请求已取消'), { code: 'CANCELLED' })); };
            signal?.addEventListener('abort', abort, { once: true });
            timer = setTimeout(() => { pending.delete(id); send({ type: 'cancel', id }); reject(Object.assign(new Error('设备响应超时，请刷新确认状态'), { code: 'TIMEOUT' })); }, method === 'plugin-host' ? 600000 : 31000);
            pending.set(id, { resolve, reject }); send({ type: 'request', id, method, properties, ...(params === undefined ? {} : { params }) });
        });
    } finally { clearTimeout(timer); signal?.removeEventListener('abort', abort); }
}
function normalizeProperties(properties, write) {
    if (!Array.isArray(properties) || !properties.length || properties.length > 100) throw new Error('属性数量无效');
    return properties.map(prop => {
        if (prop.did !== boot.device.did || !Number.isInteger(prop.siid) || !Number.isInteger(prop.piid) || prop.miid != null) throw new Error('设备属性目标无效');
        return { did: boot.device.did, siid: prop.siid, piid: prop.piid, ...(write ? { value: prop.value } : {}) };
    });
}
function publish(states) {
    const messages = new Map(), data = [], time = Date.now();
    for (const state of states) if (state.code === 0) {
        const key = `prop.${state.siid}.${state.piid}`;
        messages.set(key, [state.value]); data.push({ key, time });
        propertyValues.set(key.slice(5), state.value);
    }
    if (messages.size) group.deviceReceivedMessages.emit(M.Device, messages, data);
}
async function read(properties, signal, datasource = 1) {
    if (![1, 2, 3].includes(datasource)) throw new Error('属性数据来源无效');
    const params = normalizeProperties(properties, false);
    for (const prop of params) subscribed.set(`${prop.siid}.${prop.piid}`, prop);
    const states = await invoke('read', params, signal, { datasource });
    publish(states);
    return states;
}
function write(properties) {
    const params = normalizeProperties(properties, true);
    if (writing >= 8) return Promise.reject(Object.assign(new Error('操作过于频繁'), { code: 'PROPERTY_BUSY' }));
    writing++; const version = ++readVersion; pollController?.abort();
    // 顺序执行用户的新操作；不在网络失败后重放写指令。
    const readable = params.filter(prop => boot.resource.instance.services.some(service => service.iid === prop.siid && service.properties?.some(p => p.iid === prop.piid && p.access?.includes('read'))));
    const result = writeQueue.catch(noop).then(() => writeAndConfirm({
        properties: params, readable, write: properties => invoke('write', properties), read,
        publish: states => { if (version === readVersion) publish(states); }, active: () => !disposed && visible,
    })).finally(() => { writing--; schedule(); });
    writeQueue = result;
    return result;
}
function schedule(delay = 5000) {
    clearTimeout(pollTimer);
    if (!disposed && !switching && visible && subscribed.size && !writing && !pollController) pollTimer = setTimeout(poll, delay);
}
async function poll() {
    if (disposed || switching || !visible || writing || pollController) return;
    const controller = new AbortController(), version = readVersion; pollController = controller;
    try {
        const states = await read([...subscribed.values()], controller.signal);
        if (!controller.signal.aborted && !writing && version === readVersion) publish(states);
    } catch { /* 保留已确认状态，下一轮可见时重读。 */ }
    finally { if (pollController === controller) pollController = null; schedule(); }
}

let nativeNormalizeColor;
const themeStyle = createThemeStyle({ getColorScheme: () => boot.dark ? 'dark' : 'light', normalizeColor: value => nativeNormalizeColor?.(value) });
const nativeViews = new Set(['View', 'Text', 'Image', 'ImageBackground', 'TextInput', 'ScrollView', 'SafeAreaView', 'TouchableOpacity', 'TouchableHighlight', 'TouchableWithoutFeedback', 'Pressable', 'Switch'].map(name => Web[name]).filter(Boolean));
for (const name of ['View', 'Text', 'Image', 'ScrollView']) nativeViews.add(Web.Animated[name]);
function adaptPluginProps(type, props) {
    if (type && typeof type === 'object' && !type.$$typeof) throw new Error(`设备插件组件类型无效：${Object.keys(type).slice(0, 8).join(',')}`);
    if (type === Web.ScrollView || type === Web.Animated.ScrollView) props = adaptScrollProps(props);
    // 到真实 RN Web 控件才转换；提前处理会丢失 xm 自适配标记或重复反色。
    if (props == null && nativeViews.has(type)) props = {};
    if (props && nativeViews.has(type)) {
        const text = type === Web.Text || type === Web.TextInput || type === Web.Animated.Text;
        const layout = nativeLayoutStyle(props.style, { imageBackground: type === Web.ImageBackground });
        const style = themeStyle.style(layout, text);
        props = { ...props, style: text ? { color: 'inherit', ...style } : style };
        for (const key of Object.keys(props)) {
            if (/color$/i.test(key)) props[key] = themeStyle.color(props[key]);
            if (key === 'trackColor' && props[key] && typeof props[key] === 'object') props[key] = Object.fromEntries(Object.entries(props[key]).map(([state, color]) => [state, themeStyle.color(color)]));
        }
    }
    return props;
}
// 官方模块使用此 facade；React／RN Web 内部仍使用原 createElement，不能再次处理颜色。
const PluginReact = createPluginReact(React, adaptPluginProps, createNavigationBarCompatibility());
const createPluginElement = PluginReact.createElement;
const dark = createDarkMode({ getColorScheme: () => boot.dark ? 'dark' : 'light', addChangeListener: fn => group.appearanceChanged.addListener(fn), removeChangeListener: fn => listeners.get('appearanceChanged')?.delete(fn) });
const { appearance, nativeAppearance, serviceTheme } = createAppearance(dark);
const getPhoneScreenInfo = createPhoneScreenInfo(() => ({ width: window.innerWidth, height: window.innerHeight, scale: window.devicePixelRatio }));
const hostSystemInfo = {
    language: 'zh', platform: 'android', country: 'CN',
    // 桌面端没有手机型号；返回宿主系统真实平台而不是伪造移动机型。
    mobileModel: /Mac/i.test(navigator.platform) ? 'Mac' : String(navigator.platform || ''),
    sysVersion: (navigator.userAgent.match(/OS X ([\d_.]+)/)?.[1] ?? '').replace(/_/g, '.') || undefined,
    hostApiLevel: 10118, isXiaomiPhone: false,
};
window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', event => {
    boot.dark = event.matches;
    document.body.style.backgroundColor = boot.dark ? '#16161a' : '#fff';
    group.appearanceChanged.emit({ colorScheme: dark.getColorScheme() });
});
const virtualFiles = new Map();
const cloudRead = (api, params = {}) => invoke('cloud-read', [], undefined, { api, params });
const deviceMetadata = createDeviceMetadata({ cloudRead, device: boot.device });
const cloudWrite = (api, params = {}) => invoke('cloud-write', [], undefined, { api, params });
const browserFetch = window.fetch.bind(window);
window.fetch = async (input, init = {}) => {
    const url = new URL(typeof input === 'string' ? input : input.url, window.location.href);
    if (url.origin !== 'https://gateway.joyami.com' && !(url.origin === 'https://home.mi.com' && url.pathname === '/newoperation/productBaike')) return browserFetch(input, init);
    const request = new Request(input, init);
    if (request.method !== 'GET') throw new Error('此厂商接口暂仅支持只读请求');
    const response = await invoke('plugin-host', [], request.signal, { command: 'vendor-read', params: { url: request.url, headers: Object.fromEntries(request.headers.entries()) } });
    return new Response(response.body, { status: response.status, headers: response.headers });
};
const serviceCall = (mode, api, params) => mode === 'write' ? cloudWrite(api, params) : cloudRead(api, params);
const cloudCommand = async (name, args = []) => {
    if (!['get_ac_model', 'get_prop'].includes(name)) return unsupported(`云端能力 ${name}`)();
    // 读取本体当前匹配配置，不能用云端遥控器列表推断；宿主再次校验路径与方法。
    return cloudRead(`/home/rpc/${boot.device.did}`, { method: name, params: args });
};
const hostStorage = createHostStorage({ did: boot.device.did, storage: {
    get: key => invoke('storage-get', [], undefined, { key }),
    set: (key, value) => invoke('storage-set', [], undefined, { key, value }),
    remove: key => invoke('storage-remove', [], undefined, { key }),
} });
const deviceRpc = createDeviceRpc({ did: boot.device.did, services: boot.resource.instance.services, read, write, doAction: params => invoke('action', [], undefined, params), cloudCommand, unsupported });
const brandConfig = boot.device.brandId != null ? { brand_id: boot.device.brandId } : {};
const deviceConfigInfo = JSON.stringify(brandConfig);
const currentDevice = { did: boot.device.did, model: boot.device.model, isOnline: boot.device.isOnline, iconURL: boot.device.iconURL || '', iconUrl: boot.device.iconURL || '', deviceConfigInfo, parentDevice: boot.device.parentDevice };
const messageSubscription = { remove: () => { subscribed.clear(); schedule(); } };
const addReadableKeys = keys => {
    for (const key of keys) {
        const match = /^prop\.(\d+)\.(\d+)$/.exec(key);
        if (match && readableProperty(Number(match[1]), Number(match[2]))) subscribed.set(`${match[1]}.${match[2]}`, { did: boot.device.did, siid: Number(match[1]), piid: Number(match[2]) });
    }
    schedule();
};
const bleDevice = () => api('bluetoothDevice', 'Device.getBluetoothLE', {
    isConnected: false, isConnecting: false, disconnect: noop,
    subscribeMessages: (...keys) => { addReadableKeys(keys); return Promise.resolve({ ...messageSubscription }); },
    unsubscribeMessages: (...keys) => {
        if (!keys.length) { subscribed.clear(); schedule(); return Promise.resolve(); }
        for (const key of keys) {
            const match = /^(?:prop|event)\.(\d+)\.(\d+)$/.exec(key);
            if (match) subscribed.delete(`${match[1]}.${match[2]}`);
        }
        schedule();
        return Promise.resolve();
    },
});
const wifi = api('wifi', 'Device.getDeviceWifi', {
    listenMessages: (...keys) => { addReadableKeys(keys); return Promise.resolve(); },
    subscribeMessages: (...keys) => wifi.listenMessages(...keys).then(() => ({ remove: noop })),
    requestAuthorizedDeviceListData: model => invoke('authorized-devices', [], undefined, { model, did: boot.device.did }),
    checkVersion: () => invoke('check-version', [], undefined, { pid: boot.device.type, did: boot.device.did }),
    getVersion: () => wifi.checkVersion().then(version => version?.curVersion ?? version?.latest ?? ''),
    ...deviceRpc,
});
const smarthomeOverrides = {
    ...createSmarthomeReadApi(cloudRead),
    getDeviceIcon: deviceMetadata.getDeviceIcon,
    // 官方语义是云端设备数据（batchGetDeviceDatas → batchGetDeviceProps → /device/batchdevicedatas）。
    batchGetDeviceDatas: entries => cloudRead('/device/batchdevicedatas',
        (Array.isArray(entries) ? entries : [entries]).map(item => ({ ...item, did: boot.device.did }))),
    batchSetDeviceDatas: entries => cloudWrite('/v2/device/batch_set_props',
        (Array.isArray(entries) ? entries : [entries]).map(item => ({ ...item, did: boot.device.did }))),
    setDeviceSetting: params => cloudWrite('/device/setsetting', { ...params, did: boot.device.did }),
    delDeviceSetting: params => cloudWrite('/device/delsetting', { ...params, did: boot.device.did }),
    deviceSetExtraData: params => cloudWrite('/v2/device/set_extra_data', { ...params, did: boot.device.did }),
    delDevicesConfig: params => cloudWrite('/v2/device/del_extra_data', { ...params, did: boot.device.did }),
    setDeviceData: params => cloudWrite('/user/set_user_device_data', { ...params, did: boot.device.did }),
    delDeviceData: params => cloudWrite('/user/del_user_device_data', { ...params, did: boot.device.did }),
    setUserColl: params => cloudWrite('/user/set_user_coll', { ...params, did: boot.device.did }),
    editUserColl: params => cloudWrite('/user/edit_user_coll', params),
    delUserColl: params => cloudWrite('/user/del_user_coll', { ...params, did: boot.device.did }),
            getServerName: () => 'cn', getDeviceDataRaw: params => invoke('history', [], undefined, { ...params, did: boot.device.did }), checkDeviceVersion: (did, pid) => invoke('check-version', [], undefined, { did, pid }), reportEventRefChannel: () => Promise.resolve(), reportEvent: () => Promise.resolve(), reportLog: () => Promise.resolve(), updatePluginPageRef: () => Promise.resolve(),
};
const specOverrides = {
    getPropertiesValue: (properties, datasource = 1) => read(properties, undefined, datasource),
    setPropertiesValue: write,
    doAction: params => invoke('action', [], undefined, Array.isArray(params) ? params[0] : params),
    reportPropChanged: states => {
        const changed = (Array.isArray(states) ? states : [states]).map(state => ({ did: boot.device.did, siid: Number(state.siid), piid: Number(state.piid), code: 0, value: state.value }));
        if (changed.every(state => Number.isInteger(state.siid) && Number.isInteger(state.piid))) publish(changed);
        return Promise.resolve({ code: 0, message: 'ok' });
    },
    getSpecString: spec => String(spec) === String(boot.resource.instance.type) ? Promise.resolve(JSON.stringify(boot.resource.instance)) : unsupported('其他设备规格原文')(),
    getInstanceWithCache: async spec => {
        if (String(spec) !== String(boot.resource.instance.type)) throw Object.assign(new Error('暂不支持其他设备规格原文'), { code: 'UNSUPPORTED' });
        return JSON.parse(JSON.stringify(boot.resource.instance));
    },
    getSpecByKey: (spec, keys) => String(spec) === String(boot.resource.instance.type) ? getSpecByKey(boot.resource.instance, keys) : unsupported('其他设备规格查询')(),
    getSpecByIid: (spec, query) => String(spec) === String(boot.resource.instance.type) ? getSpecByIid(boot.resource.instance, query) : unsupported('其他设备规格查询')(),
    getPropertyReportConfig: properties => Promise.resolve((Array.isArray(properties) ? properties : [properties]).map(item => ({ did: boot.device.did, siid: Number(item.siid), piid: Number(item.piid), report: reportConfig.get(`${item.siid}.${item.piid}`) === true }))),
    setPropertyReportConfig: configs => {
        for (const item of Array.isArray(configs) ? configs : [configs]) reportConfig.set(`${item.siid}.${item.piid}`, Boolean(item.report ?? item.enable));
        return Promise.resolve({ code: 0 });
    },
};
const storageOverrides = createCloudStorageApi(cloudRead, cloudWrite);
const ircontrollerOverrides = createServiceApi('ircontroller', serviceCall);
let homepageWrite = Promise.resolve(), navigationPromise;
const homepageSettings = () => Promise.resolve({ code: 0, data: { standardized: boot.launch?.standardized === true, homepage_type: boot.launch?.preference ?? 0 } });
const customPluginInfo = model => model === undefined || model === boot.device.model
    ? Promise.resolve({ code: 0, data: boot.launch?.custom || {} }) : unsupported('其他设备的插件信息')();
function setHomepageSettings(params) {
    const operation = homepageWrite.then(() => invoke('plugin-host', [], undefined, { command: 'set-homepage', params })).then(() => {
        if (boot.launch) boot.launch.preference = params.homepage_type;
    });
    homepageWrite = operation; operation.catch(() => {});
    return operation;
}
function navigatePlugin(mode, pageName = 'main', pageParams = {}) {
    if (navigationPromise) return navigationPromise;
    const operation = homepageWrite.then(() => writeQueue.catch(noop)).then(() => {
        switching = true; clearTimeout(pollTimer); pollController?.abort(); cancelPending();
        return invoke('plugin-host', [], undefined, { command: 'navigate', params: { mode, pageName, pageParams } });
    });
    navigationPromise = operation.finally(() => { navigationPromise = null; switching = false; schedule(); });
    return navigationPromise;
}
const openPluginPage = (did, pageName = 'main', pageParams = {}) => String(did) === boot.device.did
    ? navigatePlugin('auto', pageName, pageParams) : unsupported('其他设备的插件页面')();
const goCustomPlugin = params => navigatePlugin('traditional', 'main', { ...params, open_plugin_source: 1 });
Object.assign(smarthomeOverrides, { getHomepageSettings: homepageSettings, setHomepageSettings, getCustomPluginInfo: customPluginInfo });
const M = {
    Device: api('device', 'Device', {
        owner: {
            ID: boot.device.isOwner ? '$owner' : '$other',
            isLoaded: false,
            async load() {
                // 官方 Account.load 从宿主取得当前账号资料；云端读取会把 '$owner' 绑定为真实会话 UID。
                const profile = await cloudRead('/home/profile', { uid: this.ID });
                const data = profile?.result ?? profile ?? {};
                if (data.id != null || data.userid != null || data.userId != null) this.ID = String(data.id ?? data.userid ?? data.userId);
                if (data.nickname != null || data.nickName != null) this.nickName = String(data.nickname ?? data.nickName);
                if (data.avatarUrl != null || data.avatarURL != null) this.avatarURL = String(data.avatarUrl ?? data.avatarURL);
                this.isLoaded = true;
                return this;
            },
        },
        deviceConfigInfo: brandConfig, extra: {}, parentDevice: boot.device.parentDevice, parentModel: boot.device.parentDevice?.model,
        getRoomInfoForCurrentHome: deviceMetadata.getRoomInfoForCurrentHome,
        getFreqFlag: deviceMetadata.getFreqFlag, isBelongToCarRoom: unsupported('车载房间归属'),
        deviceID: boot.device.did, session: '', model: boot.device.model, name: boot.device.name, isOnline: boot.device.isOnline, isOwner: boot.device.isOwner, type: boot.device.type, iconURL: currentDevice.iconURL, iconUrl: currentDevice.iconURL,
        DEVICE_TYPE: { BLUETOOTH_SINGLE_MODEL_DEVICE: '6', BLE_MESH_DEVICE: '16' }, getDeviceWifi: () => wifi,
        getDeviceBluetooth: unsupported('蓝牙直连'), getBluetoothLE: bleDevice,
    }),
    DeviceEvent: group, PackageEvent: group, PrivacyEvent: group, BluetoothEvent: group, DarkMode: dark,
    System: { accessibility: { getHighTextContrastState: () => Promise.resolve(window.matchMedia('(forced-colors: active)').matches || window.matchMedia('(prefers-contrast: more)').matches) } },
    // 标准页的网关门控在此代表云端通道可用；不连接或伪造本机蓝牙硬件。
    Bluetooth: (() => {
        const gatewayInfo = () => boot.device.mac
            ? invoke('gateway-rssi', [], undefined, { mac: boot.device.mac })
            : Promise.resolve({ rssi: null, isOnline: boot.device.isOnline });
        return {
            isBleOrMeshGatewayConnected: () => gatewayInfo().then(info => ({ code: 0, data: { connected: info.isOnline } })),
            isBleGatewayConnected: () => gatewayInfo().then(info => info.isOnline),
            // 官方原包把该调用当成可失败查询；返回 code:-1 而不是 reject，避免中断加载。
            getBtGateWaySubDeviceRSSI: () => gatewayInfo().then(info => info.rssi != null
                ? { code: 0, data: { RSSI: info.rssi } }
                : { code: -1, message: '设备尚未通过网关上报 RSSI' }),
            checkBluetoothIsEnabled: () => Promise.resolve(false),
        };
    })(),
    Entrance: { Main: 'main', Scene: 'scene' }, CLOUD_PRIVACY_EVENT_TYPES: {}, API_LEVEL: 10118, Utils: {},
    Host: api('host', 'Host', {
        getPhoneScreenInfo,
        get systemInfo() { return hostSystemInfo; },
        version: '11.8.707', isAndroid: true, isIOS: false, isPad: false,
        isIphoneXSeries: false,
        getAppName: () => 'Mi Home', getCurrentCountry: () => Promise.resolve('CN'),
        checkAndroidLocationServerIsOpen: () => false, phoneHasNfcForAndroid: () => false,
        pageShouldAdapterSoftKeyboard: () => true,
        storage: api('hostStorage', 'Host.storage', hostStorage),
        ui: api('hostUi', 'Host.ui', { goCustomPlugin, openPluginPage, keepScreenNotLock: (enabled = false) => { invoke('plugin-host', [], undefined, { command: 'keep-screen-on', params: { enabled } }).catch(error => console.warn('[米家设备插件] 保持屏幕常亮失败', error.message)); }, setNavigationBar: noop, setNavigationBarBackgroundColor: noop, setNavigationBarColor: noop, setStatusBarStyle: noop, setNavigationBarTitle: noop, closeCurrentPage: close, alertLegalInformationAuthorization: unsupported('隐私设置'), getFreqCameraNeedShowRedPoint: unsupported('摄像机入口提示'), getDevicesWithModel: model => invoke('authorized-devices', [], undefined, { model, did: boot.device.did }).then(result => result.result) }),
        audio: api('hostAudio', 'Host.audio'),
        crypto: api('hostCrypto', 'Host.crypto'),
        analytics: { track: noop, reportEvent: noop },
        // 设备页自己的临时文件空间，不读取本机文件，不提供真实设备 token。
        file: api('hostFile', 'Host.file', {
            readFile: name => virtualFiles.has(name) ? Promise.resolve(virtualFiles.get(name)) : Promise.reject(Object.assign(new Error('文件不存在'), { code: 'NOT_FOUND' })),
            writeFile: (name, value) => {
                if (typeof name !== 'string' || name.length > 256 || typeof value !== 'string' || value.length > 65536 || !virtualFiles.has(name) && virtualFiles.size >= 64) return Promise.reject(new Error('页面文件超过限制'));
                virtualFiles.set(name, value); return Promise.resolve();
            },
            deleteFile: name => { virtualFiles.delete(name); return Promise.resolve(); },
        }),
        locale: api('hostLocale', 'Host.locale', {
            language: 'zh', region: 'CN', timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
            getSystemTimeZone: () => Promise.resolve(Intl.DateTimeFormat().resolvedOptions().timeZone),
            getSystemTimeZoneOffset: () => Promise.resolve(-new Date().getTimezoneOffset() * 60000),
        }),
    }),
    Package: api('package', 'Package', { entrance: boot.page?.entrance || 'main', entryInfo: { resource: boot.resource }, pageParams: boot.page?.params || {}, isDebug: false, apiLevel: 10118, pluginID: boot.package?.pluginId ?? 1006883, version: boot.package?.version ?? 1, exit: close, entry: component => { OriginalRoot = component; } }),
    Service: api('service', 'Service', {
        // Semi 的米家请求固定连接正式服务器；与官方 Service.js 同步返回原生环境常量。
        getDevSerEnv: () => native.MIOTService.devSerEnv,
        getServerName: () => Promise.resolve({ countryCode: 'CN', serverCode: 'cn' }),
        callSmartHomeAPI: cloudRead,
        spec: specOverrides,
        smarthome: smarthomeOverrides,
        scene: api('scene', 'Service.scene', { openTimerSettingPageWithOptionsV2: unsupported('定时'), openIftttAutoPage: unsupported('自动化') }),
        account: api('account', 'Service.account', { ID: '$owner', getAccountInfo: () => Promise.resolve({ id: '$owner' }) }),
        miotcamera: api('miotcamera', 'Service.miotcamera'),
        ircontroller: ircontrollerOverrides,
        security: api('security', 'Service.security'),
        storage: storageOverrides,
        room: api('room', 'Service.room', { getRoomNames: deviceMetadata.getRoomNames }), kookong: api('kookong', 'Service.kookong'),
        permission: api('permission', 'Service.permission'), tjinfra: api('tjinfra', 'Service.tjinfra'),
        currentAccount: { ID: '$owner' }, reportLog: noop,
    }),
};
// 官方原生模块的兜底：已知的真实值直接提供，桌面端不存在的系统服务统一受控失败。
const nativeFallback = target => new Proxy(target, {
    get(target, prop) {
        if (prop in target || typeof prop !== 'string' || prop === 'then') return target[prop];
        return (...args) => {
            const callback = [...args].reverse().find(arg => typeof arg === 'function');
            const message = `桌面端暂不支持系统服务 ${prop}`;
            if (callback) { callback(false, { code: -1, message }); return; }
            return Promise.reject(Object.assign(new Error(message), { code: 'UNSUPPORTED' }));
        };
    },
});
const nativePackageId = boot.package?.pluginId ?? 1006883;
const miotPackageNative = nativeFallback({
    exit: close,
    packageName: boot.package?.project?.package_path || (boot.package?.kind === 'standard' ? 'miot.plugin.spec' : `plugin_${nativePackageId}`),
    basePath: '', localFilePath: '', plugPath: '', eventRandom: '',
    entryInfo: { resource: boot.resource },
    packageID: nativePackageId, pluginID: nativePackageId, version: boot.package?.version ?? 1, buildType: 'release',
    models: [], specModelNames: [], specPluginNames: [], specPluginIDs: [], specPluginNamesModels: [],
    // 插件打点上报在桌面端没有服务端，保持无操作而不是伪造数据。
    apiReport: noop,
    getPluginAppConfigValueForKey: () => undefined,
    onPackageLifecycle: noop, onDeventJs: noop, setParentControllerGestureEnabled: noop, setExitInfo: noop,
});
const miotDeviceNative = nativeFallback({ currentDevice, model: boot.device.model });
let sdkEventBuilder;
function createEventManager(definitions) {
    if (!sdkEventBuilder) {
        const record = [...registry].find(([, record]) => record.name === 'miot-sdk/native/events.js');
        if (!record) throw new Error('共享 SDK 缺少事件构造器');
        const module = req(record[0]);
        sdkEventBuilder = (module.default || module)(Object.create(null), emitter);
    }
    return sdkEventBuilder.createEventManager(definitions);
}
function buildEvents(definitions) {
    for (const [name, value] of Object.entries(createEventManager(definitions))) Object.defineProperty(definitions, name, { value, enumerable: true, configurable: false, writable: false });
}
function packageEvents() {
    const record = [...registry].find(([, record]) => record.name === 'miot-sdk/event/PackageEvent.js');
    return record ? req(record[0]).PackageEvent : group;
}
const native = {
    isAndroid: true, isIOS: false, NativeType: {}, Utils: {},
    MIOTHost: { goCustomPlugin, openPluginPage: (did, name, params, callback) => openPluginPage(did, name, params).then(value => callback?.(true, value)).catch(error => callback?.(false, { code: error.code, message: error.message })), getPhoneScreenInfo: callback => getPhoneScreenInfo().then(info => callback(true, info)), systemInfo: hostSystemInfo, locale: 'zh', is24HourTime: true, reportLog: noop, closeCurrentPage: close },
    MIOTPackage: miotPackageNative,
    MIOTDevice: miotDeviceNative, MIOTSpec: {},
    MIOTService: nativeFallback(Object.assign(serviceTheme, { devSerEnv: 'release', currentAccountID: '$owner', addLog: noop, reportEvent: noop, reportLog: noop,
        getDeviceIcon: (params, callback) => deviceMetadata.getDeviceIcon(params).then(value => callback(true, value)).catch(error => callback(false, { code: error.code, message: error.message })),
        getHomepageSettings: callback => homepageSettings().then(value => callback(true, value)), setHomepageSettings,
        getCustomPluginInfo: (params, callback) => customPluginInfo(params?.model).then(value => callback(true, value)).catch(error => callback(false, { code: error.code, message: error.message })),
    })),
    MIOTRPC: (() => {
        const nativeCall = (api, params, callback) => {
            invoke('cloud-native-call', [], undefined, { api, params: params ?? {} })
                .then(res => callback(true, res))
                .catch(err => callback(false, { code: err.code ?? -1, message: err.message }));
        };
        return {
            nativeCall,
            standardCall(api, params, callback, handler) {
                nativeCall(api, params, (ok, res) => {
                    if (ok) {
                        if (res && res.result == null) res.result = {};
                        if (handler) res = handler(api, params, res);
                        callback(ok, res.result);
                        return;
                    }
                    if (handler) res = handler(api, params, res);
                    callback(ok, res);
                });
            },
        };
    })(),
    Properties: { of: () => ({}), init: noop }, LocalCache: { currentDevice: {}, bluetoothDevices: new Map() },
    MIOTEventEmitter: emitter, buildEvents, createEventManager,
    NativeTimer: { setTimeout, clearTimeout }, SetTimeout: setTimeout, ClearTimeout: clearTimeout,
    createI18n: (strings, language = 'zh') => new (req(10020).default)(strings, language), getSystemLanguage: () => 'zh', language: 'zh',
};
M.Resources = { createI18n: native.createI18n, Language: { zh: 'zh', en: 'en' }, getLanguage: () => 'zh' };
const assetRegistry = {
    registerAsset(asset) {
        const key = (asset.httpServerLocation.replace(/^\/assets\//, '') + '/' + asset.name).replace(/[^a-zA-Z0-9]/g, '').toLowerCase();
        return { ...asset, uri: `${boot.base}assets/${key}.${asset.type}` };
    },
    getAssetByID: asset => asset,
};
// 浏览器没有系统状态栏；仍需同时支持 <StatusBar /> 和 SDK 静态方法。
class StatusBar extends React.Component { render() { return null; } }
Object.assign(StatusBar, { currentHeight: 0, setBarStyle: noop, setBackgroundColor: noop, setHidden: noop, setTranslucent: noop });
const RN = {
    ...Web,
    Platform: { ...Web.Platform, OS: 'android', Version: 35, select: choices => choices.android ?? choices.default },
    AppState: createAppState(document),
    Appearance: appearance,
    useColorScheme: () => {
        const [scheme, setScheme] = React.useState(dark.getColorScheme);
        React.useEffect(() => {
            const subscription = appearance.addChangeListener(event => setScheme(event.colorScheme));
            setScheme(dark.getColorScheme());
            return () => subscription.remove();
        }, []);
        return scheme;
    },
    StyleSheet: createNativeStyleSheet(Web.StyleSheet),
    Dimensions: { get: () => ({ width: window.innerWidth, height: window.innerHeight, scale: window.devicePixelRatio, fontScale: 1 }), addEventListener: () => ({ remove: noop }), removeEventListener: noop },
    DeviceEventEmitter: emitter, NativeEventEmitter: class { addListener(name, fn) { return group[name].addListener(fn); } },
    StatusBar, YellowBox: { ignoreWarnings: noop },
    NativeModules: {
        StatusBarManager: { HEIGHT: 0 }, PlatformConstants: {}, UIManager: {},
        MIOTDevice: miotDeviceNative,
        MIOTPackage: miotPackageNative,
        MIOTService: native.MIOTService,
        MIOTHost: native.MIOTHost,
        RNFSManager: createNativeFiles(hostStorage),
        Appearance: nativeAppearance,
        // 连接状态用浏览器真实 navigator.onLine；不伪造网络事件。
        RNCNetInfo: {
            addListener: () => ({ remove: noop }),
            getCurrentState: () => Promise.resolve({ type: navigator.onLine ? navigator.connection?.type || 'unknown' : 'none', isConnected: navigator.onLine, isInternetReachable: null, isWifiEnabled: navigator.connection?.type === 'wifi' ? navigator.onLine : null, details: null }),
            configure: () => Promise.resolve(),
        },
    },
    BackHandler: { addEventListener: (_name, fn) => group.hardwareBackPress.addListener(fn), removeEventListener: noop },
    I18nManager: { isRTL: false }, ViewPropTypes: { style: () => null },
    unstable_batchedUpdates: callback => callback(),
    // 未适配的原生控件按 RN 降级惯例渲染为普通容器：子内容可见，缺少的原生行为由调用方按 UNSUPPORTED 处理。
    requireNativeComponent: name => name === 'LottieAnimationView' ? NativeLottie : nativeDialogs[name] || class extends React.Component { render() { return createPluginElement(Web.View, this.props, this.props.children); } },
};
const asyncStorage = new Map();
RN.AsyncStorage = {
    getItem: key => Promise.resolve(asyncStorage.get(key) ?? null),
    setItem: (key, value) => { asyncStorage.set(String(key), String(value)); return Promise.resolve(); },
    removeItem: key => { asyncStorage.delete(key); return Promise.resolve(); },
    multiGet: keys => Promise.resolve(keys.map(key => [key, asyncStorage.get(key) ?? null])),
    multiSet: values => { for (const [key, value] of values) asyncStorage.set(String(key), String(value)); return Promise.resolve(); },
    getAllKeys: () => Promise.resolve([...asyncStorage.keys()]), clear: () => { asyncStorage.clear(); return Promise.resolve(); },
};
RN.UIManager = { ...Web.UIManager, LottieAnimationView: { Commands: lottieCommands }, getViewManagerConfig: name => name === 'LottieAnimationView' ? { Commands: lottieCommands } : Web.UIManager.getViewManagerConfig?.(name), dispatchViewManagerCommand: dispatchLottie, updateView: (node, _name, props) => updateLottie(node, props) };
RN.Image = React.forwardRef((props, ref) => createPluginElement(Web.Image, { ...props, ref }));
RN.Image.resolveAssetSource = source => source;
for (const name of ['View', 'Text', 'Image', 'TextInput', 'ScrollView', 'TouchableOpacity']) if (RN[name]) RN[name].propTypes ||= { style: () => null };
RN.NativeModules.RNGestureHandlerModule = { Direction: { RIGHT: 1, LEFT: 2, UP: 4, DOWN: 8 }, State: { UNDETERMINED: 0, FAILED: 1, BEGAN: 2, CANCELLED: 3, ACTIVE: 4, END: 5 }, createGestureHandler: unsupported('手势控件'), attachGestureHandler: unsupported('手势控件'), updateGestureHandler: unsupported('手势控件'), dropGestureHandler: noop };
RN.ViewPagerAndroid = React.forwardRef((props, ref) => createPluginElement(Web.ScrollView, { ...props, horizontal: true, pagingEnabled: true, ref }, props.children));
RN.NetInfo = createNetworkInfo(window);
RN.WebView = createWebView(Web.View, boot.base);
function svgProps(props) { return { ...props, style: themeStyle.style(flattenNativeStyle(props.style)) }; }
const svg = { __esModule: true };
for (const name of ['Svg', 'Path', 'Circle', 'Ellipse', 'Rect', 'Line', 'Polyline', 'Polygon', 'G', 'Defs', 'LinearGradient', 'RadialGradient', 'Stop', 'ClipPath', 'Mask', 'Pattern', 'Text', 'TSpan', 'Use', 'Symbol', 'Image']) {
    const tag = { Svg: 'svg', G: 'g', Defs: 'defs', ClipPath: 'clipPath', LinearGradient: 'linearGradient', RadialGradient: 'radialGradient', TSpan: 'tspan' }[name] || name.toLowerCase();
    svg[name] = class extends React.Component { render() { return React.createElement(tag, svgProps(this.props), this.props.children); } };
}
svg.default = svg.Svg;
RN.ART = {
    Surface: svg.Svg, Group: svg.G, Path: ArtPath, LinearGradient: svg.LinearGradient,
    Shape: props => React.createElement(svg.Path, { ...props, d: String(props.d || ''), fill: props.fill || 'none', transform: `translate(${props.x || 0} ${props.y || 0})` }),
};
class LinearGradient extends React.Component {
    render() {
        const { colors = [], locations, start = { x: 0, y: 0 }, end = { x: 0, y: 1 }, style, children, ...props } = this.props;
        const angle = Math.atan2(end.x - start.x, -(end.y - start.y)) * 180 / Math.PI;
        const stops = colors.map((color, i) => themeStyle.color(color) + (locations?.[i] != null ? ` ${locations[i] * 100}%` : ''));
        return createPluginElement(Web.View, { ...props, style: [style, { backgroundImage: `linear-gradient(${angle}deg,${stops.join(',')})` }] }, children);
    }
}
const navigation = {
    ...createNavigationCompatibility(React, { View: Web.View, close, unsupported: () => send({ type: 'unsupported' }),
        defaultHeader: ({ navigation, ...options }) => {
            const record = [...registry].find(([, entry]) => entry.name === 'miot-sdk/ui/NavigationBar.js');
            if (!record) throw new Error('共享 SDK 缺少标准导航栏');
            const module = req(record[0]), Header = module.default || module;
            return createPluginElement(Header, {
                title: options.headerTitle ?? options.title ?? boot.device.name,
                left: [{ key: Header.ICON.BACK, onPress: navigation.goBack }],
                type: Header.TYPE.LIGHT, style: options.headerStyle,
            });
        },
    }),
    createAppContainer: component => component, SafeAreaView: RN.SafeAreaView, NavigationEvents: () => null, NavigationActions: {}, StackViewStyleInterpolator: { forHorizontal: noop }, StackViewTransitionConfigs: { SlideFromRightIOS: {} },
};
const registry = new Map(), cache = new Map();
let OriginalRoot;
window.__d = (factory, id, deps, name) => registry.set(id, { factory, deps: deps || [], name, module: { exports: {} }, started: false });
const entries = new Set();
window.__r = id => entries.add(id); window.global = window; window.__DEV__ = false; window.process = { env: { NODE_ENV: 'production' } }; window.setImmediate = (fn, ...args) => setTimeout(fn, 0, ...args);
const def = value => ({ __esModule: true, default: value });
function runOriginal(record, id) {
    record.started = true; cache.set(id, record.module.exports);
    record.factory(window, req, key => { const module = req(key); return module?.__esModule ? module.default : module; }, req, record.module, record.module.exports, record.deps);
    cache.set(id, record.module.exports);
    return record.module.exports;
}
// 官方共享 SDK 的服务模块保留原始实现（含比开源目录更多的方法），只把宿主转译叠加到实例上。
const patchedServices = new Map([
    ['miot-sdk/service/smarthome.js', smarthomeOverrides],
    ['miot-sdk/service/spec.js', specOverrides],
    ['miot-sdk/service/storage.js', storageOverrides],
    ['miot-sdk/service/ircontroller.js', ircontrollerOverrides],
]);
function override(record, id) {
    const name = record?.name || '';
    if (id === 10033) return RN;
    if (id === 10297) return PluginReact;
    if (id === 10074) { M.PackageEvent = packageEvents(); return M; }
    if (id === 14299) return def(LinearGradient);
    if (id === 10120 || id === 10290) return {};
    if (/^miot-sdk\/native\/(index|android\/index|ios\/index)\.js$/.test(name)) return { ...native, default: native, __esModule: true };
    if (name.includes('@react-native-community/netinfo') && /index\.(js|ts)$/.test(name)) return RN.NetInfo;
    if (name === 'miot-sdk/Package.js') return { ...def(M.Package), PackageEvent: packageEvents() };
    if (name === 'miot-sdk/Host.js') return def(M.Host);
    if (name === 'miot-sdk/Service.js') return { ...def(M.Service), CurrentAccount: { id: '$owner' } };
    if (name === 'miot-sdk/System.js') return def(M.System);
    if (name === 'miot-sdk/Device.js') return { ...def(M.Device), DeviceEvent: group, DarkMode: dark };
    if (name === 'miot-sdk/decorator/ReportDecorator.js') return { referenceReport: noop, report: (_target, _key, descriptor) => descriptor, resultReport: (_target, _key, descriptor) => descriptor, reportAsync: (_target, _key, descriptor) => descriptor };
    if (name === 'miot-sdk/device/BasicDevice.js') return { ...def(M.Device), DeviceEvent: group, PollPropMap: new Map() };
    if (name === 'miot-sdk/darkmode/index.js') return def(dark);
    if (patchedServices.has(name)) {
        const shipped = record.started ? record.module.exports : runOriginal(record, id);
        const instance = shipped.default ?? shipped;
        if (instance && typeof instance === 'object') {
            Object.assign(instance, patchedServices.get(name));
            M.Service[name.split('/').pop().replace('.js', '')] = instance;
        }
        return shipped;
    }
    if (name.endsWith('/Image/AssetRegistry.js')) return assetRegistry;
    if (name.endsWith('/Image/resolveAssetSource.js')) return RN.Image.resolveAssetSource;
    if (name === 'node_modules/react-native-svg/index.js') return svg;
    if (name === 'node_modules/react-navigation/src/react-navigation.js' || name === 'node_modules/react-navigation-stack/dist/index.js') return navigation;
    if (name.endsWith('/BatchedBridge/NativeModules.js')) return RN.NativeModules;
    if (name.endsWith('/ReactNative/requireNativeComponent.js')) return RN.requireNativeComponent;
    if (name.endsWith('/Utilities/Platform.android.js')) return RN.Platform;
    if (name.endsWith('/StyleSheet/StyleSheet.js')) return RN.StyleSheet;
    if (name.endsWith('/ReactNative/UIManager.js')) return Web.UIManager || {};
    if (name.endsWith('/EventEmitter/NativeEventEmitter.js')) return RN.NativeEventEmitter;
    if (name.startsWith('node_modules/react-native/Libraries/')) {
        const key = name.split('/').pop().replace(/\.(android|ios|native|web)?\.?[jt]sx?$/, '');
        if (RN[key]) return RN[key];
        if (key === 'flattenStyle') return RN.StyleSheet.flatten;
        if (key === 'processColor') return Web.processColor;
    }
    if (name.endsWith('/ReactNative/ReactNativeViewAttributes.js')) return { UIView: {}, RCTView: {} };
    return undefined;
}
function req(id) {
    const record = registry.get(id), replacement = override(record, id);
    if (replacement !== undefined) return replacement;
    if (record?.started) return record.module.exports;
    if (cache.has(id)) return cache.get(id);
    if (!record) throw new Error(`设备插件缺少模块 ${id}`);
    record.started = true; cache.set(id, record.module.exports);
    record.factory(window, req, key => { const module = req(key); return module.__esModule ? module.default : module; }, req, record.module, record.module.exports, record.deps);
    cache.set(id, record.module.exports); return record.module.exports;
}
function PluginRoot() {
    const colorScheme = RN.useColorScheme();
    // 原生 Text 的缺省黑色也经过米家文字反色；嵌套 Text 继续继承父级显式颜色。
    React.useLayoutEffect(() => { document.body.style.color = themeStyle.color('#000000', true); }, [colorScheme]);
    // Package.entry 由宿主接管，但不能丢掉官方 PackageRoot 给 SDK／mhui 组件提供的主题。
    // 原包也可自带 mhui（模块无名称），按实际导出识别其 Provider，不改写原模块。
    const providers = new Set();
    for (const record of registry.values()) {
        const exported = record.started && record.module.exports;
        if (exported?.SDKContextProvider) providers.add(exported.SDKContextProvider);
        if (exported?.ConfigContext && exported.ConfigProvider) providers.add(exported.ConfigProvider);
    }
    let content = React.createElement(OriginalRoot);
    for (const Provider of providers) content = React.createElement(Provider, {
        value: { colorScheme }, colorScheme, language: 'zh', environment: 'mihome', media: { screenType: 'phone' },
    }, content);
    return content;
}
window.addEventListener('DOMContentLoaded', () => {
    try {
        const colorModule = [...registry].find(([, record]) => record.name === 'node_modules/react-native/Libraries/Color/normalizeColor.js');
        if (colorModule) nativeNormalizeColor = req(colorModule[0]);
        // 顶层 Service 与独立 service 模块必须引用同一官方实例，保留新版 SDK 方法。
        for (const [id, record] of registry) if (patchedServices.has(record.name)) req(id);
        for (const id of entries) req(id);
        packageEvents().packageWillLoad.emit();
        if (!OriginalRoot) throw new Error('设备插件没有注册首页');
        // 即使设备包只用顶层 miot 导出，也先初始化官方 SDK 的主题上下文。
        const sdkContext = [...registry].find(([, record]) => record.name === 'miot-sdk/sdkContext/index.js');
        if (sdkContext) req(sdkContext[0]);
        ReactDOM.render(React.createElement(PluginRoot), document.getElementById('app'));
        send({ type: 'loaded' }); schedule();
    } catch (error) { console.error('[米家设备插件]', error); send({ type: 'error', message: String(error.stack || error.message || '初始化失败').slice(0, 1000) }); }
}, { once: true });
