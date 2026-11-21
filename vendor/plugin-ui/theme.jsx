import { useEffect } from 'react';

import { ConfigProvider } from './ui.js';

import './semi.css';
import './theme.css';

// 主题来源由调用方提供；宿主页面与插件页面采用各自的通信方式。
export default function ThemeProvider({ children, theme }) {
    useEffect(() => {
        document.body.setAttribute('theme-mode', theme);
    }, [theme]);

    // 自定义滚动条只在滚动时显形：给正在滚动的元素打上 .is-scrolling，停手后摘掉。
    // 滚动事件不冒泡，因此用捕获阶段监听。
    useEffect(() => {
        let current = null;
        let timer;

        const onScroll = event => {
            const el = event.target === document ? document.documentElement : event.target;
            if (!(el instanceof Element)) return;

            if (current && current !== el) current.classList.remove('is-scrolling');
            current = el;
            el.classList.add('is-scrolling');

            clearTimeout(timer);
            timer = setTimeout(() => {
                if (current) current.classList.remove('is-scrolling');
                current = null;
            }, 900);
        };

        document.addEventListener('scroll', onScroll, true);
        return () => {
            document.removeEventListener('scroll', onScroll, true);
            clearTimeout(timer);
        };
    }, []);

    // 指针压在某个元素的滚动条那条窄带上时，给它打 .is-scrollbar-hover，滑块随之变宽。
    // 原生滚动条伪元素没法响应 :hover 并过渡，只能在元素上驱动。
    useEffect(() => {
        const STRIP = 6;
        let current = null;
        let frame = 0;

        const update = event => {
            frame = 0;

            let node = event.target instanceof Element ? event.target : null;
            let hit = null;

            while (node && node !== document.documentElement) {
                const style = getComputedStyle(node);
                const barY = node.scrollHeight > node.clientHeight && style.overflowY !== 'hidden';
                const barX = node.scrollWidth > node.clientWidth && style.overflowX !== 'hidden';

                if (barY || barX) {
                    const rect = node.getBoundingClientRect();
                    const right = rect.right - parseFloat(style.borderRightWidth);
                    const bottom = rect.bottom - parseFloat(style.borderBottomWidth);

                    if ((barY && event.clientX >= right - STRIP) || (barX && event.clientY >= bottom - STRIP)) {
                        hit = node;
                        break;
                    }
                }

                node = node.parentElement;
            }

            if (current === hit) return;
            if (current) current.classList.remove('is-scrollbar-hover');
            if (hit) hit.classList.add('is-scrollbar-hover');
            current = hit;
        };

        // mousemove 很密集，压到每帧最多算一次
        const onMove = event => {
            if (!frame) frame = requestAnimationFrame(() => update(event));
        };

        document.addEventListener('mousemove', onMove);
        return () => {
            document.removeEventListener('mousemove', onMove);
            if (frame) cancelAnimationFrame(frame);
            if (current) current.classList.remove('is-scrollbar-hover');
        };
    }, []);

    return <ConfigProvider>{children}</ConfigProvider>;
}
