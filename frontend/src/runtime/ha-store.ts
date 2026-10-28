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
    photos: {
      async upload(blob, mime) { const buf = new Uint8Array(await blob.arrayBuffer()); let bin = ''; for (let i = 0; i < buf.length; i += 0x8000) bin += String.fromCharCode(...buf.subarray(i, i + 0x8000)); const r = await hass().callWS<{ url: string }>({ type: 'atom_home/photo/set', mime, data: btoa(bin) }); return r.url; },
      async remove(url) { if (url.startsWith('/atom_home_photos/')) await hass().callWS({ type: 'atom_home/photo/delete', url }); },
    },
  };
}
