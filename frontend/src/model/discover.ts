import type { Registry, EntityRow, DeviceRow, StateRow } from './registry.ts';
import { domainOf, isNumeric } from './registry.ts';
import { type Kind, CONTROL_KINDS, KIND_PRIORITY, entityKind, entityCategory, sectionOfKind, type Section } from './kinds.ts';
import type { HouseConfig } from './config.ts';
import { APPLIANCE_KINDS, isAmbientLight, isIndicatorLight } from './lights.ts';

export interface EntityRef {
  id: string; domain: string; deviceClass: string | null; name: string; kind: Kind | null;
  state: string; attributes: Record<string, unknown>; unit: string | null; available: boolean; lastChanged: string;
}
export interface Room { id: string; name: string; hidden: boolean; photo: string | null; order: number; areaTemperature: string | null; areaHumidity: string | null }
export interface HomeDevice {
  key: string; kind: Kind; name: string; roomId: string; icon: string | null; photo: string | null; art: string | null; favorite: boolean; order: number; enabled: boolean; available: boolean;
  primary: EntityRef; controls: EntityRef[]; metrics: EntityRef[]; parameters: EntityRef[]; diagnostics: EntityRef[];
  manufacturer: string | null; model: string | null; haDeviceId: string | null; section: Section | null;
}
export interface Home { name: string; rooms: Room[]; devices: HomeDevice[]; warnings: string[]; counts: Record<string, number> }

export const NO_ROOM = 'none';
const unitClass = (unit: string | null) => unit ? ({ '°C': 'temperature', 'W': 'power', 'kW': 'power', 'kWh': 'energy', 'Wh': 'energy', 'V': 'voltage', 'A': 'current', 'lx': 'illuminance', 'ppm': 'carbon_dioxide', 'hPa': 'atmospheric_pressure', 'bar': 'pressure' } as Record<string, string>)[unit] ?? null : null;
const makeRef = (e: EntityRow, s: StateRow | undefined, kind: Kind | null, nameOverride?: string): EntityRef => ({
  id: e.entity_id, domain: domainOf(e.entity_id), deviceClass: e.device_class ?? (s?.attributes.device_class as string | undefined) ?? unitClass(e.unit ?? (s?.attributes.unit_of_measurement as string | undefined) ?? null),
  name: nameOverride ?? (typeof s?.attributes.friendly_name === 'string' ? s.attributes.friendly_name : e.name ?? e.original_name ?? e.entity_id), kind,
  state: s?.state ?? 'unavailable', attributes: s?.attributes ?? {}, unit: e.unit ?? (s?.attributes.unit_of_measurement as string | undefined) ?? null,
  available: !!s && s.state !== 'unavailable', lastChanged: s?.last_changed ?? '',
});
const deviceName = (d: DeviceRow) => d.name?.trim() || d.model || d.id;

