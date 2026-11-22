// 颜色转换使用当前共享 SDK 自带的 normalizeColor，不另写一套反色算法。
export function createThemeStyle({ getColorScheme, normalizeColor }) {
    const converted = new WeakSet();
    const color = (value, text = false) => {
        if (value && typeof value === 'object' && 'light' in value && 'dark' in value) value = value[getColorScheme()];
        if (value == null || typeof value !== 'string' && typeof value !== 'number') return value;
        const input = text && typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= 0xffffffff
            ? '#' + value.toString(16).padStart(8, '0') : value;
        const rgba = normalizeColor(text ? input + 'text' : input);
        if (rgba == null) return typeof value === 'string' ? value.replace(/^xm/, '') : value;
        return `rgba(${rgba >>> 24},${rgba >>> 16 & 255},${rgba >>> 8 & 255},${(rgba & 255) / 255})`;
    };
    const style = (value, text = false) => {
        if (!value || typeof value !== 'object' || converted.has(value)) return value;
        let result;
        if (Array.isArray(value)) result = value.map(item => style(item, text));
        else {
            if (Object.getPrototypeOf(value) !== Object.prototype) return value;
            result = Object.fromEntries(Object.entries(value).map(([key, item]) => {
                if (item && typeof item === 'object' && 'light' in item && 'dark' in item) item = item[getColorScheme()];
                return [key, /color$/i.test(key) ? color(item, text && key === 'color') : item];
            }));
        }
        converted.add(result);
        return result;
    };
    return { style, color };
}
