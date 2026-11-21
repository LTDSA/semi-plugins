import { semi as core } from '@semi-app/plugin-sdk';
import { withMina } from './services.mjs';
export const semi = withMina(core);
