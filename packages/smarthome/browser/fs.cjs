const { semi } = require('./bridge.mjs');
const CHUNK = 128 * 1024;
const files = semi.getFileSystemManager();
const promises = {
    async stat(path) { const stat = await files.stat(path); return { ...stat, isDirectory: () => stat.directory, isFile: () => !stat.directory, isSymbolicLink: () => false }; },
    digest: (path, options) => files.digest(path, options),
    async readFile(path, encoding) {
        const size = (await promises.stat(path)).size;
        if (size > 300 * 1024 * 1024) throw new Error('文件过大');
        const chunks = [];
        for (let offset = 0; offset < size; offset += CHUNK) chunks.push(Buffer.from(await files.readChunk(path, offset, Math.min(CHUNK, size - offset)), 'base64'));
        const result = Buffer.concat(chunks); return encoding ? result.toString(encoding) : result;
    },
    async writeFile(path, data, options = {}) {
        const bytes = Buffer.from(data);
        for (let offset = 0; offset < bytes.length || offset === 0; offset += CHUNK) await files.writeChunk(path, bytes.subarray(offset, offset + CHUNK).toString('base64'), offset, options.flag === 'wx');
    },
    mkdir: path => files.mkdir(path), mkdtemp: prefix => files.mkdtemp(prefix),
    rm: (path, options) => files.remove(path, options), rename: (from, to) => files.rename(from, to),
    async open(path, flags) { if (flags !== 'r') throw new Error('仅支持只读文件句柄'); return {
        stat: () => promises.stat(path), close: async () => {},
        async read(buffer, offset, length, position) { let count = 0; while (count < length) { const data = Buffer.from(await files.readChunk(path, position + count, Math.min(length - count, CHUNK)), 'base64'); if (!data.length) break; data.copy(buffer, offset + count); count += data.length; } return { bytesRead: count }; },
    }; },
};
promises.lstat = promises.stat;
module.exports = { promises,
    createWriteStream(path, options = {}) { let offset = 0; return { async write(chunk) { for (let start = 0; start < chunk.length; start += CHUNK) { const data = chunk.subarray(start, start + CHUNK); await files.writeChunk(path, data.toString('base64'), offset, options.flags === 'wx' && offset === 0); offset += data.length; } }, async end() { if (!offset) await files.writeChunk(path, '', 0, options.flags === 'wx'); } }; },
    async *createReadStream(path) { const size = (await promises.stat(path)).size; for (let offset = 0; offset < size; offset += CHUNK) yield Buffer.from(await files.readChunk(path, offset, Math.min(CHUNK, size - offset)), 'base64'); },
};
