const { MinaService } = require('./mina.cjs');
const { OWNER, registerPrivateAPI, notifyAccount } = require('./private-api.cjs');
function install({ accountClient }) {
    let unregisterPrivate;
    const scopes = new Map();
    function servicesFor(pluginId, accountId) {
        const auth = accountClient(accountId);
        if (!auth) return null;
        const key = `${pluginId}:${accountId || ''}`;
        if (scopes.get(key)?.identity !== auth.identity) scopes.set(key, { identity: auth.identity, mina: new MinaService({ authentication: require('./authentication.cjs').createAuthentication(auth) }), locations: require('./locations.cjs').createLocations({ postSigned: args => auth.call('xiaomi.auth', 'request', { purpose: 'mijia', path: args.uri, method: 'POST', payload: JSON.stringify(args.data) }, args.signal) }) });
        return scopes.get(key);
    }
    const accountServices = (pluginId, accountId) => pluginId === OWNER ? servicesFor(pluginId, accountId) : null;
    return { accountServices, accountRemoved(id) { for (const key of scopes.keys()) if (key.endsWith(':' + id)) scopes.delete(key); }, dispose: () => { unregisterPrivate?.(); scopes.clear(); },
        integration(host) {
            Object.defineProperty(host, 'mina', { configurable: true, get() { return this.accountScope?.getStore()?.mina || this._mina; }, set(value) { this._mina = value; } });
            return {
                accountOnly: (item, scope) => item.manifest.id === OWNER && scope !== 'device',
                notify: instance => notifyAccount(host, instance, servicesFor),
            };
        },
        setHost(host) { unregisterPrivate = registerPrivateAPI(host, servicesFor); },
    };
}
module.exports = { install };
