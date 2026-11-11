import type { Registry, StateRow } from './registry.ts';
import { unavailable } from './registry.ts';
import { houseToday } from '../runtime/zone.ts';
/** The house's heating as the owner built it (book/04-automations/HEATING.md, 04.11.2026):
 * the Tuya thermostat in the living room only switches the system and sets the common temperature;
 * five SONOFF heads follow that temperature by the room sensors; the MINI-D relay asks the boiler for heat while any head heats;
 * a room's own change holds three hours in «Авто»; an open window stops its room's head after a minute. */
export type HeatAction = 'heating' | 'idle' | 'off' | 'window' | 'offline';
/** `known: false` — the window's sensor does not answer: it is not a closed window (audit 09.11.2026) */
export interface HeatWindow { id: string; name: string; open: boolean; known: boolean; since: number | null }
export interface HeatRoom {
  key: string; areaId: string | null; name: string; trv: string;
  current: number | null; target: number | null; action: HeatAction; available: boolean; battery: number | null;
  windows: HeatWindow[]; windowPaused: boolean;
  /** «Авто»: the room's own temperature and when it returns to the common one */ override: { temp: number; until: number } | null;
  manual: number | null; desired: string | null;
  /** what the head regulates by: the room's own sensor (`select.<room>_trv_temperature_sensor_select` = remote_temperature), or its built-in one at the
   * radiator (`local_temperature`, or `remote_source_offline` when the room's sensor stopped coming) — then «в комнате» is the head's reading, and says so;
   * `lost` — the head is still set to the room's sensor, but that sensor itself does not answer (`sensor.<room>_climate_temperature` /
   * `sensor.<room>_co2_temperature` is unavailable): the head holds the last value it was given, and the card says so instead of «в комнате». */
  sensor: 'room' | 'head' | 'lost';
}
export interface Boiler {
  online: boolean; flame: boolean | null; flow: number | null; flowTarget: number | null; ret: number | null;
  dhw: number | null; dhwTarget: number | null; pressure: number | null; relay: boolean | null; state: string | null;
  /** the house's own Threshold helpers (≤ 0,8 / > 2,8 bar with hysteresis), else the manual's norm */ pressureLow: boolean; pressureHigh: boolean;
}
export type Scenario = 'home' | 'sleep' | 'away' | 'eco' | 'vacation';
export interface Heating {
  system: boolean; systemKnown: boolean; scenarioKnown: boolean; thermostat: string; thermostatOnline: boolean; mode: 'auto' | 'manual';
  scenario: Scenario; scenarioRaw: string; target: number | null; temps: Record<Scenario, number | null>;
  sleep: { from: string; to: string }; guests: boolean; eco: boolean; vacation: boolean;
  /** the day the house is warm again (YYYY-MM-DD), only while it is today or ahead: a date left from the last trip is not a return date, nor is
   * the house's «no date» (`NO_RETURN_DAY`) */ vacationReturn: string | null;
  /** the return date's helper, when the house has one */ vacationReturnId: string | null; scenarioOverride: boolean;
  /** one hysteresis for every head (owner, 09.11.2026): how far a room may cool before its head opens, how far it may warm before it closes; null until the helpers exist */
  hyst: { down: number; up: number } | null;
  /** the house's security (Alarmo): its «Отпуск» is the whole house's, the heating follows it (automation heating_security) */ security: { id: string; state: string; mode: string | null; vacation: boolean } | null;
  rooms: HeatRoom[]; boiler: Boiler; outdoor: { temp: number | null; state: string | null };
}
const SCENARIO: Record<string, Scenario> = { 'Дома': 'home', 'Сон': 'sleep', 'Нет дома': 'away', 'Эко': 'eco', 'Отпуск': 'vacation' };
const n = (s?: StateRow) => { if (!s || unavailable(s.state)) return null; const v = Number(s.state); return Number.isFinite(v) ? v : null; };
const ROOM_ORDER = ['living', 'kitchen', 'bedroom', 'kids', 'office'];
/** the calendar day of the HOUSE, as its `input_datetime` holds it: «today» for the return date is the house's day, also when the panel is
 * opened from another time zone (runtime/zone.ts; the browser's own day when the house's zone is not known) */
export const dayOf = (ms: number) => houseToday(ms);
/** The return date typed into the «Отпуск» question: empty is «no date»; a real day, today or ahead, is the date; anything else (a day that has
 * passed, typed by keyboard past the field's `min`) is `past` — said in the field, and «Отпуск» is not switched on without it. */
