// 同一视图的多个／嵌套弹层共享一次扩展；串行同步，避免旧关闭请求覆盖新弹层。
export function createModalCoordinator({ setOpen, applyLayout }) {
    const owners = new Set();
    let applied = false, layout = null, queue = Promise.resolve();
    const sync = () => {
        const job = queue.catch(() => {}).then(async () => {
            const open = owners.size > 0;
            if (open !== applied) {
                layout = await setOpen(open);
                applied = open;
                applyLayout(layout);
            }
            return layout;
        });
        queue = job;
        return job;
    };
    return {
        acquire() {
            const owner = {}; owners.add(owner);
            return { ready: sync(), release() { if (!owners.delete(owner)) return queue; return sync(); } };
        },
    };
}
