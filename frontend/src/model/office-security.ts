import type { Registry } from './registry.ts';
import type { HouseConfig } from './config.ts';
/** Security of an office building (Atom + Okapi, owner 09.11.2026, atom-okapi/SECURITY.md): Alarmo's master over several areas (zones),
 * the whole building armed and disarmed at once, every sensor of the building's rooms shown by state (doors, windows, motion, glass break,
 * presence, smoke, tamper), the Ajax hub's health. Only the service's staff arm and disarm: the people HA labels «Охрана: сотрудник сервиса». */
export type OsecState = 'disarmed' | 'arming' | 'armed' | 'pending' | 'triggered' | 'unknown';
export type OsecKind = 'door' | 'window' | 'motion' | 'presence' | 'smoke';
export interface OsecItem {
  id: string; device: string | null; name: string; kind: OsecKind;
  /** open / motion / presence / smoke now; null: no data */
  on: boolean | null; since: number | null;
  /** the case opened or the sensor moved (Ajax «tilt», a Zigbee tamper) */
  tamper: boolean;
  /** a glass-break sensor in the same device (Ajax Combi Protect): null when it has none */
  glass: boolean | null;
  offline: boolean; problem: boolean; battery: boolean;
  /** battery %, the device's own temperature, the radio signal (Ajax Jeweller: strong / normal / weak), the maker for the picture */
  level: number | null; temp: number | null; signal: 'strong' | 'normal' | 'weak' | null; maker: 'ajax' | 'zigbee' | 'other'; model: string | null;
}
export interface OsecRoom { id: string; name: string; zone: string | null; items: OsecItem[] }
export interface OsecZone { id: string; name: string; state: OsecState; area: string | null }
export interface OsecHub {
  id: string; name: string; online: boolean | null; malfunctions: number;
  lid: boolean | null; mains: boolean | null; cellular: boolean | null; ethernet: boolean | null; monitoring: boolean | null; restore: boolean | null;
  /** «2G», the battery %, the cellular signal, the device's model for the picture */
  network: string | null; level: number | null; signal: 'strong' | 'normal' | 'weak' | null; model: string | null;
}
export interface OsecPerson { id: string; name: string; staff: boolean }
export interface OfficeSecurity {
  alarm: { id: string; state: OsecState; since: number | null; delayEnds: number | null; changedBy: string | null; lastTriggered: string | null; refused: string[] };
  zones: OsecZone[]; rooms: OsecRoom[]; hub: OsecHub | null;
  /** may the signed-in user arm and disarm: HA admins and the service's staff */
  can: boolean; staff: OsecPerson[];
  /** HA's people with their login, to name who armed and disarmed in the feed */
  people: Array<{ user: string | null; name: string }>;
}
/** the label on a person: may arm and disarm the building (HA label registry, «Охрана: сотрудник сервиса») */
export const STAFF_LABEL = 'okhrana_sotrudnik_servisa';
/** the label on an area the dashboard leaves out: the showroom's smart-home exhibit (HA label registry, «Atom Home: не показывать») */
export const SKIP_AREA_LABEL = 'atom_home_ne_pokazyvat';
const MODE: Record<string, OsecState> = { disarmed: 'disarmed', arming: 'arming', pending: 'pending', triggered: 'triggered', armed_away: 'armed', armed_home: 'armed', armed_night: 'armed', armed_vacation: 'armed', armed_custom_bypass: 'armed' };
const ts = (v: string | undefined) => { const n = v ? Date.parse(v) : NaN; return Number.isFinite(n) ? n : null; };
const on = (s: string | undefined) => s === 'on' ? true : s === 'off' ? false : null;
const KIND: Record<string, OsecKind> = { door: 'door', window: 'window', opening: 'door', garage_door: 'door', motion: 'motion', occupancy: 'presence', presence: 'presence', smoke: 'smoke' };
const ORDER: OsecKind[] = ['door', 'window', 'motion', 'presence', 'smoke'];
/** Null where the house has one Alarmo panel (the house card, security.ts): an office has the master and two areas or more. */
export function readOfficeSecurity(reg: Registry, config: HouseConfig, user: { id: string | null; admin: boolean }): OfficeSecurity | null {
  const S = reg.states, ents = reg.entities, devs = reg.devices, areas = reg.areas;
  const entOf = (id: string) => ents.find(x => x.entity_id === id);
  const areaOf = (id: string) => { const e = entOf(id), d = e?.device_id ? devs.find(x => x.id === e.device_id) : null; return e?.area_id ?? d?.area_id ?? null; };
  const alarmo = Object.keys(S).filter(id => id.startsWith('alarm_control_panel.') && entOf(id)?.platform === 'alarmo' && !entOf(id)?.disabled_by);
  const masterId = alarmo.find(id => /master$/.test(id));
  const zoneIds = alarmo.filter(id => id !== masterId);
  if (!masterId || zoneIds.length < 2) return null;
  const a = S[masterId], st = MODE[a.state] ?? 'unknown';
  const name = (id: string) => String(S[id]?.attributes.friendly_name ?? id.split('.')[1]);
  const areaByName = (n: string) => areas.find(x => x.name.trim().toLowerCase() === n.trim().toLowerCase())?.area_id ?? null;
  // Alarmo names its areas «Alarmo Шоурум»: the zone is the room of the same name
  const zoneName = (id: string) => name(id).replace(/^alarmo\s+/i, '');
  const zones: OsecZone[] = zoneIds.map(id => ({ id, name: zoneName(id), state: MODE[S[id].state] ?? 'unknown', area: areaByName(zoneName(id)) }));
  // the building = the floor of the zones' rooms; a room HA labels «Atom Home: не показывать» (the showroom's exhibit) is not the building's
  const zoneAreas = zones.map(z => z.area).filter((x): x is string => !!x);
  const floors = new Set(areas.filter(x => zoneAreas.includes(x.area_id)).map(x => x.floor_id).filter(Boolean));
  const inBuilding = (area: string | null) => { if (!area) return false; const row = areas.find(x => x.area_id === area); if (!row || (row.labels ?? []).includes(SKIP_AREA_LABEL)) return false; return zoneAreas.includes(area) || (!!row.floor_id && floors.has(row.floor_id)); };
  const hubPanel = Object.keys(S).find(id => id.startsWith('alarm_control_panel.') && entOf(id)?.platform !== 'alarmo' && entOf(id)?.device_id && inBuilding(areaOf(id)) && !entOf(id)?.disabled_by);
  const hubDev = hubPanel ? entOf(hubPanel)!.device_id : null;
  const devName = (dev: string | null, fallback: string) => { if (!dev) return fallback; const o = config.devices[`d:${dev}`]?.name, d = devs.find(x => x.id === dev); return o || d?.name || fallback; };
  // one row per device: its door, window, motion, presence or smoke sensor, with the device's tamper, glass break, connection and battery beside it
  const sensors = Object.keys(S).filter(id => id.startsWith('binary_sensor.') && !entOf(id)?.disabled_by && !entOf(id)?.hidden_by && inBuilding(areaOf(id)));
  const byDevice = new Map<string, string[]>();
  for (const id of sensors) { const k = entOf(id)?.device_id ?? id; if (k === hubDev) continue; byDevice.set(k, [...(byDevice.get(k) ?? []), id]); }
  const dc = (id: string) => String(S[id].attributes.device_class ?? entOf(id)?.device_class ?? '');
  // an Ajax DoorProtect on a window still reports «door»: its name or id says window («fereastra», «окно»)
  const isWindow = (id: string, dev: string | null) => dc(id) === 'window' || /fereastr|window|okn/i.test(id) || /окн|fereastr|window/i.test(devName(dev, name(id)));
  const sdc = (id: string) => String(S[id]?.attributes.device_class ?? '');
  const num = (id: string | undefined) => { const v = id ? Number(S[id]?.state) : NaN; return id && S[id] && !['unknown', 'unavailable', ''].includes(S[id].state) && Number.isFinite(v) ? v : null; };
  const sig = (id: string | undefined): OsecItem['signal'] => { const v = id ? String(S[id]?.state ?? '').toLowerCase() : ''; return v === 'strong' ? 'strong' : v === 'normal' || v === 'medium' ? 'normal' : v === 'weak' || v === 'low' ? 'weak' : null; };
  const items: Array<OsecItem & { area: string }> = [];
  for (const ids of byDevice.values()) {
    const main = ids.filter(id => KIND[dc(id)] && entOf(id)?.entity_category !== 'diagnostic').sort((x, y) => ORDER.indexOf(KIND[dc(x)]) - ORDER.indexOf(KIND[dc(y)]))[0];
    if (!main) continue;
    const dev = entOf(main)?.device_id ?? null, any = (f: (id: string) => boolean) => ids.some(id => f(id) && S[id].state === 'on');
    const glassId = ids.find(id => /_glass_break(_\d+)?$/.test(id));
    const d = dev ? devs.find(x => x.id === dev) : null, sens = dev ? Object.keys(S).filter(x => x.startsWith('sensor.') && entOf(x)?.device_id === dev) : [];
    items.push({
      id: main, device: dev, area: areaOf(main)!, kind: isWindow(main, dev) ? 'window' : KIND[dc(main)], name: devName(dev, name(main)),
      on: on(S[main].state), since: ts(S[main].last_changed),
      tamper: any(id => dc(id) === 'tamper'), glass: glassId ? on(S[glassId].state) ?? false : null,
      offline: ids.some(id => dc(id) === 'connectivity' && S[id].state === 'off' && entOf(id)?.entity_category === 'diagnostic'),
      problem: any(id => /_device_problem(_\d+)?$/.test(id) || /_external_contact_broken(_\d+)?$/.test(id)), battery: any(id => dc(id) === 'battery'),
      level: num(sens.find(x => sdc(x) === 'battery')), temp: num(sens.find(x => sdc(x) === 'temperature')), signal: sig(sens.find(x => /_signal_strength(_\d+)?$/.test(x))),
      maker: /ajax/i.test(d?.manufacturer ?? '') ? 'ajax' : entOf(main)?.platform === 'mqtt' || /zigbee/i.test(d?.model ?? '') ? 'zigbee' : 'other', model: d?.model ?? null,
    });
  }
  const roomIds = [...new Set(items.map(i => i.area))].sort((x, y) => { const ix = zoneAreas.indexOf(x), iy = zoneAreas.indexOf(y); return (ix < 0 ? 99 : ix) - (iy < 0 ? 99 : iy) || (areas.find(r => r.area_id === x)?.name ?? '').localeCompare(areas.find(r => r.area_id === y)?.name ?? ''); });
  const rooms: OsecRoom[] = roomIds.map(r => ({ id: r, name: areas.find(x => x.area_id === r)?.name ?? r, zone: zones.find(z => z.area === r)?.id ?? null,
    items: items.filter(i => i.area === r).sort((x, y) => ORDER.indexOf(x.kind) - ORDER.indexOf(y.kind) || x.name.localeCompare(y.name)).map(({ area: _a, ...i }) => i) }));
  let hub: OsecHub | null = null;
  if (hubPanel) {
    const own = Object.keys(S).filter(x => x.startsWith('binary_sensor.') && entOf(x)?.device_id === hubDev);
    const h = S[hubPanel], of = (re: RegExp) => { const id = own.find(x => re.test(x)); return id ? on(S[id].state) : null; };
    const cs = typeof h.attributes.connection_status === 'string' ? h.attributes.connection_status : null;
    hub = { id: hubPanel, name: devName(hubDev, name(hubPanel)), online: h.state === 'unavailable' ? false : cs ? cs.toUpperCase() === 'ONLINE' : null, malfunctions: Number(h.attributes.malfunctions) || 0,
      lid: of(/_lid_opened$/), mains: of(/_mains_power$/), cellular: of(/_cellular_connected$/), ethernet: of(/_ethernet$/), monitoring: of(/_cra_connection$/), restore: of(/_restore_required$/),
      network: (() => { const id = Object.keys(S).find(x => x.startsWith('sensor.') && entOf(x)?.device_id === hubDev && /_mobile_network_type$|_cellular_network$/.test(x)); const v = id ? S[id].state : ''; return v && !['unknown', 'unavailable'].includes(v) ? v.toUpperCase() : null; })(),
      level: num(Object.keys(S).find(x => x.startsWith('sensor.') && entOf(x)?.device_id === hubDev && sdc(x) === 'battery')),
      signal: sig(Object.keys(S).find(x => x.startsWith('sensor.') && entOf(x)?.device_id === hubDev && /_cellular_signal$/.test(x))), model: devs.find(x => x.id === hubDev)?.model ?? null };
  }
  // the people: HA's persons, staff by the label; admins may always
  const persons = Object.keys(S).filter(id => id.startsWith('person.')).map(id => { const e = entOf(id); return { id, name: name(id), staff: (e?.labels ?? []).includes(STAFF_LABEL), user: typeof S[id].attributes.user_id === 'string' ? S[id].attributes.user_id as string : null }; });
  const me = persons.find(p => p.user && p.user === user.id);
  const delay = Number(a.attributes.delay);
  const open = a.attributes.open_sensors && typeof a.attributes.open_sensors === 'object' ? Object.keys(a.attributes.open_sensors as Record<string, unknown>) : [];
  return {
    alarm: { id: masterId, state: st, since: ts(a.last_changed), delayEnds: (st === 'arming' || st === 'pending') && Number.isFinite(delay) && delay > 0 ? (ts(a.last_changed) ?? Date.now()) + delay * 1000 : null,
      changedBy: typeof a.attributes.changed_by === 'string' && a.attributes.changed_by ? a.attributes.changed_by : null, lastTriggered: typeof a.attributes.last_triggered === 'string' ? a.attributes.last_triggered : null,
      refused: st === 'disarmed' ? open.map(id => items.find(i => i.id === id)?.name ?? name(id)) : [] },
    zones, rooms, hub,
    can: user.admin || !!me?.staff, people: persons.map(p => ({ user: p.user, name: p.name })),
    // two people of one name (an admin's and a user's login): the person's id tells them apart
    staff: persons.filter(p => !/^(tablet|tableta)/i.test(p.name)).map((p, _i, all) => ({ id: p.id, name: all.filter(x => x.name === p.name).length > 1 ? `${p.name} · ${p.id.split('.')[1]}` : p.name, staff: p.staff })).sort((x, y) => x.name.localeCompare(y.name)),
  };
}
export type OsecTone = 'calm' | 'armed' | 'warn' | 'alarm' | 'off';
/** the shield's mark: ticked only while guarded, «!» for an alarm or smoke */
export const osecMark = (s: OfficeSecurity): 'alert' | 'open' | 'check' => s.alarm.state === 'triggered' || allItems(s).some(i => i.kind === 'smoke' && i.on) ? 'alert' : ['armed', 'arming', 'pending'].includes(s.alarm.state) ? 'check' : 'open';
export const allItems = (s: OfficeSecurity) => s.rooms.flatMap(r => r.items);
const openings = (s: OfficeSecurity) => allItems(s).filter(i => (i.kind === 'door' || i.kind === 'window') && i.on);
/** Red: an alarm or smoke; amber: glass break, a tamper, a delay running, the hub's lid or no link; blue: armed; grey: disarmed with something open. */
export function osecTone(s: OfficeSecurity): OsecTone {
  const it = allItems(s);
  if (s.alarm.state === 'triggered' || it.some(i => i.kind === 'smoke' && i.on)) return 'alarm';
  if (s.alarm.state === 'pending' || s.alarm.state === 'arming' || s.alarm.state === 'unknown' || it.some(i => i.glass || i.tamper) || s.hub?.lid || s.hub?.online === false) return 'warn';
  if (s.alarm.state === 'armed') return 'armed';
  return openings(s).length ? 'off' : 'calm';
}
export { openings as osecOpenings };

