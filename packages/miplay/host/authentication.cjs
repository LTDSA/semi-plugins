const crypto = require('crypto');
const { assert } = require('./errors.cjs');
function createAuthentication(client) {
    const account = () => client.current().userId;
    return {
        account,
        getAccountId: () => crypto.createHash('sha256').update(`mina:${account()}`).digest('hex'),
        current(userId, signal) { assert(!signal?.aborted, '请求已取消', 'CANCELLED'); assert(account() === userId, '账号已变化', 'CONTEXT_CHANGED'); },
        async request(value, options = {}) {
            const url = new URL(value), method = options.method || 'GET';
            assert(url.origin === 'https://api2.mina.mi.com', '音箱请求地址无效');
            const data = method === 'POST' ? Object.fromEntries(new URLSearchParams(options.data)) : Object.fromEntries(url.searchParams);
            return { data: await client.call('xiaomi.auth', 'request', { purpose: 'mina', path: url.pathname, method, payload: JSON.stringify(data) }, options.signal) };
        },
    };
}
module.exports = { createAuthentication };
