import { normalizeTrayCardSize } from './tray-card-size.mjs';

export function getHomeEntries(home, { room, tray = false, powerStates = {}, aggregationStates = {}, trayCardSize = 'default' } = {}) {
    const override = tray ? normalizeTrayCardSize(trayCardSize) : 'default';
    const byId = new Map(home.devices.map(device => [device.did, device]));
    const entries = room ? room.deviceIds.map(did => ({ type: 'device', did }))
        : home.entries ?? home.devices.map(device => ({ type: 'device', did: device.did }));
    return entries.flatMap(entry => {
        if (entry.type === 'aggregation') {
            const cardSize = aggregationStates[entry.id]?.cardSize;
            return !room && !tray ? [cardSize ? { ...entry, cardSize } : entry] : [];
        }
        if (entry.type !== 'device') return [];
        const device = byId.get(entry.did);
        if (!device || !room && device.showOnHome === false || tray && (!device.isOnline || !(powerStates[device.did]?.supported || powerStates[device.did]?.curtain?.supported))) return [];
        const cardSize = override === 'default' ? device.cardSize : override;
        return [{ type: 'device', device, ...(cardSize ? { cardSize } : {}) }];
    });
}

// 小米的小卡片按列成对占位；不能用 dense 回填改变云端顺序。
export function getCardGroups(entries) {
    const groups = [];
    for (const entry of entries) {
        const cardSize = ['small', 'large'].includes(entry.cardSize) ? entry.cardSize : 'medium';
        const previous = groups[groups.length - 1];
        if (cardSize === 'small' && previous?.cardSize === 'small' && previous.entries.length < 2) previous.entries.push(entry);
        else groups.push({ key: `${entry.type}:${entry.device?.did ?? entry.id}`, cardSize, entries: [entry] });
    }
    return groups;
}
