export async function loadSmartDeviceHomes(semi, { tray = false, signal } = {}) {
    signal?.throwIfAborted();
    if (!tray) {
        await semi.login({ domain: 'account.xiaomi.com' }, { signal });
        signal?.throwIfAborted();
    }
    return semi.callBackground('mijia.homes.list', {}, { signal });
}
