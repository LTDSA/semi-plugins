// 官方 Device.getCardSize / CardScale：0 中、1 小、2 大；两个标记同时设置时为中。
function cardSize(value) {
    return value === 1 ? 'small' : value === 2 ? 'large' : 'medium';
}
function deviceCardSize(flags) {
    if (typeof flags === 'string' && /^\d+$/.test(flags)) flags = Number(flags);
    if (!Number.isSafeInteger(flags) || flags < 0) return 'medium';
    const large = (flags >> 6) & 1, small = (flags >> 11) & 1;
    return cardSize(large === small ? 0 : large ? 2 : 1);
}
module.exports = { cardSize, deviceCardSize };
