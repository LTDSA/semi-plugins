# 连接方式标志

- `semi-core.png`：原样复制宿主 `semi/img/semiTemplate.png` 的透明核心标志；迷你路由图用 alpha mask 显示白色，不带彩色应用图标底板。

- `mina.png`：将项目登录页使用的 `semi/img/mina.svg` 原样栅格化为 96×96 PNG，保留圆角和透明角。
- `miplay.png`：从用户于 2026-11-06 提供的 MiPlay Developer OS 图片中裁取左侧点阵环形 logo，保持原始比例，放入白色圆角底板，导出为 96×96 PNG。不包含 Developer / OS 文字。
- `airplay.png`：基于用户于 2026-11-06 提供的 AirPlay 图形制作，图形居中占画布约三分之二，白底、四周留白和透明圆角均包含在 PNG 本身；不使用专用 CSS 制造留白或底板。

路由图音箱名称右侧以 12×12 显示，不添加原生 tooltip。实际输出后端由 `airplay.get` / `airplay.changed` 的 `backends` 映射提供；尚未建立输出时按该音箱的优先方式显示。MiPlay 回退 MiNA 后更新标志。

已连接的发送端名称右侧也以相同样式显示 12×12 AirPlay 标志，暂停但保持连接时保留，等待连接占位卡片不显示。
