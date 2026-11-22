const { createHash } = require('crypto');
const { name: id } = require('../package.json');

const resourceHost = 'p-' + createHash('sha256').update(id).digest('hex').slice(0, 48);
module.exports = { id, resourceHost, origin: 'semi-plugin://' + resourceHost };
