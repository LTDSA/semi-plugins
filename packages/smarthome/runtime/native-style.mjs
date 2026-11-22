// 官方 SDK 使用的 RN flattenStyle 忽略非对象项；RN Web 0.17 却把数字当作注册样式 ID。
export function flattenNativeStyle(style) {
    if (style === null || typeof style !== 'object') return undefined;
    if (!Array.isArray(style)) return style;
    const result = {};
    for (const item of style) {
        const flattened = flattenNativeStyle(item);
        if (flattened) Object.assign(result, flattened);
    }
    return result;
}

export function createNativeStyleSheet(webStyleSheet) {
    return {
        ...webStyleSheet,
        create: styles => styles,
        flatten: flattenNativeStyle,
        // 不能把 Web 注册表里的数字 ID 交给官方插件。
        absoluteFill: webStyleSheet.absoluteFillObject,
    };
}

// Yoga 的 flex: 0 保留内容尺寸；CSS shorthand 会将 flex-basis 设成 0%。
export function nativeLayoutStyle(style, { imageBackground = false } = {}) {
    const value = flattenNativeStyle(style);
    // RN Web 的背景图保留显式尺寸；容器不能再被 CSS flex-basis:0% 压成文字高度。
    if (imageBackground && value?.flex > 0 && value.flexBasis == null && (value.height != null || value.width != null)) {
        const { flex, ...rest } = value;
        return { flexGrow: flex, flexShrink: 0, flexBasis: 'auto', ...rest };
    }
    if (!value || value.flex !== 0) return value;
    const { flex, ...rest } = value;
    return { flexGrow: 0, flexShrink: 0, flexBasis: 'auto', ...rest };
}
