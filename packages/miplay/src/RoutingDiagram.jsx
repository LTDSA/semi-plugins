import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { semi } from '../client/api.mjs';
import { IconMusic, Monitor, Smartphone, Tablet, MonitorSmartphone } from '@semi/plugin-ui/icons.js';
import { Checkbox } from '@semi/plugin-ui/ui.js';
import semiIcon from './semi.ico';
import semiCore from './assets/semi-core.png';
import minaIcon from './assets/mina.png';
import miplayIcon from './assets/miplay.png';
import airplayIcon from './assets/airplay.png';

function ReceiverIcon({ url, model }) {
    const [failed, setFailed] = useState(false);
    const [productImage, setProductImage] = useState(null);
    useEffect(() => {
        setFailed(false);
    }, [url]);
    useEffect(() => {
        setProductImage(null);
        if ((url && !failed) || !model) return;
        const controller = new AbortController();
        semi.callBackground('outputs.image', { model }, { signal: controller.signal }).then(image => {
            if (!controller.signal.aborted) setProductImage(image);
        }).catch(() => {});
        return () => controller.abort();
    }, [url, model, failed]);
    const image = url && !failed ? url : productImage;
    return image ? <img src={image} alt="" onError={() => { if (image === url) setFailed(true); else setProductImage(null); }} /> : <IconMusic />;
}

function SenderIcon({ userAgent = '' }) {
    if (/iPad|Tablet/i.test(userAgent)) return <Tablet />;
    if (/iPhone|iPod|Android|Mobile/i.test(userAgent)) return <Smartphone />;
    if (/Macintosh|Mac OS|Windows|Linux/i.test(userAgent)) return <Monitor />;
    return <MonitorSmartphone />;
}

// Layout adapted from magpie's routing stage: equal endpoint columns around
// a hub, with measured SVG cubic curves behind the cards. See docs/plugins/miplay-routing-design.md.
export default function RoutingDiagram({ speakers, selected, airplay, onChoose, disabled, loading = false, compact = false }) {
    const stage = useRef(null);
    const [wires, setWires] = useState([]);
    const routes = airplay.enabled ? airplay.routes || [] : [];
    const sources = new Map();
    for (const route of routes) {
        const sender = route.sender || {};
        const key = sender.address || route.speakerId;
        const previous = sources.get(key);
        sources.set(key, { ...sender, id: key, name: sender.name || previous?.name,
            userAgent: sender.userAgent || previous?.userAgent, playing: route.playing || previous?.playing || false });
    }
    const left = [...sources.values()];
    const right = speakers;
    const nodesKey = JSON.stringify([left, right.map(speaker => [speaker.id, speaker.name, speaker.imageUrl]), routes, airplay.enabled, [...selected]]);
    useLayoutEffect(() => {
        const root = stage.current;
        let frame;
        const measure = () => {
            const bounds = root.getBoundingClientRect();
            const hub = root.querySelector('.miplay-route-hub').getBoundingClientRect();
            const centerY = (hub.top + hub.bottom) / 2 - bounds.top;
            // Read every box first, as magpie does, before writing SVG paths.
            const boxes = [...root.querySelectorAll('[data-route-side]')].map(node => ({
                rect: node.getBoundingClientRect(), side: node.dataset.routeSide, active: node.dataset.active === 'true', playing: node.dataset.playing === 'true',
            }));
            setWires(boxes.map(({ rect, side, active, playing }) => {
                const x1 = side === 'left' ? rect.right - bounds.left : hub.right - bounds.left;
                const x2 = side === 'left' ? hub.left - bounds.left : rect.left - bounds.left;
                const y1 = side === 'left' ? (rect.top + rect.bottom) / 2 - bounds.top : centerY;
                const y2 = side === 'left' ? centerY : (rect.top + rect.bottom) / 2 - bounds.top;
                const middle = (x1 + x2) / 2;
                return { d: `M${x1} ${y1} C${middle} ${y1} ${middle} ${y2} ${x2} ${y2}`, active, playing };
            }));
        };
        const observer = new ResizeObserver(() => { cancelAnimationFrame(frame); frame = requestAnimationFrame(measure); });
        observer.observe(root);
        for (const node of root.querySelectorAll('.miplay-route-node')) observer.observe(node);
        measure();
        return () => { observer.disconnect(); cancelAnimationFrame(frame); };
    }, [nodesKey]);
    const endpoint = (side, id, icon, name, detail, active = false, checkbox, playing = false, badge) => <div key={id}
        className={`miplay-route-node${active ? ' is-active' : ''}`} data-route-side={side} data-active={active} data-playing={playing}>
        <span className="miplay-route-icon">{icon}</span>
        <div className="miplay-route-info"><div className="miplay-route-name"><b>{name}</b>{!compact && badge}</div><small>{detail}</small></div>
        {checkbox}
    </div>;
    return <div className={`miplay-route-stage${compact ? ' pr-stage' : ''}`} ref={stage}>
        <svg className="miplay-route-wires">{wires.map((wire, index) => <path key={index} d={wire.d} className={`${wire.active ? 'is-active' : ''}${wire.playing ? ' is-playing' : ''}`} />)}</svg>
        <div className="miplay-route-endpoints">{left.length ? left.map(sender => endpoint('left', sender.id,
            <SenderIcon userAgent={sender.userAgent} />,
            sender.name || '发送端', sender.address || '已连接', true, null, sender.playing,
            <img className="miplay-route-badge" src={airplayIcon} alt="" />)) :
            endpoint('left', 'empty', <MonitorSmartphone />, '发送端', '等待连接')}</div>
        <div className={`miplay-route-node miplay-route-hub${airplay.enabled ? ' is-active' : ''}`}>
            {compact ? <span className="miplay-tray-core" style={{ maskImage: `url(${semiCore})`, WebkitMaskImage: `url(${semiCore})` }} /> : <><img src={semiIcon} alt="" /><b>Semi</b></>}
        </div>
        <div className="miplay-route-endpoints">{right.length ? right.map(speaker => {
            const active = routes.some(route => route.speakerId === speaker.id);
            const backend = airplay.backends?.[speaker.id] || (speaker.protocols?.includes('miplay') ? 'miplay' : 'mina');
            const location = speaker.homeName && speaker.roomName ? `${speaker.homeName}-${speaker.roomName}` : speaker.homeName || speaker.roomName || '位置未知';
            return endpoint('right', speaker.id, <ReceiverIcon key={speaker.imageUrl || speaker.miplay?.model || speaker.model || 'default'} url={speaker.imageUrl} model={speaker.miplay?.model || speaker.model} />,
                speaker.name, location, active,
                !compact && <Checkbox className="miplay-route-checkbox" checked={selected.has(speaker.id)} disabled={disabled}
                    onChange={event => onChoose?.(speaker.id, event.target.checked)} />, routes.some(route => route.speakerId === speaker.id && route.playing),
                <img className="miplay-route-badge" src={backend === 'miplay' ? miplayIcon : minaIcon} alt="" />);
        }) : endpoint('right', 'empty', <IconMusic />, '接收端', loading ? '正在加载' : '暂无音箱')}</div>
    </div>;
}
