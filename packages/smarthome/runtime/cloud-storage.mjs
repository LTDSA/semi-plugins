const encode = value => typeof value === 'string' ? value : JSON.stringify(value);

function parseMain(value) {
    let result = value;
    if (typeof result === 'string') {
        try { result = JSON.parse(result); } catch { return null; }
    }
    result = result?.result ?? result;
    result = result?.results ?? result;
    const first = Array.isArray(result) ? result[0] : result;
    if (!first) return null;
    let data = first.data;
    if (typeof data === 'string') {
        try { data = JSON.parse(data); } catch { return null; }
    }
    if (!data?.ts || !data?.tc) return null;
    return Array.from({ length: Number(data.tc) }, (_, index) => Number(data.ts) + index);
}

function parseChildren(key, value) {
    let result = value;
    if (typeof result === 'string') {
        try { result = JSON.parse(result); } catch { return null; }
    }
    result = result?.result ?? result;
    result = result?.results ?? result;
    if (!Array.isArray(result) || !result.length) return null;
    return { ...result[0], key, data: result.map(item => item.data || '').join('') };
}

function chunks(model, key, value) {
    const data = encode(value);
    if (typeof data !== 'string') return null;
    if (data.length <= 2048) return [{ model, key, data }];
    const count = Math.ceil(data.length / 2048);
    if (count + 1 > 1000) return null;
    const first = Number.isFinite(Number(key)) ? Number(key) + 1 : `${key}1`;
    const keys = Array.from({ length: count }, (_, index) => typeof first === 'number' ? first + index : `${key}${index + 1}`);
    const result = [{ model, key, data: JSON.stringify({ ts: keys[0], tc: count }) }];
    for (let index = 0; index < count; index++) result.push({ model, key: keys[index], data: data.slice(index * 2048, (index + 1) * 2048) });
    return result;
}

export function createCloudStorageApi(read, write) {
    return {
        getUserConfigs: (componentId, ...keys) => read('/user/get_user_config', { component_id: componentId, keys }),
        getThirdUserConfigs: (model, ...keys) => read('/user/get_third_user_config', { model, keys }),
        setUserConfigs(componentId, data) {
            const entries = Object.entries(data || {}).map(([key, value]) => ({ component_id: componentId, key, data: value || {} }));
            if (!componentId || !entries.length) return Promise.reject(Object.assign(new Error('云端配置参数无效'), { code: 'INVALID_ARGUMENT' }));
            return write('/user/set_user_config', entries);
        },
        setThirdUserConfigs: (model, key, data) => write('/user/set_third_user_config', { model, key, data }),
        setThirdUserConfigsForOneKey(model, key, data) {
            const entries = chunks(model, key, data);
            if (!entries) return Promise.reject(Object.assign(new Error('云端配置过大'), { code: 'PAYLOAD_TOO_LARGE' }));
            return write('/user/set_third_user_config', entries);
        },
        async getThirdUserConfigsForOneKey(model, key) {
            const main = await read('/user/get_third_user_config', { model, keys: [key] });
            const children = parseMain(main);
            if (children?.length) {
                const value = await read('/user/get_third_user_config', { model, keys: children });
                const parsed = parseChildren(key, value);
                if (!parsed) throw Object.assign(new Error('云端分段配置无效'), { code: 'MIJIA_ERROR' });
                return parsed;
            }
            const first = Array.isArray(main) ? main[0] : main;
            if (typeof first === 'string') {
                try { return JSON.parse(first); } catch { return first; }
            }
            return first;
        },
    };
}
