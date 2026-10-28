import type { EntityRef } from '../model/discover.ts';
import type { T, Key } from '../i18n/index.ts';
const locales = { ru: 'ru-RU', ro: 'ro-RO', en: 'en-GB' } as const;
export type Lang = keyof typeof locales;
export const num = (v: number | null | undefined, lang: Lang, digits = 1) => v === null || v === undefined || !Number.isFinite(v) ? '—' : v.toLocaleString(locales[lang], { maximumFractionDigits: digits, minimumFractionDigits: 0 });
/** Human state of an entity: translated for known states, raw otherwise; never invents a value. */
export function stateText(e: EntityRef, t: T, lang: Lang): string {
  if (!e.available) return t('state.unavailable');
  if (e.state === 'unknown') return t('state.unknown');
  if (e.domain === 'climate') { const key = `state.${e.state}` as Key; const mode = t(key) === key ? e.state : t(key); const cur = typeof e.attributes.current_temperature === 'number' ? ` · ${num(e.attributes.current_temperature, lang)}°` : ''; return `${mode}${cur}`; }
  if (e.domain === 'sensor' || (e.domain === 'binary_sensor' && e.deviceClass === null)) { if (Number.isFinite(Number(e.state))) return `${num(Number(e.state), lang, e.unit === '%' || e.unit === 'ppm' || e.unit === 'W' ? 0 : 1)}${e.unit ? ' ' + e.unit : ''}`; }
  if (e.domain === 'binary_sensor') { const on = e.state === 'on'; if (e.deviceClass === 'moisture') return on ? t('state.wet') : t('state.dry'); if (['opening', 'door', 'window', 'garage_door'].includes(e.deviceClass ?? '')) return on ? t('state.open') : t('state.closed'); if (['motion', 'occupancy', 'presence'].includes(e.deviceClass ?? '')) return on ? t('state.detected') : t('state.clear'); return on ? t('state.on') : t('state.off'); }
  if (e.domain === 'cover') return t((`state.${e.state}`) as Key);
  if (e.domain === 'vacuum') { const b = typeof e.attributes.battery_level === 'number' ? ` · ${num(e.attributes.battery_level, lang, 0)}%` : ''; const k = `state.${e.state}` as Key; return `${t(k) === k ? e.state : t(k)}${b}`; }
  if (e.domain === 'media_player') { const k = `state.${e.state}` as Key; const title = typeof e.attributes.media_title === 'string' ? ` · ${e.attributes.media_title}` : ''; return `${t(k) === k ? e.state : t(k)}${title}`; }
  if (e.domain === 'light' && e.state === 'on' && typeof e.attributes.brightness === 'number') return `${t('state.on')} · ${Math.round(e.attributes.brightness / 2.55)}%`;
  const k = `state.${e.state}` as Key; return t(k) === k ? e.state : t(k);
}
export const isOn = (e: EntityRef) => ['on', 'playing', 'heat', 'cool', 'heat_cool', 'auto', 'cleaning', 'open', 'opening', 'unlocked', 'armed_away', 'armed_home'].includes(e.state);
export function co2Level(ppm: number | null, t: T): { label: string; tone: 'calm' | 'warning' | 'danger' | 'muted' } {
  if (ppm === null) return { label: t('overview.nothing'), tone: 'muted' };
  if (ppm < 800) return { label: t('co2.fresh'), tone: 'calm' };
  if (ppm < 1200) return { label: t('co2.ok'), tone: 'calm' };
  if (ppm < 2000) return { label: t('co2.stale'), tone: 'warning' };
  return { label: t('co2.bad'), tone: 'danger' };
}
export const iconOfKind: Record<string, string> = { light: 'light', switch: 'power', socket: 'socket', climate: 'heating', fan: 'fan', cover: 'blinds', lock: 'lock', vacuum: 'vacuum', media: 'media', camera: 'camera', weather: 'air', environment: 'thermo', energy: 'energy', leak: 'water', opening: 'door', motion: 'motion', alarm: 'warning', valve: 'water', alarm_panel: 'shield', person: 'person', measurement: 'systems' };

/** `Name · Room`, unless the owner already named the card after its room (e.g. «Термометр · Кухня»). */
export function withRoom(name: string, room: string): string { const n = name.trim(), r = room.trim(); return !r || n.toLowerCase().endsWith(r.toLowerCase()) ? n : `${n} · ${r}`; }
