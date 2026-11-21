import { useEffect, useState } from 'react';
import { semi } from '../client/api.mjs';
import { mountPlugin } from '@semi/plugin-ui/mount.jsx';
import RoutingDiagram from './RoutingDiagram.jsx';
import './miplay.css';
import './tray.css';

function AudioTray() {
    const [state, setState] = useState({ enabled: false, speakerIds: [], routes: [], speakers: [] });
    useEffect(() => {
        let active = true;
        semi.callBackground('airplay.get').then(value => { if (active) setState(value); }).catch(console.error);
        const off = semi.onBackgroundEvent('airplay.changed', value => setState(value));
        return () => { active = false; off(); };
    }, []);
    return <div className="miplay-tray"><RoutingDiagram compact speakers={state.speakers || []} selected={new Set(state.speakerIds)} airplay={state} disabled /></div>;
}
mountPlugin(AudioTray, { full: true });
