# Semi Plugin SDK

Semi 插件的 JavaScript SDK，提供账号登录、设备能力、后台通信、存储、主题和界面扩展接口，附带 TypeScript 类型。版本号与 Semi 宿主同步。

```sh
npm install @semi-app/plugin-sdk
```

```js
import { semi } from '@semi-app/plugin-sdk';

const applyTheme = ({ theme }) => document.body.setAttribute('theme-mode', theme);
applyTheme(semi.getAppBaseInfo());
semi.onThemeChange(applyTheme);
window.addEventListener('pagehide', () => semi.offThemeChange(applyTheme), { once: true });
await semi.markViewReady();
```

[插件开发指南](https://github.com/LTDSA/Semi/tree/main/docs/plugins) · [API 参考](https://github.com/LTDSA/Semi/blob/main/docs/plugins/reference.md)
