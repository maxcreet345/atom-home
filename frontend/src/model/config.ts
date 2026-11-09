import type { Section } from './kinds.ts';
import type { Kind } from './kinds.ts';

export type Language = 'ru' | 'ro' | 'en';
export interface RoomOverride { name?: string; photo?: string | null; hidden?: boolean; order?: number; /** the house feed (an SPM channel key) the room hangs on: the Energy panel splits the rooms by apartment with it */ feed?: string }
export interface DeviceOverride { enabled?: boolean; name?: string; roomId?: string; icon?: string; kind?: Kind; mergeInto?: string; order?: number; photo?: string | null; /** stock illustration: a DeviceArtType, 'none', or unset = guessed */ art?: string; /** pinned to the Home face */ favorite?: boolean }
export interface ModuleOverride { enabled?: boolean; entities?: Record<string, string>; options?: Record<string, string> }
export interface EntityOverride { hidden?: boolean; name?: string }
/** A room alarm the integration rings: when, where, how (speaker phrase or music, a dimmable light fading in, push), and how often it repeats. */
export interface Alarm { id: string; room: string; time: string; days: number[]; enabled: boolean; label: string; alice: 'off' | 'tts' | 'music'; phrase: string; station: string; light: boolean; lightEntity: string; fadeMin: number; push: boolean; repeats: number; repeatEveryMin: number }
export const ALARM_FADE = [0, 5, 10, 15, 20, 30] as const;
export const ALARM_REPEAT_EVERY = [3, 5, 10] as const;
export interface CustomButton { id: string; label: string; icon?: string; roomId?: string; service: string; target?: Record<string, unknown>; data?: Record<string, unknown>; confirm: boolean }
/** One electricity price of the Energy panel (owner, 09.11.2026): lei per kWh as billed, from a local calendar day until the next entry.
 * A past period is priced by the tariff of its own time: a month at 3 lei and 100 kWh is 300 lei, the month after a rise to 4 lei is 400. */
export interface Tariff { from: string; lei: number }
export interface HouseConfig {
  schemaVersion: 1;
  home: { name: string; logo?: string | null; language: Language; theme: 'light' | 'dark' };
  rooms: Record<string, RoomOverride>;
  devices: Record<string, DeviceOverride>;
  entities: Record<string, EntityOverride>;
  buttons: CustomButton[];
  sections: Partial<Record<Section, { hidden?: boolean }>>;
  modules: Record<string, ModuleOverride>;
  alarms: Alarm[];
  energy: { tariffs: Tariff[] };
}
export function defaultConfig(name = 'Мой дом'): HouseConfig {
  return { schemaVersion: 1, home: { name, logo: null, language: 'ru', theme: 'light' }, rooms: {}, devices: {}, entities: {}, buttons: [], sections: {}, modules: {}, alarms: [], energy: { tariffs: [] } };
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
  out.rooms = map(input.rooms, v => ({ name: str(v.name), photo: photo(v.photo), hidden: bool(v.hidden), order: num(v.order), feed: typeof v.feed === 'string' && SAFE_KEY.test(v.feed) ? v.feed : undefined })) as HouseConfig['rooms'];
  out.devices = map(input.devices, v => ({ enabled: bool(v.enabled), name: str(v.name), roomId: str(v.roomId), icon: str(v.icon, 40), kind: str(v.kind, 20), art: str(v.art, 20), favorite: bool(v.favorite), mergeInto: str(v.mergeInto, 160), order: num(v.order), photo: photo(v.photo) })) as HouseConfig['devices'];
  out.modules = map(input.modules, v => ({ enabled: bool(v.enabled), entities: plain(v.entities) ? Object.fromEntries(Object.entries(v.entities).filter(([k, e]) => /^\w{1,32}$/.test(k) && typeof e === 'string' && /^[a-z_]+\.[a-z0-9_]+$/.test(e))) : undefined, options: plain(v.options) ? Object.fromEntries(Object.entries(v.options).filter(([k, e]) => /^\w{1,32}$/.test(k) && typeof e === 'string' && /^[\w.\-]{1,64}$/.test(e))) : undefined })) as HouseConfig['modules'];
  out.entities = map(input.entities, v => ({ hidden: bool(v.hidden), name: str(v.name) })) as HouseConfig['entities'];
  if (Array.isArray(input.buttons)) for (const b of input.buttons.slice(0, 64)) {
    if (!plain(b) || typeof b.id !== 'string' || !SAFE_KEY.test(b.id) || typeof b.label !== 'string' || typeof b.service !== 'string' || !/^[a-z_]+\.[a-z_]+$/.test(b.service)) { warnings.push('config: dropped malformed button'); continue; }
    out.buttons.push(compact({ id: b.id, label: b.label.slice(0, 60), icon: str(b.icon, 40), roomId: str(b.roomId), service: b.service, target: plain(b.target) ? b.target : undefined, data: plain(b.data) ? b.data : undefined, confirm: b.confirm !== false }) as unknown as CustomButton);
  }
  out.alarms = normaliseAlarms(input.alarms);
  out.energy = { tariffs: normaliseTariffs(plain(input.energy) ? input.energy.tariffs : undefined) };
  if (plain(input.sections)) for (const [k, v] of Object.entries(input.sections)) if (plain(v) && typeof v.hidden === 'boolean') (out.sections as Record<string, { hidden?: boolean }>)[k] = { hidden: v.hidden };
  return { config: out, warnings };
}

