import type { EntityRef } from '../model/discover.ts';
import type { T, Key } from '../i18n/index.ts';
import { CommandError } from '../runtime/commands.ts';
import { SaveError } from '../runtime/store.ts';
import { dateFormat, numberFormat } from '../runtime/zone.ts';
export const locales = { ru: 'ru-RU', ro: 'ro-RO', en: 'en-GB' } as const;
export type Lang = keyof typeof locales;
/** What went wrong with a command or a save, as one sentence in the user's language (audit 2026-11-09). Takes whatever was thrown: the panel's
 * own CommandError / SaveError, Home Assistant's plain `{ code, message }` (callService and callWS reject with it, not with an Error), the
 * connection library's numeric codes, an Error, a string. Home Assistant's own words are quoted only where it wrote them for people
 * (a refused service); a parser's or a script's text is never shown, and neither is «[object Object]». */
export function errorText(e: unknown, t: T): string {
  if (e instanceof SaveError) { const k = `save.error.${e.code}` as Key; return t(k) === k ? t('save.error.failed') : t(k); }
  const inner = typeof e === 'object' && e !== null && typeof (e as { error?: unknown }).error === 'object' && (e as { error?: unknown }).error !== null ? (e as { error: unknown }).error : e;
  const o = (typeof inner === 'object' && inner !== null ? inner : {}) as { code?: unknown; message?: unknown };
  const code = typeof e === 'number' ? e : o.code;
  if (e instanceof CommandError || code === 'offline' || code === 1 || code === 3) return t('ui.offline'); // 1 / 3: cannot connect / connection lost (home-assistant-js-websocket)
  if (code === 'unauthorized' || code === 'not_allowed' || code === 2) return t('error.unauthorized');
  if (code === 'timeout') return t('error.timeout');
  if (code === 'not_found' || code === 'unknown_command' || code === 'not_supported') return t('error.notFound');
  const said = typeof o.message === 'string' ? o.message.trim() : '';
  if ((code === 'service_validation_error' || code === 'home_assistant_error') && said) return t('error.refused', { reason: said });
  return t('error.command');
}
/** Always this many decimals, «4,0 kW»: a figure that changes keeps its width and does not jump. Not a number is «—», never «0».
 * The formatters are the cached ones of runtime/zone.ts: a redraw prints hundreds of numbers and must not build an `Intl` object for each. */
export const numFixed = (v: number, lang: Lang, digits: number) => Number.isFinite(v) ? numberFormat(locales[lang], { maximumFractionDigits: digits, minimumFractionDigits: digits }).format(Number(v.toFixed(digits)) || 0) : '—';
export const num = (v: number | null | undefined, lang: Lang, digits = 1) => v === null || v === undefined || !Number.isFinite(v) ? '—' : numberFormat(locales[lang], { maximumFractionDigits: digits, minimumFractionDigits: 0 }).format(Number(v.toFixed(digits)) || 0); // rounded first: −0.3 at no decimals is 0, not «-0»
/** Human state of an entity: translated for known states, raw otherwise; never invents a value. */
export function stateText(e: EntityRef, t: T, lang: Lang): string {
  if (!e.available) return t('state.unavailable');
  if (e.state === 'unknown') return t('state.unknown');
  if (e.domain === 'climate') { const key = `state.${e.state}` as Key; const mode = t(key) === key ? e.state : t(key); const cur = typeof e.attributes.current_temperature === 'number' ? ` · ${num(e.attributes.current_temperature, lang)}°` : ''; return `${mode}${cur}`; }
  // a moment in time is told as one («9 окт., 21:11»), not as the UTC string Home Assistant stores
  if (e.domain === 'sensor' && e.deviceClass === 'timestamp') { const at = Date.parse(e.state); if (Number.isFinite(at)) return dateFormat(locales[lang], { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', ...(new Date(at).getFullYear() !== new Date().getFullYear() ? { year: 'numeric' as const } : {}) }).format(at); }
  if (e.domain === 'sensor' || (e.domain === 'binary_sensor' && e.deviceClass === null)) { if (Number.isFinite(Number(e.state))) return `${num(Number(e.state), lang, e.unit === '%' || e.unit === 'ppm' || e.unit === 'W' ? 0 : 1)}${e.unit ? ' ' + e.unit : ''}`; }
  if (e.domain === 'binary_sensor') { const on = e.state === 'on'; if (e.deviceClass === 'moisture') return on ? t('state.wet') : t('state.dry'); if (['opening', 'door', 'window', 'garage_door'].includes(e.deviceClass ?? '')) return on ? t('state.open') : t('state.closed'); if (['motion', 'occupancy', 'presence'].includes(e.deviceClass ?? '')) return on ? t('state.detected') : t('state.clear'); if (e.deviceClass === 'tamper') return on ? t('state.tampered') : t('state.tamperOk'); /* a case contact is not a switch: «Выключено» said nothing */ if (e.deviceClass === 'vibration') return on ? t('state.vibration') : t('state.still'); return on ? t('state.on') : t('state.off'); }
  if (e.domain === 'cover') return t((`state.${e.state}`) as Key);
  if (e.domain === 'vacuum') { const b = typeof e.attributes.battery_level === 'number' ? ` · ${num(e.attributes.battery_level, lang, 0)}%` : ''; const k = `state.${e.state}` as Key; return `${t(k) === k ? e.state : t(k)}${b}`; }
  if (e.domain === 'media_player') { const k = `state.${e.state}` as Key; const title = typeof e.attributes.media_title === 'string' && e.attributes.media_title.trim() ? ` · ${e.attributes.media_title.trim()}` : ''; return `${t(k) === k ? e.state : t(k)}${title}`; }
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
/** A control whose command is on its way stays in the page's focus order: never `disabled` (the browser would drop the keyboard focus to the
 * page and a remote would have nowhere to press), but marked — `aria-disabled` + `aria-busy` — and its handler ignores the press (the runner
 * drops a second command anyway). `offline` (the house is unreachable) marks it the same way without «busy»; there the press still goes
 * through, so that the runner says «Нет связи с домом». A real `disabled` is kept for a device that is not there. */
export const held = (pending?: boolean, offline?: boolean): { 'aria-disabled'?: 'true'; 'aria-busy'?: 'true' } => pending ? { 'aria-disabled': 'true', 'aria-busy': 'true' } : offline ? { 'aria-disabled': 'true' } : {};
/** A device nobody named arrives called by its entity id («fan.office_fan»): it is shown by its kind, as «Настройка» does — never by the id. */
const ENTITY_ID = /^[a-z_]+\.[a-z0-9_]+$/;
export const shownName = (name: string, kind: string, t: T) => ENTITY_ID.test(name.trim()) ? t(`kind.${kind}` as Key) : name;
