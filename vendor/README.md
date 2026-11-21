# Semi 构建依赖

`plugin-sdk` 和 `plugin-ui` 是 LTDSA/Semi 的
`0e2097d515c19e717091b184ab960619c9adba13` 源码快照。
在 npm 发布这些构建依赖之前，由工作区解析它们；插件运行包包含编译结果，
不会在用户安装时请求这些依赖。更新快照时同步 `engines.semi` 并重新验收。
