const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { JsonStore } = require('./storage.cjs');
const { pluginMetadata } = require('./mijia-device-packages.cjs');
const { assert } = require('../browser/contracts.cjs');

const hash = value => crypto.createHash('sha256').update(value).digest('hex');
const record = value => value && typeof value === 'object' && !Array.isArray(value);
const parse = value => typeof value === 'string' ? JSON.parse(value) : value;
const check = signal => assert(!signal?.aborted, '加载已取消', 'CANCELLED');
const TTL = 2 * 60 * 60 * 1000;

// 分类、名单与型号定制都取自官方服务；代码内不维护设备型号名单。
class MijiaPluginLaunch {
    constructor({ userData, runtimeRoot, runtimeVersion, now = Date.now }) {
        this.root = path.join(runtimeRoot, 'launch', hash(runtimeVersion));
        this.settings = new JsonStore(path.join(userData, 'mijia-plugin-settings.json'));
        this.now = now;
    }
    identity(mijia, model) {
        const { accountId, region } = mijia.getDevicePluginIdentity();
        return { scope: hash(JSON.stringify([accountId, region])), preferenceKey: hash(JSON.stringify([accountId, model])) };
    }
    preference(mijia, model) { return this.settings.get(this.identity(mijia, model).preferenceKey) === 1 ? 1 : 0; }
    setPreference(mijia, model, value) {
        assert(value === 0 || value === 1, '首页样式无效');
        this.settings.set(this.identity(mijia, model).preferenceKey, value);
    }
    async cached(scope, key, load, signal) {
        check(signal);
        const file = path.join(this.root, scope, hash(key) + '.json');
        try {
            const stat = await fs.promises.stat(file);
            if (stat.size <= 8 * 1024 * 1024) {
                const cached = JSON.parse(await fs.promises.readFile(file, 'utf8'));
                if (cached.key === key && cached.time <= this.now() && this.now() - cached.time < TTL) { check(signal); return cached.value; }
            }
        } catch (e) { check(signal); }
        const value = await load(); check(signal);
        const text = JSON.stringify({ key, time: this.now(), value });
        assert(Buffer.byteLength(text) <= 8 * 1024 * 1024, '标准插件配置过大', 'PLUGIN_INVALID');
        await fs.promises.mkdir(path.dirname(file), { recursive: true });
        const stage = file + '.' + crypto.randomUUID();
        try { await fs.promises.writeFile(stage, text, { mode: 0o600 }); check(signal); await fs.promises.rename(stage, file); }
        finally { await fs.promises.rm(stage, { force: true }); }
        return value;
    }
    async select({ mijia, assets, context, did, signal, mode = 'auto', onProgress }) {
        const revision = mijia.getSessionRevision();
        const model = context.device.model;
        const { scope } = this.identity(mijia, model);
        const request = async (operation, params = {}) => {
            const value = await mijia.getDevicePluginLaunchData(did, operation, params, signal);
            check(signal); assert(mijia.getSessionRevision() === revision, '米家账号已变化', 'CONTEXT_CHANGED');
            return value;
        };
        const original = await assets.devices.cached(model);
        const metadata = original?.metadata || pluginMetadata(await mijia.getDevicePluginMetadata(did, signal), model);
        const preference = this.preference(mijia, model);
        let standard, customConfig, fallbackReason;
        let stage = 'global';
        const rememberFailure = error => {
            const code = typeof error.code === 'string' && /^[A-Z_]{1,64}$/.test(error.code) ? error.code : 'PLUGIN_UNAVAILABLE';
            fallbackReason = { stage, code };
        };
        try {
            assert(assets.standardEnabled !== false, '当前运行资源关闭标准插件', 'PLUGIN_UNAVAILABLE');
            stage = 'categories';
            const categories = await this.cached(scope, 'categories', () => request('categories'), signal);
            assert(record(categories?.hookmodel) && typeof categories.default === 'string', '标准插件分类无效', 'PLUGIN_INVALID');
            const type = context.binding.specType;
            const category = typeof type === 'string' ? (type.includes('-spec-v3') ? type.split(';')[0].split(':')[4] : type.split(':')[3]) : '';
            const candidates = [...new Set([category, categories.default])].map(key => parse(categories.hookmodel[key])).filter(Boolean);
            for (const candidate of candidates) {
                stage = 'metadata';
                assert(record(candidate) && typeof candidate.model === 'string' && /^[a-zA-Z0-9_.-]{1,128}$/.test(candidate.model) && typeof candidate.package === 'string' && Number.isSafeInteger(candidate.pluginId), '标准插件分类无效', 'PLUGIN_INVALID');
                const raw = await this.cached(scope, 'metadata:' + candidate.model, () => request('metadata', { model: candidate.model }), signal);
                const info = pluginMetadata(raw, candidate.model);
                assert(info.pluginId === candidate.pluginId && info.kind === 'full', '标准插件登记不一致', 'PLUGIN_INVALID');
                stage = 'support';
                const support = parse(await this.cached(scope, `support:${info.pluginId}:${info.version}`, () => request('support', { pluginId: info.pluginId, version: info.version }), signal));
                assert(record(support) && support.plugin_id === info.pluginId && support.version === info.version && Array.isArray(support.model_list) && support.model_list.every(value => typeof value === 'string'), '标准插件型号名单无效', 'PLUGIN_INVALID');
                if (!support.model_list.includes(model) || support.black_list?.includes(model)) continue;
                if (!type || !Array.isArray(context.resource.instance.services) || !context.resource.instance.services.length) break;
                stage = 'custom';
                const operation = parse(await this.cached(scope, `custom:${info.pluginId}:${info.version}:${model}`, () => request('custom'), signal));
                assert(record(operation?.std_operate_infos), '标准插件定制配置未就绪', 'PLUGIN_INVALID');
                const config = operation.std_operate_infos[model];
                assert(config == null || record(config) && config.model === model && (config.standard_infos == null || Array.isArray(config.standard_infos)), '标准插件定制配置无效', 'PLUGIN_INVALID');
                // 官方将 null／缺失／空 standard_infos 归为 EMPTY；这不是配置请求失败。
                customConfig = config?.standard_infos?.length ? config : {};
                standard = { candidate, metadata: info, raw };
                break;
            }
        } catch (e) {
            check(signal);
            if (mijia.getSessionRevision() !== revision || ['AUTH_REQUIRED', 'AUTH_EXPIRED', 'CONTEXT_CHANGED'].includes(e.code)) throw e;
            rememberFailure(e);
            // 配置查询失败走真实原包，不把未知资格视为标准设备。
        }
        check(signal); assert(mijia.getSessionRevision() === revision, '米家账号已变化', 'CONTEXT_CHANGED');
        let devicePackage, style = 'traditional';
        if (standard && mode !== 'traditional' && (mode === 'standard' || preference === 0)) {
            try {
                stage = 'package';
                devicePackage = await assets.standardPackage(standard.candidate, standard.raw, standard.metadata, signal, onProgress);
                assert(devicePackage.project.package_path === standard.candidate.package, '标准插件包名不一致', 'PLUGIN_INVALID');
                style = 'standard';
            } catch (e) {
                check(signal);
                if (['AUTH_REQUIRED', 'AUTH_EXPIRED', 'CONTEXT_CHANGED'].includes(e.code)) throw e;
                rememberFailure(e);
            }
        }
        if (style === 'traditional') {
            assert(metadata.kind !== 'standard', '当前版本没有可用的标准首页，请稍后重试', 'PLUGIN_UNAVAILABLE');
            devicePackage = original || await assets.devices.ensure(model, async () => ({ latest_info: [this.registration(metadata)] }), signal, undefined, onProgress);
        }
        check(signal); assert(mijia.getSessionRevision() === revision, '米家账号已变化', 'CONTEXT_CHANGED');
        mijia.reportDevicePluginLaunch?.({ model, style, preference, mode, standard: standard ? { pluginId: standard.metadata.pluginId, version: standard.metadata.version } : null, fallbackReason: fallbackReason || null });
        return { devicePackage, resource: style === 'standard' ? { ...context.resource, custom_config: customConfig } : context.resource,
            launch: { style, preference, standardized: Boolean(standard) && [1, 3, 5].includes(metadata.devMode),
                custom: { devMode: metadata.devMode, homePageMore: metadata.homePageMore, hasCustomPlugin: [1, 3, 4, 5].includes(metadata.devMode) && metadata.kind !== 'standard' && Boolean(standard) },
                standard: standard ? { model: standard.candidate.model, pluginId: standard.metadata.pluginId, version: standard.metadata.version } : null } };
    }
    registration(info) {
        return { model: info.model, platform: 1, plugin_id: info.pluginId, plugin_package_id: info.packageId, version: info.version, sdk_version: info.sdkVersion,
            dev_mode: info.devMode, homepage_more: info.homePageMore, download_url: info.url, size: info.size, md5sum: info.md5 };
    }
}
module.exports = { MijiaPluginLaunch };
