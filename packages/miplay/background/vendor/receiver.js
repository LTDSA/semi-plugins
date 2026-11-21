/**
 * The receiving half: an AirPlay 1 (RAOP) target other devices can stream to.
 *
 * Ported from libraop's `raop_server.c`. This is the mirror of everything else
 * in the package — an RTSP *server* instead of a client, ALAC decoding instead
 * of encoding, polling someone else's clock instead of serving our own.
 *
 * **Encryption is the caller's decision, not this package's.** A sender may
 * encrypt the audio with an AES key it wraps in the receiver's RSA public key,
 * and may demand an `Apple-Challenge` response signed with the matching private
 * key. That key is Apple's, and shipping it is not something a library should
 * decide for the person publishing it — so both operations are optional hooks
 * ({@link ReceiverOptions.rsa}). With no hook the service advertises `et=0`,
 * which is the honest statement that it takes cleartext only.
 *
 * mDNS advertising is likewise left to the caller: the port and the TXT record
 * are handed out, and the application publishes them with whatever responder it
 * already runs.
 */
import { connect as connectTcp, createServer } from 'node:net';
import { createSocket } from 'node:dgram';
import { createDecipheriv, randomBytes } from 'node:crypto';
import { AlacDecoder, parseAlacFmtp } from './alacDecoder.js';
import { ntpNow } from './ntpTiming.js';
import { answerChallenge, decryptAesKey } from './appleKey.js';
import { fairplaySetup } from '../fairplay-setup.mjs';
import { unwrapFairplayKey } from '../fairplay-key.cjs';
/** Events a session raises, mirroring what the native receiver reported. */
/** Beyond this a gap is a blackout or a seek, not loss worth asking back for. */
const MAX_RESEND_RUN = 128;
/**
 * A running RAOP receiver. One instance serves one sender at a time, which is
 * what the protocol assumes: a second ANNOUNCE replaces the first.
 */
