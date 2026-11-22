import { useEffect, useMemo, useState } from 'react';
import { semi } from './api.mjs';
import { mountPlugin } from '@semi/plugin-ui/mount.jsx';
import { createDeviceDialogMotion } from './device-dialog-motion.mjs';
import SettingsDialog from './SettingsDialog.jsx';
import './smart-devices.css';

document.body.classList.add('semi-smart-device-settings-overlay');
function SettingsPage() {
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
    return <SettingsDialog visible={visible} onClose={motion.requestClose} afterClose={motion.finishClose} />;
}
mountPlugin(SettingsPage, { full: true });
