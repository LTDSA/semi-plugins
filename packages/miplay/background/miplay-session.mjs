import net from 'node:net';
import dgram from 'node:dgram';
import { randomBytes } from 'node:crypto';
import { CommandChannel, commandFrame, legacyAnswer, deviceInfo } from './miplay-wire.mjs';

export const clockUs = () => process.hrtime.bigint() / 1000n;
const json = data => Buffer.from(JSON.stringify(data));
function deferred(timeout = 10000, message = 'MiPlay 连接超时') {
    let resolve, reject;
    const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
    const timer = setTimeout(() => reject(new Error(message)), timeout);
    promise.finally(() => clearTimeout(timer)).catch(() => {});
    return { promise, resolve, reject };
}
export class MiPlayControl {
    async connect(device, sourceName = 'Semi') {
        this.device = device; this.sourceName = sourceName; this.sequence = 8;
        const socket = net.createConnection({ host: device.address, port: device.controlPort || 8899, localAddress: device.localAddress });
        socket.setNoDelay(true); this.channel = new CommandChannel(socket);
        try {
            const challenge = await this.channel.wait(0x28);
            const version = this.channel.wait(0x37, 0);
            const info = this.channel.wait(0x1f, 1);
            // Register all expected replies before writing the coalesced prefix.
            socket.write(Buffer.concat([commandFrame(0x36, 0, Buffer.from('1.0.1123012\0')), commandFrame(0x29, challenge.sequence, legacyAnswer(challenge.payload))]));
            this.channel.send(0x1e, 1);
            // Observe every outstanding rejection even when another step fails.
            const localInfo = version.then(frame => {
                if (!/^\d+\.\d+\.\d+\0?$/.test(frame.payload.toString())) throw new Error('MiPlay 接收端版本无效');
                return this.channel.request(0x58, 2, json({ sourceName }));
            });
            const [details] = await Promise.all([info, localInfo]);
            this.info = deviceInfo(details.payload);
            const sameAccount = this.channel.request(0x58, 3, json({ isSameAccount: 0 }));
            const mode = this.channel.request(0x34, 4);
            const [, modeFrame] = await Promise.all([sameAccount, mode]);
            this.checkMode(modeFrame);
            const statusReplies = Promise.all([this.channel.wait(0x0f, 5), this.channel.wait(0x1d, 7)]);
            // In mirror mode GetMediaInfo may produce receiver-owned 0x0022
            // notifications, not a same-sequence 0x0015 acknowledgement. Send
            // the query in the captured order without gating readiness on it.
            try {
                this.channel.send(0x0e, 5);
                this.channel.send(0x14, 6);
                this.channel.send(0x1c, 7);
            } catch (error) { this.channel.fail(error); }
            const [volume, state] = await statusReplies;
            if (volume.payload.length !== 5 || volume.payload[0] !== 0 || volume.payload.readUInt32BE(1) > 100) throw new Error('MiPlay 音箱返回的音量无效');
            if (state.payload.length !== 5 || state.payload[0] !== 0) throw new Error('MiPlay 音箱返回的状态无效');
            this.volume = volume.payload.readUInt32BE(1);
            this.heartbeat = setInterval(() => this.request(0x1a).catch(error => this.channel.fail(error)), 5000);
            this.heartbeat.unref?.();
            return this.info;
        } catch (error) { this.close(); throw error; }
    }
    checkMode(frame) {
        if (frame.payload.length !== 5 || frame.payload[0] !== 0 || frame.payload.readUInt32BE(1) !== 2) throw new Error('该音箱未处于支持的 MiPlay 音频模式');
    }
    request(command, payload) { const sequence = this.sequence++ & 65535; return this.channel.request(command, sequence, payload); }
    async open(ip, port) {
        await Promise.all([this.request(0x58, json({ sourceName: this.sourceName })), this.request(0x1e)]);
        await this.request(0x58, json({ isSameAccount: 0 }));
        this.checkMode(await this.request(0x34)); await this.request(0x1a);
        this.channel.send(0x40, this.sequence++ & 65535, json({ ref_channel: 'controlcenter', ref_function: 'single_room', ref_content: 'semi' }));
        this.channel.send(0, this.sequence++ & 65535, Buffer.from(`wfd://${ip}:${port}?mirrorMode=1\0`));
        this.opened = true;
        // Display the actual source, not a fictitious track or cover.
        this.channel.send(0x12, this.sequence++ & 65535, json({ mArtist: '', mAlbum: '', mTitle: 'Semi 音频', mDuration: 0, id: '', mCoverUrl: '', status: 0, volume: this.volume, mArt: '', mSourceName: this.sourceName, mDeviceState: 2 }));
    }
    async setVolume(value) {
        if (!Number.isFinite(value) || value < 0 || value > 100) throw new Error('音量范围无效');
        const body = Buffer.alloc(4); body.writeUInt32BE(Math.round(value)); await this.request(0x0c, body); this.volume = Math.round(value);
    }
    async stop() {
        clearInterval(this.heartbeat);
        if (!this.opened || this.channel.failure) return;
        this.opened = false;
        // CloseDevice is not an ACK gate in the reference runtime. Wait for
        // the actual socket write before tearing down transports, not 0x0003.
        await new Promise((resolve, reject) => {
            try { this.channel.send(2, this.sequence++ & 65535, undefined, error => error ? reject(error) : resolve()); }
            catch (error) { reject(error); }
        });
    }
    close() { clearInterval(this.heartbeat); this.channel?.close(); }
}

