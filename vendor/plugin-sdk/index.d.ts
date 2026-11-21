export type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };
export type JsonObject = { [key: string]: JsonValue };
export type Dispose = () => void;
export class SemiError extends Error { readonly code: string; constructor(code: string, message: string); }
export interface Availability { available: boolean; reason: string | null; code: string | null; }
export interface DeviceSummary { id: string; name: string; model: string; image: string; connected: boolean; sessionRevision: number; }
export interface DeviceContext { sn?: string; name?: string; model?: string; firmware?: string; revision: number; capabilities: string[]; }
export interface EmbeddedLayout { expanded: boolean; bounds: { x: number; y: number; width: number; height: number }; viewport: HostViewport; }
export type RuntimeScope = 'global' | 'account' | 'device';
export type RuntimeTarget = { deviceId: string; name?: string } | { accountId: string };
export interface JsonSchema { type: 'object' | 'array' | 'string' | 'number' | 'integer' | 'boolean' | 'null'; properties?: Record<string, JsonSchema>; additionalProperties?: false; required?: string[]; items?: JsonSchema; enum?: JsonValue[]; maxLength?: number; minLength?: number; maximum?: number; minimum?: number; maxItems?: number; }
export interface ContractMethod { params: JsonSchema; result?: JsonSchema; permission?: string; }
export interface AccountProviderDefinition { id: string; displayName?: string; icon?: string; version?: number; realm: string[]; protocol: string; loginView?: string; handler?: 'background'; operations?: Array<'flow' | 'login' | 'getProfile' | 'validate' | 'refresh' | 'logout'>; }
export interface DeviceCapabilityDefinition { name: string; version: number; methods: Record<string, ContractMethod>; }
export interface DeviceDiscoveryRules {
    dhcp?: Array<{ hostname?: string; macaddress?: string }>;
    zeroconf?: Array<string | { type: string; name?: string; properties?: Record<string, string> }>;
    ssdp?: Array<Partial<Record<'st' | 'usn' | 'ext' | 'server' | 'deviceType' | 'friendlyName' | 'manufacturer' | 'manufacturerURL' | 'modelDescription' | 'modelName' | 'modelNumber' | 'modelURL' | 'serialNumber' | 'UDN' | 'UPC' | 'presentationURL', string>>>;
}
export type DeviceDiscoveryInfo =
    | { source: 'neighbor'; address: string; macaddress?: string; hostname?: string }
    | { source: 'zeroconf'; type: string; name: string; host: string; addresses: string[]; port: number; properties: Record<string, string> }
    | { source: 'ssdp'; address: string; headers: Partial<Record<'st' | 'usn' | 'ext' | 'server', string>>; upnp?: Record<string, string> };
