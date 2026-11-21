const { MinaService } = require('./mina.cjs');
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
    const accountServices = (pluginId, accountId) => pluginId === 'miplay' ? servicesFor(pluginId, accountId) : null;
    return { accountServices, accountRemoved(id) { for (const key of scopes.keys()) if (key.endsWith(':' + id)) scopes.delete(key); }, dispose: () => { unregisterPrivate?.(); scopes.clear(); },
        integration(host) {
            Object.defineProperty(host, 'mina', { configurable: true, get() { return this.accountScope?.getStore()?.mina || this._mina; }, set(value) { this._mina = value; } });
            return {
                accountOnly: (item, scope) => item.manifest.id === 'miplay' && scope !== 'device',
                notify: instance => require('./private-api.cjs').notifyAccount(host, instance, servicesFor),
            };
        },
        setHost(host) { unregisterPrivate = require('./private-api.cjs').registerPrivateAPI(host, servicesFor); },
    };
}
module.exports = { install };
