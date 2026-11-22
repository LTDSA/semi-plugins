export function createNetworkInfo(target) {
    const snapshot = () => ({ isConnected: target.navigator.onLine, isInternetReachable: null, type: target.navigator.connection?.type || 'unknown' });
    const fetch = value => {
        const promise = Promise.resolve(value);
        promise.done = (success, failure) => { promise.then(success, failure).catch(error => target.setTimeout(() => { throw error; }, 0)); };
        return promise;
    };
    const listen = (callback, connected = false) => {
        const update = () => callback(connected ? snapshot().isConnected : snapshot());
        target.addEventListener('online', update); target.addEventListener('offline', update);
        return () => { target.removeEventListener('online', update); target.removeEventListener('offline', update); };
    };
    const subscriptions = new Map();
    const legacy = connected => ({
        fetch: () => fetch(connected ? snapshot().isConnected : snapshot()),
        addEventListener: (name, callback) => {
            const listener = typeof name === 'function' ? name : callback;
            subscriptions.get(listener)?.();
            const stop = listen(listener, connected);
            const remove = () => { stop(); if (subscriptions.get(listener) === remove) subscriptions.delete(listener); };
            remove.remove = remove;
            subscriptions.set(listener, remove);
            return remove;
        },
        removeEventListener: (name, callback) => {
            const listener = typeof name === 'function' ? name : callback;
            subscriptions.get(listener)?.(); subscriptions.delete(listener);
        },
    });
    return { ...legacy(false), isConnected: legacy(true) };
}
