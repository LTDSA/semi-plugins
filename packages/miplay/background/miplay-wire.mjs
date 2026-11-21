import { EventEmitter } from 'node:events';
import { createHash, createHmac } from 'node:crypto';

// Independently implemented from the documented MiPlay legacy wire facts.
// Protocol evidence and supported boundaries: docs/plugins/miplay-output.md.
export function commandFrame(command, sequence, payload = Buffer.alloc(0)) {
    const body = Buffer.isBuffer(payload) ? payload : Buffer.from(payload);
    if (body.length > 1048576) throw new Error('MiPlay 控制消息过大');
    const header = Buffer.alloc(9); header[0] = 0x24;
    header.writeUInt16BE(command, 1); header.writeUInt16BE(sequence, 3); header.writeUInt32BE(body.length, 5);
    return Buffer.concat([header, body]);
}
export function legacyAnswer(challenge) {
    if (!/^\d{16,17}$/.test(challenge.toString())) throw new Error('不支持的 MiPlay 认证挑战');
    const key = createHash('md5').update('0.0.0.0').digest('hex');
    return Buffer.from(createHmac('sha1', key).update(challenge).digest('hex'));
}
export function deviceInfo(payload) {
    if (payload.length < 3 || payload.readUIntBE(0, 3) !== payload.length - 3) throw new Error('MiPlay 设备信息长度无效');
    const result = Object.create(null);
    for (let offset = 3, count = 0; offset < payload.length; count++) {
        if (count >= 128) throw new Error('MiPlay 设备信息字段过多');
        const length = payload[offset++];
        if (!length || offset + length + 3 > payload.length) throw new Error('MiPlay 设备信息截断');
        const key = payload.subarray(offset, offset + length).toString(); offset += length;
        if (payload[offset++] !== 12) throw new Error('不支持的 MiPlay 设备字段类型');
        const size = payload.readUInt16BE(offset); offset += 2;
        if (offset + size > payload.length || Object.hasOwn(result, key)) throw new Error('MiPlay 设备字段无效');
        result[key] = payload.subarray(offset, offset + size).toString('utf8'); offset += size;
    }
    return result;
}
export class CommandChannel extends EventEmitter {
    constructor(socket) {
        super(); this.socket = socket; this.buffer = Buffer.alloc(0); this.waiters = new Map(); this.backlog = [];
        socket.on('data', data => {
            try {
                this.buffer = Buffer.concat([this.buffer, data]);
                if (this.buffer.length > 2 * 1048576) throw new Error('MiPlay 控制缓冲过大');
                while (this.buffer.length >= 9) {
                    if (this.buffer[0] !== 0x24) throw new Error('MiPlay 帧标志无效');
                    const size = this.buffer.readUInt32BE(5);
                    if (size > 1048576) throw new Error('MiPlay 帧长度无效');
                    if (this.buffer.length < size + 9) break;
                    const frame = { command: this.buffer.readUInt16BE(1), sequence: this.buffer.readUInt16BE(3), payload: Buffer.from(this.buffer.subarray(9, 9 + size)) };
                    this.buffer = this.buffer.subarray(9 + size);
                    if (frame.command >= 0x1400) throw new Error('该音箱需要尚未支持的 MiPlay 现代加密握手');
                    if (frame.command === 0x1a) { this.send(0x1b, frame.sequence); continue; }
                    if (frame.command === 0x22) { this.emit('notification', frame); continue; }
                    const key = `${frame.command}:${frame.sequence}`, waiter = this.waiters.get(key) || this.waiters.get(`${frame.command}:*`);
                    if (waiter) waiter.resolve(frame); else {
                        if (this.backlog.length >= 128) throw new Error('MiPlay 未处理消息过多');
                        this.backlog.push(frame);
                    }
                }
            } catch (error) { this.fail(error); socket.destroy(); }
        });
        socket.on('error', error => this.fail(error));
        socket.on('close', () => this.fail(new Error('MiPlay 控制连接已关闭')));
    }
    fail(error) {
        if (this.failure) return;
        this.failure = error;
        for (const waiter of [...this.waiters.values()]) waiter.reject(error);
        this.emit('failure', error);
    }
    wait(command, sequence = '*', timeout = 5000) {
        if (this.failure) return Promise.reject(this.failure);
        const index = this.backlog.findIndex(frame => frame.command === command && (sequence === '*' || sequence === frame.sequence));
        if (index >= 0) return Promise.resolve(this.backlog.splice(index, 1)[0]);
        return new Promise((resolve, reject) => {
            const key = `${command}:${sequence}`;
            if (this.waiters.has(key)) return reject(new Error('重复 MiPlay 请求'));
            const finish = (fn, value) => { clearTimeout(timer); this.waiters.delete(key); fn(value); };
            const timer = setTimeout(() => finish(reject, new Error(`MiPlay 应答超时 (${command.toString(16)})`)), timeout);
            this.waiters.set(key, { resolve: value => finish(resolve, value), reject: error => finish(reject, error) });
        });
    }
    send(command, sequence, payload, onWritten) {
        if (this.failure || this.socket.destroyed) throw this.failure || new Error('MiPlay 已断开');
        if (this.socket.writableLength > 1048576) throw new Error('MiPlay 控制发送阻塞');
        this.socket.write(commandFrame(command, sequence, payload), onWritten);
    }
    request(command, sequence, payload, response = command + 1) {
        const pending = this.wait(response, sequence);
        try { this.send(command, sequence, payload); } catch (error) { this.fail(error); }
        return pending;
    }
    close() { this.fail(new Error('MiPlay 请求已取消')); this.socket.destroy(); this.backlog = []; }
}
