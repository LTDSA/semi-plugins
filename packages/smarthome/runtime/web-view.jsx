import React from 'react';

// 原包网页仍在独立 opaque-origin frame 内运行；只允许当前租约的打包 HTML。
export function createWebView(View, base) {
    return React.forwardRef(({ source, style, onLoadEnd, onMessage, ...props }, ref) => {
        const frame = React.useRef(null);
        const uri = source?.uri;
        if (typeof uri !== 'string' || !uri.startsWith(base + 'assets/') || !/\.html$/.test(uri)) throw new Error('WebView 仅支持当前设备包内的 HTML');
        React.useImperativeHandle(ref, () => ({ postMessage: data => frame.current?.contentWindow?.postMessage(String(data), '*') }));
        React.useEffect(() => {
            const listener = event => {
                if (event.source === frame.current?.contentWindow && event.data?.channel === 'semi-mijia-webview') onMessage?.({ nativeEvent: { data: event.data.data } });
            };
            window.addEventListener('message', listener);
            return () => window.removeEventListener('message', listener);
        }, [onMessage]);
        return React.createElement(View, { style }, React.createElement('iframe', {
            ref: frame, src: uri, sandbox: 'allow-scripts', onLoad: () => onLoadEnd?.({ nativeEvent: { url: uri } }),
            style: { width: '100%', height: '100%', flex: 1, border: 0 },
        }));
    });
}
