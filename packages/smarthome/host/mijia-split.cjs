// 拆分关系只取自当前账号的云端设备记录，不根据 did 后缀推算通道。
function splitIdentity(device) {
    let extra = device?.extra;
    if (typeof extra === 'string') {
        try { extra = JSON.parse(extra); } catch { return { valid: false }; }
    }
    const split = extra?.split;
    if (!split || typeof split !== 'object' || Array.isArray(split)) return split == null ? null : { valid: false };
    if (split.parentId == null && split.moduleId == null) return null;
    const parentId = typeof split.parentId === 'number' || typeof split.parentId === 'string' ? String(split.parentId) : '';
    const moduleId = typeof split.moduleId === 'number' ? split.moduleId
        : typeof split.moduleId === 'string' && /^[1-9]\d*$/.test(split.moduleId) ? Number(split.moduleId) : NaN;
    if (!/^[a-zA-Z0-9._:-]{1,128}$/.test(parentId) || parentId === String(device.did)
        || !Number.isSafeInteger(moduleId) || moduleId < 1) return { valid: false };
    return { valid: true, parentId, moduleId, icon: split.icon };
}
module.exports = { splitIdentity };
