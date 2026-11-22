import { useCallback, useEffect, useRef, useState } from 'react';
import { semi } from './api.mjs';
import { Button, Card, Empty, Select, Spin, Tabs, Toast, Typography } from '@semi/plugin-ui/ui.js';
import { IconPause, IconQuit, IconSettingStroked, IconSmallTriangleDown, PanelsLeftRight } from '@semi/plugin-ui/icons.js';
import { useHostViewport } from '@semi/plugin-ui/hostViewport.js';
import mijiaIcon from '../assets/mijia-symbol.svg';
import './smart-devices.css';
import DevicePluginLauncher from './DevicePluginLauncher.jsx';
import OverlayLauncher from './OverlayLauncher.jsx';
import { loadSmartDeviceHomes } from './homes.mjs';
import { getHomeEntries, getCardGroups } from './home-entries.mjs';
import AggregationCard from './AggregationCard.jsx';
import { curtainToggleAction, deviceDetails } from './card-state.mjs';
import { watchTrayCardSize } from './tray-card-size.mjs';

const ALL_ROOMS = '$all';
const EMPTY_HOME = { devices: [], rooms: [], entries: [] };
const POWER_POLL_INTERVAL = 5000;

function DeviceCard({ device, roomName, power, busy, onPower, onCurtain, onOpen, cardSize = 'medium', tray = false }) {
    const [failedImage, setFailedImage] = useState(null);
    const image = device.imageUrl && failedImage !== device.imageUrl ? device.imageUrl : null;
    const offline = !device.isOnline;
    const details = deviceDetails(power);
    const curtain = power?.curtain;
    const curtainAction = curtain?.supported ? curtain.nextAction : null;
    const small = cardSize === 'small';
    const iconControl = tray && small && !offline && (power?.supported || curtain?.supported);
    const iconCurtainAction = curtainToggleAction(curtain);
    const iconReady = curtain?.supported ? Boolean(iconCurtainAction) : typeof power?.on === 'boolean';
    const isOn = !curtain?.supported && power?.on === true;
    const subtitle = offline ? `${roomName} ｜ 设备离线` : details ? `${roomName} ｜ ${details}` : roomName;
    const imageClass = `smart-device-image${image ? '' : ' is-placeholder'}`;
    const imageContent = <img src={image || mijiaIcon} alt="" loading="lazy" decoding="async" onError={image ? () => setFailedImage(image) : undefined} />;
    return <Card className={`smart-device-card${isOn ? ' is-on' : ''}${onOpen ? ' is-openable' : ''}`} data-card-size={cardSize}
        role={onOpen ? 'button' : undefined} tabIndex={onOpen ? 0 : undefined}
        onClick={onOpen ? () => onOpen(device) : undefined} onKeyDown={onOpen ? event => {
            if (event.target === event.currentTarget && ['Enter', ' '].includes(event.key)) { event.preventDefault(); onOpen(device); }
        } : undefined}>
        <div className="smart-device-top">
            {iconControl ? <button type="button" className={`${imageClass} smart-device-image-control`}
                disabled={busy || !iconReady} aria-busy={busy}
                aria-pressed={!curtain?.supported && typeof power?.on === 'boolean' ? power.on : undefined}
                onClick={event => {
                    event.stopPropagation();
                    if (busy || !iconReady) return;
                    if (curtain?.supported) onCurtain(device.did, iconCurtainAction);
                    else onPower(device.did);
                }}
            >{imageContent}</button> : <div className={imageClass}>{imageContent}</div>}
            {!small && !offline && curtain?.supported ? <span className="smart-device-power-wrap"><Button
                    className="smart-device-power"
                    theme="light" type="tertiary"
                    icon={curtain.nextAction === 'pause' ? <IconPause style={{ fontSize: 14 }} /> : <PanelsLeftRight size={14} />}
                    disabled={!curtainAction} aria-busy={busy} aria-disabled={busy || !curtainAction}
                    onClick={event => { event.stopPropagation(); if (!busy && curtainAction) onCurtain(device.did, curtainAction); }}
                /></span> : !small && !offline && power?.supported && <span className="smart-device-power-wrap"><Button
                    className="smart-device-power"
                    theme={power.on === true ? 'solid' : 'light'} type={power.on === true ? 'primary' : 'tertiary'}
                    icon={<IconQuit style={{ fontSize: 14 }} />}
                    disabled={typeof power.on !== 'boolean'}
                    aria-busy={busy} aria-disabled={busy || typeof power.on !== 'boolean'}
                    aria-pressed={typeof power.on === 'boolean' ? power.on : undefined}
                    onClick={event => { event.stopPropagation(); if (!busy) onPower(device.did); }}
                /></span>}
        </div>
        <div className="smart-device-text">
            <div className={`smart-device-label${offline ? ' is-offline' : ''}`}>{device.name}</div>
            <div className="smart-device-room">{subtitle}</div>
        </div>
    </Card>;
}

