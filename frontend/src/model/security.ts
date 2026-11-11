import type { Registry, StateRow } from './registry.ts';
import type { HouseConfig } from './config.ts';
import { houseNow } from './cameras.ts';
import { houseToday } from '../runtime/zone.ts';
import { returnDay } from './heating.ts';
/** The Security card and panel (owner, 09.11.2026, book/06-dashboards/SECURITY.md): Alarmo's state and the house's modes, the door and
 * windows it guards, the tamper switches, gas and water, the water valve. Read from HA; the panel only arms, disarms and flips the modes. */
export type AlarmState = 'disarmed' | 'arming' | 'pending' | 'triggered' | 'away' | 'guard' | 'vacation' | 'unknown';
/** Alarmo's modes as the owner named them: «Не дома» is armed_away (set and cleared by presence), the manual «Охрана» is armed_home (no inside
 * sensors here, so the same door and windows; cleared only by hand), «Отпуск» armed_vacation. */
const MODE: Record<string, AlarmState> = { disarmed: 'disarmed', arming: 'arming', pending: 'pending', triggered: 'triggered', armed_away: 'away', armed_home: 'guard', armed_night: 'guard', armed_custom_bypass: 'guard', armed_vacation: 'vacation' };
/** what the device itself says, for the Ajax-like device card: battery, radio, the maker for the picture */
export interface DevInfo { level: number | null; low: boolean; signal: 'strong' | 'normal' | 'weak' | null; maker: 'ajax' | 'zigbee' | 'other'; model: string | null }
/** `open: null` — the sensor does not answer (`unavailable` or `unknown`): it is never read as closed (audit 09.11.2026). A sensor that does not
 * answer shows no battery and no radio either: what its other entities still hold is from before it fell silent (`level`, `signal` null, `low` false). */
export interface Guarded extends DevInfo { id: string; name: string; room: string; kind: 'door' | 'window'; open: boolean | null; since: number | null; tamper: boolean | null; bypassed: boolean }
/** `kind` groups and draws (gas-like or water), `what` names it: smoke and carbon monoxide are not «утечка газа».
 * `alarm: null` is either `silent` (the sensor does not answer: never «сухо») or a leak sensor that has not reported yet (`unknown` until its
 * first alarm — the owner's decision of 09.11.2026 for the storage room's sensor, book SECURITY.md п. 7: no «без связи» for it). */
export interface Hazard extends DevInfo { id: string; name: string; room: string; /** where in the room, from the device's name: «котёл», «раковина» */ spot: string | null; kind: 'gas' | 'leak'; what: 'gas' | 'smoke' | 'co' | 'leak'; alarm: boolean | null; silent: boolean; since: number | null }
export interface Security {
  alarm: { id: string; state: AlarmState; since: number | null; arming: string | null; bypassed: string[]; changedBy: string | null; delayEnds: number | null };
  guests: { id: string; on: boolean } | null;
  vacation: { id: string; on: boolean; from: string | null; to: string | null; /** the return date's helper, set from the panel */ toId: string | null } | null;
  guarded: Guarded[]; hazards: Hazard[];
  /** `offline` — the valve is `unavailable`: HA would quietly skip a command to it, so the panel sends none; `unknown` — it answers but has not said where it stands */
  valve: { id: string; name: string; room: string; state: 'open' | 'closed' | 'moving' | 'unknown' | 'offline' } | null;
  /** the valve's weekly exercise: on/off, the time and every how many days (input_boolean/_time/_days, Настройка) */
  exercise: { id: string; on: boolean; time: string | null; timeId: string | null; days: number | null; daysId: string | null } | null;
  /** the house's sockets and what «Отпуск» turns off: the label «Отпуск: выключать» on the switch (owner: everything but the fridge, a list to keep) */
  loads: Array<{ id: string; name: string; room: string; off: boolean }>;
}
/** the label the vacation automation turns off (HA label registry, «Отпуск: выключать») */
export const VACATION_LABEL = 'otpusk_vykliuchat';
const ts = (v: string | undefined) => { const n = v ? Date.parse(v) : NaN; return Number.isFinite(n) ? n : null; };
const on = (s: string | undefined) => s === 'on' ? true : s === 'off' ? false : null;
const WHAT: Record<string, Hazard['what']> = { gas: 'gas', smoke: 'smoke', carbon_monoxide: 'co', moisture: 'leak' };
/** The house's water valve. The config decides when it names one (`modules.security.entities.valve`); otherwise the only valve of the house,
 * and among several the one that says water (device class or name), never simply the first in HA's order. */
