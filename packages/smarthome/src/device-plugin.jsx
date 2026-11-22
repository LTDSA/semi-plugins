import { semi } from './api.mjs';
import { useEffect, useMemo, useState } from 'react';
import { mountPlugin } from '@semi/plugin-ui/mount.jsx';
import DevicePluginDialog from './DevicePluginDialog.jsx';
import { createDeviceDialogMotion } from './device-dialog-motion.mjs';
import './smart-devices.css';

// 独立的透明覆盖层，不搬动／缩放承载设备列表的原生视图。
document.body.classList.add('semi-device-plugin-overlay');
function DevicePluginPage({ device }) {
    const [visible, setVisible] = useState(false);
    const motion = useMemo(() => createDeviceDialogMotion({
        requestFrame: callback => requestAnimationFrame(callback), cancelFrame: id => cancelAnimationFrame(id), setVisible,
        onClosed: () => semi.closeCurrentView().catch(() => {}),
    }), []);
    useEffect(() => {
        let received = false, disposed = false;
        const off = semi.onEvent('lifecycle.visibility', event => { received = true; motion.hostVisible(event.visible); });
        semi.getViewState().then(context => { if (!received && !disposed) motion.hostVisible(context.visible); }).catch(() => { if (!disposed) motion.requestClose(); });
        return () => { disposed = true; off(); motion.dispose(); };
    }, [motion]);
    return <DevicePluginDialog device={device} visible={visible} onClose={motion.requestClose} afterClose={motion.finishClose} />;
}
semi.getViewOptions().then(context => {
    const { did, name } = context.params;
    if (typeof did !== 'string' || !/^[a-zA-Z0-9._:-]{1,256}$/.test(did)) throw new Error('设备标识无效');
    const device = { did, name: typeof name === 'string' ? name : '米家设备' };
    mountPlugin(() => <DevicePluginPage device={device} />, { full: true });
}).catch(() => semi.closeCurrentView().catch(() => {}));
