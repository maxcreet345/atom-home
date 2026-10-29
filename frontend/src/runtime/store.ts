import { normaliseConfig, type HouseConfig } from '../model/config.ts';
/** Where the house configuration lives. Stage 2: browser storage for previews; stage 3: the HA integration. */
export interface PhotoStore { upload(blob: Blob, mime: 'image/jpeg' | 'image/png' | 'image/webp'): Promise<string>; remove(url: string): Promise<void> }
export type SaveErrorCode = 'conflict' | 'client_outdated' | 'too_large' | 'bad_schema' | 'unauthorized' | 'failed';
/** A save the store refused or could not confirm; `code` picks the message the panel shows. */
export class SaveError extends Error {
  readonly code: SaveErrorCode;
  constructor(code: SaveErrorCode, message: string = code) { super(message); this.code = code; this.name = 'SaveError'; }
}
/** `clientFeatures` is declared only by a panel that keeps every field it was given (see docs/PLAN-ADD-DEVICE.md, 7.1). */
export interface SaveOptions { clientFeatures?: string[] }
export interface ConfigStore {
  /** `revision` is present when the backend versions the config; the store remembers it and sends it with the next save. */
  load(): Promise<{ config: HouseConfig; warnings: string[]; revision?: number }>;
  /** Resolves only after the write is confirmed; rejects with SaveError. Saves from one store run one after another. */
  save(config: HouseConfig, options?: SaveOptions): Promise<{ revision?: number }>;
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
/** Import never throws: malformed input yields the default config plus warnings the UI shows. */
export function importConfig(raw: string): { config: HouseConfig; warnings: string[] } {
  if (raw.length > 512 * 1024) return { config: normaliseConfig(null).config, warnings: ['import: file larger than 512 KB'] };
  try { return normaliseConfig(JSON.parse(raw)); } catch (e) { return { config: normaliseConfig(null).config, warnings: [`import: ${e instanceof Error ? e.message : String(e)}`] }; }
}