export function pickValve(ids: string[], chosen: string | undefined, words: (id: string) => string): string | undefined {
  if (chosen && ids.includes(chosen)) return chosen;
  const sorted = [...ids].sort();
  return sorted.find(id => /water|вод|кран|apa/i.test(words(id))) ?? sorted[0];
}
export function readSecurity(reg: Registry, config?: HouseConfig, now: number = Date.now()): Security | null {
  const S = reg.states, ents = reg.entities, devs = reg.devices, areas = reg.areas;
  const areaOf = (id: string) => { const e = ents.find(x => x.entity_id === id), d = e?.device_id ? devs.find(x => x.id === e.device_id) : null; return e?.area_id ?? d?.area_id ?? null; };
  const roomOf = (id: string) => areas.find(x => x.area_id === areaOf(id))?.name ?? '';
  // the device's battery and radio: Zigbee2MQTT's linkquality (0–255) or Xiaomi's signal_strength (dBm)
  const infoOf = (id: string): DevInfo => {
    const e = ents.find(x => x.entity_id === id), d = e?.device_id ? devs.find(x => x.id === e.device_id) : null;
    const sibs = e?.device_id ? ents.filter(x => x.device_id === e.device_id && S[x.entity_id]).map(x => x.entity_id) : [];
    const val = (re: RegExp) => { const k = sibs.find(x => re.test(x)); const v = k ? Number(S[k].state) : NaN; return k && Number.isFinite(v) ? v : null; };
    const lq = val(/^sensor\..*_linkquality$/), dbm = val(/^sensor\..*_(signal_strength|rssi)$/);
    const signal = lq !== null ? (lq >= 120 ? 'strong' : lq >= 60 ? 'normal' : 'weak') : dbm !== null ? (dbm >= -65 ? 'strong' : dbm >= -80 ? 'normal' : 'weak') : null;
    const lowId = sibs.find(x => /^binary_sensor\..*_battery_low$/.test(x));
    return { level: val(/^sensor\..*_battery$/), low: !!lowId && S[lowId].state === 'on', signal, maker: /ajax/i.test(d?.manufacturer ?? '') ? 'ajax' : e?.platform === 'mqtt' || /zigbee|xiaomi|sonoff|tuya|aqara/i.test(`${d?.manufacturer ?? ''} ${d?.model ?? ''}`) ? 'zigbee' : 'other', model: d?.model ?? null };
  };
  /** a sensor that does not answer keeps no battery and radio beside «не отвечает»: those readings are from before */
  const info = (id: string, quiet: boolean): DevInfo => { const x = infoOf(id); return quiet ? { ...x, level: null, low: false, signal: null } : x; };
  // what the owner hid in HA or in the panel's own settings (a hidden room, a hidden device — Okapi's showroom exhibits) is not the house's security
  const live = (id: string) => { const e = ents.find(x => x.entity_id === id), area = areaOf(id); return !e?.disabled_by && !e?.hidden_by && !config?.entities[id]?.hidden && !(area && config?.rooms[area]?.hidden); };
  // Alarmo's own panel, never a hub's or an exhibit's; with several Alarmo areas, its master panel
  const alarmo = Object.keys(S).filter(id => id.startsWith('alarm_control_panel.') && live(id) && ents.find(x => x.entity_id === id)?.platform === 'alarmo');
  const alarmId = alarmo.find(id => /master$/.test(id)) ?? alarmo[0];
  if (!alarmId) return null;
  const a = S[alarmId];
  // «Датчик левого окна (MCCGQ02HL) Левое окно кухни» → «Левое окно кухни»: the words after the model are the name
  const tidy = (id: string) => { const last = String(S[id]?.attributes.friendly_name ?? id).split(' · ').at(-1)!, after = last.includes(')') ? last.slice(last.lastIndexOf(')') + 1).trim() : '', n = (after || last).replace(/\s*\([^)]*\)/g, '').trim(); return n.charAt(0).toUpperCase() + n.slice(1); };
  const bypassed = Array.isArray(a.attributes.bypassed_sensors) ? (a.attributes.bypassed_sensors as string[]) : [];
  const guarded: Guarded[] = Object.keys(S).filter(id => id.startsWith('binary_sensor.') && live(id) && ['door', 'window', 'opening'].includes(String(S[id].attributes.device_class))).map(id => {
    const stem = id.replace(/_contact$/, ''), tamperId = `${stem}_tamper`;
    return { ...info(id, on(S[id].state) === null), id, name: tidy(id), room: roomOf(id), kind: (S[id].attributes.device_class === 'door' || /door/.test(id) ? 'door' : 'window') as Guarded['kind'], open: on(S[id].state), since: ts(S[id].last_changed), tamper: S[tamperId] ? on(S[tamperId].state) : null, bypassed: bypassed.includes(id) };
  }).sort((x, y) => Number(y.kind === 'door') - Number(x.kind === 'door') || x.room.localeCompare(y.room) || x.name.localeCompare(y.name));
  const hazards: Hazard[] = Object.keys(S).filter(id => id.startsWith('binary_sensor.') && live(id) && ['gas', 'moisture', 'smoke', 'carbon_monoxide'].includes(String(S[id].attributes.device_class))).map(id => { const silent = on(S[id].state) === null && !(S[id].state === 'unknown' && S[id].attributes.device_class === 'moisture'); return { ...info(id, silent), id, name: tidy(id), room: roomOf(id), spot: (String(S[id].attributes.friendly_name ?? '').match(/\(([^)]+)\)/)?.[1] ?? '').replace(/^(tuya|ts\d+|zigbee).*$/i, '') || null, kind: (S[id].attributes.device_class === 'moisture' ? 'leak' : 'gas') as Hazard['kind'], what: WHAT[String(S[id].attributes.device_class)] ?? 'gas', alarm: on(S[id].state), silent, since: ts(S[id].last_changed) }; });
  const valveId = pickValve(Object.keys(S).filter(id => id.startsWith('valve.') && live(id)), config?.modules.security?.entities?.valve, id => `${id} ${String(S[id].attributes.friendly_name ?? '')} ${String(S[id].attributes.device_class ?? '')}`);
  const vs = valveId ? S[valveId].state : '';
  const pick = (...names: string[]) => names.find(id => S[id]);
  // «Гости» is one switch for the heating and the guard (the heating's own, 09.11.2026); «Отпуск» is Alarmo's armed_vacation, its end the heating's return date
  const g = pick('input_boolean.house_guests', 'input_boolean.heating_guests'), ex = pick('input_boolean.water_valve_exercise');
  const exTime = pick('input_datetime.water_valve_exercise_time'), exDays = pick('input_number.water_valve_exercise_days'), backId = pick('input_datetime.house_vacation_to', 'input_datetime.heating_vacation_return');
  const st = MODE[a.state] ?? 'unknown', delay = Number(a.attributes.delay), armMode = typeof a.attributes.arm_mode === 'string' ? a.attributes.arm_mode : null;
  const vacationOn = st === 'vacation' || (['arming', 'pending', 'triggered'].includes(st) && armMode === 'armed_vacation');
  // the helper holds a calendar date of the HOUSE: «today» is the house's, not this browser's; the house's «no date» (CODEX-011) is no date
  const back = backId ? returnDay(S[backId].state, houseToday(now)) : null;
  // a socket = the main switch of a device labelled «розетки» (its shortest switch id: «…_plug», not «…_plug_child_lock»), or one already on the vacation list
  const devOf = (id: string) => { const e = ents.find(x => x.entity_id === id); return e?.device_id ? devs.find(d => d.id === e.device_id) ?? null : null; };
  const sw = ents.filter(e => e.entity_id.startsWith('switch.') && !e.entity_category && !e.disabled_by && S[e.entity_id]);
  const main = new Map<string, string>(); for (const e of sw) if (e.device_id) { const cur = main.get(e.device_id); if (!cur || e.entity_id.length < cur.length) main.set(e.device_id, e.entity_id); }
  const loads = sw.filter(e => (e.labels ?? []).includes(VACATION_LABEL) || (e.device_id && main.get(e.device_id) === e.entity_id && (devOf(e.entity_id)?.labels ?? []).includes('rozetki')))
    .map(e => ({ id: e.entity_id, name: tidy(e.entity_id), room: roomOf(e.entity_id), off: (e.labels ?? []).includes(VACATION_LABEL) }))
    .sort((x, y) => x.room.localeCompare(y.room) || x.name.localeCompare(y.name));
  return {
    alarm: { id: alarmId, state: st, since: ts(a.last_changed), arming: armMode, bypassed, changedBy: typeof a.attributes.changed_by === 'string' ? a.attributes.changed_by : null, delayEnds: (st === 'arming' || st === 'pending') && Number.isFinite(delay) && delay > 0 ? (ts(a.last_changed) ?? Date.now()) + delay * 1000 : null },
    guests: g ? { id: g, on: S[g].state === 'on' } : null,
    vacation: { id: alarmId, on: vacationOn, from: null, to: back, toId: backId ?? null },
    guarded, hazards,
    valve: valveId ? { id: valveId, name: tidy(valveId), room: roomOf(valveId), state: vs === 'open' ? 'open' : vs === 'closed' ? 'closed' : vs === 'opening' || vs === 'closing' ? 'moving' : vs === 'unavailable' ? 'offline' : 'unknown' } : null,
    exercise: ex ? { id: ex, on: S[ex].state === 'on', time: exTime && /^\d\d:\d\d/.test(S[exTime].state) ? S[exTime].state.slice(0, 5) : null, timeId: exTime ?? null, days: exDays && Number.isFinite(Number(S[exDays].state)) ? Math.round(Number(S[exDays].state)) : null, daysId: exDays ?? null } : null,
    loads,
  };
}
export type SecTone = 'calm' | 'armed' | 'warn' | 'alarm' | 'off';
/** The card's colour: red for an alarm, gas or water; amber for an open window, a tamper or a delay running; green-blue when guarded. */
export function secTone(s: Security): SecTone {
  if (s.alarm.state === 'triggered' || s.hazards.some(h => h.alarm)) return 'alarm';
  // a sensor that does not answer guards nothing: the card is never calm with one (audit 09.11.2026)
  if (s.alarm.state === 'pending' || s.alarm.state === 'arming' || s.guarded.some(x => x.tamper) || s.alarm.state === 'unknown' || silentOnes(s).length) return 'warn';
  if (['away', 'guard', 'vacation'].includes(s.alarm.state)) return s.guarded.some(x => x.open && !x.bypassed) ? 'warn' : 'armed';
  return s.guarded.some(x => x.open) ? 'off' : 'calm';
}
export const openOnes = (s: Security) => s.guarded.filter(x => x.open);
/** The sensors that do not answer: a door or a window without a state, a gas, smoke or water sensor that is `silent`. */
export const silentOnes = (s: Security): Array<Guarded | Hazard> => [...s.guarded.filter(x => x.open === null), ...s.hazards.filter(h => h.silent)];
/** The delay's countdown: whole seconds rounded up, so the last second reads «0:01» and a minute «1:00», never «0:60». */
export function countdown(leftSeconds: number): string { const s = Math.max(0, Math.ceil(leftSeconds)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; }
/** «23 ноября» of the return date the helper holds (`YYYY-MM-DD`): a calendar date, printed as it is — never moved a day by the browser's zone
 * (`new Date('2026-11-23')` is UTC midnight, the 22nd in a browser west of it). */
export function calendarDay(iso: string | null, locale: string): string | null {
  const m = iso ? /^(\d{4})-(\d\d)-(\d\d)/.exec(iso) : null; if (!m) return null;
  return new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]))).toLocaleDateString(locale, { day: 'numeric', month: 'long', timeZone: 'UTC' });
}
/** A return date typed into the «Отпуск» question: empty is «no date»; a date that is not one, or that has already passed by the house's
 * calendar, is `past` — the panel says so and does not switch «Отпуск» on without the date the person believes they set. */
