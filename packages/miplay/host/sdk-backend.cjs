const { install } = require('./application.cjs');
const { notifyAccount } = require('./private-api.cjs');
const { assert } = require('./errors.cjs');

async function startBackend(semi) {
    const { plugin, target, development } = await semi.getBackgroundInfo();
    const instances = new Map();
    const clients = new Map();
    let defaultAccountId = null;
    let refreshId = 0;
    let appliedRefresh = 0;

    async function refreshAccounts() {
        const id = ++refreshId;
        const state = await semi.getProviderState();
        if (id < appliedRefresh) return;
        appliedRefresh = id;
        defaultAccountId = target?.accountId || state.defaultAccountId;
        const current = new Map(state.accounts.map(account => [account.id, account]));
        for (const [accountId, client] of clients) {
            if (current.get(accountId)?.userId === client.identity.userId) continue;
            clients.delete(accountId);
            application.accountRemoved(accountId);
        }
        for (const account of current.values()) {
            if (clients.has(account.id)) continue;
            const identity = Object.freeze({ accountId: account.id, userId: account.userId });
            const client = {
                identity,
                current() {
                    assert(clients.get(account.id) === client, '账号已变化', 'CONTEXT_CHANGED');
                    return identity;
                },
                call(contract, method, params, signal) {
                    client.current();
                    return semi.callService(contract, method, params, { accountId: account.id, signal });
                },
            };
            clients.set(account.id, client);
        }
    }

    function instanceFor(caller) {
        const id = caller?.runtimeId || plugin.id + ':backend';
        if (!instances.has(id)) instances.set(id, { id, item: { manifest: plugin } });
        const instance = instances.get(id);
        instance.accountBinding = caller?.target || target;
        return instance;
    }

    const host = {
        electron: { app: { isPackaged: !development } },
        emit(instance, name, data) {
            semi.emitBackgroundEvent(name, data, { to: instance.id, raw: true }).catch(() => {});
        },
        registerPrivateHandlers(_id, handlers) {
            const off = Object.entries(handlers).map(([name, handler]) => semi.handleBackgroundCall(name, async (params, { caller, signal }) => {
                await refreshAccounts();
                const instance = instanceFor(caller);
                notifyAccount(host, instance, application.accountServices);
                signal?.throwIfAborted();
                return handler(params, { instance, signal });
            }));
            return () => off.forEach(unsubscribe => unsubscribe());
        },
    };
    const application = install({ accountClient: accountId => clients.get(accountId || defaultAccountId) });
    await refreshAccounts();
    application.setHost(host);
    const offRuntime = semi.onEvent('runtime.changed', event => {
        const instance = instances.get(event.instance.runtimeId);
        if (event.closed && instance) {
            instance.closed = true;
            instances.delete(instance.id);
        }
    });
    return { dispose() { offRuntime(); application.dispose(); clients.clear(); instances.clear(); } };
}

module.exports = { startBackend };
