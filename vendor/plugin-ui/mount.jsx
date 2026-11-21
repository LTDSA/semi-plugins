import '@douyinfe/semi-ui/react19-adapter';
import { createRoot } from 'react-dom/client';
import { useEffect, useState } from 'react';
import { semi } from '@semi-app/plugin-sdk';
import ThemeProvider from './theme.jsx';
import { configureModalHost } from './modal.jsx';
import './base.css';

export async function mountPlugin(Component, { full = false } = {}) {
    const initial = semi.getAppBaseInfo();
    document.body.setAttribute('theme-mode', initial.theme);
    configureModalHost(semi);
    function Root() {
        const [theme, setTheme] = useState(initial.theme);
        useEffect(() => {
            const applyTheme = ({ theme }) => setTheme(theme);
            semi.onThemeChange(applyTheme);
            applyTheme(semi.getAppBaseInfo());
            return () => semi.offThemeChange(applyTheme);
        }, []);
        const [availability, setAvailability] = useState({ available: true });
        const embeddedContentTop = initial.platform === 'win32' ? 0 : 32;
        useEffect(() => {
            const off = semi.onEvent('availability.changed', setAvailability);
            semi.markViewReady().catch(e => setAvailability({ available: false, reason: e.message }));
            semi.getViewState().then(({ availability }) => setAvailability(availability)).catch(() => {});
            return off;
        }, []);
        return <ThemeProvider theme={theme}>
            <div inert={!availability.available} style={{ height: '100%', '--semi-embedded-content-top': `${embeddedContentTop}px` }}>
                {full ? <Component /> : <div className="semi-app-content"><Component /></div>}
            </div>
            {!availability.available && <div role="alert" style={{ position: 'fixed', inset: 0, background: 'var(--semi-color-bg-0)', display: 'grid', placeItems: 'center', zIndex: 99999, padding: 24 }}>
                <p>{availability.reason || '插件暂不可用'}</p>
            </div>}
        </ThemeProvider>;
    }
    createRoot(document.getElementById('root')).render(<Root />);
}
