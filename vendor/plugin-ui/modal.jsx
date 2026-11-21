import { forwardRef, useEffect, useLayoutEffect, useRef, useState } from 'react';
import SemiModal from '@douyinfe/semi-ui/lib/es/modal';
import { createModalCoordinator } from './modal-coordinator.mjs';
import { applyEmbeddedLayout } from './embedded-layout.mjs';

const applyLayout = layout => applyEmbeddedLayout(document, layout);
let host;
export function configureModalHost(sdk) {
    if (host) return;
    host = sdk;
    let received = false;
    host.onEvent('host.embedded.changed', layout => { received = true; applyLayout(layout); });
    // 进入内嵌页就固定内容尺寸，不能等第一个弹层打开后才改变 root 的布局规则。
    host.getViewState().then(context => { if (!received) applyLayout(context.embeddedLayout); }).catch(() => {});
}
const coordinator = createModalCoordinator({ setOpen: open => host ? host.setModalLayout(open) : Promise.resolve(null), applyLayout });

// 仍由 Semi 渲染原生组件；宿主只扩大当前受限视图，页面根节点保持原槽位。
const Modal = forwardRef(function Modal({ visible, afterClose, ...props }, ref) {
    const lease = useRef(null);
    const [ready, setReady] = useState(false);
    const [pageVisible, setPageVisible] = useState(false);
    useEffect(() => {
        let active = true, receivedVisibility = false;
        const off = host.onEvent('lifecycle.visibility', event => {
            receivedVisibility = true;
            setPageVisible(Boolean(event.visible));
        });
        host.getViewState().then(context => {
            if (active && !receivedVisibility) setPageVisible(Boolean(context.visible));
        }).catch(() => {});
        return () => { active = false; off(); };
    }, []);
    const release = () => {
        const current = lease.current; lease.current = null;
        current?.release().catch(error => console.error('[插件弹层]', error.message));
        setReady(false);
    };
    useLayoutEffect(() => {
        if (!pageVisible) { if (lease.current) release(); return; }
        if (!visible && !ready && lease.current) { release(); return; }
        if (!visible || lease.current) return;
        const current = coordinator.acquire(); lease.current = current;
        current.ready.then(() => { if (lease.current === current) setReady(true); }).catch(error => {
            console.error('[插件弹层]', error.message);
            if (lease.current === current) setReady(true);
        });
    }, [pageVisible, visible]);
    useLayoutEffect(() => () => { const current = lease.current; lease.current = null; current?.release().catch(() => {}); }, []);
    // 动画结束才恢复槽位；组件直接卸载也必须释放。
    return pageVisible && ready ? <SemiModal {...props} ref={ref} visible={visible} afterClose={() => { release(); afterClose?.(); }} /> : null;
});

// 主窗口也共用组件出口；未挂载插件宿主时保留 Semi 原组件及命令式接口。
const ModalEntry = forwardRef((props, ref) => host ? <Modal {...props} ref={ref} /> : <SemiModal {...props} ref={ref} />);
for (const name of ['info', 'success', 'error', 'warning', 'confirm', 'destroyAll']) ModalEntry[name] = SemiModal[name];

export default ModalEntry;