export const returnDate = (typed: string, now: number): { date: string | null; past: boolean } => !typed ? { date: null, past: false } : /^\d{4}-\d\d-\d\d$/.test(typed) && typed >= dayOf(now) ? { date: typed, past: false } : { date: null, past: true };
/** «Отпуск» without a return date, as the house holds it (CODEX-011). `input_datetime` cannot be emptied, so «no date» is a day no trip reaches:
 * the panel writes it before it switches «Отпуск» on without a date (the heating's question and the security's), and reads it — and anything
 * after it — back as «no date». The house's automation `heating_vacation` ends «Отпуск» «N hours before the return date» (book/04-automations/
 * HEATING.md §D 7): a day in 2099 never comes, so «Отпуск» ends only by someone coming home or by the distance — «no return date». A day in the
 * past would not do: a rule comparing «now ≥ the date − N h» would end «Отпуск» at once. */
export const NO_RETURN_DAY = '2099-12-31';
/** The return day the helper holds, as the panel shows it: today or ahead, never the house's «no date» (`NO_RETURN_DAY` and after) — else null. */
export const returnDay = (state: string | undefined, today: string): string | null => { const d = /^\d{4}-\d\d-\d\d/.test(state ?? '') ? state!.slice(0, 10) : null; return d && d >= today && d < NO_RETURN_DAY ? d : null; };
/** The room's own temperature sensor (book HEATING.md: the kitchen, the office and the bedroom have a climate sensor, the kids' room and the living room a CO₂ one). */
const roomSensor = (S: Registry['states'], key: string): StateRow | undefined => S[`sensor.${key}_climate_temperature`] ?? S[`sensor.${key}_co2_temperature`];
/** null when the house has no such heating (no «Отопление · Режим» helper or no heads). */
export function readHeating(reg: Registry, now = Date.now()): Heating | null {
  const S = reg.states, s = (id: string) => S[id], on = (id: string) => S[id]?.state === 'on';
  if (!s('input_select.heating_mode')) return null;
  const trvs = Object.keys(S).filter(id => /^climate\.[a-z0-9_]+_trv$/.test(id)).sort((a, b) => ROOM_ORDER.indexOf(a.slice(8, -4)) - ROOM_ORDER.indexOf(b.slice(8, -4)));
  if (!trvs.length) return null;
  const areaOf = (id: string) => { const e = reg.entities.find(x => x.entity_id === id); return e?.area_id ?? reg.devices.find(d => d.id === e?.device_id)?.area_id ?? null; };
  const areaName = (a: string | null) => reg.areas.find(x => x.area_id === a)?.name ?? null;
  const rooms: HeatRoom[] = trvs.map(trv => {
    const key = trv.slice(8, -4), st = s(trv), area = areaOf(trv), avail = !!st && !unavailable(st.state);
    const windows = Object.keys(S).filter(id => id.startsWith(`binary_sensor.${key}_window`) && id.endsWith('_contact')).map(id => {
      const w = S[id], label = reg.entities.find(e => e.entity_id === id), dev = reg.devices.find(d => d.id === label?.device_id);
      const raw = (dev?.name ?? w.attributes.friendly_name as string ?? id).replace(/^[^·]*·\s*/, '').replace(/\s*\(.*\)$/, '').replace(/^Датчик\s+/i, '');
      const nom = raw.replace(/^(правого|левого|центрального)\s+окна$/i, (_, a: string) => `${({ правого: 'правое', левого: 'левое', центрального: 'центральное' } as Record<string, string>)[a.toLowerCase()]} окно`).replace(/^окна$/i, 'окно');
      return { id, name: nom.charAt(0).toUpperCase() + nom.slice(1), open: w.state === 'on', known: !unavailable(w.state), since: w.state === 'on' ? Date.parse(w.last_changed) : null };
    });
    const paused = on(`input_boolean.${key}_heating_window`), timer = s(`timer.${key}_heating_override`);
    const until = timer?.state === 'active' && typeof timer.attributes.finishes_at === 'string' ? Date.parse(timer.attributes.finishes_at) : null;
    const hvac = st?.attributes.hvac_action, action: HeatAction = !avail ? 'offline' : paused ? 'window' : st!.state === 'off' ? 'off' : hvac === 'heating' ? 'heating' : 'idle';
    const bat = n(s(`sensor.${key}_trv_battery`));
    return { key, areaId: area, name: areaName(area) ?? (st?.attributes.friendly_name as string ?? key).split(' · ')[0], trv, available: avail,
      current: typeof st?.attributes.current_temperature === 'number' ? st.attributes.current_temperature : null,
      target: typeof st?.attributes.temperature === 'number' && st.state !== 'off' ? st.attributes.temperature : null,
      action, battery: bat, windows, windowPaused: paused,
      override: until && until > now ? { temp: n(s(`input_number.${key}_heating_override_temp`)) ?? 0, until } : null,
      manual: n(s(`input_number.${key}_heating_manual_temp`)), desired: s(`sensor.${key}_heating_desired`)?.state ?? null, sensor: (x => x && !unavailable(x.state) && x.state !== 'remote_temperature' ? 'head' : (rs => rs && unavailable(rs.state) ? 'lost' : 'room')(roomSensor(S, key)))(s(`select.${key}_trv_temperature_sensor_select`)) };
  });
  // the heads are fed the room's sensor minus «вверх» (heating_external_temp), so what they report is that much lower than the room
  const shift = n(s('input_number.heating_hyst_up')) ?? 0; for (const r of rooms) if (r.current !== null && r.sensor !== 'head') r.current = Math.round((r.current + shift) * 10) / 10;
  const th = s('climate.living_thermostat'), scenarioRaw = s('sensor.heating_scenario')?.state ?? 'Дома';
  const v = (k: string) => n(s(`input_number.heating_${k}_temp`));
  const B = (k: string) => n(s(`sensor.kitchen_boiler_${k}`));
  const flame = s('sensor.kitchen_boiler_flame')?.state, relay = s('switch.kitchen_boiler_heat_relay')?.state;
  const busOn = s('binary_sensor.kitchen_boiler_ebus_signal')?.state === 'on';
  const B2 = (k: string) => busOn ? B(k) : null; // a silent bus leaves the last numbers in HA: they are old, not now
  const pressure = B2('pressure'), helper = (id: string) => { const x = s(id)?.state; return x === 'on' ? true : x === 'off' ? false : null; };
  const pLow = helper('binary_sensor.kitchen_boiler_pressure_low'), pHigh = helper('binary_sensor.kitchen_boiler_pressure_high');
  const weather = ['weather.forecast_home', ...Object.keys(S).filter(id => id.startsWith('weather.'))].find(id => S[id] && !unavailable(S[id].state));
  return {
    system: on('input_boolean.heating_system'), systemKnown: ['on', 'off'].includes(s('input_boolean.heating_system')?.state ?? ''), scenarioKnown: scenarioRaw in SCENARIO, thermostat: 'climate.living_thermostat', thermostatOnline: !!th && !unavailable(th.state),
    mode: s('input_select.heating_mode')?.state === 'Ручной' ? 'manual' : 'auto',
    scenario: SCENARIO[scenarioRaw] ?? 'home', scenarioRaw, target: n(s('sensor.heating_target_temp')),
    temps: { home: v('home'), sleep: v('sleep'), away: v('away'), eco: v('eco'), vacation: v('vacation') },
    sleep: { from: (s('input_datetime.heating_sleep_start')?.state ?? '23:00').slice(0, 5), to: (s('input_datetime.heating_sleep_end')?.state ?? '06:00').slice(0, 5) },
    guests: on('input_boolean.heating_guests'), eco: on('input_boolean.heating_eco'), vacation: on('input_boolean.heating_vacation'),
    vacationReturn: returnDay(s('input_datetime.heating_vacation_return')?.state, dayOf(now)), vacationReturnId: s('input_datetime.heating_vacation_return') ? 'input_datetime.heating_vacation_return' : null, scenarioOverride: on('input_boolean.heating_scenario_override'),
    hyst: (d => d && n(s('input_number.heating_hyst_up')) !== null ? { down: d, up: n(s('input_number.heating_hyst_up'))! } : null)(n(s('input_number.heating_hyst_down'))),
    security: (a => a ? { id: 'alarm_control_panel.alarmo', state: a.state, mode: typeof a.attributes.arm_mode === 'string' ? a.attributes.arm_mode : null, vacation: ((Number(a.attributes.supported_features) || 0) & 32) === 32 } : null)(s('alarm_control_panel.alarmo')),
    rooms,
    boiler: { online: busOn && B('flow_temp') !== null, flame: !busOn ? null : flame === 'on' ? true : flame === 'off' ? false : null, flow: B2('flow_temp'), flowTarget: B2('flow_temp_target'), ret: B2('return_temp'),
      dhw: B2('dhw_temp'), dhwTarget: B2('dhw_temp_target'), pressure, pressureLow: pressure !== null && (pLow ?? pressure < 1), pressureHigh: pressure !== null && (pHigh ?? pressure > 2.5), relay: relay === 'on' ? true : relay === 'off' ? false : null, state: s('sensor.kitchen_boiler_state_code')?.state ?? null },
    outdoor: { temp: weather && typeof S[weather].attributes.temperature === 'number' ? S[weather].attributes.temperature as number : null, state: weather ? S[weather].state : null },
  };
}
export const heatingRooms = (h: Heating) => h.rooms.filter(r => r.action === 'heating').length;
/** What the tile and the hero say first. */
export type HeatTone = 'heat' | 'calm' | 'off' | 'warn';
export function heatTone(h: Heating): HeatTone { if (!h.systemKnown) return 'warn'; if (!h.system) return 'off'; if (heatTrouble(h).length || h.boiler.pressureLow || h.boiler.pressureHigh) return 'warn'; return heatingRooms(h) ? 'heat' : 'calm'; }
/** What is not answering, most important first: the thermostat, a room's head, the boiler's bus, the boiler's relay. The tile says it and is never calm with it. */
export type HeatTrouble = { kind: 'thermostat' } | { kind: 'room'; room: HeatRoom } | { kind: 'boiler' } | { kind: 'relay' };
export function heatTrouble(h: Heating): HeatTrouble[] {
  return [...(h.thermostatOnline ? [] : [{ kind: 'thermostat' } as const]), ...h.rooms.filter(r => r.action === 'offline').map(room => ({ kind: 'room', room } as const)), ...(h.boiler.online ? [] : [{ kind: 'boiler' } as const]), ...(h.boiler.relay === null ? [{ kind: 'relay' } as const] : [])];
}
/** The room the panel opens at when the tile is tapped with a problem: a lost head, then a paused window, then a head on its own sensor. */
export const problemRoom = (h: Heating): HeatRoom | null => h.system ? h.rooms.find(r => r.action === 'offline') ?? h.rooms.find(r => r.action === 'window') ?? h.rooms.find(r => r.windows.some(w => !w.known)) ?? h.rooms.find(r => r.sensor !== 'room') ?? null : null;
/** The number the house is held at and what − and + start from. «Отпуск» holds its own temperature in either mode (the automation puts it above «Ручной»),
 * so the big number is the scenario's and is not stepped from the rooms' manual values; in «Ручной» otherwise the rooms' common value or their range. */
