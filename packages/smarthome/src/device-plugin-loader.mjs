export function createDevicePluginLoader({ did, open, close, onState, waitForDownloadClose = () => true }) {
    let controller, runtime, disposed = false, confirmed = false, resourcesReady = false;
    let state = { phase: 'checking', runtime: null, progress: null, deviceProgress: null, error: null };
    const update = patch => { state = { ...state, ...patch }; onState(state); };
    const release = () => { if (runtime) { close(runtime.id).catch(() => {}); runtime = null; } };
    const start = async (download = false) => {
        if (disposed) return;
        controller?.abort(); release();
        const current = new AbortController(); controller = current;
        let sharedCompleted = false;
        update({ phase: download ? 'downloading' : 'checking', runtime: null, progress: null, deviceProgress: null, error: null });
        try {
            const value = await open(did, { signal: current.signal, download, onDownloadProgress: progress => {
                if (disposed || controller !== current || current.signal.aborted) return;
                if (progress.resource === 'device') update({ deviceProgress: progress });
                else if (progress.phase === 'ready') {
                    sharedCompleted = true; resourcesReady = true;
                    update({ progress, phase: download && waitForDownloadClose() ? 'transition' : 'plugin' });
                } else update({ progress });
            } });
            if (disposed || controller !== current || current.signal.aborted) { await close(value.id).catch(() => {}); return; }
            runtime = value;
            update({ phase: state.phase === 'transition' || download && !sharedCompleted && waitForDownloadClose() ? 'transition' : 'plugin', runtime: value, deviceProgress: null });
        } catch (error) {
            if (disposed || controller !== current || current.signal.aborted) return;
            update({ phase: error.code === 'PLUGIN_DOWNLOAD_REQUIRED' ? 'confirm' : download && !sharedCompleted ? 'download-error' : 'plugin-error', error: error.code === 'PLUGIN_DOWNLOAD_REQUIRED' ? null : error.message || '设备插件加载失败' });
        }
    };
    return {
        start: () => start(false),
        replace(value) { if (disposed) { close(value.id).catch(() => {}); return; } release(); runtime = value; update({ phase: 'plugin', runtime: value, error: null }); },
        confirm() { if (disposed || !['confirm', 'download-error'].includes(state.phase)) return; confirmed = true; return start(true); },
        retry: () => start(confirmed && !resourcesReady),
        downloaded() { if (!disposed && state.phase === 'transition') update({ phase: 'plugin' }); },
        fail(message) { release(); update({ phase: 'plugin-error', runtime: null, error: message }); },
        cancel() { controller?.abort(); },
        dispose() { disposed = true; controller?.abort(); release(); },
    };
}