const ENTITY_ID = /^[a-z_]+\.[a-z0-9_]+$/;
/** Same rules as the integration's `normalise_alarms`: malformed alarms are dropped, odd values fall back to defaults. */
export function normaliseAlarms(raw: unknown): Alarm[] {
  if (!Array.isArray(raw)) return [];
  const out: Alarm[] = [], seen = new Set<string>();
  for (const a of raw.slice(0, 40)) {
    if (!plain(a) || typeof a.id !== 'string' || !/^[A-Za-z0-9_-]{1,32}$/.test(a.id) || seen.has(a.id)) continue;
    if (typeof a.time !== 'string' || !/^([01]\d|2[0-3]):[0-5]\d$/.test(a.time)) continue;
    seen.add(a.id);
    const days = Array.isArray(a.days) ? [...new Set(a.days.filter((d): d is number => typeof d === 'number' && d >= 1 && d <= 7))].sort() : [];
    const station = typeof a.station === 'string' && ENTITY_ID.test(a.station) ? a.station : '', lightEntity = typeof a.lightEntity === 'string' && ENTITY_ID.test(a.lightEntity) ? a.lightEntity : '';
    out.push({ id: a.id, room: typeof a.room === 'string' ? a.room.slice(0, 64) : '', time: a.time, days, enabled: a.enabled !== false, label: typeof a.label === 'string' ? a.label.slice(0, 40) : '', alice: a.alice === 'tts' || a.alice === 'music' ? a.alice : 'off', phrase: typeof a.phrase === 'string' ? a.phrase.slice(0, 120) : '', station, light: a.light === true && !!lightEntity, lightEntity, fadeMin: (ALARM_FADE as readonly number[]).includes(a.fadeMin as number) ? a.fadeMin as number : 15, push: false, repeats: typeof a.repeats === 'number' && a.repeats >= 0 && a.repeats <= 10 ? Math.round(a.repeats) : 0, repeatEveryMin: (ALARM_REPEAT_EVERY as readonly number[]).includes(a.repeatEveryMin as number) ? a.repeatEveryMin as number : 5 });
  }
  return out;
}

const DAY_KEY = /^(\d{4})-(\d{2})-(\d{2})$/;
/** The tariff history, sorted by day; a malformed entry is dropped, two on the same day keep the later one, a price is 0,0001–1000 lei. */
export function normaliseTariffs(raw: unknown): Tariff[] {
  if (!Array.isArray(raw)) return [];
  const byDay = new Map<string, number>();
  for (const t of raw.slice(0, 64)) {
    if (!plain(t) || typeof t.from !== 'string' || typeof t.lei !== 'number' || !Number.isFinite(t.lei) || t.lei <= 0 || t.lei > 1000) continue;
    const m = DAY_KEY.exec(t.from); if (!m) continue;
    const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])], date = new Date(y, mo - 1, d);
    if (date.getFullYear() !== y || date.getMonth() !== mo - 1 || date.getDate() !== d) continue;
    byDay.set(t.from, Math.round(t.lei * 10000) / 10000);
  }
  return [...byDay.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([from, lei]) => ({ from, lei }));
}
