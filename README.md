# Semi 社区插件

Semi 的可独立安装插件。目前包含音频互联（`@semi-app/miplay`）。源码目录和安装包文件名都使用包名末段，例如 `packages/miplay` 和 `tgz/miplay-1.0.0.tgz`。

开发时只克隆源码分支，避免下载发行包对象。

```sh
git clone --single-branch --branch main https://github.com/LTDSA/semi-plugins.git
cd semi-plugins
npm ci
npm run build
npm test
npm run pack
```

本地打包输出到临时目录，命令会打印 tarball 路径。主分支的 Actions 将通过检查的包放在独立 `dist` 分支，每版一个文件，例如 `tgz/miplay-1.0.0.tgz`。分支上的 `index.json` 记录各版路径、校验值和发行元数据，供 npm 发布任务核对安装包。其中的 `icon` 是插件原始声明，WebP 预览路径 `iconUrl` 由发布流程写入 Pages 的 `registry.json`。同一 npm 包的同一版本不可覆盖，更新安装包内容须增加版本号。转入 `@semi-app` 时，发行分支会移除同名无作用域包及其索引条目。社区客户端从 npm 下载安装，Pages 目录每个插件只列最新正式版，预发行包使用 npm 的 `next` 标签。

首次由对 `@semi-app` 有发布权限的维护者登录 npm 后发布 `dist` 分支中的原始文件。可用 `git clone --depth 1 --single-branch --branch dist https://github.com/LTDSA/semi-plugins.git semi-plugins-dist` 下载发行分支，再执行 `npm publish ./semi-plugins-dist/tgz/miplay-1.0.0.tgz --access public --ignore-scripts`。

随后将 npm Trusted Publisher 绑定到 `LTDSA/semi-plugins` 的 `plugins.yml` 并允许直接发布，配置 GitHub App 凭据 `RELEASES_APP_ID` / `RELEASES_APP_PRIVATE_KEY`（仅目标仓库 Contents 写权限），最后设置仓库变量 `ENABLE_NPM_PUBLISH=true`。Pages 由 semi-releases 自己部署。主分支的插件 `package.json` 有改动时检查 `dist/index.json`，只打包和发布尚未归档的包名及版本。只修改 README 不触发自动发布。手动运行工作流可复用已归档的安装包，补发到 npm 或补同步目录。Trusted Publisher 需在配置后两天内经工作流实际发布一个新版本，才会验证并绑定配置。

构建依赖快照见 [vendor](vendor/README.md)。
