module.exports = async function (host, instance, operation, params, signal, services) {
    const { mina, locations } = services;
    if (operation !== 'getSpeakers') return mina.controlSpeaker(params.id, operation === 'setVolume' ? 'volume' : operation, operation === 'play' ? params.url : params.volume, signal);
    const accountId = mina.getAccountId(); instance.minaAccountId = accountId;
    if (params.skipCloud) return { accountId, speakers: [] };
    const { createMijiaDebug } = require('./debug.cjs');
    const debug = createMijiaDebug({ enabled: !host.electron.app.isPackaged, emit: data => { if (!host.electron.app.isPackaged && !instance.closed && !signal.aborted) host.emit(instance, 'mina.debug', data); } });
    try { return await mina.getSpeakers(signal, debug, identities => locations(identities, signal)); }
    catch (failure) {
        if (!accountId || !(/^AUTH_/.test(failure.code) || ['MINA_NETWORK_ERROR', 'MINA_API_ERROR'].includes(failure.code))) throw failure;
        return { accountId, speakers: [], unavailable: { code: failure.code, message: /^AUTH_/.test(failure.code) ? '音箱账号需重新登录' : '音箱服务暂不可用' } };
    }
};
