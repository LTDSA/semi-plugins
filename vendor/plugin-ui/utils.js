// 与 semi.js 中 semi.getFriendlyTime 一致
export function getFriendlyTime(timeStamp) {
    const days = Math.floor(timeStamp / 86400);
    const hours = Math.floor((timeStamp % 86400) / 3600);
    const minutes = Math.floor((timeStamp % 3600) / 60);

    let timeStr = '';
    if (days > 0) timeStr += `${days} 天 `;
    if (hours > 0) timeStr += `${hours} 时 `;
    timeStr += `${minutes} 分`;

    return timeStr;
}

// 与 semi.js 中 semi.getFriendlySize 一致
export function getFriendlySize(size, precision = 2) {
    const units = ['B', 'KB', 'MB', 'GB', 'TB'];
    let index = 0;
    while (size >= 1024 && index < units.length - 1) {
        size /= 1024;
        index++;
    }
    return `${size.toFixed(precision)} ${units[index]}`;
}

// 与旧版 Date.prototype.format('hh:mm:ss') 等价
export function formatClock(date) {
    const pad = value => String(value).padStart(2, '0');
    return `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

// 仓库里的部分第三方库是经典脚本（顶层 `var X` 挂到 window），
// 交给 Vite 当模块打包会丢掉全局变量，因此按 <script> 运行时加载，并缓存结果。
const scriptLoads = {};

export function loadScriptOnce(src) {
    if (!scriptLoads[src]) {
        scriptLoads[src] = new Promise((resolve, reject) => {
            const script = document.createElement('script');
            script.src = src;
            script.onload = resolve;
            script.onerror = reject;
            document.head.appendChild(script);
        });
    }
    return scriptLoads[src];
}