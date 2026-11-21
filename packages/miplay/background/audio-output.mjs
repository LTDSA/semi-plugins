/** Plugin-private output contract. PCM is signed 16-bit LE, stereo 44.1 kHz.
 * connect(device), start(format), write(frame), setVolume(0..100), stop(), disconnect().
 * Implementations must bound queued audio, reject failures, and release resources.
 */
export class AudioOutputBackend {
    async connect() { throw new Error('输出后端未实现 connect'); }
    async start() { throw new Error('输出后端未实现 start'); }
    async write() { throw new Error('输出后端未实现 write'); }
    async setVolume() { throw new Error('输出后端未实现 setVolume'); }
    async stop() { throw new Error('输出后端未实现 stop'); }
    async disconnect() { await this.stop(); }
}

export class MinaOutputBackend extends AudioOutputBackend {
    constructor(semi) { super(); this.semi = semi; this.kind = 'mina'; }
    async connect(device) { this.device = device; }
    async start(format) {
        this.pending = new AbortController();
        await this.semi.callBackground('mina.play', { id: this.device.id, url: format.url }, { signal: this.pending.signal });
        this.playing = true;
    }
    cancelPending() { if (!this.playing) this.pending?.abort(); }
    async write(frame) {
        if (!this.stream) throw new Error('MiNA PCM 管线未连接');
        this.stream.write(frame);
    }
    async setVolume(value) { await this.semi.callBackground('mina.setVolume', { id: this.device.id, volume: value }); }
    async stop() {
        if (this.playing) {
            this.playing = false;
            await this.semi.callBackground('mina.stop', { id: this.device.id });
        }
    }
    async disconnect({ stopDevice = true } = {}) { if (!stopDevice) this.playing = false; await this.stop(); }
}
