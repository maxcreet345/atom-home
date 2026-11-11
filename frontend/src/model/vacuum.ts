import type { DeviceRow, EntityRow, Registry, StateRow } from './registry.ts';
import { unavailable } from './registry.ts';
/** The robot vacuum as HA's Roborock integration shows it (Saros Z70 in Criuleni, 09.11.2026; docs/VACUUM.md).
 * Every part is found on the robot's and the dock's devices by the integration's own key (translation_key), so renaming an entity changes nothing.
 * The rooms are HA's own link of the robot's map rooms to areas (entity settings → «Комнаты», service vacuum.clean_area). */
export type VacPhase = 'cleaning' | 'paused' | 'returning' | 'docked' | 'idle' | 'error' | 'offline';
export interface VacRoom { areaId: string; name: string; segments: string[]; robotName: string | null }
export interface Consumable { key: 'filter' | 'main' | 'side' | 'sensor' | 'strainer'; left: number | null; total: number | null; reset: string | null }
export interface VacSelect { id: string; value: string | null; options: string[] }
export interface VacSwitch { id: string; on: boolean | null }
export interface Vacuum {
  entity: string; name: string; model: string | null; available: boolean; phase: VacPhase;
  /** the integration's own word for what it does now (charging, washing_the_mop, segment_cleaning, …) */ status: string | null;
  battery: number | null; charging: boolean; progress: number | null; cleanMinutes: number | null; cleanArea: number | null;
  currentRoom: string | null; error: string | null; dockError: string | null;
  fan: string | null; fans: string[]; cleaningMode: VacSelect | null; mopMode: VacSelect | null; mopIntensity: VacSelect | null; emptyMode: VacSelect | null; map: VacSelect | null;
  mapImage: { entity: string; url: string | null; changed: string } | null;
  /** rooms in the robot's order; empty until they are linked to areas in HA */ rooms: VacRoom[]; unlinked: string[];
  last: { begin: number | null; end: number | null }; total: { hours: number | null; area: number | null; count: number | null };
  consumables: Consumable[];
  dock: { present: boolean; cleanEmpty: boolean | null; dirtyFull: boolean | null; fluidEmpty: boolean | null; dryingLeft: number | null; dustEmptying: VacSwitch | null; mopWashing: VacSwitch | null; mopDrying: VacSwitch | null; childLock: VacSwitch | null };
  robot: { waterShortage: boolean | null; mopAttached: boolean | null; waterBox: boolean | null };
  dnd: { sw: VacSwitch | null; from: { id: string; v: string } | null; to: { id: string; v: string } | null };
  offPeak: { sw: VacSwitch | null; from: { id: string; v: string } | null; to: { id: string; v: string } | null };
  volume: { id: string; value: number | null } | null;
  /** the Roborock app's own scenes, which the integration gives as buttons («Полная уборка») */ routines: Array<{ id: string; name: string }>;
}
/** Nominal life in hours (Roborock's own: the app shows used + % left on these totals). The dock's strainer has no published total. */
const LIFE: Record<Consumable['key'], number | null> = { filter: 150, main: 300, side: 200, sensor: 30, strainer: null };
const DOCK_KEYS = new Set(['dirty_box_full', 'clean_box_empty', 'dust_collection_mode', 'strainer_time_left', 'dock_error']);
const num = (s?: StateRow) => { if (!s || unavailable(s.state)) return null; const v = Number(s.state); return Number.isFinite(v) ? v : null; };
const bool = (s?: StateRow) => !s || unavailable(s.state) ? null : s.state === 'on';
/** A model as people write it («Saros Z70»), or null for an integration's technical id («roborock.vacuum.s5e»): that is never shown as text. */
export const readableModel = (m: string | null | undefined): string | null => { const v = (m ?? '').trim(); return !v || /^[a-z0-9_-]+(\.[a-z0-9_-]+)+$/.test(v) ? null : v; };
/** The map picture's address with the time HA drew it: HA redraws the map under the same address (only its token changes, every few minutes), so the image's
 * state goes into the address and a new drawing is a new picture, as HA's own cards do. */
