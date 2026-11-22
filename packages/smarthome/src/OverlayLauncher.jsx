import { useEffect, useRef } from 'react';
import { semi } from './api.mjs';
import { Toast } from '@semi/plugin-ui/ui.js';

const EMPTY_PARAMS = {};
export default function OverlayLauncher({ view, params = EMPTY_PARAMS, onClose, errorMessage = '对话框打开失败' }) {
    const close = useRef(onClose); close.current = onClose;
    useEffect(() => {
        let disposed = false, id;
        const closed = new Set();
        const off = semi.onEvent('views.closed', event => {
            closed.add(event.instanceId);
            if (id === event.instanceId) close.current();
        });
        semi.openView({ id: view, params }).then(result => {
            id = result.instanceId;
            if (disposed) semi.closeView({ instanceId: id }).catch(() => {});
            else if (closed.has(id)) close.current();
        }).catch(error => { if (!disposed) { Toast.warning(error.message || errorMessage); close.current(); } });
        return () => { disposed = true; off(); if (id) semi.closeView({ instanceId: id }).catch(() => {}); };
    }, [view, params]);
    return null;
}
