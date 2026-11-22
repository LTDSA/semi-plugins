# 米家聚合图标

原样提取自米家官方 Android 11.8.707 APK，来源、下载地址及 SHA-256 见 [共享资源登记](../../../assets/mijia-runtime.json)。提取前验证整个 APK 的 SHA-256，没有修改或重绘 WebP。

官方 `CategorySmallViewHolder` 使用下列资源；Android 资源表的亮色路径为 `r/b2/`，暗色路径为 `r/g/`，均为 xxhdpi。本目录以 `类别-light.webp`、`类别-dark.webp` 保存对应的两份原始文件。

| 类别 | 官方资源名 | APK 文件名 |
| --- | --- | --- |
| 灯光 | mj_icon_category_light_off | chy.webp |
| 灯光开启 | mj_icon_category_light_on | chz.webp |
| 环境 | mj_icon_category_env | chx.webp |
| 窗帘 | mj_icon_category_curtain_on | chw.webp |
| 窗帘闭合 | mj_icon_category_curtain_off | chv.webp |
| 摄像机 | mj_icon_category_camera | chu.webp |

灯光的开启、窗帘的闭合图分别保存为 `light-on-<主题>.webp`、`curtain-off-<主题>.webp`。由真实聚合状态选择图案，随 Semi 的 `body[theme-mode]` 选择原生亮／暗图，不通过 CSS 反色。环境与摄像机使用固定分类图案。
