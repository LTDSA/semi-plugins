import { Card } from '@semi/plugin-ui/ui.js';
import light from './assets/aggregations/light-light.webp';
import lightDark from './assets/aggregations/light-dark.webp';
import lightOn from './assets/aggregations/light-on-light.webp';
import lightOnDark from './assets/aggregations/light-on-dark.webp';
import env from './assets/aggregations/env-light.webp';
import envDark from './assets/aggregations/env-dark.webp';
import curtain from './assets/aggregations/curtain-light.webp';
import curtainDark from './assets/aggregations/curtain-dark.webp';
import curtainOff from './assets/aggregations/curtain-off-light.webp';
import curtainOffDark from './assets/aggregations/curtain-off-dark.webp';
import camera from './assets/aggregations/camera-light.webp';
import cameraDark from './assets/aggregations/camera-dark.webp';

const ICONS = { light: [light, lightDark], env: [env, envDark], curtain: [curtain, curtainDark], camera: [camera, cameraDark] };

export default function AggregationCard({ entry, state, cardSize = 'medium' }) {
    const icons = entry.id === 'light' && state?.active === true ? [lightOn, lightOnDark]
        : entry.id === 'curtain' && state?.active === false ? [curtainOff, curtainOffDark] : ICONS[entry.id];
    return <Card className="smart-device-card smart-aggregation-card" data-card-size={cardSize}>
        <div className="smart-device-top">
            <div className="smart-device-image smart-aggregation-image">
                <img className="smart-aggregation-icon-light" src={icons[0]} alt="" />
                <img className="smart-aggregation-icon-dark" src={icons[1]} alt="" />
            </div>
        </div>
        <div className="smart-device-text">
            <div className="smart-device-label">{entry.name}</div>
            <div className="smart-device-room">{state?.subtitle || '状态未知'}</div>
        </div>
    </Card>;
}
