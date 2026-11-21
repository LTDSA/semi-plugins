// 覆盖层显示后才开始入场；退场由 Modal.afterClose 确认，不用固定延时猜动画时长。
export function createOverlayDialogMotion({ requestFrame, cancelFrame, setVisible, onClosed }) {
    let frame, shown = false, closing = false, finished = false, disposed = false;
    const cancel = () => { if (frame !== undefined) cancelFrame(frame); frame = undefined; };
    const finishClose = () => {
        if (disposed || !closing || finished) return;
        finished = true; onClosed();
    };
    return {
        hostVisible(visible) {
            cancel();
            if (!visible || disposed || closing || shown) return;
            // 先让已显示的透明原生层提交一帧，再挂载带入场动画的对话框。
            frame = requestFrame(() => {
                frame = requestFrame(() => {
                    frame = undefined;
                    if (!disposed && !closing) { shown = true; setVisible(true); }
                });
            });
        },
        requestClose() {
            if (disposed || closing) return;
            closing = true; cancel();
            if (shown) setVisible(false);
            else finishClose();
        },
        finishClose,
        dispose() { disposed = true; cancel(); },
    };
}