export default function SmartDevices({ tray = false }) {
    const [homes, setHomes] = useState([]);
    const [homeId, setHomeId] = useState('');
    const [roomId, setRoomId] = useState(ALL_ROOMS);
    const [home, setHome] = useState(EMPTY_HOME);
    const [homesLoading, setHomesLoading] = useState(true);
    const [devicesLoading, setDevicesLoading] = useState(false);
    const [homesError, setHomesError] = useState(null);
    const [devicesError, setDevicesError] = useState(null);
    const [revision, setRevision] = useState(0);
    const [powerStates, setPowerStates] = useState({});
    const [aggregationStates, setAggregationStates] = useState({});
    const [powerBusy, setPowerBusy] = useState({});
    const [traySupported, setTraySupported] = useState(false);
    const [trayCardSize, setTrayCardSize] = useState('default');
    const [settingsVisible, setSettingsVisible] = useState(false);
    const [openedDevice, setOpenedDevice] = useState(null);
    useEffect(() => { setOpenedDevice(null); }, [homeId]);
    const homesRequest = useRef(null);
    const devicesRequest = useRef(null);
    const powerRequest = useRef(null);
    const powerActions = useRef(new Map());
    const powerVersions = useRef(new Map());
    const viewport = useHostViewport();
    const size = viewport.width >= 1024 ? 'large' : viewport.width >= 600 ? 'medium' : 'small';
    useEffect(() => {
        if (!tray) return;
        return watchTrayCardSize(semi, setTrayCardSize);
    }, [tray]);
    useEffect(() => {
        if (tray) return;
        setTraySupported(['darwin', 'win32'].includes(semi.getAppBaseInfo().platform));
    }, [tray]);
    useEffect(() => {
        if (!tray && homeId && !homesLoading && !homesError) semi.setStorage({ key: 'selected-home', data: homeId }).catch(() => {});
    }, [tray, homeId, homesLoading, homesError]);
    useEffect(() => semi.onEvent('mijia.debug', data => {
        console.groupCollapsed(`[米家接口] ${data.uri} · ${data.timestamp}`);
        console.log('请求参数', data.params);
        if (data.error) console.error('请求失败', data.error);
        else console.log('返回数据', data.response);
        if (data.uri === 'semi://mijia/home-visibility') console.table((data.response?.devices || []).map(device => ({
            did: device.did, name: device.name, showOnHome: device.showOnHome,
            reason: device.reasons.join(' / ') || '未返回隐藏标记',
            catalogFreqFlag: device.catalog.freqFlag, homeFreqFlag: device.home.freqFlag,
            catalogHideMode: device.catalog.hide_mode, homeHideMode: device.home.hide_mode,
            catalogShowMode: device.catalog.show_mode, homeShowMode: device.home.show_mode,
            catalogComFlag: device.catalog.comFlag, homeComFlag: device.home.comFlag,
        })));
        console.groupEnd();
    }), []);
    const loadHomes = useCallback(async () => {
        homesRequest.current?.abort();
        devicesRequest.current?.abort();
        powerRequest.current?.abort();
        const controller = new AbortController();
        homesRequest.current = controller;
        setHomesLoading(true); setDevicesLoading(false); setHomesError(null); setDevicesError(null);
        setHome(EMPTY_HOME);
        try {
            const result = await loadSmartDeviceHomes(semi, { tray, signal: controller.signal });
            const { data: preferred } = await semi.getStorage({ key: 'selected-home' }).catch(() => ({ data: null }));
            if (controller.signal.aborted) return;
            setHomes(result.homes);
            setDevicesLoading(result.homes.length > 0);
            setHomeId(previous => result.homes.some(h => h.id === previous) ? previous : result.homes.some(h => h.id === preferred) ? preferred : result.defaultHomeId || result.homes[0]?.id || '');
            setRevision(value => value + 1);
        } catch (e) {
            if (!controller.signal.aborted) setHomesError(e.message || '获取家庭失败，请重试');
        } finally {
            if (!controller.signal.aborted) setHomesLoading(false);
        }
    }, [tray]);
    useEffect(() => {
        loadHomes();
        return () => { homesRequest.current?.abort(); devicesRequest.current?.abort(); };
    }, [loadHomes]);
    useEffect(() => {
        if (!tray) return;
        let active = true;
        const syncHome = async () => {
            try {
                const { data: preferred } = await semi.getStorage({ key: 'selected-home' });
                if (!active || !preferred || preferred === homeId || !homes.some(item => item.id === preferred)) return;
                devicesRequest.current?.abort(); powerRequest.current?.abort();
                setHome(EMPTY_HOME); setDevicesLoading(true); setDevicesError(null); setHomeId(preferred);
            } catch { /* 读取偏好失败时继续展示当前家庭。 */ }
        };
        const off = semi.onEvent('lifecycle.visibility', event => { if (event.visible) syncHome(); });
        return () => { active = false; off(); };
    }, [tray, homes, homeId]);
    useEffect(() => {
        if (!homeId || homesLoading || homesError) return;
        const controller = new AbortController();
        devicesRequest.current = controller;
        powerRequest.current = controller;
        setDevicesLoading(true); setDevicesError(null); setHome(EMPTY_HOME);
        setPowerStates({}); setPowerBusy({}); setAggregationStates({});
        let currentHome = EMPTY_HOME;
        let initial = true, visible = false, visibilityChanged = false;
        let timer, pollRequest;
        const readPower = async (snapshot, signal) => {
            const versions = new Map(powerVersions.current);
            const online = snapshot.devices.filter(device => device.isOnline && !powerActions.current.has(device.did));
            const states = [];
            for (let index = 0; index < online.length; index += 100) {
                const dids = online.slice(index, index + 100).map(device => device.did);
                states.push(...await semi.mijia.getDeviceStates(dids, { signal }));
                if (signal.aborted || controller.signal.aborted) return;
            }
            if (signal.aborted || controller.signal.aborted) return;
            setPowerStates(previous => ({ ...previous, ...Object.fromEntries(states
                // 读取期间发生过操作的设备，不用旧读数覆盖乐观状态或写入结果。
                .filter(state => !powerActions.current.has(state.did) && versions.get(state.did) === powerVersions.current.get(state.did))
                .map(state => [state.did, state])) }));
        };
        const readStates = async (snapshot, signal) => {
            const results = await Promise.allSettled([
                readPower(snapshot, signal),
                (async () => {
                    if (tray || !snapshot.entries?.some(entry => entry.type === 'aggregation')) return;
                    const states = await semi.mijia.getHomeAggregationStates(homeId, { signal });
                    if (signal.aborted || controller.signal.aborted) return;
                    setAggregationStates(Object.fromEntries(states.map(state => [state.id, state])));
                })(),
            ]);
            // 两条只读链路独立更新，单项失败不清空另一个结果。
            for (const result of results) if (result.status === 'rejected') throw result.reason;
        };
        const applyHome = result => {
            currentHome = result;
            setHome(result);
            setRoomId(previous => result.rooms.some(room => room.id === previous) ? previous : ALL_ROOMS);
        };
        const schedule = (delay = POWER_POLL_INTERVAL) => {
            clearTimeout(timer);
            if (visible && !initial && currentHome !== EMPTY_HOME && !controller.signal.aborted && !pollRequest) timer = setTimeout(poll, delay);
        };
        const poll = async () => {
            if (!visible || controller.signal.aborted || pollRequest) return;
            const request = new AbortController();
            pollRequest = request;
            try {
                if (!request.signal.aborted && !controller.signal.aborted) await readStates(currentHome, request.signal);
            } catch { /* 后台轮询失败保留最后一次状态，不反复弹出提示。 */ }
            finally {
                if (pollRequest === request) { pollRequest = null; schedule(); }
            }
        };
        const setVisible = value => {
            visible = value;
            clearTimeout(timer);
            if (!visible) { pollRequest?.abort(); pollRequest = null; }
            else schedule(0);
        };
        controller.signal.addEventListener('abort', () => { clearTimeout(timer); pollRequest?.abort(); }, { once: true });
        const offVisibility = semi.onEvent('lifecycle.visibility', event => {
            visibilityChanged = true;
            setVisible(event.visible);
        });
        semi.getViewState().then(context => {
            if (!visibilityChanged && !controller.signal.aborted) setVisible(context.visible);
        }).catch(() => {});
        const load = async () => {
            try {
                const result = await semi.mijia.getHomeDevices(homeId, { signal: controller.signal });
                if (controller.signal.aborted) return;
                applyHome(result);
                try { await readStates(result, controller.signal); }
                catch (e) {
                    if (!controller.signal.aborted) Toast.warning(e.message || '读取设备状态失败，请刷新');
                }
            } catch (e) {
                if (!controller.signal.aborted) setDevicesError(e.message || '获取设备失败，请重试');
            } finally {
                if (!controller.signal.aborted) {
                    initial = false;
                    setDevicesLoading(false);
                    // 家庭加载失败由重试按钮处理，不轮询空的家庭快照。
                    if (currentHome !== EMPTY_HOME) schedule();
                }
            }
        };
        load();
        return () => {
            controller.abort(); pollRequest?.abort(); clearTimeout(timer); offVisibility();
            for (const action of powerActions.current.values()) action.abort();
            powerActions.current.clear();
        };
    }, [homeId, revision, homesLoading, homesError, tray]);
    const togglePower = async did => {
        const current = powerStates[did];
        const scope = powerRequest.current;
        if (!scope || scope.signal.aborted || typeof current?.on !== 'boolean' || powerActions.current.has(did) || !home.devices.some(device => device.did === did && device.isOnline)) return;
        const desired = !current.on;
        const controller = new AbortController();
        powerActions.current.set(did, controller);
        powerVersions.current.set(did, (powerVersions.current.get(did) || 0) + 1);
        setPowerStates(previous => ({ ...previous, [did]: { ...current, on: desired, error: undefined } }));
        setPowerBusy(previous => ({ ...previous, [did]: true }));
        try {
            const state = await semi.mijia.setDevicePower(did, desired, { signal: controller.signal });
            if (scope.signal.aborted) return;
            setPowerStates(previous => ({ ...previous, [did]: { ...previous[did], ...state, on: state.on === desired ? state.on : current.on } }));
            if (state.on !== desired) Toast.warning(state.error || '设备状态尚未变更，请稍后刷新确认');
        } catch (e) {
            if (controller.signal.aborted || scope.signal.aborted) return;
            setPowerStates(previous => ({ ...previous, [did]: current }));
            // 失败可能发生在设备接收指令之后；只重新读状态，不重放指令。
            try {
                const [state] = await semi.mijia.getDevicePowerStates([did], { signal: controller.signal });
                if (!scope.signal.aborted) {
                    setPowerStates(previous => ({ ...previous, [did]: { ...previous[did], ...state, on: state.on === desired ? state.on : current.on } }));
                    if (state.on === desired) return;
                }
            } catch { /* 保持操作前状态，由页面刷新确认 */ }
            if (!scope.signal.aborted) Toast.error(e.message || '开关操作失败，请刷新确认');
        } finally {
            if (!scope.signal.aborted) {
                powerActions.current.delete(did);
                setPowerBusy(previous => ({ ...previous, [did]: false }));
            }
        }
    };
    const controlCurtain = async (did, action) => {
        const scope = powerRequest.current;
        if (!scope || scope.signal.aborted || powerActions.current.has(did) || !home.devices.some(device => device.did === did && device.isOnline)) return;
        const controller = new AbortController();
        powerActions.current.set(did, controller);
        powerVersions.current.set(did, (powerVersions.current.get(did) || 0) + 1);
        setPowerBusy(previous => ({ ...previous, [did]: true }));
        try {
            const result = await semi.mijia.setDeviceCurtain(did, action, { signal: controller.signal });
            if (!scope.signal.aborted && result.state) setPowerStates(previous => ({ ...previous, [did]: result.state }));
        } catch (e) {
            if (!controller.signal.aborted && !scope.signal.aborted) Toast.error(e.message || '窗帘操作失败');
        } finally {
            if (!scope.signal.aborted) {
                powerActions.current.delete(did);
                setPowerBusy(previous => ({ ...previous, [did]: false }));
            }
        }
    };

    const activeRoom = !tray && home.rooms.find(room => room.id === roomId);
    const roomNames = new Map();
    for (const room of home.rooms) for (const id of room.deviceIds) if (!roomNames.has(id)) roomNames.set(id, room.name);
    const entries = getHomeEntries(home, { room: activeRoom, tray, powerStates, aggregationStates, trayCardSize });
    const loading = homesLoading || devicesLoading;
    const error = homesError || devicesError;
    const activeKey = activeRoom ? roomId : ALL_ROOMS;
    const content = <div className="smart-devices-content">
        {error ? <div className="smart-devices-error" role="alert"><span>{error}</span><Button onClick={homesError ? loadHomes : () => setRevision(value => value + 1)}>重试</Button></div>
                : entries.length ? <div className="smart-devices-grid">{getCardGroups(entries).map(group => <div className="smart-device-slot" data-card-size={group.cardSize} key={group.key}>
                    {group.entries.map(entry => entry.type === 'aggregation'
                        ? <AggregationCard key={`aggregation:${entry.id}`} entry={entry} state={aggregationStates[entry.id]} cardSize={group.cardSize} />
                        : <DeviceCard key={`device:${entry.device.did}`} device={entry.device} roomName={activeRoom?.name || roomNames.get(entry.device.did) || '未分配房间'} power={powerStates[entry.device.did]} busy={Boolean(powerBusy[entry.device.did])} onPower={togglePower} onCurtain={controlCurtain} onOpen={tray ? undefined : setOpenedDevice} cardSize={group.cardSize} tray={tray} />)}
                </div>)}</div>
                    : <Empty title={homes.length ? tray ? '暂无可开关设备' : '暂无设备' : '暂无米家家庭'} description={homes.length ? tray ? '全屋中暂无在线且支持开关的设备' : '此房间或家庭中还没有设备' : '请先在米家中添加家庭和设备'} />}
    </div>;
    const selectHome = id => {
        if (id === homeId) return;
        devicesRequest.current?.abort();
        powerRequest.current?.abort();
        setHome(EMPTY_HOME); setRoomId(ALL_ROOMS); setDevicesError(null); setDevicesLoading(true); setHomeId(id);
    };
    const pageClass = `smart-devices-page${tray ? ' smart-devices-tray' : ''}`;
    if (loading) return <div className={pageClass} data-size={size} aria-busy="true">
        <div className="smart-devices-loading" role="status"><Spin size="large" /></div>
    </div>;
    return <div className={pageClass} data-size={size}>
        <div className="smart-devices-container">
            {!tray && <div className="smart-devices-header">
                <Select className="smart-home-select" value={homeId || undefined} onChange={selectHome} position="bottomLeft" dropdownMatchSelectWidth={false}
                    disabled={!homes.length || homesLoading || Boolean(homesError)} optionList={homes.map(item => ({ value: item.id, label: item.name }))}
                    triggerRender={({ value, disabled }) => <div className="smart-home-switch" data-disabled={disabled}>
                        <Typography.Title heading={6}>{value[0]?.label || (homesLoading ? '正在加载家庭' : '暂无家庭')}</Typography.Title>
                        <IconSmallTriangleDown />
                    </div>}
                />
                {!tray && traySupported && <Button theme="borderless" type="tertiary" size="small" icon={<IconSettingStroked />}
                    aria-haspopup="dialog" aria-expanded={settingsVisible} onClick={() => setSettingsVisible(true)} />}
            </div>}
            {tray ? <div className="smart-tray-scroll">
                {content}
            </div> : <Tabs activeKey={activeKey} onChange={setRoomId} className="smart-devices-tabs">
                <Tabs.TabPane tab="全屋" itemKey={ALL_ROOMS}>{activeKey === ALL_ROOMS && content}</Tabs.TabPane>
                {home.rooms.map(room => <Tabs.TabPane key={room.id} tab={room.name} itemKey={room.id}>{activeKey === room.id && content}</Tabs.TabPane>)}
            </Tabs>}
        </div>
        {!tray && settingsVisible && <OverlayLauncher view="settings" onClose={() => setSettingsVisible(false)} errorMessage="设置打开失败" />}
        {!tray && openedDevice && <DevicePluginLauncher device={openedDevice} onClose={() => setOpenedDevice(null)} />}
    </div>;
}