export function houseSet(h: Heating): { value: number | null; shown: number | null; lo?: number; hi?: number } {
  if (h.mode !== 'manual') return { shown: h.target, value: h.scenarioKnown ? h.target : null }; // an unknown scenario must not be taken for «Дома» and overwritten
  if (h.scenarioKnown && h.scenario === 'vacation') return { shown: h.target ?? h.temps.vacation, value: null };
  const vals = h.rooms.map(r => r.manual).filter((x): x is number => x !== null), min = Math.min(...vals), max = Math.max(...vals);
  // a range: − starts from its low end, + from its high end, so neither raises or lowers every room by surprise
  return !vals.length ? { shown: null, value: null } : min === max ? { shown: min, value: min } : { shown: max, value: max, lo: min, hi: max };
}
/** Which scenario card carries «Сейчас»: none while the scenario is unknown or the heating is switched off (nothing is held «now»);
 * in «Ручной» only «Отпуск» applies, the others do not act. */
export const scenarioNow = (h: Heating, id: string): boolean => (h.system || !h.systemKnown) && h.scenarioKnown && id === h.scenario && (h.mode !== 'manual' || id === 'vacation');
/** «Отпуск» is on its way: the house's security counts its exit delay towards «Отпуск» (`arming`, mode `armed_vacation`), and the heating's own
 * switch follows only when the guard stands. The card says «Включается…» meanwhile and a tap on it asks to switch off (which disarms). */
