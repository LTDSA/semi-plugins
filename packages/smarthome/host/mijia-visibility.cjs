const record = value => value && typeof value === 'object' && !Array.isArray(value);
const integer = value => Number.isSafeInteger(value) ? value
    : typeof value === 'string' && /^-?\d+$/.test(value) && Number.isSafeInteger(Number(value)) ? Number(value) : null;
const excludedByComFlag = device => {
    const flags = integer(device?.comFlag);
    return flags !== null && flags >= 0 && (flags & 0x10) !== 0;
};

// 官方 bmb 后处理：以组的成员表和 0x20 位计算，不检查单灯型号或其 0x20 位。
function listExclusions(devices) {
    const hidden = new Set(), shown = new Set(), nested = new Set();
    for (const device of devices) {
        if (integer(device.pid) !== 17) continue;
        const flags = device.comFlag == null ? 0 : integer(device.comFlag);
        if (flags === null || flags < 0) continue;
        let extra = device.extra;
        if (typeof extra === 'string') {
            try { extra = JSON.parse(extra); } catch { continue; }
        }
        const membership = record(extra?.member_list) && extra.member_list.member_ship;
        if (!record(membership)) continue;
        for (const did of Object.keys(membership)) {
            if (did.startsWith('group')) nested.add(did);
            else if ((flags & 0x20) !== 0) shown.add(did);
            else hidden.add(did);
        }
    }
    for (const did of shown) hidden.delete(did);
    const exclusions = new Map();
    for (const device of devices) {
        const did = String(device.did), reasons = [];
        if (excludedByComFlag(device)) reasons.push('comFlag:0x10');
        const hideMode = integer(device.hide_mode);
        if (hideMode !== null && hideMode !== 0) reasons.push(`hide_mode=${hideMode}`);
        if (nested.has(did)) reasons.push('nested-group');
        if (hidden.has(did)) reasons.push('group-member');
        if (reasons.length) exclusions.set(did, reasons);
    }
    return exclusions;
}

module.exports = { excludedByComFlag, listExclusions };
