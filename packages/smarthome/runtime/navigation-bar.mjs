// 部分 mhui-rn 顶栏在空标题的 renderTitle 中直接赋值 this.state = { imageSource: null }。
// 大标题页面会先隐藏小标题；保留被这一赋值误删的主题／尺寸，图片清理仍由官方实现决定。
// 仅适配具备官方导航 API 的组件，保留原 render、图像、按钮、静态配置及 ref。
export function createNavigationBarCompatibility() {
    const wrappers = new WeakMap();
    return type => {
        if (typeof type !== 'function' || !type.ICON?.BACK || !type.TYPE?.DARK
            || !['renderTitle', 'renderIcons', 'getIconsOfType', 'updateStyleType'].every(name => typeof type.prototype?.[name] === 'function')) return type;
        if (!wrappers.has(type)) {
            class NavigationBar extends type {
                renderTitle(...args) {
                    const previous = this.state;
                    try { return super.renderTitle(...args); }
                    finally {
                        if (previous && this.state && this.state !== previous) this.state = { ...previous, ...this.state };
                    }
                }
            }
            wrappers.set(type, NavigationBar);
            wrappers.set(NavigationBar, NavigationBar);
        }
        return wrappers.get(type);
    };
}
