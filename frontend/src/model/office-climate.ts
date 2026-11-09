import type { Registry, StateRow } from './registry.ts';
import { unavailable } from './registry.ts';
import type { HeatTone } from './heating.ts';
/** The climate of a working building heated by air conditioners (Atom + Okapi, atom-okapi/HEATING.md, 09.11.2026):
 * one virtual thermostat per zone (`climate.termostat_<zone>`, a Generic Thermostat on the zone's own sensor) switches the zone's AC;
 * the house automation picks the mode from the alarm and the work calendar and gives every thermostat the mode's temperature.
 * Nobody sets a zone by hand: the AC is put back if touched. */
export type OfficeMode = 'work' | 'duty' | 'dayoff';
export type ZoneAction = 'heating' | 'idle' | 'off' | 'offline';
export interface OfficeZone {
  key: string; areaId: string | null; name: string; thermostat: string;
  current: number | null; target: number | null; humidity: number | null; action: ZoneAction; available: boolean;
  ac: { entity: string | null; online: boolean; mode: string | null; setpoint: number | null; reading: number | null; power: number | null };
}
export interface Segment { from: number; to: number; mode: OfficeMode; temp: number | null }
export interface OfficeClimate {
  mode: OfficeMode; modeKnown: boolean; target: number | null;
  temps: Record<OfficeMode, number | null>; helpers: Record<OfficeMode, string>;
  armed: boolean | null; work: { start: number; end: number; heatEnd: number } | null; nextWork: number | null;
  /** today, midnight to midnight, as the automation runs it */ day: Segment[];
  next: { at: number; mode: OfficeMode; temp: number | null } | null;
  zones: OfficeZone[]; outdoor: { temp: number | null; state: string | null };
}
const MODE: Record<string, OfficeMode> = { 'Рабочий': 'work', 'Дежурный': 'duty', 'Нерабочий день': 'dayoff' };
const HELPERS: Record<OfficeMode, string> = { work: 'input_number.klimat_rabochaia_temperatura', duty: 'input_number.klimat_dezhurnaia_temperatura', dayoff: 'input_number.klimat_dezhurnaia_nerabochego_dnia' };
/** heating stops this long before the end of the working day: the last half hour is not worth it */
export const HEAT_STOP_MIN = 30;
/** on a day off the low temperature holds until 23:00, then the night before a working day is kept at the duty one */
export const DAYOFF_UNTIL = 23;
const n = (s?: StateRow) => { if (!s || unavailable(s.state)) return null; const v = Number(s.state); return Number.isFinite(v) ? v : null; };
const at = (v: unknown) => typeof v === 'string' ? Date.parse(v.replace(' ', 'T')) : NaN;
/** null when the building has no such climate (no «Климат · режим» helper or no virtual thermostats). */
export function readOfficeClimate(reg: Registry, now = Date.now()): OfficeClimate | null {
  const S = reg.states, s = (id: string) => S[id];
  const modeRaw = s('input_select.klimat_rezhim')?.state;
  if (modeRaw === undefined) return null;
  const thermostats = Object.keys(S).filter(id => /^climate\.termostat_[a-z0-9_]+$/.test(id)).sort();
  if (!thermostats.length) return null;
  const areaOf = (id: string) => { const e = reg.entities.find(x => x.entity_id === id); return e?.area_id ?? reg.devices.find(d => d.id === e?.device_id)?.area_id ?? null; };
  const areaName = (a: string | null) => reg.areas.find(x => x.area_id === a)?.name ?? null;
  const inArea = (a: string | null, test: (id: string, st: StateRow) => boolean) => a ? Object.keys(S).filter(id => areaOf(id) === a && test(id, S[id])) : [];
  const zones: OfficeZone[] = thermostats.map(th => {
    const st = s(th), area = areaOf(th), avail = !!st && !unavailable(st.state);
    // the zone's AC: the other climate entity in the same area (the thermostat drives it)
    const acId = inArea(area, (id) => id.startsWith('climate.') && id !== th && !id.startsWith('climate.termostat_'))[0] ?? null;
    const ac = acId ? s(acId) : undefined, acBase = acId ? acId.slice(8).replace(/_thermostat$/, '') : '';
    const hum = inArea(area, (id, x) => id.startsWith('sensor.') && x.attributes.device_class === 'humidity' && !id.startsWith(`sensor.${acBase}_`) && !unavailable(x.state))[0];
    const action: ZoneAction = !avail ? 'offline' : st!.state === 'off' ? 'off' : st!.attributes.hvac_action === 'heating' ? 'heating' : 'idle';
    return { key: th.slice(18), areaId: area, name: areaName(area) ?? (st?.attributes.friendly_name as string ?? th), thermostat: th, available: avail, action,
      current: typeof st?.attributes.current_temperature === 'number' ? st.attributes.current_temperature : null,
      target: typeof st?.attributes.temperature === 'number' ? st.attributes.temperature : null,
      humidity: hum ? n(S[hum]) : null,
      ac: { entity: acId, online: !!ac && !unavailable(ac.state), mode: ac && !unavailable(ac.state) ? ac.state : null,
        setpoint: typeof ac?.attributes.temperature === 'number' ? ac.attributes.temperature : null,
        reading: n(s(`sensor.${acBase}_indoor_temperature`)) ?? (typeof ac?.attributes.current_temperature === 'number' ? ac.attributes.current_temperature : null),
        power: n(s(`sensor.${acBase}_real_time_power`)) },
    };
  });
  const temps = { work: n(s(HELPERS.work)), duty: n(s(HELPERS.duty)), dayoff: n(s(HELPERS.dayoff)) };
  const mode = MODE[modeRaw] ?? 'duty';
  const alarm = s('alarm_control_panel.master')?.state;
  // the work calendar: while an event runs its times are today's working day; otherwise they are the next one
  const cal = s('calendar.kalendar_rabochego_vremeni'), cs = at(cal?.attributes.start_time), ce = at(cal?.attributes.end_time);
  const day0 = new Date(now); day0.setHours(0, 0, 0, 0); const d0 = day0.getTime(), d1 = d0 + 86400000;
  let today = Number.isFinite(cs) && cs >= d0 && cs < d1 ? { start: cs, end: ce, heatEnd: ce - HEAT_STOP_MIN * 60000 } : null;
  // after work the calendar already shows tomorrow: today's working day is the one that ended today (the entity turned off today),
  // and it started at the same time of day as the next one does
  const off = cal && cal.state === 'off' ? Date.parse(cal.last_changed) : NaN;
  if (!today && Number.isFinite(off) && off >= d0 && off < d1 && Number.isFinite(cs)) {
    const n0 = new Date(cs), start = new Date(d0).setHours(n0.getHours(), n0.getMinutes(), 0, 0);
    if (start < off) today = { start, end: off, heatEnd: off - HEAT_STOP_MIN * 60000 };
  }
  const nextWork = Number.isFinite(cs) && cs > now ? cs : null;
  const T = (m: OfficeMode) => temps[m];
  const day: Segment[] = today
    ? [{ from: d0, to: today.start, mode: 'duty', temp: T('duty') }, { from: today.start, to: today.heatEnd, mode: 'work', temp: T('work') }, { from: today.heatEnd, to: d1, mode: 'duty', temp: T('duty') }]
    : [{ from: d0, to: d0 + DAYOFF_UNTIL * 3600000, mode: 'dayoff', temp: T('dayoff') }, { from: d0 + DAYOFF_UNTIL * 3600000, to: d1, mode: 'duty', temp: T('duty') }];
  // what comes next: a working mode waits for the alarm, so its start is the calendar's
  const after = day.find(x => x.from > now && x.mode !== mode);
  const next = mode === 'work' && today ? { at: today.heatEnd, mode: 'duty' as const, temp: T('duty') }
    : after ? { at: after.from, mode: after.mode, temp: after.temp }
    : nextWork ? { at: nextWork, mode: 'work' as const, temp: T('work') } : null;
  const weather = Object.keys(S).find(id => id.startsWith('weather.') && !unavailable(S[id].state));
  return {
    mode, modeKnown: modeRaw in MODE, target: T(mode), temps, helpers: HELPERS,
    armed: alarm === undefined || unavailable(alarm) ? null : alarm !== 'disarmed',
    work: today, nextWork, day, next, zones,
    outdoor: { temp: weather && typeof S[weather].attributes.temperature === 'number' ? S[weather].attributes.temperature as number : null, state: weather ? S[weather].state : null },
  };
}
export const officeHeating = (c: OfficeClimate) => c.zones.filter(z => z.action === 'heating').length;
export function officeTone(c: OfficeClimate): HeatTone {
  if (!c.modeKnown || c.zones.some(z => z.action === 'offline' || !z.ac.online)) return 'warn';
  if (c.zones.every(z => z.action === 'off')) return 'off';
  return officeHeating(c) ? 'heat' : 'calm';
}
/** The ids the card draws, so they do not come back as tiles of their own. */
export function officeClaims(c: OfficeClimate): string[] { return c.zones.flatMap(z => [z.thermostat, ...(z.ac.entity ? [z.ac.entity] : [])]); }
