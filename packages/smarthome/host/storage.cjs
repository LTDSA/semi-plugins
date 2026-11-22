const fs = require('fs');
const path = require('path');
const { json } = require('../browser/contracts.cjs');

class JsonStore {
    constructor(filename) {
        this.filename = filename;
        try { this.data = JSON.parse(fs.readFileSync(filename, 'utf8')); }
        catch (error) { if (error.code !== 'ENOENT') throw error; this.data = {}; }
    }
    get(key) { return Object.hasOwn(this.data, key) ? json(this.data[key], 1024 * 1024) : null; }
    set(key, value) { this.save({ ...this.data, [key]: json(value, 1024 * 1024) }); }
    remove(key) {
        const next = { ...this.data };
        delete next[key];
        this.save(next);
    }
    save(next) {
        const data = JSON.stringify(json(next, 1024 * 1024));
        fs.mkdirSync(path.dirname(this.filename), { recursive: true });
        fs.writeFileSync(this.filename + '.tmp', data, { mode: 0o600 });
        fs.renameSync(this.filename + '.tmp', this.filename);
        this.data = next;
    }
}
module.exports = { JsonStore };