/** Build the household model from the HA registries, the live states and the house configuration. `claimed` entities belong to a module's card. Pure; safe to call on every state change. */
export function discover(reg: Registry, config: HouseConfig, claimed: ReadonlySet<string> = new Set(), trace?: Trace): Home {
  const warnings: string[] = [];
  // every reference to an entity is made here; `rememberDiscover` notes how, so that a new state can be put into the same place later
  const ref = (e: EntityRow, s: StateRow | undefined, kind: Kind | null, nameOverride?: string): EntityRef => { const r = makeRef(e, s, kind, nameOverride); if (trace) (trace.made.get(e.entity_id) ?? trace.made.set(e.entity_id, []).get(e.entity_id)!).push({ ref: r, e, kind, name: nameOverride }); return r; };
  const devices = new Map(reg.devices.map(d => [d.id, d]));
  const byDevice = new Map<string, EntityRow[]>();
  const loose: EntityRow[] = [];
  for (const e of reg.entities) {
    if (e.disabled_by || e.hidden_by) continue;
    const d = e.device_id ? devices.get(e.device_id) : undefined;
    if (e.device_id && d && !d.disabled_by && d.entry_type !== 'service') { (byDevice.get(e.device_id) ?? byDevice.set(e.device_id, []).get(e.device_id)!).push(e); }
    else if (!e.device_id) loose.push(e);
  }
  const cards: HomeDevice[] = [];
  const roomOf = (e: EntityRow, d?: DeviceRow) => e.area_id ?? d?.area_id ?? NO_ROOM;
  // Hidden by the owner, or shown by a module inside its own card (claimed): never a card of its own.
  const entityHidden = (id: string) => config.entities[id]?.hidden === true || claimed.has(id);
  const entityName = (id: string) => config.entities[id]?.name;

  for (const [deviceId, list] of byDevice) {
    const d = devices.get(deviceId)!;
    const classified = list.filter(e => !entityHidden(e.entity_id)).map(e => { const s = reg.states[e.entity_id]; const kind = entityKind(e, s); return { e, s, kind, cat: entityCategory(e, kind) }; }).filter(x => x.cat !== 'hidden');
    let controls = classified.filter(x => x.cat === 'primary' && x.kind && CONTROL_KINDS.includes(x.kind));
    const sensors = classified.filter(x => x.cat === 'primary' && x.kind && !CONTROL_KINDS.includes(x.kind));
    // Room-light rule: a light that is an appliance's indicator (camera LED, hub status light) is a setting of that device, never a lamp of the room.
    const nameOf = (x: typeof classified[number]) => typeof x.s?.attributes.friendly_name === 'string' ? x.s.attributes.friendly_name : x.e.name ?? x.e.original_name ?? '';
    // a ceiling fan's lamp is a lamp (Atom + Okapi, 09.11.2026: the iFan04 over the soldering bench), not a purifier's status light
    const ceilingFan = /ifan|ceiling\s*fan|потолочн/i.test(`${d.model ?? ''} ${d.name ?? ''}`) && !controls.some(x => x.kind !== 'fan' && x.kind !== 'light' && APPLIANCE_KINDS.includes(x.kind!));
    const appliance = !ceilingFan && controls.some(x => APPLIANCE_KINDS.includes(x.kind!));
    // an LED controller's light is its whole point, whatever «led» its name carries (Atom + Okapi, 09.11.2026: `light.kontroller_led_podsvetki_atom`)
    const ledController = /gledopto|led\s*controller|pixel\s*controller|контроллер\s+(лед|led)|strip/i.test(`${d.manufacturer ?? ''} ${d.model ?? ''} ${d.name ?? ''}`);
    const indicators = controls.filter(x => x.kind === 'light' && !ledController && (appliance || isIndicatorLight(x.e.entity_id, nameOf(x))));
    controls = controls.filter(x => !indicators.includes(x));
    // A plain switch next to a richer control (thermostat child lock, camera motion toggle…) is a setting of that device, not a card.
    const richer = controls.some(x => x.kind !== 'switch' && x.kind !== 'socket');
    const demoted = [...indicators, ...(richer ? controls.filter(x => x.kind === 'switch' || x.kind === 'socket') : [])];
    if (richer) controls = controls.filter(x => x.kind !== 'switch' && x.kind !== 'socket');
    // A lamp's second light (ambient ring, backlight) belongs to the lamp's card, not to a tile of its own.
    const lights = controls.filter(x => x.kind === 'light'), ambient = lights.length > 1 ? lights.filter(x => isAmbientLight(x.e.entity_id, nameOf(x))) : [];
    if (ambient.length && ambient.length < lights.length) controls = controls.filter(x => !ambient.includes(x));
    const ambientRefs = ambient.length && ambient.length < lights.length ? ambient.map(x => ref(x.e, x.s, x.kind, entityName(x.e.entity_id))) : [];
    const parameters = [...classified.filter(x => x.cat === 'parameter'), ...demoted].map(x => ref(x.e, x.s, x.kind, entityName(x.e.entity_id)));
    const diagnostics = classified.filter(x => x.cat === 'diagnostic').map(x => ref(x.e, x.s, x.kind, entityName(x.e.entity_id)));
    const sensorRefs = sensors.map(x => ref(x.e, x.s, x.kind, entityName(x.e.entity_id)));
    if (controls.length) {
      controls.sort((a, b) => KIND_PRIORITY.indexOf(a.kind!) - KIND_PRIORITY.indexOf(b.kind!) || a.e.entity_id.localeCompare(b.e.entity_id));
      const mainLight = controls.find(x => x.kind === 'light');
      controls.forEach((c, i) => {
        const primary = ref(c.e, c.s, c.kind, entityName(c.e.entity_id));
        cards.push({ key: `e:${c.e.entity_id}`, kind: c.kind!, name: primary.name, roomId: roomOf(c.e, d), icon: null, photo: null, art: null, favorite: false, order: 0, enabled: true, available: primary.available,
          primary, controls: c === mainLight ? [primary, ...ambientRefs] : [primary], metrics: i === 0 ? sensorRefs : [], parameters: i === 0 ? parameters : [], diagnostics: i === 0 ? diagnostics : [],
          manufacturer: d.manufacturer ?? null, model: d.model ?? null, haDeviceId: deviceId, section: sectionOfKind(c.kind!) });
        trace?.own.set(`e:${c.e.entity_id}`, [c.e.entity_id]);
      });
    } else if (sensors.length) {
      // One card per sensor kind of the device: an environment card (temperature first), an energy card (power first), one leak card…
      const groups = new Map<Kind, typeof sensors>();
      for (const x of sensors) (groups.get(x.kind!) ?? groups.set(x.kind!, []).get(x.kind!)!).push(x);
      const dcOf = (x: typeof sensors[number]) => x.e.device_class ?? (x.s?.attributes.device_class as string | undefined) ?? unitClass(x.e.unit ?? (x.s?.attributes.unit_of_measurement as string | undefined) ?? null) ?? '';
      const rank = (x: typeof sensors[number]) => ['temperature', 'power', 'carbon_dioxide', 'humidity', 'energy', 'moisture'].indexOf(dcOf(x)) + 1 || 99;
      let first = true;
      // Voltage/current alone (sensor battery voltage) is diagnostics: an energy card needs power or energy.
      const energy = groups.get('energy');
      if (energy && !energy.some(x => ['power', 'energy'].includes(dcOf(x)))) { diagnostics.push(...energy.map(x => ref(x.e, x.s, x.kind, entityName(x.e.entity_id)))); groups.delete('energy'); }
      for (const kind of KIND_PRIORITY) {
        const list = groups.get(kind); if (!list) continue;
        list.sort((a, b) => rank(a) - rank(b));
        const refs = list.map(x => ref(x.e, x.s, x.kind, entityName(x.e.entity_id)));
        const suffix = groups.size > 1 && !first ? `:${kind}` : '';
        cards.push({ key: `d:${deviceId}${suffix}`, kind, name: deviceName(d), roomId: roomOf(list[0].e, d), icon: null, photo: null, art: null, favorite: false, order: 0, enabled: true, available: refs.some(r => r.available),
          primary: refs[0], controls: [], metrics: refs, parameters: first ? parameters : [], diagnostics: first ? diagnostics : [], manufacturer: d.manufacturer ?? null, model: d.model ?? null, haDeviceId: deviceId, section: sectionOfKind(kind) });
        trace?.own.set(`d:${deviceId}${suffix}`, refs.map(r => r.id));
        first = false;
      }
    }
  }
  for (const e of loose) {
    if (entityHidden(e.entity_id)) continue;
    const s = reg.states[e.entity_id], kind = entityKind(e, s);
    if (!kind || entityCategory(e, kind) !== 'primary') continue;
    const primary = ref(e, s, kind, entityName(e.entity_id));
    cards.push({ key: `e:${e.entity_id}`, kind, name: primary.name, roomId: roomOf(e), icon: null, photo: null, art: null, favorite: false, order: 0, enabled: true, available: primary.available, primary, controls: CONTROL_KINDS.includes(kind) ? [primary] : [], metrics: CONTROL_KINDS.includes(kind) ? [] : [primary], parameters: [], diagnostics: [], manufacturer: null, model: null, haDeviceId: null, section: sectionOfKind(kind) });
    trace?.own.set(`e:${e.entity_id}`, [e.entity_id]);
  }
  // Configuration overlay: merges first, then per-card overrides.
  const byKey = new Map(cards.map(c => [c.key, c]));
  for (const [key, o] of Object.entries(config.devices)) {
    if (!o.mergeInto) continue;
    const from = byKey.get(key), into = byKey.get(o.mergeInto);
    if (!from || !into || from === into) { warnings.push(`merge: ${key} → ${o.mergeInto} not found`); continue; }
    into.controls.push(...from.controls); into.metrics.push(...from.metrics); into.parameters.push(...from.parameters); into.diagnostics.push(...from.diagnostics);
    from.enabled = false;
  }
  for (const c of cards) {
    const o = config.devices[c.key];
    if (!o) continue;
    if (o.enabled === false) c.enabled = false;
    if (o.name) c.name = o.name;
    if (o.roomId) c.roomId = o.roomId;
    if (o.icon) c.icon = o.icon;
    if (o.photo) c.photo = o.photo;
    if (o.art) c.art = o.art;
    if (o.favorite) c.favorite = true;
    if (o.kind) { c.kind = o.kind; c.section = sectionOfKind(o.kind); }
    if (typeof o.order === 'number') c.order = o.order;
  }
  cards.sort((a, b) => a.order - b.order || KIND_PRIORITY.indexOf(a.kind) - KIND_PRIORITY.indexOf(b.kind) || a.name.localeCompare(b.name, 'ru'));
  const usedRooms = new Set(cards.filter(c => c.enabled).map(c => c.roomId));
  const rooms: Room[] = reg.areas.map((a, i) => { const o = config.rooms[a.area_id] ?? {}; return { id: a.area_id, name: o.name ?? a.name, hidden: o.hidden === true, photo: o.photo ?? a.picture ?? null, order: o.order ?? i, areaTemperature: a.temperature_entity_id ?? null, areaHumidity: a.humidity_entity_id ?? null }; });
  if (usedRooms.has(NO_ROOM)) { const o = config.rooms[NO_ROOM] ?? {}; rooms.push({ id: NO_ROOM, name: o.name ?? '', hidden: o.hidden === true, photo: o.photo ?? null, order: o.order ?? 999, areaTemperature: null, areaHumidity: null }); }
  rooms.sort((a, b) => a.order - b.order);
  const counts: Record<string, number> = {};
  for (const c of cards) if (c.enabled) counts[c.kind] = (counts[c.kind] ?? 0) + 1;
  return { name: config.home.name, rooms, devices: cards, warnings, counts };
}
/** How `discover` made its references (by entity) and whose states decide each card's `available` (by card key). */
interface Trace { made: Map<string, Array<{ ref: EntityRef; e: EntityRow; kind: Kind | null; name?: string }>>; own: Map<string, string[]> }
/** What of a state can change the SHAPE of the house (which card an entity makes, under what name, in what order): its presence, the class,
 * unit and name it carries, and for a sensor whether it reads a number. Anything else in a state is a value. */
