const slug = value => typeof value === 'string' ? (value.includes(':') ? value.split(':')[3] || '' : value) : '';
const identifier = value => slug(value).replace(/_/g, '-');
export function acModelResult(response) {
    if (response?.error || response?.code != null && response.code !== 0) return null;
    const result = Array.isArray(response) ? response : response?.result;
    const id = value => Number.isSafeInteger(value) && value >= 0 || typeof value === 'string' && /^\d+$/.test(value) && Number.isSafeInteger(Number(value));
    // 原包读取前两个编号；固件可能附带更多状态，保持真实数组和字段类型。
    return Array.isArray(result) && result.length >= 2 && result.slice(0, 2).every(id) ? result : null;
}

function validNumber(value) {
    return typeof value === 'boolean' || typeof value === 'number' && Number.isFinite(value) || typeof value === 'string' && value.length <= 32768;
}

export function createDeviceRpc({ did, services, read, write, doAction, cloudCommand, unsupported }) {
    const properties = new Map(), actions = new Map();
    for (const service of services || []) {
        for (const property of service.properties || []) {
            const name = identifier(property.type), entry = { siid: service.iid, piid: property.iid, property };
            const known = properties.get(name);
            if (!known) properties.set(name, entry);
            else if (known.siid !== entry.siid || known.piid !== entry.piid) properties.set(name, null);
        }
        for (const action of service.actions || []) {
            const name = identifier(action.type), entry = { siid: service.iid, aiid: action.iid, action };
            const known = actions.get(name);
            if (!known) actions.set(name, entry);
            else if (known.siid !== entry.siid || known.aiid !== entry.aiid) actions.set(name, null);
        }
    }
    const mappedProperties = (names, mode) => {
        if (!Array.isArray(names) || !names.length || names.length > 100) throw new Error('属性名数量无效');
        return names.map(name => {
            const entry = properties.get(identifier(name));
            if (!entry) throw Object.assign(new Error('设备属性名不存在或不唯一'), { code: 'PROPERTY_UNSUPPORTED' });
            const access = entry.property.access ?? [];
            if (mode === 'read' ? !access.includes('read') && !access.includes('notify') : !access.includes(mode)) throw Object.assign(new Error(`设备属性不支持${mode}`), { code: 'PROPERTY_UNSUPPORTED' });
            return entry;
        });
    };
    const normalizeProps = (values, writeMode) => values.map(([entry, value]) => {
        const access = entry.property.access ?? [];
        if ((writeMode ? !access.includes('write') : !access.includes('read') && !access.includes('notify')) || !validNumber(value)) throw Object.assign(new Error('属性不支持此操作'), { code: 'PROPERTY_UNSUPPORTED' });
        return { did, siid: entry.siid, piid: entry.piid, ...(writeMode ? { value } : {}) };
    });
    const call = async (method, args) => {
        if (method === 'get_ac_model') {
            if (!Array.isArray(args) || args.length) throw Object.assign(new Error('空调匹配查询参数无效'), { code: 'INVALID_ARGUMENT' });
            const result = await cloudCommand(method, args);
            const model = acModelResult(result);
            if (!model) throw Object.assign(new Error('设备返回的空调匹配配置格式无效'), { code: 'INVALID_RPC_RESPONSE' });
            return { result: model };
        }
        if (['get_properties', 'get_prop', 'get_params'].includes(method)) {
            if (method === 'get_properties') {
                const targets = Array.isArray(args) && args.length && args.length <= 100 && args.every(item => Number.isInteger(item.siid) && Number.isInteger(item.piid) && Object.keys(item).every(k => ['did', 'siid', 'piid', 'type'].includes(k))) ? args : [];
                if (!targets.length) throw Object.assign(new Error('属性编号无效'), { code: 'PROPERTY_UNSUPPORTED' });
                return { result: await read(targets.map(item => ({ did, siid: item.siid, piid: item.piid }))) };
            }
            const names = Array.isArray(args) ? args : [args];
            if (method === 'get_prop' && cloudCommand && names.length > 0 && names.length <= 100 && names.every(name => typeof name === 'string' && /^[a-zA-Z0-9_.-]{1,128}$/.test(name)) && names.some(name => !properties.get(identifier(name)))) {
                const response = await cloudCommand(method, names);
                const result = Array.isArray(response) ? response : response?.result;
                if (response?.error || response?.code != null && response.code !== 0 || !Array.isArray(result) || result.length !== names.length) throw Object.assign(new Error('设备返回的属性数据格式无效'), { code: 'INVALID_RPC_RESPONSE' });
                return { result };
            }
            const entries = mappedProperties(names, 'read');
            const states = await read(entries.map(entry => ({ did, siid: entry.siid, piid: entry.piid })));
            const result = entries.map(entry => states.find(state => state.siid === entry.siid && state.piid === entry.piid)?.value);
            return { result };
        }
        if (['set_properties', 'set_prop', 'set_params'].includes(method)) {
            const values = method === 'set_properties' ? (Array.isArray(args) ? args.map(item => [
                [...properties.values()].find(entry => entry?.siid === item.siid && entry.piid === item.piid) || properties.get(identifier(item?.type)), item.value,
            ]) : []) : Array.isArray(args) ? args.map(item => [properties.get(identifier(item?.key ?? item?.name)), item?.value]) : Object.entries(args || {}).map(([name, value]) => [properties.get(identifier(name)), value]);
            if (!values.length || values.some(([entry]) => !entry)) throw Object.assign(new Error('设备属性目标无效'), { code: 'PROPERTY_UNSUPPORTED' });
            if (values.length > 100) throw new Error('属性数量无效');
            const states = await write(normalizeProps(values, true));
            return { result: states.every(state => state.code === 0) ? ['ok'] : states };
        }
        const entry = actions.get(identifier(method));
        if (entry) {
            const values = Array.isArray(args) ? args : args === undefined || args === null ? [] : [args];
            const inputs = entry.action.in || [];
            if (!Array.isArray(inputs) || values.length !== inputs.length || !values.every(validNumber)) throw Object.assign(new Error('设备方法参数无效'), { code: 'PROPERTY_UNSUPPORTED' });
            const result = await doAction({ did, siid: entry.siid, aiid: entry.aiid, in: values });
            return { result: Array.isArray(result?.out) ? result.out : [] };
        }
        return unsupported(`设备 RPC ${method}`)();
    };
    return {
        callMethod: (method, args = [], extraPayload = {}) => call(method, args, extraPayload),
        callMethodFromCloud: (method, args = [], extraPayload = {}) => call(method, args, extraPayload),
        callMethodFromLocal: (method, args = [], extraPayload = {}) => call(method, args, extraPayload),
        loadProperties: async (...names) => {
            const entries = mappedProperties(names, 'read').map(entry => ({ did, siid: entry.siid, piid: entry.piid }));
            const states = await read(entries);
            const values = names.map(name => states.find(state => `${state.siid}.${state.piid}` === name)?.value);
            return { result: values };
        },
    };
}
