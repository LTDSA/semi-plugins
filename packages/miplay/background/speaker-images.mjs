const MAX_BYTES = 160 * 1024;
const ok = ({ statusCode }) => statusCode >= 200 && statusCode < 300;

export function speakerProductModel(hardware) {
    return typeof hardware === 'string' && /^[a-z][a-z0-9]{0,15}$/i.test(hardware)
        ? `xiaomi.wifispeaker.${hardware.toLowerCase()}` : null;
}
function trustedImage(value) {
    try {
        const url = new URL(value);
        const trusted = url.hostname === 'static.home.mi.com' || url.hostname.endsWith('.mi-img.com') || url.hostname === 'cdn.fds.api.xiaomi.com' || url.hostname.endsWith('.fds.api.xiaomi.com');
        if (!trusted || !['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.port) return null;
        url.protocol = 'https:'; return url.href;
    } catch { return null; }
}
function imageType(data) {
    if (data.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return 'image/png';
    if (data[0] === 255 && data[1] === 216 && data[2] === 255) return 'image/jpeg';
    if (['GIF87a', 'GIF89a'].includes(data.subarray(0, 6).toString())) return 'image/gif';
    if (data.subarray(0, 4).toString() === 'RIFF' && data.subarray(8, 12).toString() === 'WEBP') return 'image/webp';
    return null;
}
export function createSpeakerImages({ cache, request }) {
    const memory = new Map();
    return async (hardware, signal) => {
        const model = speakerProductModel(hardware);
        if (!model || signal?.aborted) return null;
        const previous = memory.get(model);
        if (previous && previous.until > Date.now()) return previous.image;
        const key = `speaker-image:${model}`;
        const saved = await cache?.get(key).catch(() => null);
        if (saved?.until > Date.now() && typeof saved.image === 'string' && /^data:image\/(png|jpeg|gif|webp);base64,/.test(saved.image) && saved.image.length < 220000) {
            memory.set(model, saved); return saved.image;
        }
        if (signal?.aborted) return null;
        const options = { signal, timeout: 5000, redirect: 'manual', maxBytes: MAX_BYTES };
        try {
            const product = await request({ ...options, url: 'https://home.mi.com/cgi-op/api/v1/baike/v2/product', query: { model } });
            const url = ok(product) && product.data?.code === 0 && trustedImage(product.data.data?.realIcon);
            if (!url) throw new Error('No product icon');
            const result = await request({ ...options, url, responseType: 'arraybuffer' });
            if (!ok(result)) throw new Error('Image request failed');
            const bytes = Buffer.from(result.data), type = imageType(bytes);
            if (!type || bytes.length > MAX_BYTES || signal?.aborted) throw new Error('Invalid image');
            const entry = { image: `data:${type};base64,${bytes.toString('base64')}`, until: Date.now() + 86400000 };
            memory.set(model, entry);
            await cache?.set(key, entry, '音箱图片').catch(() => {});
            return entry.image;
        } catch {
            if (!signal?.aborted) memory.set(model, { image: null, until: Date.now() + 60000 });
            return null;
        } finally {
            while (memory.size > 64) memory.delete(memory.keys().next().value);
        }
    };
}
