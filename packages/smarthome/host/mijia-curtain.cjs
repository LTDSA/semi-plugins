const nameOf = (type, kind) => typeof type === 'string' ? type.match(new RegExp(`^urn:miot-spec-v2:${kind}:([^:]+):`))?.[1] : null;
const numbers = new Set(['uint8', 'uint16', 'uint32', 'int8', 'int16', 'int32', 'int', 'float', 'double']);
const semantic = choice => {
    const values = [choice.description, choice.comment].filter(value => typeof value === 'string').map(value => value.toLowerCase().replace(/[\s_/-]/g, ''));
    return values;
};
const COMMANDS = { open: ['open', '打开'], close: ['close', '关闭'], pause: ['pause', 'stop', '暂停', '停止'] };

function findCurtain(spec) {
    if (nameOf(spec?.type, 'device') !== 'curtain') return null;
    const services = (spec.services || []).filter(service => nameOf(service?.type, 'service') === 'curtain');
    if (services.length !== 1 || !Number.isSafeInteger(services[0].iid) || services[0].iid < 1) return null;
    const service = services[0];
    if ((spec.services || []).filter(other => other?.iid === service.iid).length !== 1) return null;
    const property = (name, access) => {
        const matches = (service.properties || []).filter(p => nameOf(p?.type, 'property') === name);
        const p = matches.length === 1 ? matches[0] : null;
        if (!p || !Number.isSafeInteger(p.iid) || p.iid < 1 || !Array.isArray(p.access) || !p.access.includes(access)
            || !numbers.has(p.format) || (service.properties || []).filter(other => other.iid === p.iid).length !== 1) return null;
        return { ...p, siid: service.iid, piid: p.iid };
    };
    const rawPosition = property('current-position', 'read');
    const position = rawPosition && !rawPosition['value-list'] && [undefined, 'none', 'percentage'].includes(rawPosition.unit) ? rawPosition : null;
    const motor = property('motor-control', 'write');
    const status = property('status', 'read');
    const commands = {};
    if (motor && Array.isArray(motor['value-list'])) for (const [command, words] of Object.entries(COMMANDS)) {
        const matches = motor['value-list'].filter(choice => semantic(choice).some(value => words.includes(value)));
        const value = matches.length === 1 ? matches[0].value : null;
        if (Number.isSafeInteger(value) && motor['value-list'].filter(choice => choice.value === value).length === 1) commands[command] = value;
    }
    const motion = new Map();
    if (Array.isArray(status?.['value-list'])) for (const choice of status['value-list']) {
        const states = Object.entries({ opening: ['opening', '打开中', '开启中'], closing: ['closing', '关闭中'], stopped: ['stop', 'stopped', 'pause', 'paused', '停止', '暂停'] })
            .filter(([, words]) => semantic(choice).some(value => words.includes(value)));
        if (states.length === 1 && status['value-list'].filter(other => other.value === choice.value).length === 1) motion.set(choice.value, states[0][0]);
    }
    const supported = ['open', 'close', 'pause'].every(command => Object.hasOwn(commands, command));
    return { position, motor, status, commands, motion, supported };
}

function curtainState(descriptor, rows, did) {
    const value = property => {
        const row = property && rows.find(row => row && String(row.did) === did && row.siid === property.siid && row.piid === property.piid);
        return row?.code === 0 ? row.value : null;
    };
    const raw = value(descriptor.position);
    const range = descriptor.position?.['value-range'];
    const position = typeof raw === 'number' && Number.isFinite(raw) && raw >= 0 && raw <= 100
        && (!Array.isArray(range) || raw >= range[0] && raw <= range[1]) ? Number(raw.toFixed(2)) : null;
    const motion = descriptor.motion.get(value(descriptor.status)) || null;
    const text = position === null ? null : position <= 2 ? '关着' : position >= 98 ? '开着' : `开着 ${position}%`;
    const nextAction = motion === 'opening' || motion === 'closing' ? 'pause'
        : position !== null ? position <= 2 ? 'open' : 'close' : null;
    return { supported: descriptor.supported, position, motion, text, nextAction };
}

module.exports = { findCurtain, curtainState };