export function returnDate(typed: string, today: string): { date: string | null; error: 'past' | null } {
  if (!typed) return { date: null, error: null };
  return /^\d{4}-\d\d-\d\d$/.test(typed) && typed >= today ? { date: typed, error: null } : { date: null, error: 'past' };
}
export type AskKind = 'arm' | 'disarm' | 'vacOn' | 'vacOff' | 'valve';
/** Does an open question still make sense? The house may have been disarmed, «Отпуск» flipped or the valve turned from another device meanwhile:
 * the question is then withdrawn — its «yes» would send a command to a house that is already there. */
export function questionStands(kind: AskKind, s: Security): boolean {
  const st = s.alarm.state, armed = ['away', 'guard', 'vacation', 'triggered', 'pending', 'arming'].includes(st);
  if (kind === 'arm') return !armed && st !== 'unknown';
  if (kind === 'disarm') return armed && st !== 'arming';
  // «Отпуск» is a mode of the same Alarmo: with the alarm panel unknown or unavailable there is nothing to switch on (ST-06)
  if (kind === 'vacOn') return !!s.vacation && !s.vacation.on && st !== 'unknown';
  if (kind === 'vacOff') return !!s.vacation?.on;
  return s.valve?.state === 'closed';
}
/** The seconds left of the exit or entry delay, counted without trusting this device's clock (a wall tablet's may be minutes off). The delay
 * ends at `delayEnds` by the HOUSE's clock, and every set of states says how late it is there at least: its newest `last_updated`, never
 * earlier than the alarm's own change. So each new set gives «at most this much is left now»; the smallest of them, counted down by the
 * device's own ticking, is the answer. A set that arrives late (a reconnect) can only say «more», and is ignored. */
export function delayClock(): (alarm: Pick<Security['alarm'], 'since' | 'delayEnds'>, states: Record<string, StateRow>, deviceNow?: number) => number | null {
  let key = '', read: unknown = null, ends = Infinity; // `ends`: the delay's end on THIS device's clock
  return (alarm, states, deviceNow = Date.now()) => {
    if (alarm.delayEnds === null) { key = ''; return null; }
    const k = `${alarm.since}|${alarm.delayEnds}`; if (k !== key) { key = k; read = null; ends = Infinity; }
    if (states !== read) { read = states; const h = houseNow(states), house = Math.max(Number.isFinite(h) ? h : -Infinity, alarm.since ?? -Infinity);
      ends = Math.min(ends, house === -Infinity ? alarm.delayEnds : deviceNow + (alarm.delayEnds - house)); }
    return Math.max(0, (ends - deviceNow) / 1000);
  };
}
