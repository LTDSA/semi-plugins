// Streaming 44.1 -> 48 kHz, stereo PCM16 -> float32. A 24-tap windowed sinc
// filter with 160 rational phases avoids whole-file buffering and clock drift.
const weights = Array.from({ length: 160 }, (_, phase) => {
    const fraction = phase / 160;
    const taps = Array.from({ length: 24 }, (_, index) => {
        const x = index - 11 - fraction;
        return Math.abs(x) < 1e-12 ? 1 : Math.sin(Math.PI * x) / (Math.PI * x) * (0.5 + 0.5 * Math.cos(Math.PI * x / 12));
    });
    const sum = taps.reduce((a, b) => a + b, 0); return taps.map(value => value / sum);
});
export class PcmResampler {
    constructor() { this.data = new Float32Array(); this.base = 0; this.received = 0; this.output = 0; }
    write(pcm) {
        const joined = new Float32Array(this.data.length + pcm.length / 2); joined.set(this.data);
        for (let offset = 0; offset < pcm.length; offset += 2) joined[this.data.length + offset / 2] = pcm.readInt16LE(offset) / 32768;
        this.data = joined; this.received += pcm.length / 4;
        const result = new Float32Array(Math.ceil((pcm.length / 4 + 32) * 160 / 147) * 2);
        let written = 0;
        const start = this.output;
        for (;;) {
            const position = this.output * 147, center = Math.floor(position / 160);
            if (center + 12 >= this.received) break;
            const taps = weights[position % 160];
            let left = 0, right = 0;
            for (let index = 0; index < 24; index++) {
                const frame = center + index - 11;
                if (frame < 0) continue;
                const offset = (frame - this.base) * 2;
                left += this.data[offset] * taps[index]; right += this.data[offset + 1] * taps[index];
            }
            result[written++] = left; result[written++] = right; this.output++;
        }
        const discard = Math.max(0, Math.floor(this.output * 147 / 160) - 11 - this.base);
        this.data = this.data.slice(discard * 2); this.base += discard;
        return { data: result.subarray(0, written), timestamp: start / 48000 };
    }
}
