// 官方 Host.storage 是设备插件的持久 KV；此处按真实 did 命名，避免随临时页面租约失效。
export function createHostStorage({ did, storage, limit = 256 * 1024 }) {
    const prefix = `mijia-host:${did}:`;
    const name = key => {
        if (typeof key !== 'string' || !key || key.length > 128) throw new Error('缓存键无效');
        return prefix + key;
    };
    const read = async key => {
        const saved = await storage.get(name(key));
        if (!saved) return '';
        if (saved.expiresAt && Date.now() >= saved.expiresAt) { await storage.remove(name(key)); return ''; }
        return saved.value;
    };
    const write = async (key, value, options = {}) => {
        const serialized = JSON.stringify({ value, expiresAt: Number.isFinite(options.expire) && options.expire > 0 ? Date.now() + options.expire : 0 });
        if (serialized.length > limit) throw new Error('缓存值超过设备页面限制');
        await storage.set(name(key), JSON.parse(serialized));
    };
    return {
        get: read,
        async set(key, value, options) { await write(key, value, options); },
        async load(keys) { if (!Array.isArray(keys)) throw new Error('缓存键必须是数组'); return Promise.all(keys.map(read)); },
        async save(values, options) {
            const entries = Object.entries(values || {});
            if (entries.length > 100 || entries.some(([key]) => typeof key !== 'string' || !key || key.length > 128)) throw new Error('批量缓存键无效');
            await Promise.all(entries.map(([key, value]) => write(key, value, options)));
        },
        async remove(key) { await storage.remove(name(key)); },
    };
}
