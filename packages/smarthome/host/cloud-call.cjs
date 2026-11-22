const { assert } = require('../browser/contracts.cjs');
const { origin } = require('./identity.cjs');
module.exports = async function (host, instance, method, p, signal) {
        if (['mijia.devices.list', 'mijia.homes.list', 'mijia.home.devices', 'mijia.home.aggregations', 'mijia.power.get', 'mijia.power.set', 'mijia.states.get', 'mijia.curtain.set'].includes(method)) {
            assert(host.mijia, '请先使用米家账号远程登录', 'AUTH_REQUIRED');
            if (method === 'mijia.states.get') return host.mijia.getDeviceStates(p.dids, signal);
            if (method === 'mijia.power.get') return host.mijia.getDevicePowerStates(p.dids, signal);
            if (method === 'mijia.power.set') return host.mijia.setDevicePower(p.did, p.on, signal);
            if (method === 'mijia.curtain.set') return host.mijia.setDeviceCurtain(p.did, p.action, signal);
            if (method === 'mijia.homes.list') return host.mijia.getHomes(signal);
            if (method === 'mijia.home.aggregations') return host.mijia.getHomeAggregationStates(p.homeId, signal);
            if (method === 'mijia.home.devices') {
                const home = await host.mijia.getHomeDevices(p.homeId, signal);
                return { ...home, devices: home.devices.map(device => ({ ...device, imageUrl: `${origin}/.semi/mijia-images/${encodeURIComponent(device.did)}` })) };
            }
            return host.mijia.getDeviceList(signal);
        }
    throw Object.assign(new Error('服务方法不存在'), { code: 'METHOD_NOT_FOUND' });
};
