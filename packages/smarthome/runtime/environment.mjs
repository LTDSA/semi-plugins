// 返回插件自身 viewport 的逻辑尺寸和像素尺寸，不读取桌面屏幕或宿主窗口。
export function createPhoneScreenInfo(getViewport) {
    return () => {
        const { width, height, scale } = getViewport();
        const ratio = Number.isFinite(scale) && scale > 0 ? scale : 1;
        return Promise.resolve({ viewWidth: width, viewHeight: height, viewWidthPixel: Math.round(width * ratio), viewHeightPixel: Math.round(height * ratio) });
    };
}

// 和米家 SDK 一致：标记插件自行适配暗色，不改变系统主题，也不修改插件样式。
export function createDarkMode({ getColorScheme, addChangeListener, removeChangeListener }) {
    const darkModeStore = { setDarkMode: false };
    return {
        darkModeStore,
        preparePluginOwnDarkMode: () => { darkModeStore.setDarkMode = true; },
        closePluginOwnDarkMode: () => { darkModeStore.setDarkMode = false; },
        getColorScheme, addChangeListener, removeChangeListener,
    };
}

// SDK、mhui-rn 和 RN 的原生入口必须共享同一个主题源，不能让缺失常量回退到 light。
export function createAppearance({ getColorScheme, addChangeListener, removeChangeListener }) {
    const appearance = {
        getColorScheme,
        addChangeListener(listener) {
            addChangeListener(listener);
            return { remove: () => removeChangeListener(listener) };
        },
        removeChangeListener,
    };
    const nativeAppearance = {
        getColorScheme,
        getConstants: () => ({ colorScheme: getColorScheme() }),
        addListener: () => {}, removeListeners: () => {},
    };
    const serviceTheme = { get currentDarkMode() { return getColorScheme(); } };
    return { appearance, nativeAppearance, serviceTheme };
}

// RN Web 仍会对 AppState.removeEventListener 输出弃用错误；官方设备包需要保留旧式移除能力。
export function createAppState(document) {
    const listeners = new Set();
    const state = () => document.hidden ? 'background' : 'active';
    const remove = (type, listener) => {
        if (type !== 'change' || typeof listener !== 'function') return;
        listeners.delete(listener);
    };
    document.addEventListener('visibilitychange', () => {
        for (const listener of listeners) listener(state());
    });
    return {
        get currentState() { return state(); },
        addEventListener(type, listener) {
            if (type !== 'change' || typeof listener !== 'function') return { remove: () => {} };
            listeners.add(listener);
            return { remove: () => listeners.delete(listener) };
        },
        removeEventListener: remove,
        removeListener: remove,
    };
}
