// 官方标准页以 subclass_id=0 请求设备默认图片，正数才查询 switch_subclass 字典。
export function createDeviceMetadata({ cloudRead, device }) {
    let icons;
    const unavailable = message => Promise.reject(Object.assign(new Error(message), { code: 'METADATA_UNAVAILABLE' }));
    return {
        getFreqFlag() {
            return typeof device.freqFlag === 'boolean' ? Promise.resolve({ code: 0, data: device.freqFlag }) : unavailable('设备列表未提供常用设备标记');
        },
        async getDeviceIcon(params = {}) {
            const id = params.subclass_id;
            if (id === 0) {
                if (typeof device.iconURL !== 'string' || !device.iconURL) return unavailable('设备默认图片不可用');
                return { code: 0, data: { proxy_category_icon: device.iconURL } };
            }
            if (!Number.isSafeInteger(id) || id <= 0) return unavailable('设备未指定按键图标分类');
            if (!icons) icons = cloudRead('/v2/device/switch_subclass', {}).catch(error => { icons = null; throw error; });
            const list = await icons;
            const icon = Array.isArray(list) ? list.find(item => item?.id === id)?.proxy_category_icon : null;
            if (typeof icon !== 'string' || !icon) return unavailable('官方图标字典没有此按键分类');
            return { code: 0, data: { proxy_category_icon: icon } };
        },
        getRoomInfoForCurrentHome(did) {
            if (did != null && String(did) !== String(device.did)) return unavailable('不能读取其他设备的房间');
            return device.roomInfo ? Promise.resolve({ code: 0, data: { ...device.roomInfo } }) : unavailable('尚未读取设备所属家庭与房间');
        },
        getRoomNames(ids) {
            if (!Array.isArray(ids) || ids.length > 100 || !ids.every(id => typeof id === 'string' || Number.isSafeInteger(id))) return unavailable('房间编号无效');
            if (!device.roomNames || ids.some(id => String(id) !== '0' && !Object.hasOwn(device.roomNames, String(id)))) return unavailable('设备所属家庭中不存在请求的房间');
            // 米家用 0 表示未分配房间；原包随后自行填入本地化文案。
            return Promise.resolve(ids.map(id => String(id) === '0' ? '' : device.roomNames[String(id)]));
        },
    };
}
