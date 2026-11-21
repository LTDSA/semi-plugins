import { isIPv4 } from 'node:net';

// Query only the actual peer's reverse mDNS name, using the receiver's existing
// LAN socket. A host name is evidence; a User-Agent-derived device name is not.
export class SenderNames {
    constructor(mdns, { timeout = 5000 } = {}) {
        this.mdns = mdns; this.timeout = timeout; this.pending = new Map(); this.cache = new Map();
        this.response = packet => this.read(packet);
        mdns.on('response', this.response);
    }
    watch(address, callback) {
        if (!isIPv4(address)) return () => {};
        const cached = this.cache.get(address);
        if (cached && cached.until > Date.now()) { callback(cached.name); return () => {}; }
        let entry = this.pending.get(address);
        if (!entry) {
            if (this.pending.size >= 128) return () => {};
            entry = { reverse: `${address.split('.').reverse().join('.')}.in-addr.arpa`, listeners: new Set() };
            this.pending.set(address, entry);
            entry.timer = setTimeout(() => { this.pending.delete(address); }, this.timeout);
            entry.timer.unref?.();
            this.mdns.query(entry.reverse, 'PTR');
        }
        entry.listeners.add(callback);
        return () => {
            entry.listeners.delete(callback);
            if (!entry.listeners.size) {
                clearTimeout(entry.timer);
                if (this.pending.get(address) === entry) this.pending.delete(address);
            }
        };
    }
    read(packet) {
        const records = [...(packet.answers || []), ...(packet.additionals || [])];
        for (const [address, entry] of this.pending) {
            const ptr = records.find(record => record.type === 'PTR' && record.ttl > 0 &&
                typeof record.name === 'string' && record.name.toLowerCase().replace(/\.$/, '') === entry.reverse && typeof record.data === 'string' && /\.local\.?$/i.test(record.data));
            if (!ptr) continue;
            // Preserve the advertised host label. Do not turn it into a guessed
            // friendly name or infer a hardware model from it.
            const name = ptr.data.replace(/\.local\.?$/i, '').replace(/[\x00-\x1f\x7f]/g, '').trim().slice(0, 128);
            if (!name || name.includes('.')) continue;
            this.cache.delete(address);
            this.cache.set(address, { name, until: Date.now() + Math.min(ptr.ttl, 300) * 1000 });
            while (this.cache.size > 128) this.cache.delete(this.cache.keys().next().value);
            clearTimeout(entry.timer); this.pending.delete(address);
            for (const listener of entry.listeners) listener(name);
        }
    }
    dispose() {
        this.mdns.removeListener('response', this.response);
        for (const entry of this.pending.values()) clearTimeout(entry.timer);
        this.pending.clear(); this.cache.clear();
    }
}
