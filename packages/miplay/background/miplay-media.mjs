import { Output, AdtsOutputFormat, StreamTarget, AudioSampleSource, AudioSample } from 'mediabunny';
import { registerAacEncoder } from '@mediabunny/aac-encoder';
import { PcmResampler } from './pcm-resampler.mjs';

let registered = false;
export class AacEncoder {
    async start(onFrame) {
        if (!registered) { registerAacEncoder(); registered = true; }
        this.frames = 0; this.pending = Buffer.alloc(0); this.position = 0;
        this.resampler = new PcmResampler();
        this.output = new Output({ format: new AdtsOutputFormat(), target: new StreamTarget(new WritableStream({
            write: async chunk => {
                if (chunk.position !== this.position) throw new Error('AAC 编码器非顺序输出');
                this.position += chunk.data.length;
                this.pending = Buffer.concat([this.pending, Buffer.from(chunk.data)]);
                while (this.pending.length >= 7) {
                    if (this.pending[0] !== 255 || (this.pending[1] & 0xf6) !== 0xf0) throw new Error('AAC ADTS 头无效');
                    const length = (this.pending[3] & 3) * 2048 + this.pending[4] * 8 + (this.pending[5] >> 5);
                    if (length < 7 || length > 8191) throw new Error('AAC 帧长度无效');
                    if (this.pending.length < length) break;
                    const frame = Buffer.from(this.pending.subarray(0, length)); this.pending = this.pending.subarray(length);
                    // MiPlay's verified receiver profile uses MPEG-2 AAC-LC.
                    frame[1] = frame[1] | 8;
                    if ((frame[2] >> 6) !== 1 || ((frame[2] >> 2) & 15) !== 3 || (((frame[2] & 1) << 2) | (frame[3] >> 6)) !== 2) throw new Error('MiPlay 需要 48kHz 双声道 AAC-LC');
                    await onFrame(frame);
                }
            },
        })) });
        this.source = new AudioSampleSource({ codec: 'aac', bitrate: 192000 });
        this.output.addAudioTrack(this.source); await this.output.start();
    }
    async write(frame) {
        if (!Buffer.isBuffer(frame) || frame.length % 4 || frame.length > 262144) throw new Error('PCM 格式无效');
        const converted = this.resampler.write(frame);
        if (!converted.data.length) return;
        const sample = new AudioSample({ data: converted.data, format: 'f32', sampleRate: 48000, numberOfChannels: 2, timestamp: converted.timestamp });
        this.frames += frame.length / 4;
        try { await this.source.add(sample); } finally { sample.close(); }
    }
    async close() { const output = this.output; this.output = null; if (output) await output.cancel(); }
}
function crc32(buffer) {
    let value = 0xffffffff;
    for (const byte of buffer) {
        value ^= byte << 24;
        for (let i = 0; i < 8; i++) value = value & 0x80000000 ? (value << 1) ^ 0x04c11db7 : value << 1;
    }
    return value >>> 0;
}
function ptsBytes(pts) {
    const p = BigInt(pts) & 0x1ffffffffn;
    return Buffer.from([Number((p >> 29n) & 14n) | 0x21, Number((p >> 22n) & 255n), Number((p >> 14n) & 254n) | 1, Number((p >> 7n) & 255n), Number((p << 1n) & 254n) | 1]);
}
export class MiPlayPacketizer {
    constructor() { this.sequence = 0; this.unit = 0; this.continuity = new Map(); }
    header(pid, start, adaptation = 1) {
        const continuity = this.continuity.get(pid) || 0;
        if (adaptation & 1) this.continuity.set(pid, (continuity + 1) & 15);
        return Buffer.from([0x47, (pid >> 8) | (start ? 0x40 : 0), pid & 255, (adaptation << 4) | continuity]);
    }
    psi(pid, data) {
        const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(data));
        const packet = Buffer.alloc(188, 255); this.header(pid, true).copy(packet); packet[4] = 0;
        Buffer.concat([data, crc]).copy(packet, 5); return packet;
    }
    packetize(adts, clockUs) {
        const timestamp = this.unit * 1920, packets = [];
        if (this.unit === 0 || this.unit >= 13 && (this.unit - 13) % 5 === 0) {
            packets.push(this.psi(0, Buffer.from('00b00d0000c300000001e100', 'hex')));
            packets.push(this.psi(0x100, Buffer.from('02b0120001c30000f000f0000ff100f000', 'hex')));
            const packet = Buffer.alloc(188, 255); this.header(0x1000, true, 2).copy(packet); packet[4] = 183; packet[5] = 0x10;
            const pcr = BigInt(clockUs) * 27n, base = (pcr / 300n) & 0x1ffffffffn, extension = Number(pcr % 300n);
            packet[6] = Number((base >> 25n) & 255n); packet[7] = Number((base >> 17n) & 255n);
            packet[8] = Number((base >> 9n) & 255n); packet[9] = Number((base >> 1n) & 255n);
            packet[10] = Number((base & 1n) << 7n) | 0x7e | (extension >> 8); packet[11] = extension & 255; packets.push(packet);
        }
        const pes = Buffer.alloc(16); pes.writeUIntBE(1, 0, 3); pes[3] = 0xc0; pes.writeUInt16BE(adts.length + 10, 4);
        pes[6] = 0x84; pes[7] = 0x80; pes[8] = 7; ptsBytes(timestamp).copy(pes, 9); pes[14] = pes[15] = 255;
        const data = Buffer.concat([pes, adts]);
        for (let offset = 0; offset < data.length;) {
            const count = Math.min(184, data.length - offset), packet = Buffer.alloc(188, 255);
            this.header(0x1100, offset === 0, count === 184 ? 1 : 3).copy(packet);
            let start = 4;
            if (count < 184) { packet[4] = 183 - count; if (packet[4]) packet[5] = 0; start = 188 - count; }
            data.copy(packet, start, offset, offset + count); packets.push(packet); offset += count;
        }
        const result = [];
        for (let index = 0; index < packets.length; index += 7) {
            const rtp = Buffer.alloc(12); rtp[0] = 0x80; rtp[1] = 33 | (index + 7 >= packets.length ? 0x80 : 0);
            rtp.writeUInt16BE(this.sequence++ & 65535, 2); rtp.writeUInt32BE(timestamp >>> 0, 4); rtp.writeUInt32BE(0xdeadbeef, 8);
            const body = Buffer.concat([rtp, ...packets.slice(index, index + 7)]), header = Buffer.alloc(4); header[0] = 0x24; header.writeUIntBE(body.length, 1, 3);
            result.push(Buffer.concat([header, body]));
        }
        this.unit++; return result;
    }
}
