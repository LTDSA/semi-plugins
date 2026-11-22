const { assert, error } = require('../browser/contracts.cjs');
const paths = new Set(['/microwaveoven/index/index', '/mijia-pot-service/portal/newIndex', '/mijia-pot-service/portal/index', '/mijia-pot-service/device/info']);
function vendorRequest(params, device, accountId) {
    assert(params && Object.keys(params).every(key => ['url', 'headers'].includes(key)) && typeof params.url === 'string' && params.url.length <= 4096, '厂商读取参数无效');
    const url = new URL(params.url);
    if (url.origin === 'https://home.mi.com' && url.pathname === '/newoperation/productBaike') {
        assert(!url.username && !url.password && !url.hash && [...url.searchParams.keys()].join(',') === 'model' && url.searchParams.get('model') === device.model, '产品百科型号不匹配', 'PERMISSION_DENIED');
        assert(params.headers && Object.entries(params.headers).every(([name, value]) => name.toLowerCase() === 'accept' && typeof value === 'string' && value.length <= 512 && !/[\r\n]/.test(value)), '产品百科请求头无效');
        return { url: url.href, headers: params.headers };
    }
    assert(url.origin === 'https://gateway.joyami.com' && !url.username && !url.password && !url.hash && paths.has(url.pathname), '厂商读取地址未开放', 'UNSUPPORTED');
    const keys = new Set(['deviceId', 'id', 'model', 'useId', 'userId', 'uid', 'categoryId', 'language']);
    const seen = new Set();
    for (const [key, value] of url.searchParams) {
        assert(keys.has(key) && !seen.has(key) && value.length <= 256, '厂商查询参数无效'); seen.add(key);
        if (key === 'deviceId' || key === 'id') assert(value === device.did, '厂商读取不能访问其他设备', 'PERMISSION_DENIED');
        if (key === 'model') assert(value === device.model, '厂商读取型号不匹配', 'PERMISSION_DENIED');
        if (['useId', 'userId', 'uid'].includes(key)) {
            assert(value === '$owner' || value === accountId, '厂商读取不能访问其他账号', 'PERMISSION_DENIED');
            url.searchParams.set(key, accountId);
        }
    }
    const headers = {};
    assert(params.headers && typeof params.headers === 'object' && !Array.isArray(params.headers), '厂商请求头无效');
    const allowed = new Set(['signature', 'nonce', 'timestamp', 'vid', 'accept', 'content-type', 'appid', 'version']);
    for (const [key, value] of Object.entries(params.headers)) {
        assert(allowed.has(key.toLowerCase()) && typeof value === 'string' && value.length <= 512 && !/[\r\n]/.test(value), '厂商请求头无效');
        if (key.toLowerCase() === 'vid') {
            assert(value === '$owner' || value === accountId, '厂商账号不匹配', 'PERMISSION_DENIED');
            headers[key] = accountId;
        } else headers[key] = value;
    }
    return { url: url.href, headers };
}
async function vendorRead(params, device, accountId, signal) {
    const request = vendorRequest(params, device, accountId);
    try {
        const { semi } = await import('@semi-app/plugin-sdk');
        const response = await semi.request({ url: request.url, header: request.headers, dataType: 'text', signal, timeout: 20000, maxBytes: 192 * 1024, redirect: 'manual' });
        assert(response.statusCode >= 200 && response.statusCode < 300, '厂商数据读取失败');
        return { status: response.statusCode, body: response.data, headers: { 'content-type': String(response.header['content-type'] || 'application/json') } };
    } catch (e) { throw error(signal?.aborted ? 'CANCELLED' : 'VENDOR_READ_FAILED', '厂商数据读取失败'); }
}
module.exports = { vendorRead, vendorRequest };
