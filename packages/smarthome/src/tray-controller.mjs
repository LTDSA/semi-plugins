export function registerSmartTray(semi) {
    let visible = false, supported = false, platform, queue = Promise.resolve(), initialized;
    const create = () => semi.createTray('devices', { view: 'tray' });
    const state = () => ({ visible, supported });
    const enqueue = action => {
        const result = queue.then(() => initialized).then(action);
        queue = result.catch(() => {});
        return result;
    };
    semi.registerCommand('get-tray', () => enqueue(state));
    semi.registerCommand('set-tray', ({ params }) => enqueue(async () => {
        if (!supported || typeof params.visible !== 'boolean' || Object.keys(params).length !== 1) throw new Error('仅 macOS 和 Windows 支持设置布尔托盘状态');
        if (params.visible === visible) return state();
        if (params.visible) {
            await create();
            try { await semi.setStorage({ key: 'tray-enabled', data: true }); }
            catch (e) { await semi.destroyTray('devices'); throw e; }
            visible = true;
        } else {
            await semi.setStorage({ key: 'tray-enabled', data: false });
            try { await semi.destroyTray('devices'); }
            catch (e) { await semi.setStorage({ key: 'tray-enabled', data: true }); throw e; }
            visible = false;
        }
        return state();
    }));
    initialized = semi.markViewReady().then(async () => {
        platform = semi.getAppBaseInfo().platform;
        supported = ['darwin', 'win32'].includes(platform);
        if (supported && (await semi.getStorage({ key: 'tray-enabled' })).data === true) { await create(); visible = true; }
    }).catch(e => console.error('[智能设备托盘]', e.message));
    return initialized;
}
