// 用原生 viewport 的实际尺寸驱动位移；不等待打开／关闭通知，避免 IPC 间隙重排页面。
export function embeddedLayoutStyle(layout) {
    if (!layout) return null;
    const { bounds, viewport } = layout;
    const ratio = (offset, full, size) => full > size ? offset / (full - size) : 0;
    return {
        '--semi-host-slot-x': `${bounds.x}px`,
        '--semi-host-slot-y': `${bounds.y}px`,
        '--semi-host-slot-width': `${bounds.width}px`,
        '--semi-host-slot-height': `${bounds.height}px`,
        '--semi-host-slot-ratio-x': String(ratio(bounds.x, viewport.width, bounds.width)),
        '--semi-host-slot-ratio-y': String(ratio(bounds.y, viewport.height, bounds.height)),
    };
}

export function applyEmbeddedLayout(document, layout) {
    const style = embeddedLayoutStyle(layout);
    if (style) for (const [key, value] of Object.entries(style)) document.body.style.setProperty(key, value);
    document.body.classList.toggle('semi-host-embedded', Boolean(style));
    document.body.classList.toggle('semi-host-modal-open', layout?.expanded === true);
}
