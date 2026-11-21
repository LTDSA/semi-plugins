// Semi Design 组件统一入口。
//
// 不要直接 `import { Card } from '@douyinfe/semi-ui'`：barrel 入口会把整个
// 组件库（约 7.8MB）塞进 Vite 的 dev 预打包产物，导致首次打开页面等数秒。
// 这里按组件深路径导入后再统一导出，页面可保持简洁语法而不引入全量依赖。
// 新增组件时在此登记。
export { default as ConfigProvider } from '@douyinfe/semi-ui/lib/es/configProvider';
export { default as Card } from '@douyinfe/semi-ui/lib/es/card';
export { default as Descriptions } from '@douyinfe/semi-ui/lib/es/descriptions';
export { default as Button } from '@douyinfe/semi-ui/lib/es/button';
export { default as Switch } from '@douyinfe/semi-ui/lib/es/switch';
export { default as Toast } from '@douyinfe/semi-ui/lib/es/toast';
export { default as Checkbox } from '@douyinfe/semi-ui/lib/es/checkbox';
export { default as Input } from '@douyinfe/semi-ui/lib/es/input';
export { default as Spin } from '@douyinfe/semi-ui/lib/es/spin';
export { default as Tabs } from '@douyinfe/semi-ui/lib/es/tabs';
export { default as Typography } from '@douyinfe/semi-ui/lib/es/typography';
export { default as Tooltip } from '@douyinfe/semi-ui/lib/es/tooltip';
export { default as Modal } from './modal.jsx';
export { default as Select } from '@douyinfe/semi-ui/lib/es/select';
export { default as Radio } from '@douyinfe/semi-ui/lib/es/radio';
export { default as Avatar } from '@douyinfe/semi-ui/lib/es/avatar';
export { default as Table } from '@douyinfe/semi-ui/lib/es/table';
export { default as List } from '@douyinfe/semi-ui/lib/es/list';
export { default as Dropdown } from '@douyinfe/semi-ui/lib/es/dropdown';
export { default as SplitButtonGroup } from '@douyinfe/semi-ui/lib/es/button/splitButtonGroup';
export { default as Nav } from '@douyinfe/semi-ui/lib/es/navigation';
export { default as Progress } from '@douyinfe/semi-ui/lib/es/progress';
export { default as Empty } from '@douyinfe/semi-ui/lib/es/empty';
export { default as ImagePreview } from '@douyinfe/semi-ui/lib/es/image/preview';
