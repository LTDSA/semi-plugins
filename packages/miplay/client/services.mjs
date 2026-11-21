export function withMina(core) {
    return { ...core, mina: {
        getSpeakers: (options = {}) => core.callBackground('mina.getSpeakers', options.skipCloud === undefined ? {} : { skipCloud: options.skipCloud }, options),
        controlSpeaker: (id, command, value, options = {}) => core.callBackground('mina.' + (command === 'volume' ? 'setVolume' : command), { id, ...(command === 'play' ? { url: value } : command === 'volume' ? { volume: value } : {}) }, options),
    } };
}
