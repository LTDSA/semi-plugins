import { semi } from './bridge.mjs';
import { install } from '../host/application.cjs';
import { initialize, flush } from './storage.cjs';
import { registerSmartTray } from '../src/tray-controller.mjs';
async function start() {
    const info = await semi.getBackgroundInfo(), base = semi.getAppBaseInfo(), owner = info.plugin.id;
    await initialize();
    let state, application, hooks;
    const instances = new Map(), accounts = new Map(), clients = new Map(), screen = new Set(); let screenId = 0;
    const accountId = () => info.target?.accountId || state?.defaultAccountId;
    async function hydrate() {
        state = await semi.getProviderState();
        for (const id of accounts.keys()) if (!state.accounts.some(value => value.id === id)) { application?.accountRemoved(id); accounts.delete(id); clients.delete(id); }
        for (const account of state.accounts) if (JSON.stringify(accounts.get(account.id)) !== JSON.stringify(account)) { accounts.set(account.id, account); clients.delete(account.id); }
    }
    await hydrate();
    const host = {
        instances, requests: new Map(), disposed: false,
        electron: { app: { isPackaged: !info.development, getPath: () => '/data' }, nativeTheme: { shouldUseDarkColors: base.theme === 'dark' },
            powerSaveBlocker: { start() { const id = ++screenId; screen.add(id); semi.setKeepScreenOn({ keepScreenOn: true }).catch(console.error); return id; }, stop(id) { screen.delete(id); if (!screen.size) semi.setKeepScreenOn({ keepScreenOn: false }).catch(console.error); } } },
        accountRegistry: { session: (_owner, id) => accounts.get(id || accountId()) },
        accountScope: { getStore: () => host.accountServicesFor(owner, accountId()), run: (_services, fn) => fn() },
        accountServicesFor(_owner, id) { const services = application?.accountServices(owner, id || accountId()); hooks?.prepareServices(services); return services; },
        check(instance) { if (instance?.closed) throw Object.assign(new Error('页面已关闭'), { code: 'RUNTIME_CLOSED' }); },
        emit: (instance, name, data) => semi.emitBackgroundEvent(name, data, { to: instance.id, raw: true }).catch(console.error),
        cache: { registerDirectories: (_owner, resources) => semi.registerCacheDirectories(resources).catch(console.error) },
        closeInstance: instance => semi.closeView({ instanceId: instance.id }).catch(console.error),
        registerPrivateHandlers(_owner, handlers) {
            const offs = Object.entries(handlers).map(([name, fn]) => semi.handleBackgroundCall(name, async (params, { caller, signal }) => {
                await hydrate(); const instance = instanceFor(caller); try { return await fn(params, { instance, signal }); } finally { await flush(); }
            })); return () => offs.forEach(off => off());
        },
    };
    function instanceFor(caller) {
        if (!caller || caller.pluginId !== owner || caller.target?.accountId && caller.target.accountId !== accountId()) throw Object.assign(new Error('页面账号不匹配'), { code: 'CONTEXT_CHANGED' });
        if (!instances.has(caller.runtimeId)) instances.set(caller.runtimeId, { id: caller.runtimeId, item: { manifest: info.definition }, cleanups: new Set(), visibilityHandlers: new Set(), closed: false });
        const instance = instances.get(caller.runtimeId);
        Object.assign(instance, { viewId: caller.viewId, visible: caller.visible !== false, layer: caller.overlay, params: caller.params || {}, accountBinding: { accountId: accountId() } }); return instance;
    }
    application = install({ electron: host.electron, packageRoot: '/package', accountClient(id) {
        id ||= accountId(); const account = accounts.get(id); if (!account) return null;
        if (!clients.has(id)) { const identity = { accountId: id, userId: account.userId }; clients.set(id, { identity, current() { if (accounts.get(id) !== account) throw Object.assign(new Error('账号已变化'), { code: 'CONTEXT_CHANGED' }); return identity; }, call: (contract, method, params, signal) => semi.callService(contract, method, params, { accountId: id, signal }) }); }
        return clients.get(id);
    } });
    hooks = application.integration(host); host.integration = hooks; application.setHost(host);
    semi.handleResourceRequest(async ({ params, signal }) => {
        await hydrate();
        if (params.target.accountId && params.target.accountId !== accountId()) throw new Error('资源账号不匹配');
        const url = new URL(params.url);
        const response = await hooks.resource({ manifest: info.definition }, params.target, { signal, streamFiles: true }, url);
        if (!response) throw new Error('资源不存在');
        const runtime = url.pathname.match(/^(\/\.semi\/mijia-runtime\/[a-f0-9]{48}\/)(.+)$/);
        return {
            ...(response.filePath ? { filePath: response.filePath, contentType: response.headers['Content-Type'] }
                : { body: Buffer.from(await response.arrayBuffer()).toString('base64'), contentType: response.headers.get('content-type') }),
            ...(runtime ? { sandbox: { root: runtime[1], ...(runtime[2].startsWith('assets/') && runtime[2].endsWith('.html') ? { inlineScripts: true } : {}) } } : {}),
        };
    });
    semi.handleBackgroundCall('lifecycle.clearCache', () => hooks.clearCache({ manifest: info.definition }));
    semi.onEvent('runtime.changed', event => {
        if (event.instance.target?.accountId !== accountId()) return;
        const instance = instanceFor(event.instance);
        if (event.closed) { instance.closed = true; for (const cleanup of instance.cleanups) cleanup(); hooks.releaseInstance(instance); instances.delete(instance.id); }
        else { for (const fn of instance.visibilityHandlers) fn(instance.visible); hooks.visibilityChanged(instance, instance.visible); }
    });
    semi.onEvent('theme.changed', ({ theme }) => { host.electron.nativeTheme.shouldUseDarkColors = theme === 'dark'; });
    await registerSmartTray(semi);
}
start().catch(error => console.error('[智能设备后台]', error));
