// DNS-SD records may arrive in separate packets. Keep only bounded, expiring
// records; decode dns-packet TXT chunks individually (they have no length byte).
export const MIPLAY_SERVICES = ['_mi-connect._udp.local', '_lyra-mdns._udp.local', '_miplay_audio._tcp.local'];
const normalize = value => String(value || '').replace(/\.$/, '').toLowerCase();
export function decodeTxt(chunks) {
    const result = Object.create(null);
    for (const chunk of Array.isArray(chunks) ? chunks : []) {
        const text = Buffer.from(chunk).toString('utf8');
        const separator = text.indexOf('=');
        if (separator > 0) result[text.slice(0, separator).toLowerCase()] = text.slice(separator + 1);
    }
    return result;
}
export class MiPlayDnsRecords {
    constructor() { this.records = new Map(); }
    ingest(packet, source, now = Date.now()) {
        const departed = new Set();
        for (const rr of [...(packet.answers || []), ...(packet.additionals || [])].slice(0, 256)) {
            if (!['PTR', 'SRV', 'TXT', 'A'].includes(rr.type) || typeof rr.name !== 'string' || rr.name.length > 512) continue;
            const key = `${normalize(rr.name)}:${rr.type}:${rr.type === 'PTR' || rr.type === 'A' ? rr.data : ''}`;
            if (rr.ttl === 0) {
                this.records.delete(key);
                if (rr.type === 'PTR' && MIPLAY_SERVICES.includes(normalize(rr.name))) departed.add(normalize(rr.data));
                continue;
            }
            if (!Number.isFinite(rr.ttl) || rr.ttl < 0 || (!this.records.has(key) && this.records.size >= 512)) continue;
            this.records.set(key, { ...rr, source, expires: now + Math.min(rr.ttl, 120) * 1000 });
        }
        for (const [key, rr] of this.records) if (departed.has(normalize(rr.name))) this.records.delete(key);
        return this.services(now);
    }
    services(now = Date.now()) {
        for (const [key, rr] of this.records) if (rr.expires <= now) this.records.delete(key);
        const records = [...this.records.values()], names = new Set();
        for (const rr of records) {
            if (rr.type === 'PTR' && MIPLAY_SERVICES.includes(normalize(rr.name))) names.add(normalize(rr.data));
            if (['SRV', 'TXT'].includes(rr.type) && MIPLAY_SERVICES.some(type => normalize(rr.name).endsWith(`.${type}`))) names.add(normalize(rr.name));
        }
        return [...names].slice(0, 64).map(fqdn => {
            const srv = records.find(rr => rr.type === 'SRV' && normalize(rr.name) === fqdn);
            const txt = records.find(rr => rr.type === 'TXT' && normalize(rr.name) === fqdn);
            const type = MIPLAY_SERVICES.find(type => fqdn.endsWith(`.${type}`));
            const addresses = records.filter(rr => rr.type === 'A' && normalize(rr.name) === normalize(srv?.data?.target)).map(rr => rr.data);
            // Only an instance's own SRV/TXT source can supply a missing A.
            if (!addresses.length && (srv?.source || txt?.source)) addresses.push(srv?.source || txt.source);
            return { fqdn, name: fqdn.slice(0, -(type.length + 1)), type, txt: decodeTxt(txt?.data), addresses,
                port: srv?.data?.port, host: srv?.data?.target, hasTxt: !!txt, hasSrv: !!srv };
        });
    }
}
