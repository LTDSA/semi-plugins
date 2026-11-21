import { useEffect, useState } from 'react';
import { semi } from '@semi-app/plugin-sdk';

// 原生内嵌视图的 viewport 小于主窗口；沿用主窗口断点时使用宿主提供的尺寸。
export function useHostViewport() {
    const [viewport, setViewport] = useState({ width: window.innerWidth, height: window.innerHeight });
    useEffect(() => {
        let active = true;
        const off = semi.onEvent('host.viewport.changed', setViewport);
        semi.getViewState().then(context => { if (active) setViewport(context.hostViewport); }).catch(() => {});
        return () => { active = false; off(); };
    }, []);
    return viewport;
}
