import { normaliseConfig, normaliseAlarms, type HouseConfig, type Alarm } from '../model/config.ts';
/** Where the house configuration lives. Stage 2: browser storage for previews; stage 3: the HA integration. */
export interface PhotoStore { upload(blob: Blob, mime: 'image/jpeg' | 'image/png' | 'image/webp'): Promise<string>; remove(url: string): Promise<void> }
/** `not_loaded`: the panel has not read the house's settings yet (the read failed), so it has nothing real to save over them. */
export type SaveErrorCode = 'conflict' | 'client_outdated' | 'too_large' | 'bad_schema' | 'unauthorized' | 'not_loaded' | 'failed';
/** A save the store refused or could not confirm; `code` picks the message the panel shows. */
export class SaveError extends Error {
  readonly code: SaveErrorCode;
  constructor(code: SaveErrorCode, message: string = code) { super(message); this.code = code; this.name = 'SaveError'; }
}
/** After an update through HACS the new panel is served at once, while the integration's Python keeps running the old code until Home Assistant
 *  restarts: the two then differ in version. True only when both are known and differ — an integration too old to say its version says nothing. */
export function restartNeeded(panelVersion: unknown, serverVersion: unknown): boolean {
  const ok = (v: unknown): v is string => typeof v === 'string' && /^\d+(\.\d+)+/.test(v.trim());
  return ok(panelVersion) && ok(serverVersion) && panelVersion.trim() !== serverVersion.trim();
}
/** `clientFeatures` is declared only by a panel that keeps every field it was given (see docs/PLAN-ADD-DEVICE.md, 7.1). */
export interface SaveOptions { clientFeatures?: string[] }
export interface ConfigStore {
  /** `revision` is present when the backend versions the config; the store remembers it and sends it with the next save. */
  load(): Promise<{ config: HouseConfig; warnings: string[]; revision?: number; /** the version of the integration that answered (its Python side) */ serverVersion?: string }>;
  /** Resolves only after the write is confirmed; rejects with SaveError. Saves from one store run one after another. */
  /** `alarms`: the list the house holds when the store carried it over a whole snapshot that was older than an alarms write (CODEX-003). */
  save(config: HouseConfig, options?: SaveOptions): Promise<{ revision?: number; alarms?: Alarm[] }>;
  /** Alarms may be set by any signed-in user (not only admins): the backend changes just that key and keeps the rest. */
  saveAlarms?(alarms: Alarm[]): Promise<{ alarms: Alarm[]; revision?: number }>;
  readonly label: string;
  photos?: PhotoStore;
}
/** Browser-only photo store for previews: the image travels inside the config as a data URL. */
export const dataUrlPhotos: PhotoStore = {
  async upload(blob, mime) { const buf = await blob.arrayBuffer(); let bin = ''; const bytes = new Uint8Array(buf); for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]); return `data:${mime};base64,${btoa(bin)}`; },
  async remove() { /* nothing stored outside the config */ },
};
/** In-memory store with the backend's revision rule. `client()` opens a second panel on the same data (QA: two tablets); `failNext` makes the next save fail. */
export function memoryStore(initial?: unknown): ConfigStore & { client(): ConfigStore; failNext(code: SaveErrorCode): void } {
  const shared = { current: normaliseConfig(initial), revision: 0, fail: null as SaveErrorCode | null };
  const open = (): ConfigStore => {
    let known = 0;
    return {
      label: 'memory', photos: dataUrlPhotos,
      async load() { known = shared.revision; return { ...shared.current, revision: shared.revision }; },
      async save(config) {
        if (shared.fail) { const code = shared.fail; shared.fail = null; throw new SaveError(code); }
        if (known !== shared.revision) throw new SaveError('conflict');
        shared.current = { config: normaliseConfig(config).config, warnings: [] }; known = ++shared.revision;
        return { revision: known };
      },
      async saveAlarms(alarms) { const list = normaliseAlarms(alarms); shared.current = { config: { ...shared.current.config, alarms: list }, warnings: [] }; known = ++shared.revision; return { alarms: list, revision: known }; },
    };
  };
  return Object.assign(open(), { client: open, failNext(code: SaveErrorCode) { shared.fail = code; } });
}
export function localStore(key = 'atom-home:config'): ConfigStore {
  return {
    label: 'browser', photos: dataUrlPhotos,
    async load() { try { const raw = localStorage.getItem(key); return normaliseConfig(raw ? JSON.parse(raw) : null); } catch (e) { return { config: normaliseConfig(null).config, warnings: [`storage: ${e instanceof Error ? e.message : String(e)}`] }; } },
    async save(config) { try { localStorage.setItem(key, JSON.stringify(normaliseConfig(config).config)); } catch (e) { throw new SaveError('failed', e instanceof Error ? e.message : String(e)); } return {}; },
  };
}
export const exportConfig = (config: HouseConfig) => JSON.stringify(config, null, 2);
export type ImportProblem = 'empty' | 'too_large' | 'not_json' | 'not_config';
const plainObject = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
/** «Импорт JSON», decided before anything is saved: broken, truncated or wrong-shaped text is a problem with a name (the configurator says it
 * in the user's language and changes nothing); only a text that is a panel configuration (what «Экспорт JSON» writes) yields a config. */
