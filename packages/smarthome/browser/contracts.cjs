const error = (code, message) => Object.assign(new Error(message), { code });
function assert(value, message, code = 'INVALID_ARGUMENT') { if (!value) throw error(code, message); }
function json(value, limit = 256 * 1024) { const text = JSON.stringify(value); assert(text !== undefined && Buffer.byteLength(text) <= limit, '消息超过允许大小', 'PAYLOAD_TOO_LARGE'); return JSON.parse(text); }
module.exports = { assert, error, json };
