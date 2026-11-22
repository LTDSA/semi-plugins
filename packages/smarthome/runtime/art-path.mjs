// React Native ART 的路径对象可直接调用，也可通过 new 创建；输出标准 SVG 路径。
export function ArtPath(source = '') {
    if (!(this instanceof ArtPath)) return new ArtPath(source);
    this.commands = [String(source)];
}
for (const [name, command] of Object.entries({ moveTo: 'M', move: 'm', lineTo: 'L', line: 'l', curveTo: 'C', curve: 'c' })) {
    ArtPath.prototype[name] = function (...values) { this.commands.push(command + values.join(' ')); return this; };
}
ArtPath.prototype.arc = function (x, y, rx, ry = rx, outer = false) { this.commands.push(`a${rx} ${ry} 0 ${outer ? 1 : 0} 1 ${x} ${y}`); return this; };
ArtPath.prototype.counterArc = function (x, y, rx, ry = rx, outer = false) { this.commands.push(`a${rx} ${ry} 0 ${outer ? 1 : 0} 0 ${x} ${y}`); return this; };
ArtPath.prototype.close = function () { this.commands.push('Z'); return this; };
ArtPath.prototype.toString = function () { return this.commands.join(' '); };
