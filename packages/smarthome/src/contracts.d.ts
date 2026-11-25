import type { JsonObject, JsonValue, CallOptions } from '@semi-app/plugin-sdk';
export interface DevicePluginDownloadProgress { phase: 'metadata' | 'download' | 'verify' | 'extract' | 'ready'; resource: 'runtime' | 'device'; loaded: number; total: number; percent: number; }
export interface DevicePluginOpenOptions extends CallOptions { download?: boolean; onDownloadProgress?: (progress: DevicePluginDownloadProgress) => void; }
export type MijiaCardSize = 'small' | 'medium' | 'large';
export interface MijiaDevice { did: string; name: string; model: string; isOnline: boolean; showOnHome: boolean; imageUrl?: string; cardSize?: MijiaCardSize; }
export interface MijiaHomes { homes: { id: string; name: string }[]; defaultHomeId: string | null; }
export interface MijiaRoom { id: string; name: string; deviceIds: string[]; }
export type MijiaHomeEntry = { type: 'device'; did: string } | { type: 'aggregation'; id: 'light' | 'env' | 'curtain' | 'camera'; name: string };
export interface MijiaHomeDevices { devices: MijiaDevice[]; rooms: MijiaRoom[]; entries: MijiaHomeEntry[]; }
export interface MijiaAggregationState { id: 'light' | 'env' | 'curtain' | 'camera'; subtitle: string; active: boolean | null; cardSize?: MijiaCardSize; }
export interface MijiaPowerState { did: string; supported: boolean; on: boolean | null; error?: string; }
export interface MijiaDeviceReading { name: string; label: string; value: number; unit: string; }
export interface MijiaDeviceStatus { name: string; value: number | string; text: string; }
export type MijiaCurtainAction = 'open' | 'pause' | 'close';
export interface MijiaCurtainState { supported: boolean; position: number | null; motion: 'opening' | 'closing' | 'stopped' | null; text: string | null; nextAction: MijiaCurtainAction | null; }
export interface MijiaDeviceState extends MijiaPowerState { readings: MijiaDeviceReading[]; statuses: MijiaDeviceStatus[]; curtain?: MijiaCurtainState; }
export interface MijiaClient {
        getDeviceList(options?: CallOptions): Promise<MijiaDevice[]>;
        getHomes(options?: CallOptions): Promise<MijiaHomes>;
        getHomeDevices(homeId: string, options?: CallOptions): Promise<MijiaHomeDevices>;
        getHomeAggregationStates(homeId: string, options?: CallOptions): Promise<MijiaAggregationState[]>;
        getDevicePowerStates(dids: string[], options?: CallOptions): Promise<MijiaPowerState[]>;
        getDeviceStates(dids: string[], options?: CallOptions): Promise<MijiaDeviceState[]>;
        setDevicePower(did: string, on: boolean, options?: CallOptions): Promise<MijiaPowerState>;
        setDeviceCurtain(did: string, action: MijiaCurtainAction, options?: CallOptions): Promise<{ accepted: true; state: MijiaDeviceState | null }>;
        getDevicePluginRuntimeInfo(options?: CallOptions): Promise<{ version: string | null }>;
        openDevicePlugin(did: string, options?: DevicePluginOpenOptions): Promise<{ id: string; did: string; url: string }>;
        closeDevicePlugin(id: string): Promise<void>;
        callDevicePluginHost(id: string, command: 'set-homepage' | 'navigate', params: { homepage_type?: 0 | 1; mode?: 'auto' | 'standard' | 'traditional' | 'back'; pageName?: string; pageParams?: JsonObject }, options?: CallOptions): Promise<{ id: string; did: string; url: string } | null>;
        callDevicePluginHost(id: string, command: 'keep-screen-on', params: { enabled: boolean }, options?: CallOptions): Promise<null>;
        callDevicePluginHost(id: string, command: 'vendor-read', params: { url: string; headers: Record<string, string> }, options?: CallOptions): Promise<{ status: number; body: string; headers: Record<string, string> }>;
        getDevicePluginProperties(id: string, properties: { siid: number; piid: number }[], options?: CallOptions & { datasource?: 1 | 2 | 3 }): Promise<{ did: string; siid: number; piid: number; code: number; value?: boolean | number | string }[]>;
        getDevicePluginHistory(id: string, params: { uid?: string; type: 'prop' | 'event' | 'store'; key?: string; time_start?: number | string; time_end?: number | string; limit?: number | string }, options?: CallOptions): Promise<JsonValue>;
        doDevicePluginAction(id: string, params: { did?: string; miid?: number; siid: number; aiid: number; in: JsonValue[] }, options?: CallOptions): Promise<JsonValue>;
        getDevicePluginAuthorizedDevices(id: string, model: string, options?: CallOptions): Promise<JsonObject>;
        getDevicePluginVersion(id: string, pid: number | string, options?: CallOptions): Promise<JsonObject>;
        getDevicePluginGatewayInfo(id: string, mac: string, options?: CallOptions): Promise<{ rssi: number | null; isOnline: boolean }>;
        getDevicePluginCloudRead(id: string, api: string, params: JsonObject, options?: CallOptions): Promise<JsonValue>;
        setDevicePluginCloudWrite(id: string, api: string, params: JsonValue, options?: CallOptions): Promise<JsonValue>;
        getDevicePluginCloudCall(id: string, api: string, params: JsonObject, options?: CallOptions): Promise<JsonObject>;
        setDevicePluginProperties(id: string, properties: { siid: number; piid: number; value: boolean | number }[], options?: CallOptions): Promise<{ did: string; siid: number; piid: number; code: number }[]>;
}

export interface MijiaEvents {
    'mijia.debug': { uri: string; params: JsonObject; response?: JsonValue; error?: { code: string; httpStatus: number | null }; timestamp: string };
    'mijia.plugin.download-progress': DevicePluginDownloadProgress & { progressId: string };
}
