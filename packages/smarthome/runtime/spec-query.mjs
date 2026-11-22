const clone = value => JSON.parse(JSON.stringify(value));
const segment = (value, index) => String(value?.type ?? '').split(':')[index];
const withIds = (item, ids) => ({ ...clone(item), ...ids });
const matching = (items, key, index, values) => (items || []).filter(item => values.includes(segment(item, index))).map(item => withIds(item, key === 'service' ? { siid: item.iid } : {}));

function protocolIndex(instance) {
    return parseFloat(instance?.['protocol-version'] || '2') >= 3 ? 4 : 3;
}

function findServices(instance, keys, index) {
    return matching(instance.services, 'service', index, keys);
}

function findItems(services, kind, keys, index) {
    const field = kind === 'property' ? 'properties' : kind === 'action' ? 'actions' : 'events';
    const idField = kind === 'property' ? 'piid' : kind === 'action' ? 'aiid' : 'eiid';
    return services.flatMap(service => (service[field] || []).filter(item => keys.includes(segment(item, index))).map(item => withIds(item, { siid: service.iid, [idField]: item.iid })));
}

export function getSpecByIid(instance, query = {}) {
    const { miid, siid, piid, aiid, eiid } = query;
    const version3 = protocolIndex(instance) >= 3;
    if (version3 && miid) {
        const module = (instance.modules || []).find(item => item.iid === miid);
        return Promise.resolve(module ? withIds(module, { miid }) : null);
    }
    const container = version3 && miid ? (instance.modules || []).find(item => item.iid === miid) : instance;
    const service = siid ? (container?.services || []).find(item => item.iid === siid) : null;
    if (siid && !piid && !aiid && !eiid) return Promise.resolve(service ? withIds(service, { siid }) : null);
    if (siid && (piid || aiid || eiid)) {
        const id = piid || aiid || eiid;
        const field = piid ? 'properties' : aiid ? 'actions' : 'events';
        const item = service?.[field]?.find(entry => entry.iid === id);
        return Promise.resolve(item ? withIds(item, { siid, [piid ? 'piid' : aiid ? 'aiid' : 'eiid']: id }) : null);
    }
    return Promise.resolve(null);
}

export function getSpecByKey(instance, keys = {}) {
    const { mkey, skey, pkey, akey, ekey } = keys;
    const index = protocolIndex(instance);
    const skeys = [skey].filter(Boolean);
    if (!mkey) {
        if (!skey) return Promise.resolve([]);
        if (pkey || akey || ekey) return Promise.resolve(findItems(findServices(instance, skeys, index), pkey ? 'property' : akey ? 'action' : 'event', [pkey || akey || ekey], index));
        return Promise.resolve(findServices(instance, skeys, index));
    }
    if (version3(instance)) {
        const modules = (instance.modules || []).filter(item => segment(item, index) === mkey).map(item => withIds(item, { miid: item.iid }));
        if (!skey) return Promise.resolve(modules);
        return Promise.resolve(modules.flatMap(module => {
            const services = findServices(module, skeys, index).map(service => withIds(service, { miid: module.iid, siid: service.iid }));
            return pkey || akey || ekey ? findItems(services, pkey ? 'property' : akey ? 'action' : 'event', [pkey || akey || ekey], index) : services;
        }));
    }
    return Promise.resolve([]);
}

function version3(instance) {
    return protocolIndex(instance) >= 3;
}
