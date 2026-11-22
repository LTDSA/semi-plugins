// 原页面用云变量记忆色温/彩光 Tab；桌面只在本次页面内保存这个 UI 偏好。
// 它不是设备属性，也不调用米家云存储或保存隐私授权结果。
export function createLocalDevicePreferences(did) {
    const values = new Map();
    const check = requests => {
        if (!Array.isArray(requests) || !requests.length || requests.length > 32 || requests.some(request => request?.did !== did)) throw new Error('页面偏好目标无效');
    };
    return {
        async get(requests) {
            check(requests);
            const result = { [did]: {} };
            for (const request of requests) {
                if (!Array.isArray(request.props) || request.props.length > 32) throw new Error('页面偏好参数无效');
                for (const key of request.props) if (key === 'prop.s_ctOrRgb' && values.has(key)) result[did][key] = values.get(key);
            }
            return result;
        },
        async set(requests) {
            check(requests);
            const changes = [];
            for (const request of requests) {
                if (!request.props || typeof request.props !== 'object' || Array.isArray(request.props)) throw new Error('页面偏好参数无效');
                for (const [key, value] of Object.entries(request.props)) {
                    if (key !== 'prop.s_ctOrRgb' || typeof value !== 'string' || !['0', '1'].includes(value)) throw Object.assign(new Error('此页面偏好暂不支持'), { code: 'UNSUPPORTED' });
                    changes.push([key, value]);
                }
            }
            for (const [key, value] of changes) values.set(key, value);
            return null;
        },
    };
}
