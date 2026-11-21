export function selectionKey(accountId) {
    if (!/^[a-f0-9]{64}$/.test(accountId)) throw new Error('账号标识无效');
    return `mina:${accountId}`;
}
export function restoreSelection(saved, speakers) {
    const available = speakers.filter(speaker => speaker.online !== false);
    const selected = new Set();
    for (const id of Array.isArray(saved) ? saved : []) {
        if (typeof id !== 'string') continue;
        const matches = available.filter(speaker => speaker.id === id || speaker.aliases?.includes(id));
        if (matches.length === 1) selected.add(matches[0].id);
    }
    return selected;
}
