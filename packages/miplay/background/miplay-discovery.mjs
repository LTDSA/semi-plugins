import createBonjour from 'bonjour';
import { EventEmitter } from 'node:events';
import { isIPv4 } from 'node:net';
import { createHash } from 'node:crypto';
import { createSocket } from 'node:dgram';
import dnsPacket from 'dns-packet';
import { MiPlayControl } from './miplay-session.mjs';
import { MIPLAY_SERVICES, MiPlayDnsRecords } from './miplay-dns.mjs';

function rejectionReason(service, localAddress) {
    const txt = service.txt || {};
    const apps = String(txt.apps || '').replace(/^\[|\]$/g, '').split(',').map(value => value.trim());
    const type = service.type || MIPLAY_SERVICES.find(type => String(service.fqdn || '').replace(/\.$/, '').endsWith(`.${type}`));
    if (type !== '_miplay_audio._tcp.local' && !apps.includes('5') &&
        !(type === '_lyra-mdns._udp.local' && (txt.appdata || txt.AppData))) return '未声明 MiPlay 音频能力';
    const address = (service.addresses || []).find(value => isIPv4(value) && /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(value));
    if (!address) return '尚无可用的局域网 IPv4 地址';
    if (address === localAddress) return '本机广播';
    return null;
}

export function discoveryCandidate(service, localAddress) {
    const txt = service.txt || {};
    if (rejectionReason(service, localAddress)) return null;
    const address = (service.addresses || []).find(value => isIPv4(value) && /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(value));
    if (!address || address === localAddress) return null;
    // SRV/port advertises MiConnect discovery, not the legacy control port.
    // Do not connect arbitrary advertised ports or treat mico.device_id as MiNA ID.
    const id = `miplay:${createHash('sha256').update(String(service.fqdn || service.name) + ':' + address).digest('hex').slice(0, 24)}`;
    return { id, name: String(txt.name || service.name || 'MiPlay 音箱').slice(0, 200), address, localAddress, controlPort: 8899 };
}
export class MiPlayDiscovery extends EventEmitter {
    constructor({ ip, createControl = () => new MiPlayControl() }) {
        super(); Object.assign(this, { ip, createControl }); this.devices = new Map(); this.present = new Set(); this.pending = new Map(); this.controls = new Set(); this.queue = []; this.running = 0; this.closed = false;
        this.startedAt = Date.now();
        this.announcements = new Map();
        this.records = new MiPlayDnsRecords(); this.observations = new Map(); this.queries = new Map();
    }
    start() {
        this.bonjour = createBonjour({ interface: this.ip, bind: '0.0.0.0' });
        const mdns = this.bonjour._server.mdns;
        const failure = error => this.emit('diagnostic', { phase: 'miplay-discovery', result: 'network-error', message: String(error.code || error.message).slice(0, 200) });
        mdns.on('error', failure);
        mdns.on('response', (packet, info) => this.received(packet, info?.address));
        // Some Xiaomi discovery responders only answer QU queries to the
        // requester's source port. Keep a separate ephemeral socket for those.
        this.unicast = createSocket('udp4');
        this.unicast.on('error', failure);
        this.unicast.on('message', (data, info) => {
            if (data.length > 65535) return;
            try { const packet = dnsPacket.decode(data); if (packet.type === 'response') this.received(packet, info.address); } catch {}
        });
        this.unicast.bind(0, this.ip, () => {
            if (this.closed) return;
            this.unicast.setMulticastInterface(this.ip); this.unicast.setMulticastTTL(255); this.query();
        });
        this.timer = setInterval(() => { this.received({}); this.query(); }, 5000);
        this.timer.unref?.();
        this.query();
    }
    query(questions = MIPLAY_SERVICES.map(name => ({ name, type: 'PTR' }))) {
        if (this.closed) return;
        const now = Date.now();
        questions = questions.filter(question => {
            const key = `${question.type}:${question.name}`;
            if (now - (this.queries.get(key) || 0) < 2000) return false;
            if (this.queries.size >= 256) this.queries.delete(this.queries.keys().next().value);
            this.queries.set(key, now); return true;
        });
        if (!questions.length) return;
        this.bonjour?._server.mdns.query(questions);
        if (this.unicast) {
            // dns-packet does not encode QU; set the IN class high bit in each
            // independent single-question packet, without changing DNS names.
            for (const question of questions) {
                const data = dnsPacket.encode({ type: 'query', questions: [question] });
                data.writeUInt16BE(0x8001, data.length - 2);
                this.unicast.send(data, 5353, '224.0.0.251', () => {});
            }
        }
    }
    received(packet, source) {
        if (this.closed) return;
        const services = this.records.ingest(packet, source), ids = new Set(), names = new Set();
        for (const service of services) {
            names.add(service.fqdn);
            const candidate = discoveryCandidate(service, this.ip);
            if (candidate) ids.add(candidate.id);
            this.found(service);
            const questions = [];
            if (!service.hasSrv) questions.push({ name: service.fqdn, type: 'SRV' });
            if (!service.hasTxt) questions.push({ name: service.fqdn, type: 'TXT' });
            if (service.host) questions.push({ name: service.host, type: 'A' });
            this.query(questions);
        }
        let changed = false;
        for (const id of this.present) if (!ids.has(id)) {
            this.present.delete(id); this.devices.delete(id); this.announcements.delete(id); changed = true;
        }
        for (const name of this.observations.keys()) if (!names.has(name)) this.observations.delete(name);
        if (changed) this.emit('changed');
    }
    found(service) {
        if (this.closed) return;
        const candidate = discoveryCandidate(service, this.ip);
        const observation = { name: service.name, service: service.type || service.fqdn, addresses: service.addresses,
            ...(Number.isInteger(service.port) ? { advertisedPort: service.port } : {}),
            ...(service.txt?.apps === undefined ? {} : { apps: String(service.txt.apps) }),
            status: candidate ? 'observed' : 'filtered', ...(candidate ? {} : { reason: rejectionReason(service, this.ip) }) };
        const observationKey = service.fqdn || service.name;
        if (this.observations.has(observationKey) || this.observations.size < 64) {
            const changed = JSON.stringify(this.observations.get(observationKey)) !== JSON.stringify(observation);
            this.observations.set(observationKey, observation);
            if (changed && !candidate) this.emit('changed');
        }
        if (candidate && !this.announcements.has(candidate.id) && this.announcements.size >= 64) return;
        if (candidate) this.present.add(candidate.id);
        if (!candidate || this.closed || this.devices.has(candidate.id) || this.pending.has(candidate.id) || this.pending.size >= 64) return;
        if (Date.now() - (this.announcements.get(candidate.id)?.failedAt || 0) < 30000) return;
        const txt = service.txt || {};
        this.announcements.set(candidate.id, { id: candidate.id, name: candidate.name, address: candidate.address,
            ...(service.type || service.fqdn ? { service: service.type || service.fqdn } : {}),
            ...(Number.isInteger(service.port) ? { advertisedPort: service.port } : {}),
            ...(txt.apps === undefined ? {} : { apps: String(txt.apps) }),
            ...(txt.version === undefined ? {} : { version: String(txt.version) }),
            ...(txt.sec === undefined ? {} : { sec: String(txt.sec) }), status: 'probing' });
        let finish;
        const promise = new Promise(resolve => { finish = resolve; });
        this.pending.set(candidate.id, promise);
        this.queue.push(async () => {
            if (this.closed) { this.pending.delete(candidate.id); finish(); return; }
            const control = this.createControl(); this.controls.add(control);
            try {
                const info = await control.connect(candidate);
                if (this.closed || !this.present.has(candidate.id)) return;
                const miotDid = typeof info.miotDid === 'string' && /^[a-zA-Z0-9._:-]{1,256}$/.test(info.miotDid) ? info.miotDid : undefined;
                const deviceId = typeof info.deviceId === 'string' && /^[a-zA-Z0-9._:-]{1,256}$/.test(info.deviceId) ? info.deviceId : undefined;
                const id = miotDid ? `miplay:${miotDid}` : `miplay:${createHash('sha256').update(info.deviceId || candidate.id).digest('hex').slice(0, 24)}`;
                this.devices.set(candidate.id, { ...candidate, id, name: (info.miName || candidate.name).slice(0, 200), model: (info.model || '').slice(0, 100),
                    ...(miotDid ? { miotDid } : {}), ...(deviceId ? { deviceId } : {}), ...(info.roomName ? { roomName: info.roomName.slice(0, 200) } : {}), online: true, protocols: ['miplay'] });
                if (this.announcements.has(candidate.id)) this.announcements.get(candidate.id).status = 'ready';
                this.emit('changed');
            } catch (error) {
                if (!this.closed && this.present.has(candidate.id)) {
                    Object.assign(this.announcements.get(candidate.id), { status: 'unavailable', failedAt: Date.now(), error: error.message.slice(0, 512) });
                    this.emit('diagnostic', { phase: 'miplay-discovery', result: 'unavailable', message: error.message });
                    this.emit('changed');
                }
            }
            finally { control.close(); this.controls.delete(control); this.pending.delete(candidate.id); finish(); }
        });
        this.drain();
    }
    snapshot() {
        const active = [...this.announcements.values()];
        return [...active, ...[...this.observations.values()].filter(item => item.status === 'filtered')].map(device => ({ ...device }));
    }
    drain() {
        while (!this.closed && this.running < 4 && this.queue.length) {
            this.running++;
            this.queue.shift()().finally(() => { this.running--; this.drain(); });
        }
    }
    async list(waitMs = 2500) {
        if (this.closed) return [];
        const delay = this.pending.size ? waitMs : this.devices.size ? 0 : Math.max(0, this.startedAt + waitMs - Date.now());
        let timer;
        if (delay) await Promise.race([new Promise(resolve => { timer = setTimeout(resolve, delay); }),
            this.pending.size ? Promise.allSettled([...this.pending.values()]) : new Promise(() => {})]);
        clearTimeout(timer);
        const devices = [...new Map([...this.devices.values()].map(device => [`${device.id}@${device.address}`, device])).values()];
        const counts = new Map();
        for (const device of devices) counts.set(device.id, (counts.get(device.id) || 0) + 1);
        return devices.map(device => ({ ...device, ...(counts.get(device.id) > 1 ? {
            id: `${device.id}:${createHash('sha256').update(device.address).digest('hex').slice(0, 8)}`,
        } : {}) }));
    }
    close() {
        this.closed = true;
        clearInterval(this.timer);
        try { this.unicast?.close(); } catch {}
        for (const control of this.controls) control.close();
        for (const browser of this.browsers || []) browser.stop();
        this.bonjour?.destroy(); this.devices.clear(); this.present.clear(); this.announcements.clear(); this.observations.clear(); this.records.records.clear();
        // Complete queued jobs too, so all outstanding list waiters settle.
        while (this.queue.length) this.queue.shift()();
    }
}

export function mergeOutputs(cloud, local) {
    const result = cloud.map(device => ({ ...device, protocols: device.online === false ? [] : ['mina'] }));
    // Only exact identifiers from the authenticated/readable control response
    // participate, never mDNS mico.device_id, names, IPs or model guesses.
    const matches = local.map(device => {
        const candidates = result.filter(item => device.deviceId && item.id === device.deviceId || device.miotDid && item.miotDid === device.miotDid);
        if (candidates.length !== 1) return null;
        const target = candidates[0];
        if (device.miotDid && target.miotDid && device.miotDid !== target.miotDid) return null;
        return target;
    });
    for (const [index, device] of local.entries()) {
        const proposed = matches[index];
        const target = proposed && matches.filter(item => item === proposed).length === 1 ? proposed : null;
        if (target) {
            target.protocols.push('miplay'); target.miplay = device; target.online = true; target.aliases = [device.id];
        } else result.push({ ...device, miplay: device, ...(device.deviceId ? { aliases: [device.deviceId] } : {}) });
    }
    return result;
}
