const fs = require('./fs.cjs');
const { semi } = require('./bridge.mjs');
let initial = {}, queue = Promise.resolve();
async function initialize() {
    ({ data: initial } = await semi.getStorage({ key: 'device-page-settings' }));
    if (initial) return;
    try { initial = JSON.parse(await fs.promises.readFile('/data/mijia-plugin-settings.json', 'utf8')); } catch (e) { if (e.code !== 'ENOENT') throw e; initial = {}; }
    await semi.setStorage({ key: 'device-page-settings', data: initial });
}
class JsonStore {
    constructor(filename) { this.filename = filename; this.data = { ...initial }; }
    get(key) { return this.data[key] === undefined ? null : structuredClone(this.data[key]); }
    set(key, value) { this.data[key] = structuredClone(value); this.persist(); }
    remove(key) { delete this.data[key]; this.persist(); }
    persist() { const text = JSON.stringify(this.data); queue = queue.then(() => semi.setStorage({ key: 'device-page-settings', data: JSON.parse(text) })); queue.catch(error => console.error('[插件设置]', error)); }
}
module.exports = { initialize, flush: () => queue, JsonStore };
