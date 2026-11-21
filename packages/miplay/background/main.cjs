module.exports = async function start(semi, dependencies) {
    const backend = dependencies ? null : await require('../host/sdk-backend.cjs').startBackend(semi);
    semi = (await import('../client/services.mjs')).withMina(semi);
    const { Receiver, lanAddress } = dependencies || await import('./engine.mjs');
    const { PreferredOutputBackend } = await import('./miplay-output.mjs');
    const { MiPlayDiscovery, mergeOutputs } = await import('./miplay-discovery.mjs');
    const { restoreSelection } = await import('../src/selection.mjs');
    const { createSpeakerImages } = await import('./speaker-images.mjs');
    const getImage = dependencies ? dependencies.getImage : createSpeakerImages({ request: semi.request, cache: { get: semi.getCache, set: semi.setCache } });
    const debugOff = semi.onEvent('mina.debug', data => semi.emitBackgroundEvent('mina.debug', data).catch(() => {}));
    const outputs = new Map();
    let discovery = dependencies?.discovery || null, cachedCloud = null, cloudRequest = null;
    let protocols = { mina: true, miplay: true };
    const preferencesReady = semi.getStorage({ key: 'output-protocols' }).then(({ data: saved }) => {
        if (saved && typeof saved.mina === 'boolean' && typeof saved.miplay === 'boolean') protocols = { mina: saved.mina, miplay: saved.miplay };
    });
    const deviceList = async options => {
        await preferencesReady;
        if (protocols.miplay && !discovery && !dependencies) {
            try {
                discovery = new MiPlayDiscovery({ ip: lanAddress() });
                discovery.on('changed', () => semi.emitBackgroundEvent('audio.outputs.changed', {}).catch(() => {}));
                discovery.on('diagnostic', detail => semi.emitBackgroundEvent('airplay.diagnostic', detail).catch(() => {}));
                discovery.start();
            } catch (error) {
                discovery?.close(); discovery = null;
                semi.emitBackgroundEvent('airplay.diagnostic', { phase: 'miplay-discovery', result: 'unavailable', message: error.message }).catch(() => {});
            }
        }
        let cloud;
        if (!protocols.mina) cloud = await semi.callBackground('mina.getSpeakers', { skipCloud: true }, options);
        else if (cachedCloud && cachedCloud.until > Date.now()) cloud = cachedCloud.value;
        else {
            const request = cloudRequest || (cloudRequest = semi.callBackground('mina.getSpeakers', {}, options));
            try {
                cloud = await request;
                if (cloudRequest === request) cachedCloud = { value: cloud, until: Date.now() + 2000 };
            } finally { if (cloudRequest === request) cloudRequest = null; }
        }
        const local = protocols.miplay && discovery ? await discovery.list() : [];
        await semi.emitBackgroundEvent('miplay.devices', { discovered: discovery?.snapshot?.() || [], available: local }).catch(() => {});
        return { accountId: cloud.accountId, speakers: mergeOutputs(protocols.mina ? cloud.speakers : [], local), protocols: { ...protocols }, ...(protocols.mina && cloud.unavailable ? { cloudUnavailable: cloud.unavailable } : {}) };
    };
    let receivers = [], active = false, ids = [], accountId = null, generation = 0, accountEpoch = 0, disposed = false;
    let queue = Promise.resolve();
    const played = new Set(), controls = new Map(), routes = new Map(), names = new Map();
    const senderInfo = (sender = {}) => {
        const cached = names.get(sender.address);
        const previous = cached?.until > Date.now() ? cached.sender : {};
        const result = { ...previous, ...sender, name: sender.name || previous.name || '', userAgent: sender.userAgent || previous.userAgent || '' };
        const keepProtocolName = sender.nameSource === 'bonjour' && previous.name && cached.source === 'rtsp';
        if (keepProtocolName) {
            result.name = previous.name;
            if (previous.nameSource) result.nameSource = previous.nameSource; else delete result.nameSource;
        }
        if (sender.name && sender.address) {
            if (!keepProtocolName) {
                names.delete(sender.address); names.set(sender.address, { sender: result, source: sender.nameSource === 'bonjour' ? 'bonjour' : 'rtsp', until: Date.now() + 600000 });
            }
            while (names.size > 128) names.delete(names.keys().next().value);
            // A sender can keep an OPTIONS/control socket while its audio
            // socket comes and goes. Both belong to the same live peer.
            for (const route of routes.values()) if (route.sender.address === sender.address) {
                route.sender = { ...route.sender, name: result.name, userAgent: result.userAgent || route.sender.userAgent };
            }
        }
        return result;
    };
    const state = () => ({ enabled: active, speakerIds: [...ids], backends: Object.fromEntries([...outputs].map(([id, output]) => [id, output.kind || (output.device?.miplay ? 'miplay' : 'mina')])),
        speakers: [...outputs].map(([id, output]) => ({ id, name: output.device?.name || '音箱', model: output.device?.model, imageUrl: output.device?.imageUrl, miplay: output.device?.miplay, protocols: output.device?.protocols })),
        routes: [...routes.values()].map(route => ({ ...route, sender: { ...route.sender } })) });
    const publish = error => semi.emitBackgroundEvent('airplay.changed', { ...state(), ...(error ? { error } : {}) });
    const control = event => {
        if (event.type === 'diagnostic') {
            const { type, id, ...detail } = event;
            semi.emitBackgroundEvent('airplay.diagnostic', { speakerId: id, ...detail }).catch(() => {}); return;
        }
        if (!active || !ids.includes(event.id) || disposed) return;
        if (event.type === 'output-error') {
            serial(async () => { await stop(); await publish(event.message); }).catch(() => {}); return;
        }
        const routeKey = `${event.id}:${event.connectionId ?? 'stream'}`;
        if (event.type === 'connection') {
            if (event.connected) {
                const route = { speakerId: event.id, connectionId: event.connectionId, sender: senderInfo(event.sender), playing: routes.get(routeKey)?.playing || false };
                routes.set(routeKey, route);
            }
            else routes.delete(routeKey);
            publish().catch(() => {}); return;
        }
        if (event.type !== 'play' && !played.has(event.id)) return;
        if (event.type === 'play') {
            const route = { speakerId: event.id, connectionId: event.connectionId, sender: senderInfo(event.sender), playing: true };
            routes.set(routeKey, route);
            publish().catch(() => {});
        } else if (event.type === 'stop') {
            if (routes.has(routeKey)) routes.set(routeKey, { ...routes.get(routeKey), playing: false });
            publish().catch(() => {});
        }
        if (event.type === 'play') played.add(event.id);
        const token = generation;
        const previous = controls.get(event.id) || { job: Promise.resolve(), count: 0 };
        if (previous.count >= 32) return;
        const next = { count: previous.count + 1 };
        next.job = previous.job.catch(() => {}).then(async () => {
            if (!active || generation !== token) return;
            const value = event.type === 'volume' ? event.value <= -30 ? 0 : Math.min(100, Math.round((event.value + 30) / 30 * 100)) : event.url;
            const output = outputs.get(event.id);
            if (!output) throw new Error('音频输出已失效');
            if (event.type === 'play') await output.start({ url: value, sampleRate: 44100, channels: 2, sampleFormat: 's16le' });
            else if (event.type === 'stop') await output.stop();
            else if (event.type === 'volume') await output.setVolume(value);
            await semi.emitBackgroundEvent('airplay.diagnostic', { speakerId: event.id, phase: 'speaker-control', command: event.type, result: 'accepted' });
            if (event.type === 'play') await publish();
            if (event.type === 'stop') played.delete(event.id);
        }).catch(async e => {
            if (!active || generation !== token) return;
            await semi.emitBackgroundEvent('airplay.diagnostic', { speakerId: event.id, phase: 'speaker-control', command: event.type, result: 'failed', code: e.code || 'CONTROL_FAILED' }).catch(() => {});
            await publish(e.message);
        }).finally(() => { next.count--; if (controls.get(event.id) === next) controls.delete(event.id); });
        controls.set(event.id, next);
    };
    const stop = async (stopSpeakers = true) => {
        active = false; generation++; routes.clear(); names.clear();
        await Promise.allSettled(receivers.map(receiver => receiver.stop())); receivers = []; ids = [];
        for (const output of outputs.values()) output.cancelPending?.();
        await Promise.allSettled([...controls.values()].map(c => c.job)); controls.clear();
        await Promise.allSettled([...outputs.values()].map(output => output.disconnect({ stopDevice: stopSpeakers }))); outputs.clear();
        played.clear(); await semi.setBackgroundActive(false); await publish();
    };
    const set = async ({ enabled, speakerIds }, { signal } = {}, persist = true) => {
        const epoch = accountEpoch;
        if (typeof enabled !== 'boolean' || !Array.isArray(speakerIds) || speakerIds.length > 16 || new Set(speakerIds).size !== speakerIds.length || !speakerIds.every(id => typeof id === 'string') || enabled && !speakerIds.length) throw new Error('请选择 1 至 16 台音箱');
        if (disposed || signal?.aborted) throw new Error('请求已取消');
        if (!enabled) {
            await stop();
            if (persist && accountId) await semi.setStorage({ key: `airplay:${accountId}`, data: { enabled: false, speakerIds } });
            return state();
        }
        cachedCloud = null;
        const list = await deviceList({ signal });
        if (epoch !== accountEpoch || disposed || signal?.aborted) throw new Error('请求已取消');
        const speakers = speakerIds.map(id => list.speakers.find(speaker => speaker.id === id));
        if (enabled && !speakers.every(Boolean)) throw new Error('所选音箱已不在当前账号设备列表中');
        if (speakers.some(speaker => speaker.online === false)) throw new Error('所选音箱已离线');
        if (active && accountId === list.accountId && ids.length === speakerIds.length && ids.every(id => speakerIds.includes(id))) return state();
        await stop(accountId === list.accountId); accountId = list.accountId;
        if (enabled) {
            await semi.setBackgroundActive(true, { tray: 'main' });
            try {
                const ip = lanAddress(); ids = [...speakerIds]; active = true;
                for (const speaker of speakers) {
                    const output = new PreferredOutputBackend(semi, {
                        diagnostic: detail => semi.emitBackgroundEvent('airplay.diagnostic', { speakerId: speaker.id, ...detail }).catch(() => {}),
                        onFailure: error => control({ type: 'output-error', id: speaker.id, message: error.message }),
                    });
                    await output.connect(speaker); outputs.set(speaker.id, output);
                    const receiver = new Receiver({ ip, accountId, speaker, onEvent: control, output });
                    receivers.push(receiver); await receiver.start();
                    if (disposed || epoch !== accountEpoch || signal?.aborted) throw new Error('请求已取消');
                }
                await semi.setBackgroundActive(true, { tray: 'main' });
            } catch (e) { await stop(); throw e; }
        }
        if (persist) await semi.setStorage({ key: `airplay:${accountId}`, data: { enabled, speakerIds } });
        await publish(); return state();
    };
    const serial = work => { const job = queue.catch(() => {}).then(work); queue = job; return job; };
    semi.handleBackgroundCall('airplay.get', () => state());
    semi.handleBackgroundCall('outputs.list', () => deviceList());
    semi.handleBackgroundCall('outputs.image', ({ model }, { signal } = {}) => getImage ? getImage(model, signal) : null);
    semi.handleBackgroundCall('outputs.configure', (params, options) => serial(async () => {
        await preferencesReady;
        if (!params || typeof params.mina !== 'boolean' || typeof params.miplay !== 'boolean' || Object.keys(params).some(key => !['mina', 'miplay'].includes(key))) throw new Error('无效接收端设置');
        const enabled = active, previous = [...ids];
        await stop();
        protocols = { mina: params.mina, miplay: params.miplay };
        if (!protocols.miplay) { discovery?.close(); discovery = null; }
        cachedCloud = null;
        await semi.setStorage({ key: 'output-protocols', data: protocols });
        const list = await deviceList(options);
        const selected = [...restoreSelection(previous, list.speakers)];
        if (enabled) await set({ enabled: selected.length > 0, speakerIds: selected }, options);
        return list;
    }));
    semi.handleBackgroundCall('airplay.set', (params, options) => serial(() => set(params, options)));
    const restore = () => serial(async () => {
        const scope = await semi.callBackground('mina.getSpeakers', { skipCloud: true });
        if (scope.accountId !== accountId) { await stop(false); accountId = scope.accountId; }
        const { data: saved } = await semi.getStorage({ key: `airplay:${accountId}` });
        if (saved?.enabled && !active) {
            const list = await deviceList();
            const speakerIds = [...restoreSelection(saved.speakerIds, list.speakers)];
            if (speakerIds.length) await set({ ...saved, speakerIds }, {}, false);
        }
    }).catch(e => publish(e.message));
    const off = semi.onEvent('mina.account.changed', () => {
        cachedCloud = null; cloudRequest = null; discovery?.close(); discovery = null;
        generation++; accountEpoch++;
        serial(() => stop(false)).then(restore).catch(e => publish(e.message));
    });
    const permissionsOff = semi.onEvent('permissions.changed', event => {
        if (event.permissions['ui.tray.create'] === false) { generation++; serial(() => stop()); }
    });
    // Register first, then restore without delaying the SDK readiness handshake.
    setTimeout(restore, 0);
    return async () => { disposed = true; backend?.dispose(); generation++; off(); permissionsOff(); debugOff(); discovery?.close(); await stop(); };
};
