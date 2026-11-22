export const TRAY_CARD_SIZE_KEY = 'tray-card-size';
export const TRAY_CARD_SIZE_OPTIONS = [
    { value: 'default', label: '默认' },
    { value: 'small', label: '小卡片' },
    { value: 'medium', label: '中卡片' },
    { value: 'large', label: '大卡片' },
];
export const normalizeTrayCardSize = value => TRAY_CARD_SIZE_OPTIONS.some(option => option.value === value) ? value : 'default';

// 托盘保活期间设置可在独立 overlay 中改变；重新显示时读取，不增加计时器或设备请求。
export function watchTrayCardSize(semi, onChange, onError = () => {}) {
    let active = true, version = 0;
    const refresh = async () => {
        const current = ++version;
        try {
            const { data: value } = await semi.getStorage({ key: TRAY_CARD_SIZE_KEY });
            if (active && current === version) onChange(normalizeTrayCardSize(value));
        } catch (error) { if (active && current === version) onError(error); }
    };
    const off = semi.onEvent('lifecycle.visibility', event => { if (event.visible) refresh(); });
    refresh();
    return () => { active = false; version++; off(); };
}
