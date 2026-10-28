import type { Section } from './kinds.ts';
import type { Kind } from './kinds.ts';

export type Language = 'ru' | 'ro' | 'en';
export interface RoomOverride { name?: string; photo?: string | null; hidden?: boolean; order?: number }
export interface DeviceOverride { enabled?: boolean; name?: string; roomId?: string; icon?: string; kind?: Kind; mergeInto?: string; order?: number; photo?: string | null; /** stock illustration: a DeviceArtType, 'none', or unset = guessed */ art?: string }
export interface ModuleOverride { enabled?: boolean; entities?: Record<string, string>; options?: Record<string, string> }
export interface EntityOverride { hidden?: boolean; name?: string }
export interface CustomButton { id: string; label: string; icon?: string; roomId?: string; service: string; target?: Record<string, unknown>; data?: Record<string, unknown>; confirm: boolean }
export interface HouseConfig {
  schemaVersion: 1;
  home: { name: string; logo?: string | null; language: Language; theme: 'light' | 'dark' };
  rooms: Record<string, RoomOverride>;
  devices: Record<string, DeviceOverride>;
  entities: Record<string, EntityOverride>;
  buttons: CustomButton[];
  sections: Partial<Record<Section, { hidden?: boolean }>>;
  modules: Record<string, ModuleOverride>;
}
export function defaultConfig(name = 'Мой дом'): HouseConfig {
  return { schemaVersion: 1, home: { name, logo: null, language: 'ru', theme: 'light' }, rooms: {}, devices: {}, entities: {}, buttons: [], sections: {}, modules: {} };
}
const plain = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const SAFE_KEY = /^[\w.:\-]{1,128}$/;
/** Accepts a stored config; unknown or malformed parts are dropped, never thrown through to the UI. Returns the normalised config and a list of warnings. */
export function normaliseConfig(input: unknown): { config: HouseConfig; warnings: string[] } {
  const warnings: string[] = [], out = defaultConfig();
  if (!plain(input)) return { config: out, warnings: input === undefined || input === null ? [] : ['config: not an object'] };
  if (input.schemaVersion !== 1) warnings.push(`config: schemaVersion ${String(input.schemaVersion)} treated as 1`);
  if (plain(input.home)) {
    if (typeof input.home.name === 'string' && input.home.name.trim()) out.home.name = input.home.name.trim().slice(0, 60);
    if (typeof input.home.logo === 'string' && /^(data:image\/(png|jpeg|webp);base64,|\/local\/|https?:\/\/)/.test(input.home.logo)) out.home.logo = input.home.logo.slice(0, 200000);
    if (input.home.language === 'ru' || input.home.language === 'ro' || input.home.language === 'en') out.home.language = input.home.language;
    if (input.home.theme === 'light' || input.home.theme === 'dark') out.home.theme = input.home.theme;
  }
  const compact = (o: Record<string, unknown>) => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined));
  const map = (src: unknown, pick: (v: Record<string, unknown>) => Record<string, unknown> | null) => {
    const result: Record<string, Record<string, unknown>> = {};
    if (!plain(src)) return result;
    for (const [k, v] of Object.entries(src)) { if (!SAFE_KEY.test(k) || !plain(v)) { warnings.push(`config: dropped key ${k.slice(0, 40)}`); continue; } const p = pick(v); if (p) result[k] = compact(p); }
    return result;
  };
  const str = (v: unknown, max = 80) => typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : undefined;
  const num = (v: unknown) => typeof v === 'number' && Number.isFinite(v) ? v : undefined;
  const bool = (v: unknown) => typeof v === 'boolean' ? v : undefined;
  const photo = (v: unknown) => typeof v === 'string' && /^(\/atom_home_photos\/[a-z0-9]{12,32}\.(jpg|png|webp)|\/local\/[\w./-]+|https?:\/\/[^\s"']+|data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+)$/.test(v) && v.length <= 1_200_000 ? v : v === null ? null : undefined;
  out.rooms = map(input.rooms, v => ({ name: str(v.name), photo: photo(v.photo), hidden: bool(v.hidden), order: num(v.order) })) as HouseConfig['rooms'];
  out.devices = map(input.devices, v => ({ enabled: bool(v.enabled), name: str(v.name), roomId: str(v.roomId), icon: str(v.icon, 40), kind: str(v.kind, 20), art: str(v.art, 20), mergeInto: str(v.mergeInto, 160), order: num(v.order), photo: photo(v.photo) })) as HouseConfig['devices'];
  out.modules = map(input.modules, v => ({ enabled: bool(v.enabled), entities: plain(v.entities) ? Object.fromEntries(Object.entries(v.entities).filter(([k, e]) => /^\w{1,32}$/.test(k) && typeof e === 'string' && /^[a-z_]+\.[a-z0-9_]+$/.test(e))) : undefined, options: plain(v.options) ? Object.fromEntries(Object.entries(v.options).filter(([k, e]) => /^\w{1,32}$/.test(k) && typeof e === 'string' && /^[\w.\-]{1,64}$/.test(e))) : undefined })) as HouseConfig['modules'];
  out.entities = map(input.entities, v => ({ hidden: bool(v.hidden), name: str(v.name) })) as HouseConfig['entities'];
  if (Array.isArray(input.buttons)) for (const b of input.buttons.slice(0, 64)) {
    if (!plain(b) || typeof b.id !== 'string' || !SAFE_KEY.test(b.id) || typeof b.label !== 'string' || typeof b.service !== 'string' || !/^[a-z_]+\.[a-z_]+$/.test(b.service)) { warnings.push('config: dropped malformed button'); continue; }
    out.buttons.push(compact({ id: b.id, label: b.label.slice(0, 60), icon: str(b.icon, 40), roomId: str(b.roomId), service: b.service, target: plain(b.target) ? b.target : undefined, data: plain(b.data) ? b.data : undefined, confirm: b.confirm !== false }) as unknown as CustomButton);
  }
  if (plain(input.sections)) for (const [k, v] of Object.entries(input.sections)) if (plain(v) && typeof v.hidden === 'boolean') (out.sections as Record<string, { hidden?: boolean }>)[k] = { hidden: v.hidden };
  return { config: out, warnings };
}