const shape = (e: EntityRow, s: StateRow | undefined) => !s ? '' : `1\u0001${String(s.attributes.unit_of_measurement ?? '')}\u0001${String(s.attributes.device_class ?? '')}\u0001${String(s.attributes.friendly_name ?? '')}\u0001${domainOf(e.entity_id) === 'sensor' && !isNumeric(s.state) && s.state !== 'unavailable' && s.state !== 'unknown' ? 'x' : ''}`;
/** `discover` that remembers its last answer (PERF-1 of the audit of 09.11.2026: every state change of Home Assistant rebuilt the whole house,
 * 31 ms of 43 on the wall tablet). The registry, the settings and the claimed entities unchanged:
 *  - no state of a known entity changed → the very same house;
 *  - states changed but none in shape → the same house with those entities' references renewed (only the cards that hold them are new objects);
 *  - anything else → built anew.
 * One function per panel: `const discoverHome = rememberDiscover()`. The result equals `discover(...)` field for field (tests/discover-memo.test.ts). */
export function rememberDiscover(): (reg: Registry, config: HouseConfig, claimed?: ReadonlySet<string>) => Home {
  let last: { entities: Registry['entities']; devices: Registry['devices']; areas: Registry['areas']; config: HouseConfig; claimed: string; home: Home; rows: Map<string, StateRow | undefined>; shapes: Map<string, string>; rowOf: Map<string, EntityRow>; trace: Trace } | null = null;
  return (reg, config, claimed = new Set()) => {
    const claimedKey = [...claimed].sort().join('|');
    if (last && last.entities === reg.entities && last.devices === reg.devices && last.areas === reg.areas && last.config === config && last.claimed === claimedKey) {
      const changed: string[] = []; let reshaped = false;
      for (const [id, row] of last.rows) { const now = reg.states[id]; if (now === row) continue; if (shape(last.rowOf.get(id)!, now) !== last.shapes.get(id)) { reshaped = true; break; } changed.push(id); }
      if (!reshaped) {
        if (!changed.length) return last.home;
        const swap = new Map<EntityRef, EntityRef>();
        for (const id of changed) { const now = reg.states[id]; last.rows.set(id, now); for (const m of last.trace.made.get(id) ?? []) { const next = makeRef(m.e, now, m.kind, m.name); swap.set(m.ref, next); m.ref = next; } }
        if (!swap.size) return last.home; // the entities that changed stand on no card
        const put = (r: EntityRef) => swap.get(r) ?? r, any = (list: EntityRef[]) => list.some(r => swap.has(r)), alive = (id: string) => { const s = reg.states[id]; return !!s && s.state !== 'unavailable'; };
        const devices = last.home.devices.map(c => swap.has(c.primary) || any(c.controls) || any(c.metrics) || any(c.parameters) || any(c.diagnostics)
          ? { ...c, primary: put(c.primary), controls: c.controls.map(put), metrics: c.metrics.map(put), parameters: c.parameters.map(put), diagnostics: c.diagnostics.map(put), available: (last!.trace.own.get(c.key) ?? [c.primary.id]).some(alive) } : c);
        last.home = { ...last.home, devices };
        return last.home;
      }
    }
    const trace: Trace = { made: new Map(), own: new Map() }, home = discover(reg, config, claimed, trace);
    const rows = new Map<string, StateRow | undefined>(), shapes = new Map<string, string>(), rowOf = new Map<string, EntityRow>();
    for (const e of reg.entities) { if (e.disabled_by || e.hidden_by) continue; const s = reg.states[e.entity_id]; rows.set(e.entity_id, s); shapes.set(e.entity_id, shape(e, s)); rowOf.set(e.entity_id, e); }
    last = { entities: reg.entities, devices: reg.devices, areas: reg.areas, config, claimed: claimedKey, home, rows, shapes, rowOf, trace };
    return home;
  };
}
/** Climate summary of a room: temperature/humidity from the area's chosen entities; where the area names none, from the room's environment devices. */
export function roomClimate(home: Home, reg: Registry, roomId: string) {
  const room = home.rooms.find(r => r.id === roomId);
  const num = (id: string | null | undefined) => { const s = id ? reg.states[id] : undefined; const v = s ? Number(s.state) : NaN; return Number.isFinite(v) ? v : null; };
  const env = home.devices.filter(d => d.enabled && d.roomId === roomId && d.kind === 'environment').flatMap(d => d.metrics);
  const pick = (cls: string) => { const m = env.find(e => e.deviceClass === cls && e.available && Number.isFinite(Number(e.state))); return m ? Number(m.state) : null; };
  return {
    // The area's own link is the room's sensor (as the room page and «Воздух» read it, docs/AIR.md): when it is silent the room has no reading —
    // another sensor of the room is taken only where the area names none, never as a stand-in for a silent one.
    temperature: room?.areaTemperature ? num(room.areaTemperature) : pick('temperature'), humidity: room?.areaHumidity ? num(room.areaHumidity) : pick('humidity'), co2: pick('carbon_dioxide'),
    lights: home.devices.filter(d => d.enabled && d.roomId === roomId && d.kind === 'light'),
  };
}