export const vacationArming = (h: Heating): boolean => !h.vacation && !!h.security?.vacation && h.security.state === 'arming' && h.security.mode === 'armed_vacation';
/** The boiler's two marks never contradict: with the bus silent the relay's word is said as the relay's own («Реле: запрос тепла»), and the
 * hero's fact is a warning, not a flame. */
export const boilerMark = (b: Boiler): 'warn' | 'hot' | '' => !b.online || b.relay === null ? 'warn' : b.relay ? 'hot' : '';
/** A room's own − and + that the automation would undo: in «Отпуск» every room is held at the scenario's temperature. */
export const roomLocked = (h: Heating): boolean => h.scenarioKnown && h.scenario === 'vacation';
/** The boiler's pressure in words: the house's thresholds first, «норма» only inside the manual's 1,0–1,5 bar, nothing without a reading. */
export const pressureWord = (b: Boiler): 'low' | 'high' | 'norm' | 'outside' | null => b.pressure === null ? null : b.pressureLow ? 'low' : b.pressureHigh ? 'high' : b.pressure >= 1 && b.pressure <= 1.5 ? 'norm' : 'outside';
/** «На улице»: −0,4° is «0°», never «−0°»; the weather word's key is HA's state as it is («clear-night»). */
export const outdoorText = (o: Heating['outdoor']): { temp: number; key: string | null } | null => o.temp === null ? null : { temp: Math.round(o.temp) || 0, key: o.state ? `clock.weather.${o.state}` : null };
/** The two hysteresis steppers share one degree: each one's ceiling is counted from what the other SHOWS (a tap not sent yet included). */
export const hystMax = (other: number) => Math.max(0, Math.min(1, Math.round((1 - other) * 10) / 10));
/** The ids the heating card draws, so they do not come back as tiles of their own. */
export function heatingClaims(h: Heating): string[] { return [h.thermostat, ...h.rooms.map(r => r.trv)]; }
