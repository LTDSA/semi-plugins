# 音频互联

Semi 插件，将 AirPlay 音频转发到支持的小米音箱。需在 Semi 中启用，使用系统访问和托盘权限。访问在线音箱时使用 Semi 的小米账号授权。

插件包含单独构建的 PlayFair WASM。对应源码、构建说明和许可证随包保留，见 [PlayFair](background/vendor/playfair/README.md)。重新构建 WASM 可执行 `npm run build:fairplay -w miplay`。普通插件打包使用仓库中的 WASM。
