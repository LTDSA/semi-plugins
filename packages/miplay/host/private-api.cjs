const { assert } = require('./errors.cjs');
const OWNER = 'miplay';
function registerPrivateAPI(host, servicesFor) {
    return host.registerPrivateHandlers(OWNER, Object.fromEntries(['getSpeakers', 'play', 'stop', 'setVolume'].map(method => ['mina.' + method, async (params, { instance, signal }) => {
        const keys = method === 'getSpeakers' ? ['skipCloud'] : method === 'play' ? ['id', 'url'] : method === 'stop' ? ['id'] : ['id', 'volume'];
        assert(Object.keys(params).every(key => keys.includes(key)), '音箱参数无效');
        if (method === 'getSpeakers') assert(params.skipCloud === undefined || typeof params.skipCloud === 'boolean', '音箱参数无效');
        else {
            assert(typeof params.id === 'string' && params.id.length > 0 && params.id.length <= 256, '音箱 ID 无效');
            if (method === 'play') assert(typeof params.url === 'string' && params.url.length <= 4096, '音频地址无效');
            if (method === 'setVolume') assert(Number.isInteger(params.volume) && params.volume >= 0 && params.volume <= 100, '音量无效');
        }
        const services = servicesFor(instance.item.manifest.id, instance.accountBinding?.accountId);
        assert(services?.mina, '请先请求账号登录', 'AUTH_REQUIRED');
        return require('./cloud-call.cjs')(host, instance, method, params, signal, services);
    }])));
}
function notifyAccount(host, instance, servicesFor) {
    if (instance.item.manifest.id !== OWNER) return;
    let accountId = null;
    try { accountId = servicesFor(OWNER, instance.accountBinding?.accountId)?.mina?.getAccountId() || null; } catch { /* 提供者不可用时清空账号状态。 */ }
    if (instance.minaAccountId !== undefined && instance.minaAccountId !== accountId) host.emit(instance, 'mina.account.changed', { accountId });
    instance.minaAccountId = accountId;
}
module.exports = { registerPrivateAPI, notifyAccount };
