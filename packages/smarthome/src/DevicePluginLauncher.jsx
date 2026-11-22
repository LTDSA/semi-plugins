import { useMemo } from 'react';
import OverlayLauncher from './OverlayLauncher.jsx';

export default function DevicePluginLauncher({ device, onClose }) {
    const params = useMemo(() => ({ did: device.did, name: device.name }), [device.did]);
    return <OverlayLauncher view="device-plugin" params={params} onClose={onClose} errorMessage="设备插件打开失败" />;
}
