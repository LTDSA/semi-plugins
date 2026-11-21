const crypto = require('crypto');
const { assert, error } = require('./errors.cjs');
const UA = 'MiHome/6.0.103 (com.xiaomi.mihome; build:6.0.103.1; iOS 14.4.0) Alamofire/6.0.103 MICO/iOSApp/appStore/6.0.103';
function parse(data) { return typeof data === 'string' ? JSON.parse(data.replace(/^&&&START&&&/, '')) : data; }
function authenticationFailure(data) {
    if ([401, 403].includes(Number(data?.code))) return true;
    const message = typeof data?.message === 'string' ? data.message.trim() : '';
    return /\b(?:auth(?:entication|orization)?[ _-]*(?:error|failed|failure|required|expired)|unauthorized|not[ _-]*(?:logged[ _-]*in|login)|login[ _-]*(?:required|expired)|(?:invalid|expired)[ _-]*(?:token|session)|(?:token|session)[ _-]*(?:invalid|expired))\b/i.test(message);
}

class MinaService {
    constructor({ authentication }) {
        this.authentication = authentication;
    }
    getAccountId() { return this.authentication.getAccountId(); }
    account() { return this.authentication.account(); }
    current(...args) { return this.authentication.current(...args); }
    request(...args) { return this.authentication.request(...args); }
    async getSpeakers(signal, debug, enrich) {
        const diagnostic = detail => { try { debug?.({ uri: 'semi://mina/auth', response: detail }); } catch {} };
        let userId;
        try { userId = this.account(); }
        catch (e) { diagnostic({ stage: 'account-context', code: e.code }); throw e; }
        let data;
        try {
            data = parse((await this.request(`https://api2.mina.mi.com/admin/v2/device_list?master=0&requestId=app_ios_${crypto.randomBytes(15).toString('hex')}`, {
                signal, diagnostic, headers: { 'User-Agent': UA },
            })).data);
            this.current(userId, signal);
            try { debug?.({ uri: 'https://api2.mina.mi.com/admin/v2/device_list', params: { master: 0 }, response: data }); } catch { /* 调试订阅不影响列表读取。 */ }
            const authError = authenticationFailure(data);
            if (authError) {
                const failure = error('AUTH_REQUIRED', '音箱列表认证失败');
                if (Number.isInteger(Number(data?.code))) failure.serverCode = Number(data.code);
                throw failure;
            }
            assert(data?.code === 0, '音箱列表读取失败', 'MINA_API_ERROR');
        } catch (e) {
            diagnostic({ stage: 'device-list', code: e.code || 'MINA_API_ERROR',
                ...(Number.isInteger(e.httpStatus) ? { httpStatus: e.httpStatus } : {}),
                ...(Number.isInteger(e.serverCode) ? { serverCode: e.serverCode } : {}) });
            throw e;
        }
        this.current(userId, signal);
        assert(Array.isArray(data.data) && data.data.length <= 2000, '音箱列表格式异常', 'MINA_API_ERROR');
        const speakers = [], seen = new Set();
        for (const item of data.data) {
            if (typeof item.deviceID !== 'string' || !item.deviceID || item.deviceID.length > 256 || seen.has(item.deviceID)) continue;
            seen.add(item.deviceID);
            const presence = typeof item.presence === 'string' ? item.presence.trim().toLowerCase() : '';
            const online = presence === 'online' ? true : presence === 'offline' ? false : undefined;
            speakers.push({ id: item.deviceID, name: typeof item.name === 'string' ? item.name.slice(0, 200) : item.deviceID,
                model: typeof item.hardware === 'string' ? item.hardware.slice(0, 100) : '',
                ...(typeof item.miotDID === 'string' && /^[a-zA-Z0-9._:-]{1,256}$/.test(item.miotDID) ? { miotDid: item.miotDID } : {}),
                ...(online === undefined ? {} : { online }) });
        }
        if (enrich) {
            const identities = data.data.filter(item => seen.has(item.deviceID)).map(item => ({ id: item.deviceID, miotDid: typeof item.miotDID === 'string' ? item.miotDID : '' }));
            try {
                const details = await enrich(identities);
                this.current(userId, signal);
                for (const speaker of speakers) Object.assign(speaker, details.get(speaker.id) || {});
            } catch (e) { this.current(userId, signal); if (e.code === 'CONTEXT_CHANGED' || e.code === 'CANCELLED') throw e; }
        }
        this.catalog = { accountId: this.getAccountId(), speakers: new Map(speakers.map(speaker => [speaker.id, { ...speaker }])) };
        return { accountId: crypto.createHash('sha256').update(`mina:${userId}`).digest('hex'), speakers };
    }
    async controlSpeaker(id, command, value, signal) {
        const userId = this.account();
        this.current(userId, signal);
        const speaker = this.catalog?.accountId === this.getAccountId() && this.catalog.speakers.get(id);
        assert(speaker, '音箱不在当前账号列表中', 'DEVICE_NOT_FOUND');
        let method, message;
        if (command === 'play') {
            const url = new URL(value);
            assert(url.protocol === 'http:' && !url.username && !url.password && !url.search && !url.hash
                && /^\/airplay\/[-\w]{20,100}\/\d+\/stream\.wav$/.test(url.pathname), '音频流地址无效');
            // MiService 和 MiAir 的已知机型差异；不是 MiPlay 直连。
            const musicModels = new Set(['LX04', 'LX05', 'LX05A', 'L05B', 'L05C', 'L06', 'L06A', 'X08A', 'X10A', 'X08C', 'X08E', 'X8F', 'X4B', 'OH2', 'OH2P', 'X6A', 'L15A', 'L07A']);
            if (musicModels.has(speaker.model)) {
                method = 'player_play_music';
                const audioId = '448161862632079419';
                message = { startaudioid: audioId, music: JSON.stringify({ payload: { audio_type: '', audio_items: [{ item_id: { audio_id: audioId,
                    cp: { album_id: '-1', episode_index: 0, id: '355454500', name: 'xiaowei' } }, stream: { url: url.href } }],
                    list_params: { listId: '-1', loadmore_offset: 0, origin: 'xiaowei', type: 'MUSIC' } }, play_behavior: 'REPLACE_ALL' }) };
            } else { method = 'player_play_url'; message = { url: url.href, type: 2, media: 'app_ios' }; }
        } else if (command === 'stop') { method = 'player_play_operation'; message = { action: 'stop', media: 'app_ios' }; }
        else if (command === 'volume') {
            assert(Number.isInteger(value) && value >= 0 && value <= 100, '音量无效');
            method = 'player_set_volume'; message = { volume: value, media: 'app_ios' };
        } else throw error('METHOD_NOT_FOUND', '不支持的音箱控制');
        try {
            const response = await this.authentication.request('https://api2.mina.mi.com/remote/ubus', { method: 'POST', data: new URLSearchParams({ deviceId: id, method, path: 'mediaplayer',
                message: JSON.stringify(message), requestId: 'app_ios_' + crypto.randomBytes(15).toString('hex') }).toString(),
                signal, timeout: 15000, maxRedirects: 0, maxContentLength: 1024 * 1024,
                headers: { 'User-Agent': UA, 'Content-Type': 'application/x-www-form-urlencoded' },
            });
            this.current(userId, signal);
            const result = parse(response.data);
            assert(!authenticationFailure(result), '音箱账号认证已失效', 'AUTH_REQUIRED');
            assert(result?.code === 0 && (result.data?.code === undefined || result.data.code === 0), '音箱播放控制失败', 'MINA_CONTROL_FAILED');
            return null;
        } catch (e) {
            if (e.code === 'CONTEXT_CHANGED' || signal?.aborted) throw error('CANCELLED', '音箱控制已取消');
            if (e.code === 'AUTH_REQUIRED' || [401, 403].includes(e.response?.status)) {
                this.current(userId, signal);
                throw error('AUTH_REQUIRED', '请在登录页重新扫码在线登录，以完成音箱账号认证。');
            }
            throw error('MINA_CONTROL_FAILED', '音箱播放控制失败，请检查账号和设备状态');
        }
    }
}
module.exports = { MinaService, authenticationFailure };