export const mapAddress = (url: string | null, drawn: string): string | null => url ? `${url}${url.includes('?') ? '&' : '?'}state=${encodeURIComponent(drawn)}` : null;
/** Trips to the dock in the middle of a job (the Saros washes its mop several times a run): HA calls the robot «docked» / «returning» meanwhile. */
export const DOCK_TRIPS = ['washing_the_mop', 'going_to_wash_the_mop', 'emptying_the_bin', 'back_to_dock_washing_duster'];
/** The phase by the integration's own status word, for when the vacuum entity itself says «unknown» (HA starting, or a status code HA has no state for). */
function phaseOfStatus(x: string | null): VacPhase {
  if (!x) return 'idle';
  if (x === 'error') return 'error';
  if (x === 'paused') return 'paused';
  if (x === 'returning_home' || x === 'docking' || x === 'going_to_wash_the_mop' || x === 'back_to_dock_washing_duster') return 'returning';
  if (x === 'charging' || x === 'charging_complete' || x === 'washing_the_mop' || x === 'emptying_the_bin' || x === 'air_drying_stopping') return 'docked';
  return /clean|mopping|going_to_target|patrol|mapping/.test(x) ? 'cleaning' : 'idle';
}
/** What belongs to the robot — its device, the dock's devices, their entities by the integration's key. It depends on the registry's lists only,
 * never on a state, so it is found once per `registry.entities` / `registry.devices` (they keep their identity while only states change) and a
 * new state re-reads values only (audit round 2: the nested «every device × every entity» pass ran on every state change). */
interface VacParts { dev: DeviceRow | null; dock: boolean; mine: EntityRow[]; keys: Map<string, EntityRow[]> }
interface VacStructure { entities: EntityRow[]; devices: DeviceRow[]; robots: EntityRow[]; parts: Map<string, VacParts> }
/** How many times the structural pass ran (tests/round2-heatvac.test.ts counts it). */
export const vacuumProbe = { structure: 0 };
let structure: VacStructure | null = null;
const structureOf = (reg: Registry): VacStructure => { if (!structure || structure.entities !== reg.entities || structure.devices !== reg.devices) structure = { entities: reg.entities, devices: reg.devices, robots: reg.entities.filter(e => e.entity_id.startsWith('vacuum.') && !e.disabled_by), parts: new Map() }; return structure; };
function partsOf(reg: Registry, ent: EntityRow): VacParts {
  const all = structureOf(reg), known = all.parts.get(ent.entity_id); if (known) return known;
  vacuumProbe.structure++;
  const dev = reg.devices.find(d => d.id === ent.device_id) ?? null;
  // the dock is a second device of the same integration (via the robot, or the one carrying the dock's own parts): one pass over the entities
  const dockOwners = new Set<string>(); for (const e of reg.entities) if (e.device_id && e.platform === ent.platform && DOCK_KEYS.has(e.translation_key ?? '')) dockOwners.add(e.device_id);
  const dockDevs = reg.devices.filter(d => d.id !== dev?.id && (d.via_device_id === dev?.id || dockOwners.has(d.id)));
  const devs = new Set([ent.device_id, ...dockDevs.map(d => d.id)]);
  const mine = reg.entities.filter(e => !e.disabled_by && e.device_id && devs.has(e.device_id)), keys = new Map<string, EntityRow[]>();
  for (const e of mine) if (e.translation_key) { const l = keys.get(e.translation_key); if (l) l.push(e); else keys.set(e.translation_key, [e]); }
  const parts = { dev, dock: dockDevs.length > 0, mine, keys }; all.parts.set(ent.entity_id, parts); return parts;
}
/** The map picture the panel shows: the last cropped one stays until the new drawing is cropped (HA redraws the map every few minutes, and going
 * back to the uncropped picture in between made the map jump); the plain address only until the first crop is ready. */