export class AirPlayReceiver {
    options;
    onEvent;
    server = null;
    sessions = new Map();
    activeSession = null;
    connectionSequence = 0;
    mac;
    lastSeq = -1;
    lastTs = -1;
    counters = {
        received: 0,
        missed: 0,
        retransmitted: 0,
        undecodable: 0,
        resendsAsked: 0,
        framesAnnounced: 0,
        framesDecoded: 0,
    };
    volume = 0;
    constructor(options, onEvent) {
        this.options = options;
        this.onEvent = onEvent;
        this.mac = options.mac ?? randomBytes(6);
    }
    /**
     * What the audio path has seen since the stream started.
     *
     * `missed` counts gaps in the sender's sequence numbers -- audio that never
     * arrived -- and is the number that separates a network problem from a
     * decoding one, which sound identical from the outside.
     */
    get stats() {
        return { ...this.counters };
    }
    /** Start listening. Returns what the caller needs to advertise. */
    async start() {
        const server = createServer((socket) => this.onConnection(socket));
        await new Promise((resolve, reject) => {
            server.once('error', reject);
            server.listen(this.options.port ?? 0, this.options.host, () => {
                server.removeListener('error', reject);
                resolve();
            });
        });
        this.server = server;
        const address = server.address();
        const port = typeof address === 'object' && address ? address.port : 0;
        return {
            instanceName: `${this.mac.toString('hex').toUpperCase()}@${this.options.name}`,
            port,
            txt: {
                tp: 'UDP',
                sm: 'false',
                sv: 'false',
                // `ek=1` and an `et` with a 1 in it are claims about encryption we can
                // only make when the caller supplied the key to back them up.
                ek: '1',
                et: '0,1',
                md: '0,1,2',
                cn: '0,1',
                ch: '2',
                ss: '16',
                sr: '44100',
                // Keep the known-working MiAir RAOP declaration.
                vn: '65537',
                vs: '105.1',
                da: 'true',
                sf: '0x4',
                pw: 'false',
                fn: this.options.name,
                // MiAir audio/PCM/ALAC/RSA/legacy flags, without AAC (not implemented here).
                ft: '0x' + ((1 << 9) | (1 << 14) | (1 << 18) | (1 << 19) | (1 << 22) | (1 << 23) | (1 << 27)).toString(16).toUpperCase(),
                txtvers: '1',
                am: this.options.model ?? 'sonn',
            },
        };
    }
    stop() {
        for (const [socket, session] of this.sessions) {
            this.teardown(session);
            socket.destroy();
        }
        this.sessions.clear();
        this.activeSession = null;
        this.server?.close();
        this.server = null;
    }
    onConnection(socket) {
        if (this.sessions.size >= 8) { this.options.onProtocol?.({ event: 'busy' }); socket.destroy(); return; }
        socket.setNoDelay(true);
        socket.on('error', () => socket.destroy());
        const session = {
            connectionId: ++this.connectionSequence,
            alac: null,
            aesKey: null,
            aesIv: null,
            decoder: null,
            fpKeyMessage: null,
            audio: null,
            control: null,
            timing: null,
            senderTimingPort: 0,
            senderControlPort: 0,
            senderAddress: socket.remoteAddress?.replace(/^::ffff:/, '') ?? '',
            socket,
            dacpId: null,
            activeRemote: null,
        };
        this.sessions.set(socket, session);
        this.options.onProtocol?.({ event: 'connected', connectionId: session.connectionId });
        let buffer = Buffer.alloc(0);
        socket.on('data', (chunk) => {
            buffer = Buffer.concat([buffer, chunk]);
            if (buffer.length > 1114112) { socket.destroy(); return; }
            for (;;) {
                const headerEnd = buffer.indexOf('\r\n\r\n');
                if (headerEnd < 0) {
                    return;
                }
                if (headerEnd > 65536) { socket.destroy(); return; }
                const head = buffer.subarray(0, headerEnd).toString('utf8');
                const lines = head.split('\r\n');
                const headers = new Map();
                for (const line of lines.slice(1)) {
                    const sep = line.indexOf(':');
                    if (sep > 0) {
                        headers.set(line.slice(0, sep).trim().toLowerCase(), line.slice(sep + 1).trim());
                    }
                }
                const length = Number(headers.get('content-length') ?? '0');
                if (!Number.isInteger(length) || length < 0 || length > 1048576) { socket.destroy(); return; }
                if (buffer.length < headerEnd + 4 + length) {
                    return;
                }
                const body = buffer.subarray(headerEnd + 4, headerEnd + 4 + length);
                buffer = buffer.subarray(headerEnd + 4 + length);
                try { this.handleRequest(socket, session, lines[0] ?? '', headers, Buffer.from(body)); }
                catch (e) {
                    this.options.onProtocol?.({ event: 'request-failed', connectionId: session.connectionId, code: e.code || (e instanceof RangeError ? 'INVALID_CODEC_DATA' : 'INVALID_REQUEST') });
                    socket.destroy();
                }
            }
        });
        socket.on('close', () => {
            const state = this.sessions.get(socket);
            if (state) {
                if (state.reportedConnection) this.onEvent({ type: 'connection', connected: false, connectionId: state.connectionId });
                this.teardown(state);
                this.sessions.delete(socket);
                if (this.activeSession === state) {
                    this.activeSession = null; this.onEvent({ type: 'stop', connectionId: state.connectionId });
                }
                this.options.onProtocol?.({ event: 'disconnected', connectionId: session.connectionId, received: this.counters.received, decoded: this.counters.framesDecoded, undecodable: this.counters.undecodable });
            }
        });
        socket.on('error', () => {
            /* the close handler does the cleanup */
        });
    }
    reportConnection(session) {
        const sender = { address: session.senderAddress, name: session.deviceName || '', userAgent: session.userAgent || '' };
        const signature = JSON.stringify(sender);
        if (session.reportedConnection === signature) return;
        session.reportedConnection = signature;
        this.onEvent({ type: 'connection', connected: true, connectionId: session.connectionId, sender });
    }
    reply(socket, cseq, extra = {}, body, status = 200) {
        const headers = {
            CSeq: cseq,
            Server: 'AirTunes/105.1',
            // Senders check this to know the receiver actually has an output; without
            // it an iPhone retries OPTIONS a few times and gives up before it ever
            // gets as far as ANNOUNCE.
            'Audio-Jack-Status': 'connected; type=analog',
            'Apple-Jack-Status': 'connected; type=analog',
            'Content-Length': String(body?.length || 0),
            ...extra,
        };
        if (body) {
            headers['Content-Length'] = String(body.length);
        }
        const text = Object.entries(headers)
            .map(([key, value]) => `${key}: ${value}`)
            .join('\r\n');
        const reason = { 200: 'OK', 453: 'Not Enough Bandwidth', 455: 'Method Not Valid in This State' }[status] || 'Error';
        socket.write(Buffer.concat([Buffer.from(`RTSP/1.0 ${status} ${reason}\r\n${text}\r\n\r\n`), body || Buffer.alloc(0)]), error => {
            this.options.onProtocol?.({ event: error ? 'response-failed' : 'response-sent', connectionId: this.sessions.get(socket)?.connectionId, status, bodyBytes: body?.length || 0 });
        });
    }
    handleRequest(socket, session, requestLine, headers, body) {
        const [method = '', target = ''] = requestLine.split(' ');
        const path = ['/fp-setup', '/auth-setup', '/pair-setup', '/pair-verify', '/info'].includes(target) ? target : 'stream';
        const cseq = headers.get('cseq') ?? '0';
        const clean = value => typeof value === 'string' ? value.replace(/[\x00-\x1f\x7f]/g, '').trim().slice(0, 128) : '';
        // Apple senders commonly use Client-Name; Device-Name is also used by
        // compatible clients. Neither is the software's User-Agent identity.
        const deviceName = clean(headers.get('x-apple-client-name')) || clean(headers.get('x-apple-device-name'));
        if (deviceName) session.deviceName = deviceName;
        if (headers.has('user-agent')) session.userAgent = clean(headers.get('user-agent'));
        if (session.reportedConnection && method !== 'TEARDOWN') this.reportConnection(session);
        this.options.onRequest?.({
            method,
            connectionId: session.connectionId,
            appleChallenge: headers.has('apple-challenge'),
            path, bodyBytes: body.length,
            keyTransport: body.includes('a=fpaeskey:') ? 'fairplay' : body.includes('a=rsaaeskey:') ? 'rsa' : 'none',
            ...(method === 'ANNOUNCE' ? { codec: /AppleLossless/i.test(body.toString()) ? 'ALAC' : /L16\//.test(body.toString()) ? 'L16' : 'unknown' } : {}),
        });
        // Every request carries these; keep the latest so a remote command can be
        // sent at any point in the session.
        const dacpId = headers.get('dacp-id');
        const activeRemote = headers.get('active-remote');
        if (dacpId && dacpId !== session.dacpId) {
            session.dacpId = dacpId;
            session.activeRemote = activeRemote ?? session.activeRemote;
            this.onEvent({ type: 'remote', dacpId, activeRemote: session.activeRemote ?? '' });
        }
        else if (activeRemote) {
            session.activeRemote = activeRemote;
        }
        // A sender may demand proof we hold the AirPort key before it will stream.
        const extra = {};
        const challenge = headers.get('apple-challenge');
        if (challenge) {
            extra['Apple-Response'] = answerChallenge(Buffer.from(challenge, 'base64'), socket.localAddress?.replace(/^::ffff:/, '') ?? '', this.mac);
        }
        switch (method) {
            case 'POST':
                if (path === '/fp-setup') {
                    const response = fairplaySetup(body);
                    session.fpKeyMessage?.fill(0);
                    session.fpKeyMessage = body.length === 164 ? Buffer.from(body) : null;
                    this.reportConnection(session);
                    this.reply(socket, cseq, { ...extra, 'Content-Type': 'application/octet-stream' }, response);
                } else this.reply(socket, cseq, extra);
                return;
            case 'OPTIONS':
                this.reportConnection(session);
                this.reply(socket, cseq, {
                    ...extra,
                    Public: 'ANNOUNCE, SETUP, RECORD, PAUSE, FLUSH, FLUSHBUFFERED, TEARDOWN, OPTIONS, POST, GET, PUT, SETPEERSX, SETMAGICCOOKIE, GET_PARAMETER, SET_PARAMETER',
                });
                return;
            case 'ANNOUNCE':
                if (this.activeSession && this.activeSession !== session) {
                    this.reply(socket, cseq, extra, undefined, 453); return;
                }
                this.handleAnnounce(session, body.toString('utf8'));
                this.activeSession = session;
                this.reportConnection(session);
                this.reply(socket, cseq, extra);
                return;
            case 'SETUP':
                if (this.activeSession !== session) { this.reply(socket, cseq, extra, undefined, 455); return; }
                void this.handleSetup(socket, session, headers, cseq, extra).catch(() => {
                    this.options.onProtocol?.({ event: 'setup-failed' }); socket.destroy();
                });
                return;
            case 'RECORD':
                if (this.activeSession !== session || !session.audio) { this.reply(socket, cseq, extra, undefined, 455); return; }
                this.onEvent({ type: 'play', connectionId: session.connectionId, sender: {
                    address: socket.remoteAddress?.replace(/^::ffff:/, '') || '',
                    name: session.deviceName || '',
                    userAgent: session.userAgent || '',
                } });
                this.reply(socket, cseq, { ...extra, 'Audio-Latency': '0', 'RTP-Info': `seq=${Math.max(0, this.lastSeq)};rtptime=${Math.max(0, this.lastTs)}` });
                return;
            case 'PAUSE':
                if (this.activeSession === session) this.onEvent({ type: 'pause', connectionId: session.connectionId });
                this.reply(socket, cseq, extra); return;
            case 'FLUSHBUFFERED':
            case 'FLUSH':
                if (this.activeSession === session) this.onEvent({ type: 'flush' });
                this.reply(socket, cseq, { ...extra, 'RTP-Info': `seq=${Math.max(0, this.lastSeq)};rtptime=${Math.max(0, this.lastTs)}` });
                return;
            case 'TEARDOWN':
                // This tears down the media session, not necessarily the RTSP
                // TCP/control connection. Only socket.close removes the peer.
                this.teardown(session);
                if (this.activeSession === session) { this.activeSession = null; this.onEvent({ type: 'stop', connectionId: session.connectionId }); }
                this.reply(socket, cseq, extra);
                return;
            case 'SET_PARAMETER':
                this.handleSetParameter(session, headers, body);
                this.reply(socket, cseq, extra);
                return;
            case 'GET_PARAMETER':
                this.reply(socket, cseq, { ...extra, 'Content-Type': 'text/parameters' }, Buffer.from(`volume: ${this.volume.toFixed(6)}\r\n`, 'utf8'));
                return;
            default:
                this.reply(socket, cseq, extra);
        }
    }
    /** Read the codec parameters, and the AES key when the sender encrypted one. */
    handleAnnounce(session, sdp) {
        session.aesKey?.fill(0); session.aesIv?.fill(0);
        session.aesKey = null; session.aesIv = null; session.alac = null; session.decoder = null;
        let fairplayKey;
        session.pcm = /a=rtpmap:\d+ L16\/44100\/2/i.test(sdp);
        for (const line of sdp.split(/\r?\n/)) {
            if (line.startsWith('i=') && !session.deviceName) {
                session.deviceName = line.slice(2).replace(/[\x00-\x1f\x7f]/g, '').trim().slice(0, 128);
            }
            else if (line.startsWith('a=fmtp:')) {
                session.alac = parseAlacFmtp(line.slice(line.indexOf(' ') + 1));
            }
            else if (line.startsWith('a=rsaaeskey:')) {
                const wrapped = Buffer.from(base64Pad(line.slice('a=rsaaeskey:'.length)), 'base64');
                session.aesKey = decryptAesKey(wrapped);
            }
            else if (line.startsWith('a=aesiv:')) {
                session.aesIv = Buffer.from(base64Pad(line.slice('a=aesiv:'.length)), 'base64');
            }
            else if (line.startsWith('a=fpaeskey:')) {
                fairplayKey = Buffer.from(base64Pad(line.slice('a=fpaeskey:'.length)), 'base64');
            }
        }
        if (fairplayKey) {
            try {
                if (session.aesKey) throw Object.assign(new Error('Ambiguous audio key'), { code: 'INVALID_FAIRPLAY_KEY' });
                session.aesKey = unwrapFairplayKey(session.fpKeyMessage, fairplayKey);
            } finally { fairplayKey.fill(0); }
        }
        if (session.alac) {
            session.decoder = new AlacDecoder(session.alac);
        }
        if (session.aesKey && session.aesKey.length !== 16 || session.aesIv && session.aesIv.length !== 16) throw new Error('Invalid audio key');
    }
    async handleSetup(socket, session, headers, cseq, extra) {
        const transport = headers.get('transport') ?? '';
        const field = (name) => {
            const match = new RegExp(`${name}=(\\d+)`).exec(transport);
            return match ? Number(match[1]) : 0;
        };
        session.senderControlPort = field('control_port');
        session.senderTimingPort = field('timing_port');
        const audio = createSocket({ type: 'udp4', reuseAddr: true });
        const control = createSocket({ type: 'udp4', reuseAddr: true });
        const timing = createSocket({ type: 'udp4', reuseAddr: true });
        audio.on('message', (msg) => this.onAudio(session, msg));
        control.on('message', (msg) => this.onControl(session, msg));
        await Promise.all([bind(audio, this.options.host), bind(control, this.options.host), bind(timing, this.options.host)]);
        session.audio = audio;
        session.control = control;
        session.timing = timing;
        // Poll the sender's clock: on RAOP the sender owns the timeline and we
        // follow it, the exact inverse of this package's sending side.
        if (session.senderTimingPort) {
            this.startTimingClient(session);
        }
        this.onEvent({ type: 'stream', port: audio.address().port });
        this.reply(socket, cseq, {
            ...extra,
            Transport: `RTP/AVP/UDP;unicast;mode=record;server_port=${audio.address().port};` +
                `control_port=${control.address().port};timing_port=${timing.address().port}`,
            Session: '1',
        });
    }
    /**
     * Ask the sender to send a run of packets again.
     *
     * Not a standard RTCP NACK: eight bytes, type 0x55, carrying the first
     * missing sequence number and how many follow. Without this a receiver simply
     * keeps whatever holes the network left, and on a link with any loss that is
     * the difference between clean audio and a hiccup every few seconds.
     */
    requestResend(session, first, count) {
        // A silly range means a blackout or a seek, not loss worth chasing.
        if (!session.control || !session.senderControlPort || count > MAX_RESEND_RUN) {
            return;
        }
        const req = Buffer.alloc(8);
        req[0] = 0x80;
        req[1] = 0x55 | 0x80;
        req.writeUInt16BE(1, 2);
        req.writeUInt16BE(first, 4);
        req.writeUInt16BE(count, 6);
        this.counters.resendsAsked += count;
        session.control.send(req, session.senderControlPort, session.senderAddress);
    }
    /**
     * The control port carries two different things and they must not be
     * confused: a retransmit reply (type 0xD6) wraps a real audio packet behind a
     * four-byte header, while a sync packet (0xD4) is the sender telling us where
     * its timeline is. Feeding the latter to the decoder produces exactly what it
     * sounds like.
     */
    onControl(session, msg) {
        if (msg.length < 4) {
            return;
        }
        const type = msg[1] & 0x7f;
        if (type === 0x56) {
            this.onAudio(session, msg.subarray(4), true);
        }
        // 0x54 is the sync packet; the timeline it announces is not used yet.
    }
    /** Ask the sender for the time, the same 0xD2/0xD3 exchange we answer as a sender. */
    startTimingClient(session) {
        const poll = () => {
            if (!session.timing) {
                return;
            }
            const request = Buffer.alloc(32);
            request[0] = 0x80;
            request[1] = 0xd2;
            request.writeUInt16BE(0x0007, 2);
            const now = ntpNow();
            request.writeUInt32BE(Number(now >> 32n), 24);
            request.writeUInt32BE(Number(now & 0xffffffffn), 28);
            session.timing.send(request, session.senderTimingPort, session.senderAddress);
        };
        poll();
        const timer = setInterval(poll, 3000);
        session.timing?.on('close', () => clearInterval(timer));
    }
    /**
     * One audio packet: strip the RTP header, decrypt when the sender encrypted,
     * decode, and hand the PCM up.
     *
     * AES here is CBC over whole 16-byte blocks only — the tail of the payload is
     * left in the clear, which is what the format specifies and what a decoder
     * that assumes otherwise gets wrong.
     */
    onAudio(session, packet, retransmitted = false) {
        if (packet.length <= 12 || !session.pcm && (!session.decoder || !session.alac)) {
            return;
        }
        if (retransmitted) {
            this.counters.retransmitted += 1;
        }
        else {
            const seq = packet.readUInt16BE(2);
            if (this.lastSeq >= 0) {
                // 16-bit wrap, and a retransmit arriving late reads as a jump backwards.
                const delta = (seq - this.lastSeq) & 0xffff;
                if (delta > 1 && delta < 0x8000) {
                    this.counters.missed += delta - 1;
                    this.requestResend(session, (this.lastSeq + 1) & 0xffff, delta - 1);
                }
            }
            // What the sender says each packet is worth, which need not match what we
            // decode out of it -- and that difference is exactly the kind that goes
            // unnoticed, since neither a gap nor a decode failure shows up.
            const ts = packet.readUInt32BE(4);
            if (this.lastTs >= 0) {
                const step = (ts - this.lastTs) >>> 0;
                if (step > 0 && step < 0x8000) {
                    this.counters.framesAnnounced += step;
                }
            }
            this.lastTs = ts;
            this.lastSeq = seq;
            this.counters.received += 1;
        }
        let payload = packet.subarray(12);
        if (session.aesKey && session.aesIv) {
            const whole = payload.length - (payload.length % 16);
            if (whole > 0) {
                const decipher = createDecipheriv('aes-128-cbc', session.aesKey, session.aesIv);
                decipher.setAutoPadding(false);
                const clear = Buffer.concat([decipher.update(payload.subarray(0, whole)), decipher.final()]);
                payload = Buffer.concat([clear, payload.subarray(whole)]);
            }
        }
        let pcm;
        try {
            pcm = session.pcm ? Buffer.from(payload).swap16() : session.decoder?.decode(payload);
        } catch { this.counters.undecodable++; return; }
        if (!pcm) {
            this.counters.undecodable += 1;
        }
        if (pcm) {
            this.counters.framesDecoded += pcm.length / ((session.alac?.channels ?? 2) * 2);
            this.onEvent({
                type: 'pcm',
                sampleRate: session.alac?.sampleRate ?? 44100,
                channels: session.alac?.channels ?? 2,
                data: pcm,
            });
        }
    }
    /** Volume, track metadata and cover art all arrive on SET_PARAMETER. */
    handleSetParameter(session, headers, body) {
        const contentType = headers.get('content-type') ?? '';
        if (contentType.startsWith('text/parameters')) {
            const text = body.toString('utf8');
            // `progress: <start>/<current>/<end>`, all three in RTP ticks at the
            // stream's own sample rate. Converting here keeps the caller from having
            // to know the unit, and the sender is the only party that knows where in
            // the track it is -- nothing in the audio itself carries that.
            const progress = /progress:\s*(\d+)\/(\d+)\/(\d+)/.exec(text);
            if (progress) {
                const rate = session.alac?.sampleRate ?? 44100;
                const start = Number(progress[1]);
                const current = Number(progress[2]);
                const end = Number(progress[3]);
                this.onEvent({
                    type: 'progress',
                    elapsedMs: Math.max(0, Math.round(((current - start) / rate) * 1000)),
                    durationMs: Math.max(0, Math.round(((end - start) / rate) * 1000)),
                });
            }
            const match = /volume:\s*(-?[\d.]+)/.exec(text);
            if (match) {
                this.volume = Number(match[1]);
                // The wire scale is dB from -30 to 0, with -144 for mute.
                this.onEvent({ type: 'volume', value: this.volume });
            }
            return;
        }
        if (contentType.startsWith('image/')) {
            this.onEvent({ type: 'artwork', contentType, data: trimImage(contentType, body) });
            return;
        }
        if (contentType.includes('dmap')) {
            this.onEvent({ type: 'metadata', ...parseDmap(body) });
        }
    }
    teardown(session) {
        session.audio?.close();
        session.control?.close();
        session.timing?.close();
        session.audio = session.control = session.timing = null;
        session.decoder = null;
        session.aesKey?.fill(0); session.aesIv?.fill(0); session.fpKeyMessage?.fill(0);
        session.aesKey = session.aesIv = session.fpKeyMessage = null;
    }
}
/**
 * Send a transport command back to the device that is streaming to us.
 *
 * The sender publishes an `_dacp._tcp` service named `iTunes_Ctrl_<DACP-ID>`;
 * resolving that is the caller's job (this package carries no mDNS), and the
 * address it finds goes in here. The request itself is a bare HTTP GET carrying
 * the `Active-Remote` token as its only credential.
 */
export async function sendRemoteCommand(host, port, activeRemote, command, timeoutMs = 3000) {
    return new Promise((resolve) => {
        const socket = connectTcp({ host, port });
        let settled = false;
        const finish = (ok) => {
            if (!settled) {
                settled = true;
                socket.destroy();
                resolve(ok);
            }
        };
        const timer = setTimeout(() => finish(false), timeoutMs);
        socket.once('connect', () => {
            socket.write(`GET /ctrl-int/1/${command} HTTP/1.0\r\n` +
                `Active-Remote: ${activeRemote}\r\n` +
                `Connection: close\r\n\r\n`);
        });
        socket.once('data', (chunk) => {
            clearTimeout(timer);
            finish(/^HTTP\/1\.[01] 2\d\d/.test(chunk.toString('latin1')));
        });
        socket.once('error', () => {
            clearTimeout(timer);
            finish(false);
        });
        socket.once('close', () => {
            clearTimeout(timer);
            finish(false);
        });
    });
}
async function bind(socket, host) {
    await new Promise((resolve, reject) => {
        socket.once('error', reject);
        socket.bind(0, host, () => {
            socket.removeListener('error', reject);
            resolve();
        });
    });
}
/** SDP strips base64 padding; Node's decoder wants it back. */
function base64Pad(value) {
    const trimmed = value.trim();
    return trimmed + '='.repeat((4 - (trimmed.length % 4)) % 4);
}
/**
 * Pull the track fields out of a DMAP blob. The container is a tag, a 32-bit
 * length and a payload, nested — only the three fields a now-playing display
 * needs are read.
 */
/**
 * Cut a fixed-size artwork body down to the image it carries.
 *
 * iOS declares a Content-Length of exactly 180224 bytes for every cover and
 * leaves whatever was in that slot after the image's own end marker -- around
 * 78 KB of it. Decoders stop at the marker, so it renders either way, but
 * passing the tail on means every consumer stores and serves it too, and a
 * stricter one may refuse the file outright.
 */
function trimImage(contentType, body) {
    if (!contentType.startsWith('image/jpeg') || body.length < 4) {
        return body;
    }
    if (body.readUInt16BE(0) !== 0xffd8) {
        return body;
    }
    const end = body.lastIndexOf(Buffer.from([0xff, 0xd9]));
    return end > 0 && end + 2 < body.length ? body.subarray(0, end + 2) : body;
}
function parseDmap(body) {
    const out = {};
    const walk = (buffer) => {
        let offset = 0;
        while (offset + 8 <= buffer.length) {
            const tag = buffer.subarray(offset, offset + 4).toString('latin1');
            const length = buffer.readUInt32BE(offset + 4);
            const value = buffer.subarray(offset + 8, offset + 8 + length);
            if (tag === 'mlit') {
                walk(value);
            }
            else if (tag === 'minm') {
                out.title = value.toString('utf8');
            }
            else if (tag === 'asar') {
                out.artist = value.toString('utf8');
            }
            else if (tag === 'asal') {
                out.album = value.toString('utf8');
            }
            else if (tag === 'astm' && length === 4) {
                // daap.songtime, in milliseconds. Worth having even though `progress`
                // carries a length too: this one arrives with every track's metadata,
                // where progress is sent sparsely -- so it is the only length a
                // receiver can count on seeing for each track.
                const ms = value.readUInt32BE(0);
                if (ms > 0) {
                    out.durationMs = ms;
                }
            }
            offset += 8 + length;
        }
    };
    walk(body);
    return out;
}
