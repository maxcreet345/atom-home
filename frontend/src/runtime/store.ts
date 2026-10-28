import { normaliseConfig, type HouseConfig } from '../model/config.ts';
/** Where the house configuration lives. Stage 2: browser storage for previews; stage 3: the HA integration. */
export interface ConfigStore {
  load(): Promise<{ config: HouseConfig; warnings: string[] }>;
  save(config: HouseConfig): Promise<void>;
  readonly label: string;
}
export function memoryStore(initial?: unknown): ConfigStore {
  let current = normaliseConfig(initial);
  return { label: 'memory', async load() { return current; }, async save(config) { current = { config: normaliseConfig(config).config, warnings: [] }; } };
}
export function localStore(key = 'atom-home:config'): ConfigStore {
  return {
    label: 'browser',
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
