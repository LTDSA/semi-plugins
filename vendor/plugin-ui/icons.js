// 图标统一入口。
//
// 优先用 Semi 图标集（与 Semi Design 视觉一致）；Semi 没有合适对应时用 Lucide 补充。
// 均深路径导入单图标，避免 barrel 把整个图标库（数十 MB）塞进 Vite 的 dev 预打包产物。
// 图标名沿用各库原始命名，新增时在此登记。

// --- Semi 图标 ---
export { default as IconChevronLeft } from '@douyinfe/semi-icons/lib/es/icons/IconChevronLeft';
export { default as IconChevronRight } from '@douyinfe/semi-icons/lib/es/icons/IconChevronRight';
export { default as IconFolder } from '@douyinfe/semi-icons/lib/es/icons/IconFolder';
export { default as IconFile } from '@douyinfe/semi-icons/lib/es/icons/IconFile';
export { default as IconImage } from '@douyinfe/semi-icons/lib/es/icons/IconImage';
export { default as IconCode } from '@douyinfe/semi-icons/lib/es/icons/IconCode';
export { default as IconTreeTriangleDown } from '@douyinfe/semi-icons/lib/es/icons/IconTreeTriangleDown';
export { default as IconTriangleDown } from '@douyinfe/semi-icons/lib/es/icons/IconTriangleDown';
// 字形只占 em 框一小部分，用来逼近 Material 的 arrow_drop_down
export { default as IconSmallTriangleDown } from '@douyinfe/semi-icons/lib/es/icons/IconSmallTriangleDown';
export { default as IconWifi } from '@douyinfe/semi-icons/lib/es/icons/IconWifi';
export { default as IconGridView } from '@douyinfe/semi-icons/lib/es/icons/IconGridView';
export { default as IconInbox } from '@douyinfe/semi-icons/lib/es/icons/IconInbox';
export { default as IconDisc } from '@douyinfe/semi-icons/lib/es/icons/IconDisc';
export { default as IconGlobeStroke } from '@douyinfe/semi-icons/lib/es/icons/IconGlobeStroke';
export { default as IconQrCode } from '@douyinfe/semi-icons/lib/es/icons/IconQrCode';
export { default as IconExternalOpen } from '@douyinfe/semi-icons/lib/es/icons/IconExternalOpen';
export { default as IconSetting } from '@douyinfe/semi-icons/lib/es/icons/IconSetting';
export { default as IconSettingStroked } from '@douyinfe/semi-icons/lib/es/icons/IconSettingStroked';
export { default as IconMore } from '@douyinfe/semi-icons/lib/es/icons/IconMore';
export { default as IconPlus } from '@douyinfe/semi-icons/lib/es/icons/IconPlus';
export { default as IconUserCircle } from '@douyinfe/semi-icons/lib/es/icons/IconUserCircle';
export { default as IconExport } from '@douyinfe/semi-icons/lib/es/icons/IconExport';
export { default as IconLink } from '@douyinfe/semi-icons/lib/es/icons/IconLink';
export { default as IconAppCenter } from '@douyinfe/semi-icons/lib/es/icons/IconAppCenter';
export { default as IconApps } from '@douyinfe/semi-icons/lib/es/icons/IconApps';
export { default as IconPuzzle } from '@douyinfe/semi-icons/lib/es/icons/IconPuzzle';
export { default as IconPulse } from '@douyinfe/semi-icons/lib/es/icons/IconPulse';
export { default as IconTerminal } from '@douyinfe/semi-icons/lib/es/icons/IconTerminal';
export { default as IconLockStroked } from '@douyinfe/semi-icons/lib/es/icons/IconLockStroked';
export { default as IconArrowUp } from '@douyinfe/semi-icons/lib/es/icons/IconArrowUp';
export { default as IconArrowDown } from '@douyinfe/semi-icons/lib/es/icons/IconArrowDown';
export { default as IconCheckCircleStroked } from '@douyinfe/semi-icons/lib/es/icons/IconCheckCircleStroked';
export { default as IconAlertCircle } from '@douyinfe/semi-icons/lib/es/icons/IconAlertCircle';
export { default as IconRefresh } from '@douyinfe/semi-icons/lib/es/icons/IconRefresh';
export { default as IconQuit } from '@douyinfe/semi-icons/lib/es/icons/IconQuit';
export { default as IconPause } from '@douyinfe/semi-icons/lib/es/icons/IconPause';
export { default as IconSearch } from '@douyinfe/semi-icons/lib/es/icons/IconSearch';

// --- Lucide（Semi 无对应时使用）---
export { default as Monitor } from 'lucide-react/dist/esm/icons/monitor.mjs';
export { default as Smartphone } from 'lucide-react/dist/esm/icons/smartphone.mjs';
export { default as Tablet } from 'lucide-react/dist/esm/icons/tablet.mjs';
export { default as MonitorSmartphone } from 'lucide-react/dist/esm/icons/monitor-smartphone.mjs';
export { default as Network } from 'lucide-react/dist/esm/icons/network.mjs';
export { default as GlobeOff } from 'lucide-react/dist/esm/icons/globe-off.mjs';
export { default as EthernetPort } from 'lucide-react/dist/esm/icons/ethernet-port.mjs';
export { default as PanelsLeftRight } from 'lucide-react/dist/esm/icons/panels-left-right.mjs';
export { default as Pause } from 'lucide-react/dist/esm/icons/pause.mjs';
// 线框 info：Semi 的 IconInfoCircle 是实心圆（22/24），比旧版的描边字形重得多
export { default as Info } from 'lucide-react/dist/esm/icons/info.mjs';
export { default as IconDeleteStroked } from '@douyinfe/semi-icons/lib/es/icons/IconDeleteStroked';
export { default as IconMusic } from '@douyinfe/semi-icons/lib/es/icons/IconMusic';

export { default as IconUser } from '@douyinfe/semi-icons/lib/es/icons/IconUser';

export { default as TabletSmartphone } from 'lucide-react/dist/esm/icons/tablet-smartphone.mjs';
export { default as Settings2 } from 'lucide-react/dist/esm/icons/settings-2.mjs';

export { default as MemoryStick } from 'lucide-react/dist/esm/icons/memory-stick.mjs';
