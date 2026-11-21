import http from 'node:http';
import os from 'node:os';
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import createBonjour from 'bonjour';
import { AirPlayReceiver } from './vendor/receiver.js';
import { SenderNames } from './sender-names.mjs';

export function lanAddress(interfaces = os.networkInterfaces()) {
    const choices = Object.entries(interfaces).filter(([name]) => !/^(utun|tun|tap|awdl|llw|docker|veth)/i.test(name))
        .flatMap(([, entries]) => entries || []).filter(e => !e.internal && (e.family === 'IPv4' || e.family === 4));
    const selected = choices.find(e => /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(e.address));
    if (!selected) throw new Error('未找到可用的局域网 IPv4 地址');
    return selected.address;
}
function wavHeader() {
    const b = Buffer.alloc(44); b.write('RIFF'); b.writeUInt32LE(0x7fffff00 + 36, 4); b.write('WAVEfmt ', 8);
    b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(2, 22); b.writeUInt32LE(44100, 24);
    b.writeUInt32LE(176400, 28); b.writeUInt16LE(4, 32); b.writeUInt16LE(16, 34); b.write('data', 36); b.writeUInt32LE(0x7fffff00, 40);
    return b;
}
export class Receiver {
    constructor({ ip, accountId, speaker, onEvent, advertise = true, output }) {
        Object.assign(this, { ip, speaker, onEvent, advertise, output });
        if (output) output.stream = { write: frame => this.deliverPCM(frame) };
        this.key = randomBytes(24).toString('base64url'); this.sid = 0; this.active = false; this.queue = []; this.bytes = 0;
        this.clients = new Set();
        this.senderConnections = new Map();
        const mac = createHash('sha256').update(`${accountId}:${speaker.id}`).digest().subarray(0, 6); mac[0] = mac[0] & 0xfe | 2;
        const diagnostic = (phase, detail) => onEvent({ type: 'diagnostic', id: speaker.id, phase, ...detail });
        this.raop = new AirPlayReceiver({ name: speaker.name, model: 'AirPort4,107', mac, host: ip,
            onRequest: detail => diagnostic('rtsp-request', detail),
            onProtocol: detail => diagnostic('rtsp-session', detail),
        }, event => this.event(event));
        this.http = http.createServer((req, res) => this.request(req, res));
        this.http.on('clientError', (_e, socket) => socket.destroy());
    }
    get url() { return `http://${this.ip}:${this.port}/airplay/${this.key}/${this.sid}/stream.wav`; }
    async start() {
        try {
            await new Promise((resolve, reject) => { this.http.once('error', reject); this.http.listen(0, this.ip, resolve); });
            this.port = this.http.address().port;
            this.ad = await this.raop.start();
            if (this.advertise) {
                // Listen for multicast queries on the wildcard socket; select the LAN
                // interface for membership/outgoing packets, not the receive bind address.
                this.bonjour = createBonjour({ interface: this.ip, bind: '0.0.0.0' });
                this.senderNames = new SenderNames(this.bonjour._server.mdns);
                const host = `semi-airplay-${this.ad.instanceName.split('@')[0].toLowerCase()}.local`;
                this.service = this.bonjour.publish({ name: this.ad.instanceName, host, type: 'raop', protocol: 'tcp', port: this.ad.port, txt: this.ad.txt, probe: true });
                const records = this.service._records.bind(this.service);
                this.service._records = () => [
                    ...records().filter(r => !['A', 'AAAA'].includes(r.type)).map(r => ({
                        ...r, ...(r.type === 'PTR' ? {} : { flush: true }),
                        // dns-packet 5 expects an array of raw TXT strings. bonjour 3's
                        // pre-encoded Buffer would get wrapped as one malformed TXT item.
                        ...(r.type === 'TXT' ? { data: Object.entries(this.ad.txt).map(([key, value]) => Buffer.from(`${key}=${value}`)) } : {}),
                    })),
                    { name: host, type: 'A', ttl: 120, flush: true, data: this.ip },
                ];
                await new Promise((resolve, reject) => {
                    const timer = setTimeout(() => reject(new Error('AirPlay 设备发布超时')), 10000);
                    this.service.once('up', () => { clearTimeout(timer); resolve(); });
                    this.service.once('error', e => { clearTimeout(timer); reject(e); });
                    this.bonjour._server.mdns.on('error', e => { clearTimeout(timer); reject(e); });
                });
                this.onEvent({ type: 'diagnostic', id: this.speaker.id, phase: 'published', address: this.ip,
                    service: this.service.fqdn, host, port: this.ad.port, txt: this.ad.txt });
            }
            return this;
        } catch (e) { await this.stop(); throw e; }
    }
    event(event) {
        if (event.type === 'connection') {
            const previous = this.senderConnections.get(event.connectionId);
            previous?.cancel?.();
            this.senderConnections.delete(event.connectionId);
            this.onEvent({ ...event, id: this.speaker.id });
            if (event.connected) {
                const connection = { event };
                this.senderConnections.set(event.connectionId, connection);
                if (!event.sender.name && this.senderNames) connection.cancel = this.senderNames.watch(event.sender.address, name => {
                    if (this.senderConnections.get(event.connectionId) !== connection) return;
                    this.onEvent({ ...event, sender: { ...event.sender, name, nameSource: 'bonjour' }, id: this.speaker.id });
                });
            }
        } else if (event.type === 'pcm') {
            if (!this.active || event.sampleRate !== 44100 || event.channels !== 2) return;
            if (this.output) this.output.write(event.data).catch(error => {
                if (!this.outputFailed) { this.outputFailed = true; this.onEvent({ type: 'output-error', id: this.speaker.id, message: error.message }); }
            });
            else this.deliverPCM(event.data);
        } else if (event.type === 'play') {
            if (this.active) return;
            this.active = true; this.sid++; this.queue = []; this.bytes = 0;
            this.onEvent({ type: 'play', id: this.speaker.id, url: this.url, sender: event.sender, connectionId: event.connectionId });
        } else if (event.type === 'flush') { this.queue = []; this.bytes = 0; }
        else if (event.type === 'stop' || event.type === 'pause') {
            if (!this.active) return;
            this.active = false; for (const client of this.clients) client.end();
            this.onEvent({ type: 'stop', id: this.speaker.id, connectionId: event.connectionId });
        } else if (event.type === 'volume') this.onEvent({ type: 'volume', id: this.speaker.id, value: event.value });
    }
    deliverPCM(data) {
        if (!this.clients.size) {
            this.queue.push(data); this.bytes += data.length;
            while (this.bytes > 512 * 1024) this.bytes -= this.queue.shift().length;
        } else for (const client of this.clients) {
            if (client.writableLength > 512 * 1024) client.destroy(); else client.write(data);
        }
    }
    request(req, res) {
        const match = req.url.match(/^\/airplay\/([-\w]{32})\/(\d+)\/stream\.wav$/);
        const valid = match && timingSafeEqual(Buffer.from(match[1]), Buffer.from(this.key));
        if (!valid || !this.active || match[2] !== String(this.sid) || !['GET', 'HEAD'].includes(req.method)) {
            res.writeHead(404); res.end(); return;
        }
        this.onEvent({ type: 'diagnostic', id: this.speaker.id, phase: req.method.toLowerCase() });
        res.writeHead(200, { 'Content-Type': 'audio/wav', 'Cache-Control': 'no-store', Connection: 'close' });
        if (req.method === 'HEAD') { res.end(); return; }
        if (this.clients.size) for (const client of this.clients) client.destroy();
        this.clients.add(res); res.on('close', () => this.clients.delete(res));
        res.write(wavHeader()); for (const chunk of this.queue) res.write(chunk);
        this.queue = []; this.bytes = 0;
    }
    async stop() {
        for (const connection of this.senderConnections.values()) connection.cancel?.();
        this.senderConnections.clear(); this.senderNames?.dispose();
        this.active = false; this.raop.stop();
        for (const client of this.clients) client.destroy(); this.clients.clear();
        this.http.closeAllConnections(); this.http.close();
        if (this.service?._activated) await new Promise(resolve => { const timer = setTimeout(resolve, 500); this.service.stop(() => { clearTimeout(timer); resolve(); }); });
        this.bonjour?.destroy();
    }
}
