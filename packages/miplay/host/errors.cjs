function error(code, message) {
    return Object.assign(new Error(message), { code });
}
function assert(condition, message, code = 'INVALID_ARGUMENT') {
    if (!condition) throw error(code, message);
}
module.exports = { assert, error };
