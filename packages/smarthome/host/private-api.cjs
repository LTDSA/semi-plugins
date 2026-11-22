const { assert } = require('../browser/contracts.cjs');
const { validateMijiaCall } = require('./contracts.cjs');
const { id: OWNER } = require('./identity.cjs');
const runtimeMethods = ['runtime-info', 'open', 'close', 'host-call', 'read', 'write', 'history', 'authorized-devices', 'check-version', 'gateway-info', 'cloud-read', 'cloud-write', 'cloud-call', 'action'];
function registerPrivateAPI(host, servicesFor) {
    const methods = [...new Set(Object.values(require('./cloud-methods.cjs')).filter(name => name.startsWith('mijia.'))), ...runtimeMethods.map(name => 'mijia.plugin.' + name)];
    return host.registerPrivateHandlers(OWNER, Object.fromEntries(methods.map(method => [method, async (params, { instance, signal }) => {
        validateMijiaCall(method, params);
        const execute = async () => {
            if (!method.startsWith('mijia.plugin.')) return require('./cloud-call.cjs')(host, instance, method, params, signal);
            const result = await host.integration.request(instance, method, params, signal);
            assert(result?.handled, '设备运行方法不存在', 'METHOD_NOT_FOUND'); return result.value;
        };
        if (!host.accountRegistry) return execute();
        const services = servicesFor ? servicesFor(OWNER, instance.accountBinding?.accountId) : host.accountServicesFor(OWNER, instance.accountBinding?.accountId);
        assert(services?.mijia || method === 'mijia.plugin.close', '请先请求账号登录', 'AUTH_REQUIRED');
        return services ? host.accountScope.run(services, execute) : execute();
    }])));
}
module.exports = { registerPrivateAPI };
