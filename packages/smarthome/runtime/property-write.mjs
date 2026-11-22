const cancelled = () => Object.assign(new Error('操作已取消'), { code: 'CANCELLED' });

// 写指令只发一次。code 1 或响应丢失时用读回来确认，不能把已接受当作完成。
export async function writeAndConfirm({ properties, readable, write, read, publish, active, wait = ms => new Promise(resolve => setTimeout(resolve, ms)) }) {
    if (!active()) throw cancelled();
    let response, writeError;
    try { response = await write(properties); }
    catch (e) {
        if (['CANCELLED', 'CONTEXT_CHANGED', 'AUTH_EXPIRED', 'AUTH_REQUIRED', 'PERMISSION_DENIED', 'INVALID_ARGUMENT', 'PROPERTY_UNSUPPORTED', 'DEVICE_OFFLINE'].includes(e.code)) throw e;
        writeError = e;
    }
    if (!active()) throw cancelled();
    if (!readable.length) { if (writeError) throw writeError; return response; }
    for (const delay of [0, 250, 600, 1200]) {
        if (delay) await wait(delay);
        if (!active()) throw cancelled();
        try {
            const states = await read(readable);
            if (!active()) throw cancelled();
            publish(states);
            if (readable.every(prop => states.some(state => state.siid === prop.siid && state.piid === prop.piid && state.code === 0 && state.value === prop.value))) {
                if (writeError && readable.length !== properties.length) throw writeError;
                return (response || properties).map(item => readable.some(prop => prop.siid === item.siid && prop.piid === item.piid) ? { did: item.did, siid: item.siid, piid: item.piid, code: 0 } : item);
            }
        } catch (e) { if (['CANCELLED', 'CONTEXT_CHANGED', 'AUTH_EXPIRED', 'AUTH_REQUIRED', 'RUNTIME_CLOSED'].includes(e.code)) throw e; }
    }
    if (writeError) throw writeError;
    if (response.some(item => ![0, 1].includes(item.code))) return response;
    throw Object.assign(new Error('尚未确认设备状态，请稍后查看'), { code: 'STATE_UNCONFIRMED' });
}
