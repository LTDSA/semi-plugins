// 只适配官方模块创建的元素；不能修改 React 本体，否则 RN Web 的内部节点也会重复转换。
export function createPluginReact(React, adaptProps, adaptType = type => type) {
    return {
        ...React,
        createElement(type, props, ...children) {
            return React.createElement(adaptType(type), adaptProps(type, props), ...children);
        },
    };
}
