import type { CallOptions } from '../../../packages/plugin-sdk/index';
export interface MinaClient {
        controlSpeaker(id: string, command: 'play' | 'stop' | 'volume', value?: string | number, options?: CallOptions): Promise<unknown>;
        getSpeakers(options?: CallOptions & { skipCloud?: boolean }): Promise<{ accountId: string; unavailable?: { code: string; message: string }; speakers: Array<{ id: string; name: string; model: string; miotDid?: string; online?: boolean; homeName?: string; roomName?: string; imageUrl?: string }> }>;
}
