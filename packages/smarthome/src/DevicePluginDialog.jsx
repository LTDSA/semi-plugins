import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { semi } from './api.mjs';
import { Button, Modal, Progress, Toast } from '@semi/plugin-ui/ui.js';
import { createDevicePluginBridge } from './device-plugin-bridge.mjs';
import { createDevicePluginLoader } from './device-plugin-loader.mjs';

export default function DevicePluginDialog({ device, visible = true, onClose, afterClose }) {
    const [state, setState] = useState({ phase: 'checking', runtime: null, progress: null, error: null });
    const runtime = state.runtime;
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);
    const [frame, setFrame] = useState(null);
    const bridgeRef = useRef(null);
    const loaderRef = useRef(null);
    const downloadDialogRef = useRef(null);
    const pluginDialogRef = useRef(null);
    const displayed = useRef(visible); displayed.current = visible;
    const close = useRef(onClose); close.current = onClose;
    const requestClose = () => {
        loaderRef.current?.cancel(); close.current();
        const dialog = ['checking', 'plugin', 'plugin-error'].includes(state.phase) ? pluginDialogRef.current : downloadDialogRef.current;
        if (!dialog) afterClose?.();
    };
    useEffect(() => {
        const loader = createDevicePluginLoader({ did: device.did, open: semi.mijia.openDevicePlugin, close: semi.mijia.closeDevicePlugin,
            waitForDownloadClose: () => Boolean(downloadDialogRef.current),
            onState: value => { setState(value); if (['checking', 'plugin'].includes(value.phase)) { setLoading(true); setError(null); } },
        });
        loaderRef.current = loader; loader.start();
        return () => { loader.dispose(); if (loaderRef.current === loader) loaderRef.current = null; };
    }, [device.did]);
    useLayoutEffect(() => {
        if (!runtime || !frame) return;
        const element = frame;
        // contentRect 不受 Modal 入场动画的 transform 影响，避免把动画缩放永久叠加。
        const resize = width => { element.style.transform = `scale(${width / 390})`; };
        const observer = new ResizeObserver(entries => resize(entries[0].contentRect.width));
        observer.observe(element.parentElement); resize(element.parentElement.clientWidth);
        const bridge = createDevicePluginBridge({ frame: element, runtime, did: runtime.did, sdk: semi,
            onClose: requestClose, onReady: () => setLoading(false), onError: message => { setError(message); setLoading(false); },
            onUnsupported: () => Toast.info('此功能暂不支持'),
            onNavigate: value => loaderRef.current?.replace(value),
        });
        bridgeRef.current = bridge;
        if (!displayed.current) bridge.setVisible(false);
        const handler = event => bridge.handle(event);
        window.addEventListener('message', handler);
        const off = semi.onEvent('lifecycle.visibility', event => bridge.setVisible(event.visible && displayed.current));
        semi.getViewState().then(context => bridge.setVisible(context.visible && displayed.current)).catch(() => {});
        const timer = setTimeout(() => { setError('设备插件加载超时，请重试'); setLoading(false); }, 30000);
        // loaded 消息取消超时，避免已运行的页面被延迟错误覆盖。
        const loaded = event => { if (event.source === element.contentWindow && event.origin === 'null' && event.data?.channel === 'semi-mijia-device-v1' && event.data.type === 'loaded') clearTimeout(timer); };
        window.addEventListener('message', loaded);
        return () => { clearTimeout(timer); observer.disconnect(); bridge.dispose(); if (bridgeRef.current === bridge) bridgeRef.current = null; off(); window.removeEventListener('message', handler); window.removeEventListener('message', loaded); };
    }, [runtime, frame, device.did]);
    useLayoutEffect(() => { if (!visible) { bridgeRef.current?.setVisible(false); loaderRef.current?.cancel(); } }, [visible]);
    useEffect(() => {
        if (error && runtime) loaderRef.current?.fail(error);
    }, [error, runtime]);
    useEffect(() => {
        if (state.phase !== 'checking') return;
        const escape = event => { if (event.key === 'Escape') { event.preventDefault(); requestClose(); } };
        window.addEventListener('keydown', escape);
        return () => window.removeEventListener('keydown', escape);
    }, [state.phase]);
    // 共享资源检查结果返回前不挂载任何对话框，避免手机框先出现再被下载提示替换。
    if (state.phase === 'checking') return null;
    if (['confirm', 'downloading', 'download-error', 'transition'].includes(state.phase)) {
        const downloading = ['downloading', 'transition'].includes(state.phase);
        const progress = state.progress;
        const status = progress?.phase === 'ready' ? '下载完成，正在打开…' : ['verify', 'extract'].includes(progress?.phase) ? '正在校验并准备资源…'
            : progress?.phase === 'download' ? '正在下载运行资源…' : '正在获取下载信息…';
        return <Modal ref={downloadDialogRef} visible={visible && state.phase !== 'transition'} centered title={downloading ? '正在下载运行资源' : '下载共享运行资源'} width={420}
            onCancel={requestClose} maskClosable={!downloading} closable={!downloading}
            afterClose={() => { if (state.phase === 'transition' && displayed.current) loaderRef.current?.downloaded(); else afterClose?.(); }}
            footer={<><Button onClick={requestClose}>{downloading ? '取消下载' : '取消'}</Button>{!downloading && <Button theme="solid" type="primary" onClick={() => loaderRef.current?.confirm()}>{state.phase === 'download-error' ? '重试下载' : '下载并继续'}</Button>}</>}>
            {downloading ? <div className="smart-device-download-progress" role="status">
                <span>{status}</span><Progress percent={progress?.percent ?? 0} showInfo={progress?.percent != null} />
                {progress?.total > 0 && <span className="smart-device-download-size">{(progress.loaded / 1048576).toFixed(1)} / {(progress.total / 1048576).toFixed(1)} MB</span>}
            </div> : state.phase === 'download-error' ? <div role="alert">{state.error}</div> : <p>首次使用设备插件需要下载共享运行资源，仅需下载一次。是否下载？</p>}
        </Modal>;
    }
    const failure = state.error || error;
    const progress = state.deviceProgress;
    const downloadingPlugin = progress?.phase === 'download';
    return <Modal ref={pluginDialogRef} visible={visible} motion centered title={null} footer={null} closable={false} maskClosable onCancel={requestClose} afterClose={afterClose}
        className="smart-device-dialog" width="min(390px, calc((100dvh - 48px) * 0.4620853), calc(100vw - 48px))" bodyStyle={{ padding: 0 }}>
        <span id="semi-modal-title" className="smart-device-dialog-label">{device.name}</span>
        <div className="smart-device-screen">
            {runtime && !error && <iframe ref={setFrame} src={runtime.url} title={device.name} sandbox="allow-scripts" allow="bluetooth" className="smart-device-plugin-frame" />}
            {(loading || failure) && <div className="smart-device-plugin-status" role={failure ? 'alert' : 'status'}>
                {failure ? <><span>{failure}</span><Button onClick={() => loaderRef.current?.retry()}>重试</Button></>
                    : <Progress type="circle" size="small" showInfo={false} indeterminate={!downloadingPlugin}
                        percent={downloadingPlugin ? progress.percent : 0} />}
            </div>}
        </div>
    </Modal>;
}
