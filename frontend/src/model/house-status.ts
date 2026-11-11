/* «Всё ли в порядке?» — the house status strip on Home (release «classic», 11.11.2026; ported unchanged from design 2026, phase 2).
 * Pure: it reads only what the existing models already say (security, heating, the robot vacuum, the devices) and answers with one tone,
 * one sentence and the items that need a person, each with the place a tap opens. Danger before warning; a group of the same kind is one item
 * («3 устройства без связи»). Tested under Node: tests/house-status.test.ts. */
import type { Key, T } from '../i18n/index.ts';
import type { HomeDevice, EntityRef } from './discover.ts';
import type { Security, Hazard } from './security.ts';
import { openOnes } from './security.ts';
import type { Heating } from './heating.ts';
import { heatTrouble } from './heating.ts';
import type { Vacuum } from './vacuum.ts';
import { vacuumAlerts } from './vacuum.ts';
import type { View } from '../runtime/route.ts';

export type StatusTone = 'danger' | 'warn';
/** Every kind the strip knows, in the order it lists them: danger first, then what only needs a look. */
export const KIND_ORDER = ['alarm', 'entry', 'gas', 'smoke', 'co', 'leak', 'offline', 'armedOpen', 'window', 'pressure', 'heating', 'nolink', 'battery', 'vacuum', 'consumable'] as const;
export type StatusKind = typeof KIND_ORDER[number];
const DANGER: ReadonlySet<StatusKind> = new Set<StatusKind>(['alarm', 'entry', 'gas', 'smoke', 'co', 'leak', 'offline']);
/** One thing that needs a person: a chip on the strip. `place` is what a tap opens (null: nothing to open — the house is offline). */
export interface StatusItem { id: string; kind: StatusKind; tone: StatusTone; text: string; place: Partial<View> | null; glyph: string; /** how many things the chip stands for */ count: number }
export interface HouseStatus { tone: 'ok' | StatusTone; title: string; items: StatusItem[] }
export interface StatusInput {
  /** the panel reaches the house */ online: boolean;
  security: Security | null; heating: Heating | null; vacuum: Vacuum | null;
  /** an eBUS boiler module (a house without the heating model): its pressure in bar */ boiler?: { pressure: number | null } | null;
  /** the house's enabled devices */ devices: HomeDevice[];
  /** a device as a person calls it on Home («Детская · люстра», «Камера у входа») */ nameOf: (d: HomeDevice) => string;
  roomName: (id: string) => string;
  /** the house has these pages (a chip never leads to a hidden one): security, climate, cleaning */ pages?: ReadonlySet<string>;
}
/** Kinds of devices a person relies on: a lamp, a socket, the heating, a lock, the valve, a camera, a safety sensor. A thermometer or a phone's
 *  reading that went quiet is not on the strip (it is in «Устройства → Внимание»); neither is a TV or a media stick — Home Assistant calls
 *  them «unavailable» whenever they are switched off at the wall, and a strip that always says «нет связи» is a strip nobody reads. */
export const CARE_KINDS: ReadonlySet<string> = new Set(['light', 'switch', 'socket', 'climate', 'fan', 'cover', 'lock', 'valve', 'vacuum', 'camera', 'leak', 'opening', 'alarm', 'alarm_panel']);
/** Devices whose battery the house depends on (a phone's battery is its owner's business). */
const BATTERY_KINDS: ReadonlySet<string> = new Set(['leak', 'opening', 'motion', 'environment', 'climate', 'lock', 'alarm', 'valve', 'cover']);
/** A battery at or under this many percent is «садится». */
export const BATTERY_LOW = 15;
const w = (t: T, k: string, p?: Record<string, string | number>) => t(`status.${k}` as Key, p);
const lower = (s: string) => s ? s[0].toLocaleLowerCase() + s.slice(1) : s;
const GLYPH: Record<StatusKind, string> = { alarm: 'danger', entry: 'lock', gas: 'flame', smoke: 'flame', co: 'flame', leak: 'water', offline: 'offline', armedOpen: 'door', window: 'door', pressure: 'flame', heating: 'heating', nolink: 'offline', battery: 'battery', vacuum: 'vacuum', consumable: 'vacuum' };

