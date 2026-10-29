import { SaveError, type ConfigStore, type SaveErrorCode } from './store.ts';
import { normaliseConfig, type HouseConfig } from '../model/config.ts';
import type { Hass } from './host.ts';
const CODES: SaveErrorCode[] = ['conflict', 'client_outdated', 'too_large', 'bad_schema', 'unauthorized'];
const saveError = (e: unknown) => {
  const code = (e as { code?: unknown } | null)?.code, message = (e as { message?: unknown } | null)?.message;
  return new SaveError(CODES.includes(code as SaveErrorCode) ? code as SaveErrorCode : 'failed', typeof message === 'string' ? message : String(code ?? e));
};
/** Configuration kept in Home Assistant `.storage` through the atom_home integration's WebSocket API.
 *  Keep one instance per panel: it remembers the revision it last read or wrote, and queues saves so two quick edits do not collide. */
export function haStore(hass: () => Hass): ConfigStore {
  let revision: number | undefined;
  let queue: Promise<unknown> = Promise.resolve();
  return {
    label: 'home-assistant',
    async load() {
      const r = await hass().callWS<{ config: unknown; version: string; admin: boolean; revision?: number }>({ type: 'atom_home/config/get' });
      // An integration older than 1.2 has no revision: saves then go without one, as before.
      revision = typeof r.revision === 'number' ? r.revision : undefined;
      return { ...normaliseConfig(r.config ?? null), revision };
    },
    save(config: HouseConfig, options = {}) {
      const run = async () => {
        const msg: Record<string, unknown> = { type: 'atom_home/config/set', config: normaliseConfig(config).config };
        if (revision !== undefined) msg.expected_revision = revision;
        if (options.clientFeatures?.length) msg.client_features = options.clientFeatures;
        let r: { revision?: number } | null;
        try { r = await hass().callWS<{ saved: boolean; revision?: number }>(msg); } catch (e) { throw saveError(e); }
        if (typeof r?.revision === 'number') revision = r.revision;
        return { revision };
      };
      const next = queue.then(run, run);
      queue = next.catch(() => undefined);
      return next;
    },
    photos: {
      async upload(blob, mime) { const buf = new Uint8Array(await blob.arrayBuffer()); let bin = ''; for (let i = 0; i < buf.length; i += 0x8000) bin += String.fromCharCode(...buf.subarray(i, i + 0x8000)); const r = await hass().callWS<{ url: string }>({ type: 'atom_home/photo/set', mime, data: btoa(bin) }); return r.url; },
      async remove(url) { if (url.startsWith('/atom_home_photos/')) await hass().callWS({ type: 'atom_home/photo/delete', url }); },
    },
  };
}