/** One line of the Ajax-like feed: the building armed, disarmed, alarmed, and by whom (HA's logbook of the master panel). */
export interface OsecEvent { when: number; kind: 'armed' | 'disarmed' | 'triggered' | 'pending'; by: string | null; via: 'user' | 'ajax' | 'automation' | null; /** Alarmo's armed mode («armed_away»…) */ mode?: string }
export interface LogRow { when: number; entity_id: string; state?: string; context_user_id?: string | null; context_entity_id?: string | null; context_domain?: string | null; context_name?: string | null }
/** The master's logbook → the feed, newest first: «arming» by a person, then «armed_away» a minute later, is one line «armed by …». */
export function readOsecEvents(rows: LogRow[], master: string, people: Array<{ user: string | null; name: string }>): OsecEvent[] {
  const out: OsecEvent[] = []; let pendingBy: Pick<OsecEvent, 'by' | 'via'> | null = null;
  const who = (r: LogRow): Pick<OsecEvent, 'by' | 'via'> => {
    if (r.context_user_id) return { by: people.find(p => p.user === r.context_user_id)?.name ?? null, via: 'user' };
    if (r.context_entity_id && /ajax_alarmo/.test(r.context_entity_id)) return { by: null, via: 'ajax' };
    if (r.context_domain === 'automation' || r.context_entity_id?.startsWith('automation.')) return { by: r.context_name ?? null, via: 'automation' };
    return { by: null, via: null };
  };
  for (const r of [...rows].filter(r => r.entity_id === master).sort((a, b) => a.when - b.when)) {
    const st = r.state ?? '';
    if (st === 'arming') { pendingBy = who(r); continue; }
    if (st.startsWith('armed_')) { const w = who(r); out.push({ when: r.when * 1000, kind: 'armed', ...(w.via ? w : pendingBy ?? w), mode: st }); pendingBy = null; continue; }
    if (st === 'disarmed') { out.push({ when: r.when * 1000, kind: 'disarmed', ...who(r) }); continue; }
    if (st === 'triggered' || st === 'pending') out.push({ when: r.when * 1000, kind: st, ...who(r) });
  }
  return out.reverse();
}
