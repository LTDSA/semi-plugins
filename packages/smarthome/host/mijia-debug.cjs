// 调试事件进入插件前先做快照和脱敏，不能传递 axios 配置、Cookie 或设备密钥。
function snapshot(value, key = '', depth = 0) {
    const name = key.replace(/[^a-z0-9]/gi, '').toLowerCase();
    if (/(token|password|passwd|ssecurity|cookie|authorization|credential|secret|beaconkey|bindkey|privatekey)/.test(name) || name === 'key') return '[已脱敏]';
    if (depth > 24) return '[嵌套过深]';
    if (Array.isArray(value)) return value.map(item => snapshot(item, '', depth + 1));
    if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([name, item]) => [name, snapshot(item, name, depth + 1)]));
    if (typeof value === 'string') return value.replace(/([?&](?:[^=&]*(?:token|password|ssecurity|secret|cookie|authorization|bind_key|private_key)[^=&]*)=)[^&#]*/gi, '$1[已脱敏]');
    return value ?? null;
}
function createMijiaDebug({ enabled, emit }) {
    return data => {
        if (!enabled) return;
        // 调试订阅失败不得影响设备读取。
        try { emit(snapshot({ ...data, timestamp: new Date().toISOString() })); } catch { /* 日志尽力交付 */ }
    };
}
module.exports = { createMijiaDebug };
