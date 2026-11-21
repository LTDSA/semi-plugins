import { AudioOutputBackend, MinaOutputBackend } from './audio-output.mjs';
import { MiPlayControl, MiPlayMediaSession, clockUs } from './miplay-session.mjs';
import { AacEncoder, MiPlayPacketizer } from './miplay-media.mjs';

export class MiPlayOutputBackend extends AudioOutputBackend {
    constructor({ onFailure = () => {}, diagnostic = () => {}, controlFactory = () => new MiPlayControl(), mediaFactory = options => new MiPlayMediaSession(options), encoderFactory = () => new AacEncoder() } = {}) {
        super(); Object.assign(this, { onFailure, diagnostic, controlFactory, mediaFactory, encoderFactory }); this.kind = 'miplay'; this.queue = []; this.bytes = 0;
    }
    async connect(device) { this.device = device.miplay || device; }
    async start(format) {
        if (format.sampleRate !== 44100 || format.channels !== 2 || format.sampleFormat !== 's16le') throw new Error('MiPlay 输入格式必须为 44.1kHz 双声道 PCM16');
        this.failure = null; this.stopping = false; this.starting = true; this.job = Promise.resolve(); this.packetizer = new MiPlayPacketizer();
        this.control = this.controlFactory();
        this.media = this.mediaFactory({ ip: this.device.localAddress, peer: this.device.address, onFailure: error => this.fail(error) });
        try {
            await this.control.connect(this.device);
            this.diagnostic({ phase: 'miplay-control', result: 'connected' });
            this.control.channel?.on('failure', error => { if (this.playing) this.fail(error); });
            const port = await this.media.listen();
            this.encoder = this.encoderFactory();
            await this.encoder.start(async frame => {
                if (this.stopping) return;
                const position = BigInt(this.packetizer.unit * 1024) * 1000000n / 48000n;
                let due = this.origin + position;
                if (clockUs() - due > 250000n) {
                    // Preserve media counters across an input gap, but move their
                    // wall-clock mapping so old deadlines do not accumulate.
                    this.origin = clockUs() - position; due = this.origin + position;
                    await this.media.resync(this.origin);
                }
                const delay = Number(due - clockUs()) / 1000;
                if (delay > 0) await new Promise(resolve => setTimeout(resolve, Math.min(delay, 100)));
                if (this.stopping) return;
                try {
                    for (const packet of this.packetizer.packetize(frame, clockUs())) await this.media.write(packet);
                    if (this.packetizer.unit === 1) this.diagnostic({ phase: 'miplay-media', result: 'sent' });
                } catch (error) { if (!this.stopping) throw error; }
            });
            await this.control.open(this.device.localAddress, port); await this.media.waitReady();
            this.diagnostic({ phase: 'miplay-rtsp', result: 'ready' });
            this.origin = this.media.origin || clockUs(); this.playing = true; this.starting = false;
            const pending = this.queue; this.queue = []; this.bytes = 0;
            await Promise.all(pending.map(frame => this.write(frame)));
        } catch (error) { await this.disconnect(); throw error; }
    }
    async write(frame) {
        if (this.failure) throw this.failure;
        if (!this.playing) {
            if (this.bytes + frame.length > 1048576) throw new Error('MiPlay 启动缓冲已满');
            this.queue.push(Buffer.from(frame)); this.bytes += frame.length; return;
        }
        if (this.bytes + frame.length > 1048576) throw new Error('MiPlay 编码缓冲已满');
        this.bytes += frame.length;
        const job = this.job.then(async () => { if (this.playing) await this.encoder.write(frame); }).finally(() => { this.bytes -= frame.length; });
        this.job = job; job.catch(error => this.fail(error)); return job;
    }
    fail(error) { if (!this.failure) { this.failure = error; if (this.playing) this.onFailure(error); } }
    async setVolume(value) { if (this.failure) throw this.failure; await this.control.setVolume(value); }
    cancelPending() { this.stopping = true; this.control?.close(); this.media?.close(); }
    async stop() { await this.disconnect(); }
    async disconnect({ stopDevice = true } = {}) {
        this.stopping = true; this.playing = false; this.starting = false; this.queue = [];
        let failure;
        if (this.control) { try { if (stopDevice) await this.control.stop(); } catch (error) { failure = error; } finally { this.control.close(); } }
        this.media?.close();
        await this.job?.catch(() => {}); await this.encoder?.close(); this.encoder = null; this.bytes = 0;
        if (failure) throw failure;
    }
}

// Select the local backend before streaming. A start failure may fall back to
// MiNA only after the failed local session is closed; no media write is replayed.
export class PreferredOutputBackend extends AudioOutputBackend {
    constructor(semi, options = {}) { super(); this.semi = semi; this.options = options; this.pending = []; this.bytes = 0; }
    async connect(device) { this.device = device; }
    async start(format) {
        this.starting = true; this.cancelled = false;
        try {
            if (this.device.miplay) {
                const backend = new MiPlayOutputBackend(this.options); this.backend = backend; await backend.connect(this.device);
                if (this.cancelled) throw new Error('音频输出已取消');
                try { await backend.start(format); }
                catch (error) {
                    await backend.disconnect().catch(() => {});
                    if (this.cancelled) throw new Error('音频输出已取消');
                    if (!this.device.protocols?.includes('mina')) throw error;
                    this.options.diagnostic?.({ phase: 'miplay-fallback', message: error.message }); this.backend = null;
                }
            }
            if (this.cancelled) throw new Error('音频输出已取消');
            if (!this.backend) {
                this.backend = new MinaOutputBackend(this.semi); await this.backend.connect(this.device);
                if (this.cancelled) throw new Error('音频输出已取消');
                await this.backend.start(format);
            }
            this.backend.stream = this.stream;
            this.kind = this.backend.kind;
            this.options.diagnostic?.({ phase: 'output-backend', backend: this.kind });
            const pending = this.pending; this.pending = []; this.bytes = 0;
            const writes = pending.map(frame => this.backend.write(frame));
            this.starting = false;
            await Promise.all(writes);
        } catch (error) { this.starting = false; this.pending = []; this.bytes = 0; throw error; }
    }
    async write(frame) {
        if (!this.backend || this.starting) {
            if (this.bytes + frame.length > 1048576) throw new Error('音频输出启动缓冲已满');
            this.pending.push(Buffer.from(frame)); this.bytes += frame.length; return;
        }
        await this.backend.write(frame);
    }
    async setVolume(value) { if (this.backend) await this.backend.setVolume(value); }
    cancelPending() { this.cancelled = true; if (this.starting) this.backend?.cancelPending?.(); }
    async stop(options) { const backend = this.backend; this.backend = null; this.pending = []; this.bytes = 0; if (backend) await backend.disconnect(options); }
    async disconnect(options) { await this.stop(options); }
}
