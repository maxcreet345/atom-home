import type { ConfigStore } from './store.ts';
import { normaliseConfig, type HouseConfig } from '../model/config.ts';
import type { Hass } from './host.ts';
/** Configuration kept in Home Assistant `.storage` through the atom_home integration's WebSocket API. */
export function haStore(hass: () => Hass): ConfigStore {
  return {
    label: 'home-assistant',
    async load() {
      const r = await hass().callWS<{ config: unknown; version: string; admin: boolean }>({ type: 'atom_home/config/get' });
      return normaliseConfig(r.config ?? null);
    },
    async save(config: HouseConfig) { await hass().callWS({ type: 'atom_home/config/set', config: normaliseConfig(config).config }); },
  };
}
