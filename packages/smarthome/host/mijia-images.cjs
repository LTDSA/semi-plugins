const { assert, error } = require('../browser/contracts.cjs');
const { splitIdentity } = require('./mijia-split.cjs');

const IMAGE_LIMIT = 2 * 1024 * 1024;
const CACHE_LIMIT = 16 * 1024 * 1024;
const TTL = 24 * 60 * 60 * 1000;
function imageUrl(value) {
    if (typeof value !== 'string' || value.length > 4096) return null;
    try {
        const url = new URL(value);
        const trusted = url.hostname === 'static.home.mi.com' || url.hostname.endsWith('.mi-img.com') || url.hostname === 'cdn.fds.api.xiaomi.com' || url.hostname.endsWith('.fds.api.xiaomi.com') || (url.hostname === 'cdn.eco.mi.com' && url.pathname.startsWith('/chunmi-img/'));
        if (!trusted || !['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.port) return null;
        url.protocol = 'https:';
        return url.href;
    } catch { return null; }
}
function imageType(data) {
    if (data.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return 'image/png';
    if (data[0] === 255 && data[1] === 216 && data[2] === 255) return 'image/jpeg';
    if (['GIF87a', 'GIF89a'].includes(data.subarray(0, 6).toString())) return 'image/gif';
    if (data.subarray(0, 4).toString() === 'RIFF' && data.subarray(8, 12).toString() === 'WEBP') return 'image/webp';
    return null;
}
function deviceImageUrls(device) {
    const split = splitIdentity(device);
    return [...new Set([split?.valid && split.icon, device.icon_real, device.realIcon, device.icon, device.image_url, device.imageUrl].map(imageUrl).filter(Boolean))];
}
const deviceImageUrl = device => deviceImageUrls(device)[0];
const check = signal => assert(!signal?.aborted, '图片请求已取消', 'CANCELLED');

function createMijiaImages({ getProduct, download }) {
    const products = new Map(), cache = new Map(), waiters = [];
    let bytes = 0, active = 0;

    async function fetchImage(url, signal) {
        const cached = cache.get(url);
        if (cached) {
            cache.delete(url);
            if (cached.expires > Date.now()) { cache.set(url, cached); return cached; }
            bytes -= cached.data.length;
        }
        const data = Buffer.from(await download(url, signal));
        check(signal);
        const contentType = imageType(data);
        assert(contentType && data.length <= IMAGE_LIMIT, '设备图片格式或大小异常', 'IMAGE_UNAVAILABLE');
        const result = { data, contentType, expires: Date.now() + TTL };
        bytes -= cache.get(url)?.data.length || 0;
        cache.delete(url);
        cache.set(url, result);
        bytes += data.length;
        while (bytes > CACHE_LIMIT) {
            const key = cache.keys().next().value;
            bytes -= cache.get(key).data.length;
            cache.delete(key);
        }
        return result;
    }

    async function get(device, signal) {
        check(signal);
        const urls = deviceImageUrls(device);
        let failure;
        for (const url of urls) {
            try { return await fetchImage(url, signal); }
            catch (error) { check(signal); if (error.code === 'CANCELLED') throw error; failure = error; }
        }
        const model = device.model;
        if (typeof model === 'string' && /^[a-zA-Z0-9_.-]{1,128}$/.test(model)) {
            let product = products.get(model);
            if (!product || product.expires < Date.now()) {
                const result = await getProduct(model, signal);
                check(signal);
                assert(result?.code === 0 && result.data, '设备图片信息不可用', 'IMAGE_UNAVAILABLE');
                product = { url: imageUrl(result.data.realIcon), expires: Date.now() + TTL };
                products.delete(model);
                products.set(model, product);
                if (products.size > 256) products.delete(products.keys().next().value);
            }
            if (product.url && !urls.includes(product.url)) return fetchImage(product.url, signal);
        }
        if (failure) throw failure;
        throw error('IMAGE_UNAVAILABLE', '此设备暂无图片');
    }

    return {
        async get(device, signal) {
            check(signal);
            if (active < 4) active++;
            else await new Promise((resolve, reject) => {
                const start = () => { signal?.removeEventListener('abort', cancel); resolve(); };
                const cancel = () => {
                    waiters.splice(waiters.indexOf(start), 1);
                    reject(error('CANCELLED', '图片请求已取消'));
                };
                waiters.push(start);
                signal?.addEventListener('abort', cancel, { once: true });
            });
            try { return await get(device, signal); }
            finally {
                const next = waiters.shift();
                if (next) next();
                else active--;
            }
        },
    };
}
module.exports = { createMijiaImages, imageUrl, deviceImageUrl, IMAGE_LIMIT };
