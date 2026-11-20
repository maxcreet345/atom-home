/* «Отопление · Центральный термостат и комнаты» from the catalog (model/card-catalog.ts): the heating screen of Criuleni (model/heating.ts) read
 * through the installer's bindings instead of the house's own entity names. What is not bound is a function the card does not have: no mode
 * switch without a mode list, no «Вернуть к общей» without the room's timer, no scenarios, no boiler (a card of its own, later). Pure. */
import type { Registry, StateRow } from './registry.ts';
import { unavailable } from './registry.ts';
import type { Heating, HeatRoom, HeatAction } from './heating.ts';
import type { ProfileInstance } from './card-catalog.ts';

export interface HeatLayoutRoom { key: string; areaId: string; trv: string; air?: string; timer?: string; overrideTemp?: string; manualTemp?: string }
export interface HeatLayout { central: string; mode?: string; homeTemp?: string; target?: string; system?: string; rooms: HeatLayoutRoom[] }
const slug = (s: string) => s.replace(/[^a-z0-9_]/gi, '_').toLowerCase();
/** The layout of a «heating.rooms» instance; null for any other card. */
export function heatLayoutOf(inst: ProfileInstance): HeatLayout | undefined {
  if (inst.profileId !== 'heating.rooms' || !inst.bindings.central) return undefined;
  const b = inst.bindings;
  return { central: b.central, mode: b.mode, homeTemp: b.homeTemp, target: b.target, system: b.system,
    rooms: (inst.rooms ?? []).filter(r => r.bindings.trv).map(r => ({ key: slug(r.id), areaId: r.areaId, trv: r.bindings.trv, air: r.bindings.air, timer: r.bindings.timer, overrideTemp: r.bindings.overrideTemp, manualTemp: r.bindings.manualTemp })) };
}
const n = (s?: StateRow) => { if (!s || unavailable(s.state)) return null; const v = Number(s.state); return Number.isFinite(v) ? v : null; };
/** The mode list's two words: Criuleni's «Авто» / «Ручной», else an option that reads as manual, else the first two. */
export function modeWords(options: unknown): { auto: string; manual: string } | null {
  const list = Array.isArray(options) ? options.filter((x): x is string => typeof x === 'string') : [];
  if (list.length < 2) return null;
  // only a list that says «manual» is a mode list: off / heat / auto must never have «heat» taken for «Ручной»
  const manual = list.find(o => /ручн|manual|manual/i.test(o)); if (!manual) return null;
  const auto = list.find(o => o !== manual && /авто|auto/i.test(o)) ?? list.find(o => o !== manual)!;
  return { auto, manual };
}
export function readHeatingLayout(reg: Registry, now: number, L: HeatLayout): Heating | null {
  const S = reg.states, s = (id?: string) => id ? S[id] : undefined;
  const th = s(L.central); if (!th || !L.rooms.length) return null;
  const areaName = (a: string | null) => reg.areas.find(x => x.area_id === a)?.name ?? null;
  const words = L.mode ? modeWords(s(L.mode)?.attributes.options) : null;
  const mode: 'auto' | 'manual' = words && s(L.mode)?.state === words.manual ? 'manual' : 'auto';
  const rooms: HeatRoom[] = L.rooms.map(r => {
    const st = s(r.trv), avail = !!st && !unavailable(st.state), timer = s(r.timer);
    const until = timer?.state === 'active' && typeof timer.attributes.finishes_at === 'string' ? Date.parse(timer.attributes.finishes_at) : null;
    const hvac = st?.attributes.hvac_action, action: HeatAction = !avail ? 'offline' : st!.state === 'off' ? 'off' : hvac === 'heating' ? 'heating' : 'idle';
    const air = s(r.air), airValue = n(air), head = typeof st?.attributes.current_temperature === 'number' ? st.attributes.current_temperature : null;
    // the room's own air sensor when one is bound and answers; a bound one that is silent is said so («последнее известное»), never replaced by a look-alike
    const sensor: HeatRoom['sensor'] = !r.air ? 'head' : airValue === null ? 'lost' : 'room';
    return { key: r.key, areaId: r.areaId, name: areaName(r.areaId) ?? (st?.attributes.friendly_name as string ?? r.key).split(' · ')[0], trv: r.trv, available: avail,
      current: sensor === 'room' ? airValue : head, target: typeof st?.attributes.temperature === 'number' && st.state !== 'off' ? st.attributes.temperature : null,
      action, battery: null, windows: [], windowPaused: false,
      override: until && until > now ? { temp: n(s(r.overrideTemp)) ?? (typeof st?.attributes.temperature === 'number' ? st.attributes.temperature : 0), until } : null,
      manual: n(s(r.manualTemp)), desired: null, sensor, ids: { timer: r.timer ?? null, manual: r.manualTemp ?? null } };
  });
  // a bound on/off that is gone is unknown, never read from the thermostat in its place (the card says what is lost)
  const sys = s(L.system), systemKnown = L.system ? !!sys && ['on', 'off'].includes(sys.state) : !unavailable(th.state), system = L.system ? sys?.state === 'on' : th.state !== 'off';
  const target = L.target ? n(s(L.target)) : L.homeTemp ? n(s(L.homeTemp)) : typeof th.attributes.temperature === 'number' ? th.attributes.temperature : null;
  const weather = Object.keys(S).find(id => id.startsWith('weather.') && !unavailable(S[id].state));
  const none = { home: target, sleep: null, away: null, eco: null, vacation: null };
  return {
    system, systemKnown, scenarioKnown: true, thermostat: L.central, thermostatOnline: !unavailable(th.state), mode, scenario: 'home', scenarioRaw: 'Дома', target, temps: none,
    sleep: { from: '23:00', to: '06:00' }, guests: false, eco: false, vacation: false, vacationReturn: null, vacationReturnId: null, scenarioOverride: false, hyst: null, security: null, rooms,
    boiler: { online: true, flame: null, flow: null, flowTarget: null, ret: null, dhw: null, dhwTarget: null, name: null, pressure: null, pressureLow: false, pressureHigh: false, relay: false, state: null },
    outdoor: { temp: weather && typeof S[weather].attributes.temperature === 'number' ? S[weather].attributes.temperature as number : null, state: weather ? S[weather].state : null },
    parts: { boiler: false, scenarios: false, mode: !!words },
    ids: { mode: L.mode ?? null, modeAuto: words?.auto ?? null, modeManual: words?.manual ?? null, homeTemp: L.homeTemp ?? null, system: L.system ?? null, legacy: false },
  };
}
