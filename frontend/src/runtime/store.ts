import { normaliseConfig, type HouseConfig } from '../model/config.ts';
/** Where the house configuration lives. Stage 2: browser storage for previews; stage 3: the HA integration. */
export interface PhotoStore { upload(blob: Blob, mime: 'image/jpeg' | 'image/png' | 'image/webp'): Promise<string>; remove(url: string): Promise<void> }
export interface ConfigStore {
  load(): Promise<{ config: HouseConfig; warnings: string[] }>;
  save(config: HouseConfig): Promise<void>;
  readonly label: string;
  photos?: PhotoStore;
}
/** Browser-only photo store for previews: the image travels inside the config as a data URL. */
export const dataUrlPhotos: PhotoStore = {
  async upload(blob, mime) { const buf = await blob.arrayBuffer(); let bin = ''; const bytes = new Uint8Array(buf); for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]); return `data:${mime};base64,${btoa(bin)}`; },
  async remove() { /* nothing stored outside the config */ },
};
export function memoryStore(initial?: unknown): ConfigStore {
  let current = normaliseConfig(initial);
  return { label: 'memory', photos: dataUrlPhotos, async load() { return current; }, async save(config) { current = { config: normaliseConfig(config).config, warnings: [] }; } };
}
export function localStore(key = 'atom-home:config'): ConfigStore {
  return {
    label: 'browser', photos: dataUrlPhotos,
    async load() { try { const raw = localStorage.getItem(key); return normaliseConfig(raw ? JSON.parse(raw) : null); } catch (e) { return { config: normaliseConfig(null).config, warnings: [`storage: ${e instanceof Error ? e.message : String(e)}`] }; } },
    async save(config) { localStorage.setItem(key, JSON.stringify(normaliseConfig(config).config)); },
  };
}
export const exportConfig = (config: HouseConfig) => JSON.stringify(config, null, 2);
/** Import never throws: malformed input yields the default config plus warnings the UI shows. */
export function importConfig(raw: string): { config: HouseConfig; warnings: string[] } {
  if (raw.length > 512 * 1024) return { config: normaliseConfig(null).config, warnings: ['import: file larger than 512 KB'] };
  try { return normaliseConfig(JSON.parse(raw)); } catch (e) { return { config: normaliseConfig(null).config, warnings: [`import: ${e instanceof Error ? e.message : String(e)}`] }; }
}
