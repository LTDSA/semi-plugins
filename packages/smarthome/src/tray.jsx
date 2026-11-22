import { mountPlugin } from '@semi/plugin-ui/mount.jsx';
import SmartDevices from './SmartDevices.jsx';
function TrayDevices() { return <SmartDevices tray />; }
mountPlugin(TrayDevices, { full: true });