export function checkImport(raw: string): { ok: true; config: HouseConfig; warnings: string[] } | { ok: false; problem: ImportProblem } {
  if (!raw.trim()) return { ok: false, problem: 'empty' };
  if (raw.length > 512 * 1024) return { ok: false, problem: 'too_large' };
  let v: unknown; try { v = JSON.parse(raw); } catch { return { ok: false, problem: 'not_json' }; }
  const maps = ['rooms', 'devices', 'entities', 'modules', 'sections', 'energy'], lists = ['buttons', 'alarms'];
  if (!plainObject(v) || v.schemaVersion !== 1 || !plainObject(v.home) || typeof v.home.name !== 'string' || maps.some(k => v[k] !== undefined && !plainObject(v[k])) || lists.some(k => v[k] !== undefined && !Array.isArray(v[k]))) return { ok: false, problem: 'not_config' };
  return { ok: true, ...normaliseConfig(v) };
}
/** What an import replaces, in numbers the confirmation shows as «было → станет». */
export const configCounts = (c: HouseConfig) => ({ rooms: Object.keys(c.rooms).length, devices: Object.keys(c.devices).length, buttons: c.buttons.length, alarms: c.alarms.length, tariffs: c.energy.tariffs.length });
/** Import never throws: malformed input yields the default config plus warnings the UI shows. */
export function importConfig(raw: string): { config: HouseConfig; warnings: string[] } {
  if (raw.length > 512 * 1024) return { config: normaliseConfig(null).config, warnings: ['import: file larger than 512 KB'] };
  try { return normaliseConfig(JSON.parse(raw)); } catch (e) { return { config: normaliseConfig(null).config, warnings: [`import: ${e instanceof Error ? e.message : String(e)}`] }; }
}
/** An alarm edit made on a list that has gone stale, carried over to the fresh list: what this screen added, changed or removed (by id)
 * is applied, everything another screen did meanwhile stays. */
export function rebaseAlarms(base: Alarm[], wanted: Alarm[], fresh: Alarm[]): Alarm[] {
  const was = new Map(base.map(a => [a.id, JSON.stringify(a)])), want = new Map(wanted.map(a => [a.id, a]));
  const out = fresh.filter(a => !was.has(a.id) || want.has(a.id)).map(a => { const mine = want.get(a.id); return mine && JSON.stringify(mine) !== was.get(a.id) ? mine : a; });
  const have = new Set(out.map(a => a.id));
  for (const a of wanted) if (!was.has(a.id) && !have.has(a.id)) out.push(a);
  return out;
}
