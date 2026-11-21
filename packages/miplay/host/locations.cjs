// Speaker placement is this plugin's small HTTP consumer; it does not load the device runtime.
function createLocations(auth) {
    let pending;
    return async (identities, signal) => {
        pending ||= (async () => {
            const result = await auth.postSigned({ uri: '/v2/homeroom/gethome', data: { limit: 150, fetch_share: true, fetch_share_dev: true, plat_form: 0, app_ver: 9 }, signal });
            const map = new Map();
            for (const home of result?.result?.homelist || []) {
                const response = await auth.postSigned({ uri: '/v2/home/home_device_list', data: { home_owner: Number(home.uid), home_id: Number(home.id), limit: 200, get_split_device: true, support_smart_home: true, get_cariot_device: true, get_third_device: true }, signal });
                const rooms = new Map((home.roomlist || []).map(room => [String(room.id), room.name]));
                for (const device of response?.result?.device_info || response?.result?.list || []) map.set(String(device.did), { homeName: home.name || '', roomName: rooms.get(String(device.room_id)) || '' });
            }
            return map;
        })().catch(failure => { pending = null; throw failure; });
        const locations = await pending;
        return new Map(identities.flatMap(identity => locations.has(identity.miotDid) ? [[identity.id, locations.get(identity.miotDid)]] : []));
    };
}
module.exports = { createLocations };
