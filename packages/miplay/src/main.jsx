import { useEffect, useRef, useState } from 'react';
import { compareDisplayNames } from '@semi/plugin-ui/name-order.mjs';
import { semi } from '../client/api.mjs';
import { mountPlugin } from '@semi/plugin-ui/mount.jsx';
import { Button, Card, List, Spin, Switch, Toast, Typography } from '@semi/plugin-ui/ui.js';
import { restoreSelection, selectionKey } from './selection.mjs';
import RoutingDiagram from './RoutingDiagram.jsx';
import airplayIcon from './assets/airplay.png';
import minaIcon from './assets/mina.png';
import miplayIcon from './assets/miplay.png';
import './miplay.css';

function Miplay() {
    const [state, setState] = useState({ phase: 'loading' });
    const [selected, setSelected] = useState(new Set());
    const [saving, setSaving] = useState(false);
    const [airplay, setAirplay] = useState({ enabled: false, speakerIds: [] });
    const [airplayBusy, setAirplayBusy] = useState(false);
    const airplayLock = useRef(false);
    const operation = useRef(null);
    const saveLock = useRef(false);
    const start = () => {
        operation.current?.abort();
        const controller = new AbortController(); operation.current = controller;
        setState({ phase: 'loading' }); setSelected(new Set());
        return controller;
    };
    const failure = (error, controller) => {
        if (!controller.signal.aborted) setState({ phase: error.code === 'AUTH_REQUIRED' ? 'auth' : 'error', message: error.code === 'AUTH_REQUIRED' ? '请在登录页重新扫码在线登录，以完成音箱账号认证。' : error.message });
    };
    const read = async controller => {
        const result = await semi.callBackground('outputs.list', {}, { signal: controller.signal });
        const { data: saved } = await semi.getStorage({ key: selectionKey(result.accountId) });
        const service = await semi.callBackground('airplay.get');
        if (controller.signal.aborted) return;
        result.speakers = result.speakers.filter(speaker => speaker.online !== false);
        result.speakers.sort((a, b) => compareDisplayNames(a.name, b.name));
        setSelected(restoreSelection(service.enabled ? service.speakerIds : saved, result.speakers));
        setAirplay(service);
        setState({ phase: 'ready', ...result });
    };
    const load = async () => {
        const controller = start();
        try {
            await semi.login({ domain: 'account.xiaomi.com' }, { signal: controller.signal });
            const allowed = await semi.authorize({ scope: ['runtime.node', 'ui.tray.create'] });
            if (controller.signal.aborted) return;
            if (!allowed['runtime.node']) { setState({ phase: 'error', message: '未获得系统访问授权，请在应用设置中允许后重试。' }); return; }
            await read(controller);
        } catch (error) { failure(error, controller); }
    };
    useEffect(() => {
        const stoppedOff = semi.onBackgroundEvent('stopped', () => setAirplay({ enabled: false, speakerIds: [] }));
        const diagnosticOff = semi.onBackgroundEvent('airplay.diagnostic', data => console.log('[AirPlay 音频流]', data));
        const debugOff = semi.onBackgroundEvent('mina.debug', data => console.log('[MiNA 音箱列表]', data));
        const miplayOff = semi.onBackgroundEvent('miplay.devices', data => console.log('[MiPlay 音箱列表]', data));
        const airplayOff = semi.onBackgroundEvent('airplay.changed', value => {
            if (value.diagnostic) console.log('[AirPlay 音频流]', value.diagnostic);
            setAirplay(value);
            if (value.error) Toast.error(value.error);
        });
        const outputsOff = semi.onBackgroundEvent('audio.outputs.changed', () => {
            if (operation.current && !operation.current.signal.aborted && !saveLock.current && !airplayLock.current) {
                const controller = operation.current;
                read(controller).catch(error => { if (!controller.signal.aborted) Toast.error(error.message); });
            }
        });
        load();
        const accountOff = semi.onEvent('mina.account.changed', () => load());
        return () => { operation.current?.abort(); accountOff(); debugOff(); miplayOff(); airplayOff(); diagnosticOff(); stoppedOff(); outputsOff(); };
    }, []);
    const choose = async (id, checked) => {
        if (saveLock.current || airplayLock.current || state.phase !== 'ready') return;
        saveLock.current = true; setSaving(true);
        const controller = operation.current;
        const previous = selected;
        const next = new Set(selected);
        checked ? next.add(id) : next.delete(id);
        setSelected(next);
        try {
            if (airplay.enabled) {
                setAirplay(await semi.callBackground('airplay.set', { enabled: next.size > 0, speakerIds: [...next] }, { signal: controller.signal }));
            }
            await semi.setStorage({ key: selectionKey(state.accountId), data: [...next] });
        }
        catch (error) { if (!controller.signal.aborted) { setSelected(previous); Toast.error(error.message); } }
        finally { saveLock.current = false; setSaving(false); }
    };
    const toggleAirplay = async enabled => {
        if (airplayLock.current || saveLock.current || state.phase !== 'ready') return;
        airplayLock.current = true; setAirplayBusy(true);
        try { setAirplay(await semi.callBackground('airplay.set', { enabled, speakerIds: [...selected] }, { signal: operation.current.signal })); }
        catch (error) { if (!operation.current.signal.aborted) Toast.error(error.message); }
        finally { airplayLock.current = false; setAirplayBusy(false); }
    };
    const configure = async (protocol, enabled) => {
        if (saveLock.current || airplayLock.current) return;
        saveLock.current = true; setSaving(true);
        const controller = operation.current;
        try {
            await semi.callBackground('outputs.configure', { ...(state.protocols || { mina: true, miplay: true }), [protocol]: enabled }, { signal: controller.signal });
            await read(controller);
        } catch (error) { if (!controller.signal.aborted) Toast.error(error.message); }
        finally { saveLock.current = false; setSaving(false); }
    };
    if (state.phase === 'loading') return <div className="miplay-loading"><Spin /></div>;
    if (state.phase !== 'ready') return <Card><div className="miplay-state">
        <Typography.Text type="secondary">{state.message}</Typography.Text>
        {state.phase !== 'auth' && <Button type="tertiary" onClick={load}>重试</Button>}
    </div></Card>;
    return <div className="miplay">
        <RoutingDiagram speakers={state.speakers} selected={selected} airplay={airplay} onChoose={choose}
            disabled={saving || airplayBusy} />
        <Typography.Text strong className="miplay-settings-title">发送端</Typography.Text>
        <List bordered className="semi-plugin-permission-list">
            <List.Item><div className="miplay-airplay-row">
                <span className="miplay-settings-label"><img src={airplayIcon} alt="" /><Typography.Text strong>AirPlay</Typography.Text></span>
                <Switch checked={airplay.enabled} loading={airplayBusy}
                    disabled={state.phase !== 'ready' || saving || airplayBusy || !airplay.enabled && selected.size === 0} onChange={toggleAirplay} />
            </div></List.Item>
        </List>
        <Typography.Paragraph type="tertiary" size="small" className="miplay-airplay-description">开启服务后，Semi 会持续在后台运行。</Typography.Paragraph>
        <Typography.Text strong className="miplay-settings-title">接收端</Typography.Text>
        <List bordered className="semi-plugin-permission-list">
            <List.Item><div className="miplay-airplay-row">
                <span className="miplay-settings-label"><img src={minaIcon} alt="" /><Typography.Text strong>MiNA</Typography.Text></span>
                {/^AUTH_/.test(state.cloudUnavailable?.code || '') ? <Typography.Text type="tertiary">需重新登录</Typography.Text> :
                    <Switch checked={state.protocols?.mina !== false} disabled={saving || airplayBusy} onChange={enabled => configure('mina', enabled)} />}
            </div></List.Item>
            <List.Item><div className="miplay-airplay-row">
                <span className="miplay-settings-label"><img src={miplayIcon} alt="" /><Typography.Text strong>小米妙播</Typography.Text></span>
                <Switch checked={state.protocols?.miplay !== false} disabled={saving || airplayBusy} onChange={enabled => configure('miplay', enabled)} />
            </div></List.Item>
        </List>
    </div>;
}
mountPlugin(Miplay);
