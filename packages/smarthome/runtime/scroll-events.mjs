const callbacks = ['onScroll', 'onScrollBeginDrag', 'onScrollEndDrag', 'onMomentumScrollBegin', 'onMomentumScrollEnd'];

// RN Web 0.17 的滚动事件没有 contentInset；米家原生页面依赖其四个边距。
// 保留原事件及读数，不修改 Web 事件，也不覆盖已存在的原生边距。
export function normalizeScrollEvent(event, inset) {
    if (!event?.nativeEvent) return event;
    const nativeInset = event.nativeEvent.contentInset;
    const contentInset = Object.fromEntries(['top', 'left', 'bottom', 'right'].map(edge => [edge, nativeInset?.[edge] ?? inset?.[edge] ?? 0]));
    return { ...event, nativeEvent: { ...event.nativeEvent, contentInset } };
}

export function adaptScrollProps(props) {
    if (!props) props = {};
    const adapted = { ...props };
    // 原生竖向滚动内容的高度无上界；默认内容布局不能按网页 flex 分配剩余高度。
    if (!props.horizontal && props.contentContainerStyle == null) adapted.contentContainerStyle = { display: 'block' };
    for (const name of callbacks) if (typeof props[name] === 'function') {
        const handler = props[name];
        adapted[name] = function (event, ...args) { return handler.call(this, normalizeScrollEvent(event, props.contentInset), ...args); };
    }
    return adapted;
}
