import { useEffect, useState } from 'react';
import { semi } from './api.mjs';
import { List, Modal, Select, Switch, Toast, Typography } from '@semi/plugin-ui/ui.js';
import { normalizeTrayCardSize, TRAY_CARD_SIZE_KEY, TRAY_CARD_SIZE_OPTIONS } from './tray-card-size.mjs';

export default function SettingsDialog({ visible, onClose, afterClose }) {
    const [trayVisible, setTrayVisible] = useState(false);
    const [trayBusy, setTrayBusy] = useState(true);
    const [trayCardSize, setTrayCardSize] = useState('default');
    const [cardSizeBusy, setCardSizeBusy] = useState(true);
    const [runtimeVersion, setRuntimeVersion] = useState(null);
    useEffect(() => {
        let active = true;
        const controller = new AbortController();
        semi.executeCommand('get-tray').then(state => { if (active) setTrayVisible(state.visible); })
            .catch(error => { if (active) Toast.warning(error.message); })
            .finally(() => { if (active) setTrayBusy(false); });
        semi.getStorage({ key: TRAY_CARD_SIZE_KEY }).then(({ data: value }) => { if (active) setTrayCardSize(normalizeTrayCardSize(value)); })
            .catch(error => { if (active) Toast.warning(error.message); })
            .finally(() => { if (active) setCardSizeBusy(false); });
        semi.mijia.getDevicePluginRuntimeInfo({ signal: controller.signal }).then(info => {
            if (active) setRuntimeVersion(info.version || '未下载');
        }).catch(() => { if (active) setRuntimeVersion('读取失败'); });
        return () => { active = false; controller.abort(); };
    }, []);
    const toggleTray = async value => {
        if (trayBusy) return;
        setTrayBusy(true);
        try { setTrayVisible((await semi.executeCommand('set-tray', { visible: value })).visible); }
        catch (error) { Toast.error(error.message || '设置托盘失败'); }
        finally { setTrayBusy(false); }
    };
    const changeCardSize = async value => {
        if (cardSizeBusy) return;
        setCardSizeBusy(true);
        try {
            const size = normalizeTrayCardSize(value);
            await semi.setStorage({ key: TRAY_CARD_SIZE_KEY, data: size });
            setTrayCardSize(size);
        } catch (error) { Toast.error(error.message || '设置卡片尺寸失败'); }
        finally { setCardSizeBusy(false); }
    };
    return <Modal title="设置" visible={visible} motion centered footer={null} onCancel={onClose} afterClose={afterClose} bodyStyle={{ marginBottom: 24 }}>
        <List bordered className="semi-plugin-permission-list smart-device-settings-list">
            <List.Item align="center" main={<Typography.Text strong>显示托盘</Typography.Text>} extra={<Switch checked={trayVisible} disabled={trayBusy} onChange={toggleTray} />} />
            <List.Item className="smart-device-card-size-setting" align="center" main={<Typography.Text strong>卡片尺寸</Typography.Text>} extra={<Select size="default" style={{ width: 108 }} value={trayCardSize} disabled={cardSizeBusy} optionList={TRAY_CARD_SIZE_OPTIONS} onChange={changeCardSize} />} />
        </List>
        <List bordered className="semi-plugin-permission-list smart-device-settings-list">
            <List.Item align="center" main={<Typography.Text strong>米家运行资源</Typography.Text>} extra={<Typography.Text type="tertiary" style={{ whiteSpace: 'nowrap' }}>{runtimeVersion || '正在读取…'}</Typography.Text>} />
        </List>
    </Modal>;
}