/** The battery of a device, in percent or as «low» (a binary battery sensor), from its own entities; null when it has none or says nothing. */
export function batteryOf(d: Pick<HomeDevice, 'primary' | 'metrics' | 'diagnostics' | 'parameters'>): { low: boolean; level: number | null } | null {
  const all: EntityRef[] = [d.primary, ...d.metrics, ...d.diagnostics, ...d.parameters].filter(e => e.deviceClass === 'battery' && e.available);
  const pct = all.find(e => e.domain === 'sensor' && Number.isFinite(Number(e.state)) && e.state !== '');
  if (pct) { const level = Number(pct.state); return { low: level <= BATTERY_LOW, level }; }
  const flag = all.find(e => e.domain === 'binary_sensor' && (e.state === 'on' || e.state === 'off'));
  return flag ? { low: flag.state === 'on', level: null } : null;
}

/** The strip's answer. Everything a person must act on, in the order of KIND_ORDER; «Всё в порядке» when nothing is. */
export function houseStatus(x: StatusInput, t: T): HouseStatus {
  const items: StatusItem[] = [], has = (p: string) => !x.pages || x.pages.has(p);
  const add = (kind: StatusKind, id: string, text: string, place: Partial<View> | null, count = 1) => items.push({ id: `${kind}:${id}`, kind, tone: DANGER.has(kind) ? 'danger' : 'warn', text, place, glyph: GLYPH[kind], count });
  const security = x.security, sec: Partial<View> | null = has('security') ? { section: 'security' } : { section: 'systems', filter: 'attention' };
  const attention: Partial<View> = { section: 'systems', filter: 'attention' };
  // ---- danger: the alarm, gas / smoke / CO, water, the house out of reach
  if (security) {
    const st = security.alarm.state;
    if (st === 'triggered') { const open = openOnes(security)[0]; add('alarm', st, open ? w(t, 'alarmAt', { room: open.room || open.name }) : w(t, 'alarm'), sec); }
    if (st === 'pending') add('entry', st, w(t, 'entry'), sec);
    const wet = security.hazards.filter(h => h.alarm);
    for (const what of ['gas', 'smoke', 'co', 'leak'] as const) { const hs = wet.filter(h => h.what === what); if (hs.length) add(what, hs.map(h => h.id).join(','), hazardText(what, hs, t), sec, hs.length); }
  } else {
    // no security model (no Alarmo): the house's own leak, gas and smoke sensors
    const on = x.devices.filter(d => d.primary.available && d.primary.state === 'on');
    const wet = on.filter(d => d.kind === 'leak'), fire = on.filter(d => d.kind === 'alarm');
    for (const what of ['gas', 'smoke', 'co'] as const) { const hs = fire.filter(d => (d.primary.deviceClass === 'carbon_monoxide' ? 'co' : d.primary.deviceClass === 'smoke' ? 'smoke' : 'gas') === what); if (hs.length) add(what, hs.map(d => d.key).join(','), hs.length === 1 ? w(t, `${what}At`, { room: x.roomName(hs[0].roomId) }) : w(t, `${what}N`, { n: hs.length }), attention, hs.length); }
    if (wet.length) add('leak', wet.map(d => d.key).join(','), wet.length === 1 ? w(t, 'leakAt', { room: x.roomName(wet[0].roomId) }) : w(t, 'leakN', { n: wet.length }), attention, wet.length);
  }
  if (!x.online) add('offline', 'house', w(t, 'offline'), null);
  // ---- warnings: open while guarded, a window open while the heating works, the boiler, the heating's own links
  if (security && ['away', 'guard', 'vacation'].includes(security.alarm.state)) { const open = openOnes(security).filter(g => !g.bypassed); if (open.length) add('armedOpen', open.map(g => g.id).join(','), open.length === 1 ? w(t, 'armedOpen', { room: open[0].room || open[0].name }) : w(t, 'armedOpenN', { n: open.length }), sec, open.length); }
  const heat = x.heating, climate: Partial<View> = has('climate') ? { section: 'climate' } : attention;
  if (heat && heat.system) { const rooms = heat.rooms.filter(r => r.windows.some(win => win.known && win.open)); if (rooms.length) add('window', rooms.map(r => r.key).join(','), rooms.length === 1 ? w(t, 'windowAt', { room: rooms[0].name }) : w(t, 'windowN', { n: rooms.length }), climate, rooms.length); }
  const pressure = heat ? (heat.boiler.pressureLow ? heat.boiler.pressure ?? 0 : null) : x.boiler?.pressure !== undefined && x.boiler?.pressure !== null && x.boiler.pressure < 1 ? x.boiler.pressure : null;
  if (pressure !== null) add('pressure', 'boiler', w(t, 'pressure'), climate); // the classic look keeps the eBUS boiler's card on «Климат» (its placement), with or without the heating model
  const heatIds = new Set<string>();
  if (heat) { heatIds.add(heat.thermostat); for (const r of heat.rooms) heatIds.add(r.trv);
    const trouble = heatTrouble(heat); if (trouble.length) { const room = trouble.length === 1 && trouble[0].kind === 'room' ? trouble[0].room.name : null; add('heating', trouble.map(tr => tr.kind === 'room' ? tr.room.key : tr.kind).join(','), room ? w(t, 'heatingAt', { room }) : w(t, 'heating'), climate, trouble.length); } }
  // ---- devices a person relies on that do not answer, as one item; the heating's own are told above
  const silent = x.devices.filter(d => !d.primary.available && CARE_KINDS.has(d.kind) && !heatIds.has(d.primary.id));
  if (silent.length) add('nolink', silent.map(d => d.key).join(','), silent.length === 1 ? w(t, 'nolink1', { name: x.nameOf(silent[0]) }) : w(t, 'nolinkN', { n: silent.length }), silent.length === 1 ? { section: 'systems', device: silent[0].key } : attention, silent.length);
  // ---- batteries: the devices', the guarded sensors' «low» flag, the radiator heads'
  const low = new Map<string, string>();
  for (const d of x.devices) { if (!d.primary.available || !BATTERY_KINDS.has(d.kind)) continue; const b = batteryOf(d); if (b?.low) low.set(d.primary.id, x.nameOf(d)); }
  if (security) for (const g of [...security.guarded, ...security.hazards] as Array<{ id: string; name: string; room: string; low: boolean }>) if (g.low && !low.has(g.id)) low.set(g.id, g.room ? `${g.room} · ${lower(g.name)}` : g.name);
  if (heat) for (const r of heat.rooms) if (r.available && r.battery !== null && r.battery <= BATTERY_LOW && !low.has(r.trv)) low.set(r.trv, w(t, 'trv', { room: r.name }));
  if (low.size) { const [id, name] = [...low][0]; add('battery', [...low.keys()].join(','), low.size === 1 ? w(t, 'battery1', { name }) : w(t, 'batteryN', { n: low.size }), low.size === 1 && x.devices.some(d => d.primary.id === id) ? { section: 'systems', device: x.devices.find(d => d.primary.id === id)!.key } : attention, low.size); }
  // ---- the robot vacuum: an error, then a tank or a part due (one item: the worst first, «и ещё N»)
  const v = x.vacuum, clean: Partial<View> = has('cleaning') ? { section: 'cleaning' } : attention;
  if (v && v.available && v.phase !== 'offline') {
    if (v.phase === 'error') add('vacuum', 'error', w(t, 'vacError'), clean);
    const care = vacuumAlerts(v).filter(a => a.key !== 'error' || v.phase !== 'error');
    if (care.length) { const first = care[0], word = first.key === 'due' && first.consumable ? t('module.vac.a.due' as Key, { p: lower(t(`module.vac.c.${first.consumable}` as Key)) }) : t(`module.vac.a.${first.key}` as Key, first.key === 'dockError' ? { e: '' } : undefined);
      add('consumable', care.map(a => a.consumable ?? a.key).join(','), care.length === 1 ? w(t, 'vacCare', { what: lower(word) }) : w(t, 'vacCareN', { what: lower(word), n: care.length - 1 }), clean, care.length); }
  }
  items.sort((a, b) => KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind));
  const tone = items.some(i => i.tone === 'danger') ? 'danger' : items.length ? 'warn' : 'ok';
  return { tone, title: items.length ? w(t, 'attention', { n: items.length }) : w(t, 'ok'), items };
}
/** «Протечка · Ванная», «Протечка: 2 места»; a sensor's spot is the owner's own word and stays. */
function hazardText(what: Hazard['what'], hs: Hazard[], t: T): string {
  if (hs.length > 1) return w(t, `${what}N`, { n: hs.length });
  const h = hs[0]; return w(t, `${what}At`, { room: h.room || h.name });
}
