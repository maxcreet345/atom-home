import type { Registry, StateRow } from './registry.ts';
import { unavailable } from './registry.ts';
/** The house's heating as the owner built it (book/04-automations/HEATING.md, 04.11.2026):
 * the Tuya thermostat in the living room only switches the system and sets the common temperature;
 * five SONOFF heads follow that temperature by the room sensors; the MINI-D relay asks the boiler for heat while any head heats;
 * a room's own change holds three hours in «Авто»; an open window stops its room's head after a minute. */
export type HeatAction = 'heating' | 'idle' | 'off' | 'window' | 'offline';
export interface HeatWindow { id: string; name: string; open: boolean; since: number | null }
export interface HeatRoom {
  key: string; areaId: string | null; name: string; trv: string;
  current: number | null; target: number | null; action: HeatAction; available: boolean; battery: number | null;
  windows: HeatWindow[]; windowPaused: boolean;
  /** «Авто»: the room's own temperature and when it returns to the common one */ override: { temp: number; until: number } | null;
  manual: number | null; desired: string | null; sensor: string | null;
}
export interface Boiler {
  online: boolean; flame: boolean | null; flow: number | null; flowTarget: number | null; ret: number | null;
  dhw: number | null; dhwTarget: number | null; pressure: number | null; relay: boolean | null; state: string | null;
}
export type Scenario = 'home' | 'sleep' | 'away' | 'eco' | 'vacation';
export interface Heating {
  system: boolean; thermostat: string; thermostatOnline: boolean; mode: 'auto' | 'manual';
  scenario: Scenario; scenarioRaw: string; target: number | null; temps: Record<Scenario, number | null>;
  sleep: { from: string; to: string }; guests: boolean; eco: boolean; vacation: boolean; vacationReturn: string | null; scenarioOverride: boolean;
  rooms: HeatRoom[]; boiler: Boiler; outdoor: { temp: number | null; state: string | null };
}
const SCENARIO: Record<string, Scenario> = { 'Дома': 'home', 'Сон': 'sleep', 'Нет дома': 'away', 'Эко': 'eco', 'Отпуск': 'vacation' };
const n = (s?: StateRow) => { if (!s || unavailable(s.state)) return null; const v = Number(s.state); return Number.isFinite(v) ? v : null; };
const ROOM_ORDER = ['living', 'kitchen', 'bedroom', 'kids', 'office'];
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
      return { id, name: nom.charAt(0).toUpperCase() + nom.slice(1), open: w.state === 'on', since: w.state === 'on' ? Date.parse(w.last_changed) : null };
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
      manual: n(s(`input_number.${key}_heating_manual_temp`)), desired: s(`sensor.${key}_heating_desired`)?.state ?? null, sensor: null };
  });
  const th = s('climate.living_thermostat'), scenarioRaw = s('sensor.heating_scenario')?.state ?? 'Дома';
  const v = (k: string) => n(s(`input_number.heating_${k}_temp`));
  const B = (k: string) => n(s(`sensor.kitchen_boiler_${k}`));
  const flame = s('sensor.kitchen_boiler_flame')?.state, relay = s('switch.kitchen_boiler_heat_relay')?.state;
  const busOn = s('binary_sensor.kitchen_boiler_ebus_signal')?.state === 'on';
  const weather = ['weather.forecast_home', ...Object.keys(S).filter(id => id.startsWith('weather.'))].find(id => S[id] && !unavailable(S[id].state));
  return {
    system: on('input_boolean.heating_system'), thermostat: 'climate.living_thermostat', thermostatOnline: !!th && !unavailable(th.state),
    mode: s('input_select.heating_mode')?.state === 'Ручной' ? 'manual' : 'auto',
    scenario: SCENARIO[scenarioRaw] ?? 'home', scenarioRaw, target: n(s('sensor.heating_target_temp')),
    temps: { home: v('home'), sleep: v('sleep'), away: v('away'), eco: v('eco'), vacation: v('vacation') },
    sleep: { from: (s('input_datetime.heating_sleep_start')?.state ?? '23:00').slice(0, 5), to: (s('input_datetime.heating_sleep_end')?.state ?? '06:00').slice(0, 5) },
    guests: on('input_boolean.heating_guests'), eco: on('input_boolean.heating_eco'), vacation: on('input_boolean.heating_vacation'),
    vacationReturn: s('input_datetime.heating_vacation_return')?.state ?? null, scenarioOverride: on('input_boolean.heating_scenario_override'),
    rooms,
    boiler: { online: busOn && B('flow_temp') !== null, flame: flame === 'on' ? true : flame === 'off' ? false : null, flow: B('flow_temp'), flowTarget: B('flow_temp_target'), ret: B('return_temp'),
      dhw: B('dhw_temp'), dhwTarget: B('dhw_temp_target'), pressure: B('pressure'), relay: relay === 'on' ? true : relay === 'off' ? false : null, state: s('sensor.kitchen_boiler_state_code')?.state ?? null },
    outdoor: { temp: weather && typeof S[weather].attributes.temperature === 'number' ? S[weather].attributes.temperature as number : null, state: weather ? S[weather].state : null },
  };
}
export const heatingRooms = (h: Heating) => h.rooms.filter(r => r.action === 'heating').length;
/** What the tile and the hero say first. */
export type HeatTone = 'heat' | 'calm' | 'off' | 'warn';
export function heatTone(h: Heating): HeatTone { if (!h.system) return 'off'; if (h.rooms.some(r => r.action === 'offline') || (h.boiler.pressure !== null && (h.boiler.pressure < 1 || h.boiler.pressure > 2.5))) return 'warn'; return heatingRooms(h) ? 'heat' : 'calm'; }
/** The ids the heating card draws, so they do not come back as tiles of their own. */
export function heatingClaims(h: Heating): string[] { return [h.thermostat, ...h.rooms.map(r => r.trv)]; }
