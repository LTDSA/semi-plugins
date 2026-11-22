// RNFS 使用设备隔离的持久文件空间，不映射本机任意路径。
export function createNativeFiles(storage) {
    const key = path => {
        if (typeof path !== 'string' || !/^\/documents(?:\/[^/]+)*$/.test(path) || path.split('/').some(part => part === '.' || part === '..') || path.length > 120) throw new Error('文件路径不属于设备插件');
        return 'rnfs:' + path;
    };
    const read = async path => {
        const value = await storage.get(key(path));
        if (!value) throw Object.assign(new Error('文件不存在'), { code: 'ENOENT' });
        return value;
    };
    return {
        RNFSFileTypeRegular: 0, RNFSFileTypeDirectory: 1,
        RNFSDocumentDirectoryPath: '/documents',
        async writeFile(path, content) {
            if (path === '/documents') throw new Error('不能覆盖插件文件空间根目录');
            if (typeof content !== 'string') throw new Error('文件内容必须为 Base64');
            const size = atob(content).length;
            await storage.set(key(path), { content, size, type: 0, mtime: Date.now() / 1000, ctime: Date.now() / 1000 });
        },
        async readFile(path) { return (await read(path)).content; },
        async exists(path) { return path === '/documents' || Boolean(await storage.get(key(path))); },
        async unlink(path) { if (path === '/documents') throw new Error('不能删除插件文件空间根目录'); await read(path); await storage.remove(key(path)); },
        async mkdir(path) { if (path === '/documents') return; await storage.set(key(path), { type: 1, size: 0, mtime: Date.now() / 1000, ctime: Date.now() / 1000 }); },
        async stat(path) { const { content, ...info } = await read(path); return { ...info, originalFilepath: path }; },
    };
}
