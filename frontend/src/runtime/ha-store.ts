import { SaveError, type ConfigStore, type SaveErrorCode } from './store.ts';
import { normaliseAlarms, normaliseConfig, type Alarm, type HouseConfig } from '../model/config.ts';
import type { Hass } from './host.ts';
/** Declared on every config/set: the server refuses a panel without it once a room has a feed (custom_components/atom_home/const.py). */
export const ROOM_FEED_FEATURE = 'room_feed_v1';
/** Declared the same way once a tariff history is stored (energy.tariffs): a 1.24.0 panel would drop it on save. */
export const TARIFF_FEATURE = 'energy_tariff_v1';
const CODES: SaveErrorCode[] = ['conflict', 'client_outdated', 'too_large', 'bad_schema', 'unauthorized'];
const saveError = (e: unknown) => {
  const code = (e as { code?: unknown } | null)?.code, message = (e as { message?: unknown } | null)?.message;
  return new SaveError(CODES.includes(code as SaveErrorCode) ? code as SaveErrorCode : 'failed', typeof message === 'string' ? message : String(code ?? e));
};
/** Configuration kept in Home Assistant `.storage` through the atom_home integration's WebSocket API.
 *  Keep one instance per panel: it remembers the revision it last read or wrote, and queues saves so two quick edits do not collide. */
export function haStore(hass: () => Hass): ConfigStore {
  let revision: number | undefined;
  /** Nothing is saved until the house's settings have been read once: a panel that only has the factory set (the read failed) would
   *  otherwise write it over the real one, and without a revision the server could not even refuse (audit 2026-11-09). */
  let loaded = false;
  let queue: Promise<unknown> = Promise.resolve();
  /** CODEX-003: the alarms are written by their own command (`alarms/set`, any user) and the rest by `config/set` (the whole settings). A whole
   *  snapshot built before an alarms write settled still holds the old list; queued behind that write it would get the new revision and put the
   *  old alarms back (a switched-off alarm rings again). So every alarms write that settles is counted, and a settings save that was asked for
   *  before it carries the alarms the house confirmed instead of its own stale copy — and says so, for the panel to show them. */
  let alarmsGen = 0, houseAlarms: Alarm[] | null = null;
  return {
    label: 'home-assistant',
    async load() {
      const r = await hass().callWS<{ config: unknown; version: string; admin: boolean; revision?: number }>({ type: 'atom_home/config/get' });
      // An integration up to 1.25.7 answers «config: null, revision: 0» while its entry is being reloaded (a newer one refuses with
      // `not_loaded`, which rejects above). A house whose settings this panel has already read cannot have none a moment later: the
      // read counts as failed, the panel keeps what it has and the loader tries again (runtime/loader.ts).
      if (loaded && (r.config === null || r.config === undefined) && (revision ?? 0) > 0) throw new SaveError('not_loaded');
      // An integration older than 1.2 has no revision: saves then go without one, as before.
      revision = typeof r.revision === 'number' ? r.revision : undefined;
      loaded = true;
      return { ...normaliseConfig(r.config ?? null), revision, serverVersion: typeof r.version === 'string' ? r.version : undefined };
    },
    save(config: HouseConfig, options = {}) {
      const seen = alarmsGen; // the alarms writes this snapshot was built after
      const run = async () => {
        if (!loaded) throw new SaveError('not_loaded');
        const rebased = seen !== alarmsGen && houseAlarms ? houseAlarms : null;
        const msg: Record<string, unknown> = { type: 'atom_home/config/set', config: normaliseConfig(rebased ? { ...config, alarms: rebased } : config).config };
        if (revision !== undefined) msg.expected_revision = revision;
        // normaliseConfig keeps rooms.<area>.feed, so this panel always says so; an integration older than 1.2 (no revision) has no client_features and would refuse the key.
        const features = revision !== undefined ? [...new Set([ROOM_FEED_FEATURE, TARIFF_FEATURE, ...(options.clientFeatures ?? [])])] : options.clientFeatures ?? [];
        if (features.length) msg.client_features = features;
        let r: { revision?: number } | null;
        try { r = await hass().callWS<{ saved: boolean; revision?: number }>(msg); } catch (e) { throw saveError(e); }
        if (typeof r?.revision === 'number') revision = r.revision;
        return rebased ? { revision, alarms: rebased } : { revision };
      };
      const next = queue.then(run, run);
      queue = next.catch(() => undefined);
      return next;
    },
    saveAlarms(alarms) {
      const run = async () => {
        if (!loaded) throw new SaveError('not_loaded');
        const msg: Record<string, unknown> = { type: 'atom_home/alarms/set', alarms: normaliseAlarms(alarms) };
        if (revision !== undefined) msg.expected_revision = revision;
        let r: { alarms?: unknown; revision?: number };
        try { r = await hass().callWS<{ saved: boolean; revision?: number; alarms?: unknown }>(msg); } catch (e) { throw saveError(e); }
        if (typeof r?.revision === 'number') revision = r.revision;
        const held = normaliseAlarms(r.alarms); houseAlarms = held; alarmsGen++;
        return { alarms: held, revision };
      };
      const next = queue.then(run, run); queue = next.catch(() => undefined); return next;
    },
    photos: {
      async upload(blob, mime) { const buf = new Uint8Array(await blob.arrayBuffer()); let bin = ''; for (let i = 0; i < buf.length; i += 0x8000) bin += String.fromCharCode(...buf.subarray(i, i + 0x8000)); const r = await hass().callWS<{ url: string }>({ type: 'atom_home/photo/set', mime, data: btoa(bin) }); return r.url; },
      async remove(url) { if (url.startsWith('/atom_home_photos/')) await hass().callWS({ type: 'atom_home/photo/delete', url }); },
    },
  };
}