export interface DiscoveredDevice extends DevicePresentation {
    type: string;
    identifiers?: Record<string, string>;
    endpoint?: { ip: string; port: number };
    params?: JsonObject;
}
export interface DeviceAdapterDefinition { id: string; displayName?: string; deviceTypes?: string[]; discovery?: DeviceDiscoveryRules; addView?: string; icon?: string; provides?: Array<'device.metrics@1'>; capabilities?: DeviceCapabilityDefinition[]; }
export interface ServiceProviderDefinition { id: string; displayName?: string; icon?: string; version?: number; realm: string[]; contract: string; scope: RuntimeScope; accountProvider?: string; authorization?: 'account'; handler?: 'background'; methods: Record<string, ContractMethod>; }
export interface ProviderDescriptor { id: string; kind: 'accountProviders' | 'deviceAdapters' | 'serviceProviders'; pluginId: string; name: string; version: number; available: boolean; realm?: string[]; protocol?: string; contract?: string; scope?: RuntimeScope; methods?: string[]; deviceTypes?: string[]; capabilities?: Array<{ name: string; version: number; methods: string[] }>; }
export interface ProviderQuery { kind?: ProviderDescriptor['kind']; realm?: string[]; contract?: string; version?: number; }
export interface RuntimeDescriptor { pluginId: string; name: string; runtimeId?: string; viewId?: string; scope?: RuntimeScope; target?: RuntimeTarget | null; visible?: boolean; params?: JsonObject; overlay?: boolean; }
export interface ProviderContext { signal: AbortSignal; caller: RuntimeDescriptor; credentials?: JsonObject; accountId?: string; deviceId?: string; }
export interface AccountProfile { name?: string; avatar?: string; userId?: string; }
export type AccountProviderHandlers = Partial<Record<'flow' | 'login' | 'validate' | 'refresh' | 'logout', ProviderHandler>> & { getProfile?: (params: { subject: string }, context: ProviderContext) => AccountProfile | null | Promise<AccountProfile | null> };
export interface DevicePresentation { name: string; model: string; image?: { asset: string }; }
export interface DeviceRecordMetadata { id: string; type: string; adapterId: string; name: string; model: string; identifiers: JsonObject; connections: JsonObject; }
export type DeviceAdapterHandlers = Partial<Record<'add' | 'validate' | 'flow' | 'connect' | 'check' | 'call' | 'capability' | 'refresh' | 'disconnect' | 'action' | 'maintain', ProviderHandler>> & { discover?: (info: DeviceDiscoveryInfo, context: ProviderContext) => DiscoveredDevice[] | Promise<DiscoveredDevice[]>; menu?: (params: { record: DeviceRecordMetadata; connected: boolean; capabilities: string[] }, context: ProviderContext) => DeviceMenu | Promise<DeviceMenu>; describe?: (params: { record: DeviceRecordMetadata }, context: ProviderContext) => DevicePresentation | Promise<DevicePresentation> };
export type ProviderHandler = (params: JsonObject, context: ProviderContext) => JsonValue | Promise<JsonValue>;
export interface AppBaseInfo { version: string; theme: 'light' | 'dark'; platform: 'darwin' | 'win32' | 'linux'; }
export interface LoginOptions { domain: string; selectAccount?: boolean; provider?: string; }
export interface AccountInfo { id: string; domain: string; name: string; userId: string; avatar: string; pluginCount: number; }
export interface BackendState { devices: Array<{ record: JsonObject; credentials: JsonObject | null; context: JsonObject; sessionCredentials: JsonObject | null; expired: boolean }>; accounts: Array<AccountInfo & { providerId: string; protocol?: string; credentials?: JsonObject }>; defaultAccountId: string | null; }
export interface ViewOptions { viewId: string; params: JsonObject; target: RuntimeTarget | null; }
export interface ViewState { visible: boolean; hostViewport: HostViewport; embeddedLayout: EmbeddedLayout | null; availability: Availability; }
export interface BackgroundInfo { packageDirectory: string; dataDirectory: string; definition: JsonObject; development: boolean; target: RuntimeTarget | null; plugin: { id: string; name: string; version: string }; }
export interface OpenViewOptions { id: string; params?: JsonObject; target?: RuntimeTarget; }
export interface CallOptions { signal?: AbortSignal; timeout?: number; }
export interface CallbackError { code: string; errMsg: string; }
export type CallbackSuccess<T> = T & { errMsg: string };
export interface Callbacks<T> {
    success?: (result: CallbackSuccess<T>) => void;
    fail?: (error: CallbackError) => void;
    complete?: (result: CallbackSuccess<T> | CallbackError) => void;
}
type CallbackCall<T> = Callbacks<T> & (Required<Pick<Callbacks<T>, 'success'>> | Required<Pick<Callbacks<T>, 'fail'>> | Required<Pick<Callbacks<T>, 'complete'>>);
type NoCallbacks = { [K in keyof Callbacks<unknown>]?: never };
type EmptyResult = Record<never, never>;
export interface NetworkOptions extends CallOptions {
    url: string;
    header?: Record<string, string>;
    redirect?: 'manual' | 'follow';
    maxBytes?: number;
}
export interface RequestOptions extends NetworkOptions {
    method?: string;
    query?: Record<string, string | number | boolean | null | Array<string | number | boolean | null>>;
    data?: JsonValue | ArrayBuffer;
    responseType?: 'text' | 'arraybuffer';
    dataType?: string;
}
export interface HttpResponse { statusCode: number; header: Record<string, string | string[] | undefined>; }
export interface RequestResult<T> extends HttpResponse { data: T; cookies: string[]; }
export interface RequestTask { abort(): void; }
export interface DownloadOptions extends NetworkOptions {
    filePath?: string;
    onProgress?: (progress: { loaded: number; total: number | null }) => void;
}
export type DownloadResult = HttpResponse & { bytesWritten: number } & (
    { filePath: string | null; tempFilePath?: never } | { filePath?: never; tempFilePath: string }
);
export interface DownloadProgress { progress: number; totalBytesWritten: number; totalBytesExpectedToWrite: number; }
export interface DownloadTask extends RequestTask {
    onProgressUpdate(callback: (progress: DownloadProgress) => void): void;
    offProgressUpdate(callback?: (progress: DownloadProgress) => void): void;
}
export type PluginResource = {
    contentType: string;
    sandbox?: { root: string; inlineScripts?: true };
} & ({ body: string; filePath?: never } | { filePath: string; body?: never });
export interface IntentMap {
}
export interface IntentRequest<P> { params: P; caller: { pluginId: string; name: string }; requestId: string; signal: AbortSignal; }
export interface EventMap {
    'theme.changed': { theme: 'light' | 'dark' };
    'app.show': Record<never, never>;
    'app.hide': Record<never, never>;
    'runtime.changed': { instance: RuntimeDescriptor; closed?: boolean };
    'flow.closed': { flowId: string };
    'permissions.changed': { permissions: Record<string, boolean> };
    'availability.changed': Availability;
    'device.list.changed': {};
    'device.services.changed': Record<string, Array<{ id: string; name: string }>>;
    'host.viewport.changed': HostViewport;
    'host.embedded.changed': EmbeddedLayout | null;
    'views.closed': { instanceId: string };
    'lifecycle.suspend': Availability;
    'lifecycle.resume': Availability;
    'lifecycle.visibility': { visible: boolean };
    'tray.click': { id: string };
}
export interface HostViewport { width: number; height: number; }
export interface DeviceToolDefinition { id: string; title: string; view: string; icon?: string; color?: string; }
export interface DeviceViewRequirements { requires?: string[]; deviceCapabilities?: Array<{ name: string; version: number }>; }
export interface ContributionPatch { title?: string; badge?: string; enabled?: boolean; hidden?: boolean; }
export interface FileSystemManager {
    stat(path: string): Promise<{ size: number; directory: boolean; modified: number }>;
    digest(path: string, options?: CallOptions): Promise<string>;
    readChunk(path: string, offset: number, length: number): Promise<string>;
    writeChunk(path: string, data: string, offset?: number, exclusive?: boolean): Promise<void>;
    mkdir(path: string): Promise<void>;
    mkdtemp(prefix: string): Promise<string>;
    remove(path: string, options?: { recursive?: boolean; force?: boolean }): Promise<void>;
    rename(path: string, to: string): Promise<void>;
}
export interface SDK {
    callFlow(operation: string, params?: JsonObject, options?: CallOptions): Promise<JsonValue>;
    completeFlow(result: JsonValue): Promise<JsonValue>;
    cancelFlow(): Promise<null>;
    getProviderState(): Promise<BackendState>;
    updateDevice(params: JsonObject): Promise<void>;
    saveAccount(provider: string, value: JsonObject, options?: CallOptions & { flowId: string }): Promise<AccountInfo>;
    reconnectDevice(deviceId: string, preference?: string): Promise<void>;
    discoverProviders(query?: ProviderQuery, options?: CallOptions): Promise<ProviderDescriptor[]>;
    registerAccountProvider(id: string, methods: AccountProviderHandlers): Dispose;
    registerDeviceAdapter(id: string, methods: DeviceAdapterHandlers): Dispose;
    registerServiceProvider(id: string, methods: Record<string, ProviderHandler>): Dispose;
    callService<T extends JsonValue = JsonValue>(contract: string, method: string, params?: JsonObject, options?: CallOptions & { version?: number; provider?: string; accountId?: string }): Promise<T>;
    callBackground<T extends JsonValue = JsonValue>(name: string, params?: JsonObject, options?: CallOptions): Promise<T>;
    handleBackgroundCall(name: string, handler: (params: JsonObject, options: { signal: AbortSignal; caller?: RuntimeDescriptor }) => JsonValue | void | Promise<JsonValue | void>): Dispose;
    emitBackgroundEvent(name: string, data: JsonValue, options?: { to?: string; raw?: boolean }): Promise<void>;
    onBackgroundEvent(name: string, callback: (data: any) => void): Dispose;
    setBackgroundActive(active: boolean, options?: { tray?: 'none' | 'main' }): Promise<void>;
    canIUse(api: string): boolean;
    login(options: LoginOptions & CallbackCall<AccountInfo>, callOptions?: CallOptions): void;
    login(options: LoginOptions & NoCallbacks, callOptions?: CallOptions): Promise<AccountInfo>;
    request(options: RequestOptions & { responseType: 'arraybuffer' } & CallbackCall<RequestResult<ArrayBuffer>>): RequestTask;
    request(options: RequestOptions & { responseType?: 'text'; dataType: 'text' } & CallbackCall<RequestResult<string>>): RequestTask;
    request<T extends JsonValue = JsonValue>(options: RequestOptions & CallbackCall<RequestResult<T | string | ArrayBuffer>>): RequestTask;
    request(options: RequestOptions & { responseType: 'arraybuffer' } & NoCallbacks): Promise<RequestResult<ArrayBuffer>>;
    request(options: RequestOptions & { responseType?: 'text'; dataType: 'text' } & NoCallbacks): Promise<RequestResult<string>>;
    request<T extends JsonValue = JsonValue>(options: RequestOptions & { responseType?: 'text' } & NoCallbacks): Promise<RequestResult<T | string>>;
    request(options: RequestOptions & NoCallbacks): Promise<RequestResult<JsonValue | ArrayBuffer>>;
    downloadFile(options: DownloadOptions & CallbackCall<DownloadResult>): DownloadTask;
    downloadFile(options: DownloadOptions & NoCallbacks): Promise<DownloadResult>;
    authorize(options: { scope: string; reason?: string } & CallbackCall<EmptyResult>): void;
    authorize(options: { scope: string[]; reason?: string } & CallbackCall<{ authSetting: Record<string, boolean> }>): void;
    authorize(options: { scope: string; reason?: string } & NoCallbacks): Promise<void>;
    authorize(options: { scope: string[]; reason?: string } & NoCallbacks): Promise<Record<string, boolean>>;
    readonly version: string;
    getAppBaseInfo(): AppBaseInfo;
    onThemeChange(callback: (data: EventMap['theme.changed']) => void): void;
    offThemeChange(callback?: (data: EventMap['theme.changed']) => void): void;
    onAppShow(callback: () => void): void;
    offAppShow(callback?: () => void): void;
    onAppHide(callback: () => void): void;
    offAppHide(callback?: () => void): void;
    markViewReady(): Promise<void>;
    getViewOptions(): Promise<ViewOptions>;
    getViewState(): Promise<ViewState>;
    getBackgroundInfo(): Promise<BackgroundInfo>;
    closeCurrentView(): Promise<void>;
    openView(options: OpenViewOptions): Promise<{ instanceId: string }>;
    closeView(options: { instanceId: string }): Promise<void>;
    getDeviceList(query: { capability: string; version?: number }, options?: CallOptions): Promise<DeviceSummary[]>;
    callDevice<T extends JsonValue = JsonValue>(capability: string, method: string, params?: JsonObject, options?: CallOptions & { version?: number; deviceId?: string }): Promise<T>;
    handleIntent<K extends keyof IntentMap>(name: K, handler: (request: IntentRequest<IntentMap[K]['params']>) => Promise<IntentMap[K]['result']> | IntentMap[K]['result']): Dispose;
    invokeIntent<K extends keyof IntentMap>(name: K, params: IntentMap[K]['params'], options?: CallOptions & { target?: string; version?: number }): Promise<IntentMap[K]['result']>;
    registerCommand(name: string, handler: (request: IntentRequest<JsonObject>) => JsonValue | void | Promise<JsonValue | void>): Dispose;
    executeCommand(name: string, params?: JsonObject): Promise<JsonValue>;
    onEvent<K extends keyof EventMap>(name: K, callback: (data: EventMap[K]) => void): Dispose;
    onEvent<T extends JsonValue = JsonValue>(name: string, callback: (data: T) => void): Dispose;
    getCache<T extends JsonValue = JsonValue>(key: string): Promise<T | null>;
    setCache(key: string, value: JsonValue, category?: string): Promise<void>;
    removeCache(key: string): Promise<void>;
    registerCacheDirectories(resources: Array<{ folder: string; category: string }>): Promise<void>;
    getCacheUsage(): Promise<Array<{ category: string; bytes: number }>>;
    getStorage<T extends JsonValue = JsonValue>(options: { key: string } & CallbackCall<{ data: T | null }>): void;
    getStorage<T extends JsonValue = JsonValue>(options: { key: string } & NoCallbacks): Promise<{ data: T | null }>;
    setStorage(options: { key: string; data: JsonValue } & CallbackCall<EmptyResult>): void;
    setStorage(options: { key: string; data: JsonValue } & NoCallbacks): Promise<void>;
    removeStorage(options: { key: string } & CallbackCall<EmptyResult>): void;
    removeStorage(options: { key: string } & NoCallbacks): Promise<void>;
    handleResourceRequest(handler: (request: IntentRequest<{ url: string; target: JsonObject }>) => PluginResource | Promise<PluginResource>): Dispose;
    openExternal(url: string): Promise<void>;
    showContextMenu(): Promise<void>;
    getFileSystemManager(): FileSystemManager;
    setModalLayout(open: boolean): Promise<EmbeddedLayout | null>;
    updateSidebarItem(id: string, patch: ContributionPatch): Promise<void>;
    updateStatusBarItem(id: string, patch: ContributionPatch): Promise<void>;
    updateTrayMenuItem(id: string, patch: ContributionPatch): Promise<void>;
    createTray(id: string, options: { icon?: string; template?: boolean; tooltip?: string; title?: string; view?: string; menu?: { title: string; command: string }[] }): Promise<void>;
    destroyTray(id: string): Promise<void>;
    setKeepScreenOn(options: { keepScreenOn: boolean } & CallbackCall<EmptyResult>): void;
    setKeepScreenOn(options: { keepScreenOn: boolean } & NoCallbacks): Promise<void>;
}
export interface Transport {
    readonly apis?: readonly string[];
    getBaseInfo?(): AppBaseInfo;
    invoke(request: { version: 1; id: string; method: string; params: unknown; timeout: number }): Promise<{ ok: boolean; value?: unknown; error?: { code: string; message: string } }>;
    cancel(id: string): void;
    subscribe(callback: (event: { name: string; data: unknown }) => void): Dispose;
}
export function createSDK(transport?: Transport): SDK;
export const semi: SDK;
export const authorize: SDK['authorize'];
export const callBackground: SDK['callBackground'];
export const callDevice: SDK['callDevice'];
export const callFlow: SDK['callFlow'];
export const callService: SDK['callService'];
export const canIUse: SDK['canIUse'];
export const cancelFlow: SDK['cancelFlow'];
export const closeCurrentView: SDK['closeCurrentView'];
export const closeView: SDK['closeView'];
export const completeFlow: SDK['completeFlow'];
export const createTray: SDK['createTray'];
export const destroyTray: SDK['destroyTray'];
export const discoverProviders: SDK['discoverProviders'];
export const downloadFile: SDK['downloadFile'];
export const emitBackgroundEvent: SDK['emitBackgroundEvent'];
export const executeCommand: SDK['executeCommand'];
export const getAppBaseInfo: SDK['getAppBaseInfo'];
export const getBackgroundInfo: SDK['getBackgroundInfo'];
export const getCache: SDK['getCache'];
export const getCacheUsage: SDK['getCacheUsage'];
export const getDeviceList: SDK['getDeviceList'];
export const getFileSystemManager: SDK['getFileSystemManager'];
export const getProviderState: SDK['getProviderState'];
export const getStorage: SDK['getStorage'];
export const getViewOptions: SDK['getViewOptions'];
export const getViewState: SDK['getViewState'];
export const handleBackgroundCall: SDK['handleBackgroundCall'];
export const handleIntent: SDK['handleIntent'];
export const handleResourceRequest: SDK['handleResourceRequest'];
export const invokeIntent: SDK['invokeIntent'];
export const login: SDK['login'];
export const markViewReady: SDK['markViewReady'];
export const offAppHide: SDK['offAppHide'];
export const offAppShow: SDK['offAppShow'];
export const offThemeChange: SDK['offThemeChange'];
export const onAppHide: SDK['onAppHide'];
export const onAppShow: SDK['onAppShow'];
export const onBackgroundEvent: SDK['onBackgroundEvent'];
export const onEvent: SDK['onEvent'];
export const onThemeChange: SDK['onThemeChange'];
export const openExternal: SDK['openExternal'];
export const openView: SDK['openView'];
export const reconnectDevice: SDK['reconnectDevice'];
export const registerAccountProvider: SDK['registerAccountProvider'];
export const registerCacheDirectories: SDK['registerCacheDirectories'];
export const registerCommand: SDK['registerCommand'];
export const registerDeviceAdapter: SDK['registerDeviceAdapter'];
export const registerServiceProvider: SDK['registerServiceProvider'];
export const removeCache: SDK['removeCache'];
export const removeStorage: SDK['removeStorage'];
export const request: SDK['request'];
export const saveAccount: SDK['saveAccount'];
export const setBackgroundActive: SDK['setBackgroundActive'];
export const setCache: SDK['setCache'];
export const setKeepScreenOn: SDK['setKeepScreenOn'];
export const setModalLayout: SDK['setModalLayout'];
export const setStorage: SDK['setStorage'];
export const showContextMenu: SDK['showContextMenu'];
export const updateDevice: SDK['updateDevice'];
export const updateSidebarItem: SDK['updateSidebarItem'];
export const updateStatusBarItem: SDK['updateStatusBarItem'];
export const updateTrayMenuItem: SDK['updateTrayMenuItem'];

export interface DeviceMenu { actions: Array<{ id: string; title: string }>; tools: DeviceToolDefinition[]; }
export interface PluginPackage { name: string; version: string; engines?: { semi?: string; [key: string]: string | undefined }; description?: string; author?: string | { name: string; email?: string; url?: string }; files?: string[]; dependencies?: Record<string, string>; semi: { displayName?: string; icon?: string; color?: string; sdkVersion?: 1; permissions?: string[]; deviceAdapters?: DeviceAdapterDefinition[]; [key: string]: unknown }; }