export const mapShown = (url: string | null, crop: { src: string } | null): string | null => !url ? null : crop ? crop.src : url;
/** The first robot vacuum of the house, or null when it has none. */
export function readVacuum(reg: Registry): Vacuum | null {
  const S = reg.states;
  const robots = structureOf(reg).robots.filter(e => S[e.entity_id]), ent = robots.find(e => e.platform === 'roborock') ?? robots[0];
  if (!ent) return null;
  const st = S[ent.entity_id], { dev, dock, mine, keys } = partsOf(reg, ent);
  const byKey = (k: string, domain?: string): EntityRow | undefined => keys.get(k)?.find(e => !domain || e.entity_id.startsWith(domain + '.'));
  const s = (k: string, domain?: string) => { const e = byKey(k, domain); return e ? S[e.entity_id] : undefined; };
  const sel = (k: string): VacSelect | null => { const e = byKey(k, 'select'), x = e && S[e.entity_id]; return e && x ? { id: e.entity_id, value: unavailable(x.state) ? null : x.state, options: Array.isArray(x.attributes.options) ? x.attributes.options as string[] : [] } : null; };
  const sw = (k: string): VacSwitch | null => { const e = byKey(k, 'switch'); return e ? { id: e.entity_id, on: bool(S[e.entity_id]) } : null; };
  const tm = (k: string) => { const e = byKey(k, 'time'), x = e && S[e.entity_id]; return e && x && !unavailable(x.state) ? { id: e.entity_id, v: x.state.slice(0, 5) } : null; };
  const available = st.state !== 'unavailable'; // «unknown» is not a lost robot: its sensors still speak, «Стоп» and «На базу» must work
  const statusRaw = s('status', 'sensor')?.state ?? null, status = statusRaw && !unavailable(statusRaw) ? statusRaw : null, err = s('vacuum_error', 'sensor')?.state ?? null, dockErr = s('dock_error', 'sensor')?.state ?? null;
  const hasErr = !!err && !['none', 'unknown', 'unavailable'].includes(err);
  // the phase is the vacuum's own state; a leftover error code on a docked robot is an alert, not a lock
  const own: VacPhase = !available ? 'offline' : st.state === 'unknown' ? phaseOfStatus(status) : st.state === 'error' ? 'error' : st.state === 'cleaning' ? 'cleaning' : st.state === 'paused' ? 'paused' : st.state === 'returning' ? 'returning' : st.state === 'docked' ? 'docked' : 'idle';
  // a trip to the dock in the middle of a job is still the job: the progress, «Пауза» and the locked rooms stay (the robot says it is cleaning; or it washes the mop with the run unfinished)
  const inJob = bool(s('in_cleaning', 'binary_sensor')) === true, pct = num(s('clean_percent', 'sensor')), trip = !!status && DOCK_TRIPS.includes(status);
  const phase: VacPhase = own === 'docked' && (inJob || (trip && pct !== null && pct < 100)) ? 'cleaning' : own === 'returning' && trip && (inJob || (pct !== null && pct < 100)) ? 'cleaning' : own;
  // rooms: HA's link of map rooms to areas, in the robot's own order of its rooms
  const link = ent.vacuum ?? null, segOrder = link?.segments.map(x => x.id) ?? [];
  const rooms: VacRoom[] = link ? Object.entries(link.areas).map(([areaId, segments]) => ({ areaId, name: reg.areas.find(a => a.area_id === areaId)?.name ?? areaId, segments, robotName: link.segments.find(x => segments.includes(x.id))?.name ?? null }))
    .filter(r => reg.areas.some(a => a.area_id === r.areaId)).sort((a, b) => segOrder.indexOf(a.segments[0]) - segOrder.indexOf(b.segments[0])) : [];
  const linked = new Set(rooms.flatMap(r => r.segments)), unlinked = link ? link.segments.filter(x => !linked.has(x.id)).map(x => x.name) : [];
  // the room it is in now: the sensor speaks the robot's own room name, which the link turns into the area
  const curRaw = s('current_room', 'sensor')?.state, cur = curRaw && !unavailable(curRaw) ? rooms.find(r => r.robotName === curRaw)?.name ?? null : null; // the robot's own word is a raw string («кухню»): a room is named only through HA's link
  const images = mine.filter(e => e.entity_id.startsWith('image.') && S[e.entity_id] && !unavailable(S[e.entity_id].state));
  const mapSel = sel('selected_map'), img = images.find(e => mapSel?.value && (S[e.entity_id].attributes.friendly_name as string ?? '').endsWith(mapSel.value)) ?? images[0];
  const consumable = (key: Consumable['key'], sensor: string, button: string): Consumable | null => { const e = byKey(sensor, 'sensor'); return e ? { key, left: num(S[e.entity_id]), total: LIFE[key], reset: byKey(button, 'button')?.entity_id ?? null } : null; };
  const ts = (k: string) => { const x = s(k, 'sensor'); const v = x && !unavailable(x.state) ? Date.parse(x.state) : NaN; return Number.isFinite(v) ? v : null; };
  const name = (dev?.name ?? st.attributes.friendly_name as string ?? ent.entity_id).replace(/^[^·]*·\s*/, '').replace(/\s*\(.*\)$/, '');
  return {
    entity: ent.entity_id, name, model: readableModel((dev?.name ?? '').match(/\(([^)]+)\)\s*$/)?.[1] ?? dev?.model), available, phase, status,
    battery: num(s('battery', 'sensor')) ?? num(mine.map(e => e.entity_id.startsWith('sensor.') ? S[e.entity_id] : undefined).find(x => x?.attributes.device_class === 'battery')) ?? (typeof st.attributes.battery_level === 'number' ? st.attributes.battery_level : null),
    charging: bool(mine.map(e => S[e.entity_id]).find(x => x && x.attributes.device_class === 'battery_charging')) === true || status === 'charging',
    progress: pct, cleanMinutes: num(s('cleaning_time', 'sensor')), cleanArea: num(s('cleaning_area', 'sensor')),
    currentRoom: cur, error: hasErr ? err : null, dockError: dockErr && !['ok', 'unknown', 'unavailable'].includes(dockErr) ? dockErr : null,
    fan: typeof st.attributes.fan_speed === 'string' ? st.attributes.fan_speed : null, fans: Array.isArray(st.attributes.fan_speed_list) ? st.attributes.fan_speed_list as string[] : [],
    cleaningMode: sel('cleaning_mode'), mopMode: sel('mop_mode'), mopIntensity: sel('mop_intensity'), emptyMode: sel('dust_collection_mode'), map: mapSel,
    mapImage: img ? { entity: img.entity_id, url: typeof S[img.entity_id].attributes.entity_picture === 'string' ? S[img.entity_id].attributes.entity_picture as string : null, changed: S[img.entity_id].state } : null,
    rooms, unlinked,
    last: { begin: ts('last_clean_start'), end: ts('last_clean_end') },
    total: { hours: num(s('total_cleaning_time', 'sensor')), area: num(s('total_cleaning_area', 'sensor')), count: num(s('total_cleaning_count', 'sensor')) },
    consumables: [consumable('filter', 'filter_time_left', 'reset_air_filter_consumable'), consumable('main', 'main_brush_time_left', 'reset_main_brush_consumable'), consumable('side', 'side_brush_time_left', 'reset_side_brush_consumable'), consumable('sensor', 'sensor_time_left', 'reset_sensor_consumable'), consumable('strainer', 'strainer_time_left', 'reset_dock_strainer_consumable')].filter((c): c is Consumable => !!c),
    dock: { present: dock, cleanEmpty: bool(s('clean_box_empty')), dirtyFull: bool(s('dirty_box_full')), fluidEmpty: bool(s('clean_fluid_empty')), dryingLeft: num(s('mop_drying_remaining_time', 'sensor')),
      dustEmptying: sw('dust_emptying'), mopWashing: sw('mop_washing'), mopDrying: sw('mop_drying'), childLock: sw('child_lock') },
    robot: { waterShortage: bool(s('water_shortage')), mopAttached: bool(s('mop_attached')), waterBox: bool(s('water_box_attached')) },
    dnd: { sw: sw('dnd_switch'), from: tm('dnd_start_time'), to: tm('dnd_end_time') },
    offPeak: { sw: sw('off_peak_switch'), from: tm('off_peak_start'), to: tm('off_peak_end') },
    volume: (e => e ? { id: e.entity_id, value: num(S[e.entity_id]) } : null)(byKey('volume', 'number')),
    routines: mine.filter(e => e.entity_id.startsWith('button.') && !e.translation_key && !e.entity_category && S[e.entity_id]).map(e => ({ id: e.entity_id, name: (S[e.entity_id].attributes.friendly_name as string ?? e.entity_id).replace(/^.*\)\s*/, '') })),
  };
}
/** What needs the owner now, worst first: an error, a dock tank, then a part due (≤ 10 % or ≤ 5 h). */
export function vacuumAlerts(v: Vacuum): Array<{ key: string; tone: 'warn' | 'info'; consumable?: Consumable['key'] }> {
  const out: Array<{ key: string; tone: 'warn' | 'info'; consumable?: Consumable['key'] }> = [];
  if (v.error && v.phase !== 'error') out.push({ key: 'error', tone: 'warn' }); // in «error» the sentence already names it
  if (v.dockError) out.push({ key: 'dockError', tone: 'warn' });
  if (v.dock.dirtyFull && v.dockError !== 'waste_water_tank_full') out.push({ key: 'dirtyFull', tone: 'warn' });
  if (v.dock.cleanEmpty && v.dockError !== 'water_empty') out.push({ key: 'cleanEmpty', tone: 'warn' });
  if (v.robot.waterShortage) out.push({ key: 'waterShortage', tone: 'warn' });
  if (v.dock.fluidEmpty) out.push({ key: 'fluidEmpty', tone: 'info' });
  for (const c of v.consumables) if (c.left !== null && (c.left <= 5 || (c.total && c.left / c.total <= 0.1))) out.push({ key: 'due', tone: 'info', consumable: c.key });
  return out;
}
/** A setting of the robot or of its dock (the dock's empty mode, the volume) is sent only to an entity that answers (studio ST-13, release classic):
 * missing or `unavailable` takes no command; `unknown` still does (a robot that says nothing yet is not a lost one). The house off the line is not
 * this — that goes through the command and is said there («Нет связи с домом»). */
export const settingAnswers = (states: Readonly<Record<string, { state: string } | undefined>>, id: string): boolean => { const s = states[id]; return !!s && s.state !== 'unavailable'; };
export const percentLeft = (c: Consumable) => c.left === null || !c.total ? null : Math.max(0, Math.min(100, Math.round(c.left / c.total * 100)));
/** The rooms chosen for cleaning as the panel keeps them over a reload: only rooms the robot still has, each once, and 1–3 passes. Anything else is «nothing chosen». */
export function readChoice(raw: string | null, known: readonly string[]): { rooms: string[]; repeat: number } {
  try { const x = raw ? JSON.parse(raw) as { rooms?: unknown; repeat?: unknown } : null, rooms = Array.isArray(x?.rooms) ? x!.rooms.filter((r): r is string => typeof r === 'string' && known.includes(r)) : [];
    return { rooms: rooms.filter((r, i) => rooms.indexOf(r) === i), repeat: x?.repeat === 2 || x?.repeat === 3 ? x.repeat : 1 }; } catch { return { rooms: [], repeat: 1 }; }
}
