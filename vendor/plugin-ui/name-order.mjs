const collator = new Intl.Collator('zh-CN-u-co-pinyin', { sensitivity: 'base', numeric: true });
const startsWithHan = name => /^\p{Script=Han}/u.test(name);

// 原生中文排序支持拼音，但不会将拼音与拉丁字母逐字混排；英文等名称在前。
export function compareDisplayNames(a, b) {
    return Number(startsWithHan(a)) - Number(startsWithHan(b)) || collator.compare(a, b);
}
