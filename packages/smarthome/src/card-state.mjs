export function curtainToggleAction(curtain) {
    if (!curtain?.supported) return null;
    if (curtain.motion === 'opening') return 'close';
    if (curtain.motion === 'closing') return 'open';
    const position = curtain.position;
    return typeof position === 'number' && Number.isFinite(position) && position >= 0 && position <= 100
        ? position <= 2 ? 'open' : 'close' : null;
}

export function deviceDetails(state) {
    const readings = (state?.readings || [])
        .filter(reading => (reading.name !== 'brightness' || state.on === true) && (reading.name !== 'current-position' || !state.curtain))
        .map(reading => reading.name === 'connected-device-number' ? `${reading.label} ${reading.value}` : `${reading.value}${reading.unit}`);
    const statuses = state?.on === true ? (state.statuses || []).map(status => status.text) : [];
    return [...(state?.curtain?.text ? [state.curtain.text] : []), ...statuses, ...readings].join(' ');
}