const CAPABILITIES = ['wfd_video_formats', 'wfd_audio_codecs', 'wfd_client_rtp_ports', 'wfd_tcp_enable', 'wfd_tcp_multi_session_enable', 'wfd_image_enable', 'wfd_dynamic_video_enable', 'wfd_standby_resume_capability', 'wfd_video_bitrate', 'wfd_current_video_info'].join('\r\n') + '\r\n';
const PUBLIC = 'org.wfa.wfd1.0, SETUP, TEARDOWN, PLAY, PAUSE, GET_PARAMETER, SET_PARAMETER';
export class MiPlayMediaSession {
    constructor({ ip, peer, onFailure = () => {} }) {
        Object.assign(this, { ip, peer, onFailure }); this.sockets = new Set(); this.session = randomBytes(8).toString('hex');
        this.ready = deferred(15000, '音箱未完成 MiPlay 反向 RTSP 握手');
        this.ready.promise.catch(() => {}); this.mediaReady = deferred(15000, '音箱未建立 MiPlay 媒体通道'); this.mediaReady.promise.catch(() => {});
        this.waiters = new Map(); this.accepted = 0; this.closed = false;
        this.nextSequence = 6;
    }
    async listen() {
        this.timerSocket = dgram.createSocket('udp4');
        this.timerSocket.on('message', (request, remote) => {
            if (remote.address !== this.peer || !request.length || request.length > 40) return;
            const received = clockUs(), response = Buffer.alloc(40); request.copy(response);
            response.writeBigUInt64LE(clockUs(), 16); response.writeBigUInt64LE(received, 24);
            this.timerSocket.send(response, remote.port, remote.address, () => {});
        });
        this.timerSocket.on('error', error => this.fail(error));
        await new Promise((resolve, reject) => { this.timerSocket.once('error', reject); this.timerSocket.bind(0, this.ip, resolve); });
        this.timerPort = this.timerSocket.address().port;
        this.server = net.createServer(socket => {
            if (socket.remoteAddress?.replace(/^::ffff:/, '') !== this.peer || this.accepted >= 3 || this.closed) { socket.destroy(); return; }
            this.accepted++; this.sockets.add(socket); socket.setNoDelay(true);
            socket.on('error', error => this.fail(error));
            socket.on('close', () => { this.sockets.delete(socket); if (!this.closed && (socket === this.control || socket === this.media)) this.fail(new Error('MiPlay 媒体连接已断开')); });
            if (this.accepted === 1) { this.control = socket; this.negotiate(socket).catch(error => this.fail(error)); }
            else if (this.accepted === 3) { this.media = socket; this.mediaReady.resolve(); }
        });
        this.server.on('error', error => this.fail(error));
        await new Promise((resolve, reject) => { this.server.once('error', reject); this.server.listen(0, this.ip, resolve); });
        this.port = this.server.address().port; return this.port;
    }
    message(line, headers = {}, body = '') {
        const data = Buffer.from(body);
        return Buffer.concat([Buffer.from(`${line}\r\nDate: ${new Date().toUTCString()}\r\nServer: \r\n${Object.entries({ ...headers, 'Content-Length': data.length }).map(([key, value]) => `${key}:${['wfd_timer_server_port', 'TimeOffset'].includes(key) ? '' : ' '}${value}`).join('\r\n')}\r\n\r\n`), data]);
    }
    reply(request, headers = {}) { this.control.write(this.message('RTSP/1.0 200 OK', { CSeq: request.headers.cseq, ...headers })); }
    request(method, sequence, body = '', headers = {}, target = 'rtsp://localhost/wfd1.0') {
        const pending = deferred(5000, `MiPlay RTSP ${method} 超时`);
        this.waiters.set(String(sequence), pending);
        pending.promise.finally(() => this.waiters.delete(String(sequence))).catch(() => {});
        this.control.write(this.message(`${method} ${target} RTSP/1.0`, { CSeq: sequence, 'Content-Type': 'text/parameters', ...headers }, body));
        return pending.promise;
    }
    async negotiate(socket) {
        let buffer = Buffer.alloc(0);
        socket.on('data', data => {
            try {
                buffer = Buffer.concat([buffer, data]);
                if (buffer.length > 131072) throw new Error('MiPlay RTSP 缓冲过大');
                for (;;) {
                    const end = buffer.indexOf('\r\n\r\n'); if (end < 0) break;
                    const lines = buffer.subarray(0, end).toString().split('\r\n'), headers = Object.create(null);
                    for (const line of lines.slice(1)) { const colon = line.indexOf(':'); if (colon > 0) headers[line.slice(0, colon).toLowerCase()] = line.slice(colon + 1).trim(); }
                    const size = Number(headers['content-length'] || 0);
                    if (!Number.isInteger(size) || size < 0 || size > 65536) throw new Error('MiPlay RTSP 消息长度无效');
                    if (buffer.length < end + 4 + size) break;
                    const request = { line: lines[0], headers, body: buffer.subarray(end + 4, end + 4 + size).toString() }; buffer = buffer.subarray(end + 4 + size);
                    if (request.line.startsWith('RTSP/')) {
                        const pending = this.waiters.get(headers.cseq);
                        if (!pending) continue;
                        if (!/^RTSP\/1\.0 200\b/.test(request.line)) pending.reject(new Error('音箱拒绝 MiPlay RTSP 请求')); else pending.resolve(request);
                    } else this.handle(request);
                }
            } catch (error) { this.fail(error); }
        });
        const numericIP = this.ip.split('.').reduce((value, byte) => value * 256 + Number(byte), 0);
        await this.request('OPTIONS', 1, '', { Require: 'org.wfa.wfd1.0', wfd_timer_server_port: `${numericIP}:${this.timerPort}` }, '*');
        const capabilities = await this.request('GET_PARAMETER', 2, CAPABILITIES);
        if (!/wfd_audio_codecs:\s*AAC\s+[0-9a-f]*1\b/i.test(capabilities.body) || !/RTP\/AVP\/TCP;interleaved/.test(capabilities.body)) throw new Error('音箱不支持已实现的 AAC/TCP MiPlay 配置');
        await this.request('SET_PARAMETER', 3, `wfd_audio_codecs: AAC 00000001 00\r\nwfd_client_rtp_ports: RTP/AVP/TCP;interleaved mode=play\r\nwfd_presentation_URL: rtsp://${this.ip}/wfd1.0/streamid=0 none\r\n`);
        await this.request('SET_PARAMETER', 4, 'wfd_trigger_method: SETUP\r\n');
    }
    handle(request) {
        const method = request.line.split(' ')[0];
        if (method === 'OPTIONS') return this.reply(request, { Public: PUBLIC });
        if (method === 'SETUP') {
            if (!/RTP\/AVP\/TCP;interleaved=0-1/.test(request.headers.transport || '')) throw new Error('不支持的 MiPlay RTP 传输');
            this.setup = true;
            return this.reply(request, { Session: `${this.session};timeout=60`, Transport: request.headers.transport + (request.headers.transport.endsWith(';') ? '' : ';') });
        }
        if (method === 'PLAY') {
            if (!this.setup || request.headers.session?.split(';')[0] !== this.session) throw new Error('MiPlay PLAY 会话无效');
            this.reply(request, { Session: `${this.session};timeout=60`, Range: 'npt=now-' });
            this.origin = clockUs();
            this.request('TIME_OFFSET', 5, '', { TimeOffset: String(this.origin + 1000000n) }).then(() => this.ready.resolve()).catch(error => this.fail(error));
            return;
        }
        if (['GET_PARAMETER', 'VIDEO_LATENCY', 'IDR', 'SET_PARAMETER'].includes(method)) return this.reply(request, { Session: `${this.session};timeout=60` });
        if (method === 'TEARDOWN') { this.reply(request); this.fail(new Error('音箱结束了 MiPlay 媒体会话')); return; }
        throw new Error('不支持的 MiPlay RTSP 方法');
    }
    async waitReady() { await Promise.all([this.ready.promise, this.mediaReady.promise]); }
    async resync(origin) {
        await this.request('TIME_OFFSET', this.nextSequence++, '', { TimeOffset: String(origin + 1000000n) });
    }
    async write(data) {
        if (this.closed || !this.media || this.media.destroyed) throw new Error('MiPlay 音频通道不可用');
        if (this.media.writableLength > 262144) throw new Error('MiPlay 音频发送阻塞');
        if (!this.media.write(data)) await new Promise((resolve, reject) => {
            const finish = error => { clearTimeout(timer); this.media.removeListener('drain', drain); this.media.removeListener('close', close); error ? reject(error) : resolve(); };
            const drain = () => finish(), close = () => finish(new Error('MiPlay 音频连接已关闭'));
            const timer = setTimeout(() => finish(new Error('MiPlay 音频发送超时')), 3000);
            this.media.once('drain', drain); this.media.once('close', close);
        });
    }
    fail(error) {
        if (this.closed) return;
        this.ready.reject(error); this.mediaReady.reject(error);
        for (const pending of this.waiters.values()) pending.reject(error);
        this.onFailure(error); this.close();
    }
    close() {
        if (this.closed) return; this.closed = true;
        this.ready.reject(new Error('MiPlay 已取消')); this.mediaReady.reject(new Error('MiPlay 已取消'));
        for (const pending of this.waiters.values()) pending.reject(new Error('MiPlay 已取消'));
        for (const socket of this.sockets) socket.destroy(); this.sockets.clear();
        try { this.timerSocket?.close(); } catch {} this.server?.close();
    }
}
