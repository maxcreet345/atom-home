import type { Registry, EntityRow, DeviceRow, StateRow } from './registry.ts';
import { domainOf } from './registry.ts';
import { type Kind, CONTROL_KINDS, KIND_PRIORITY, entityKind, entityCategory, sectionOfKind, type Section } from './kinds.ts';
import type { HouseConfig } from './config.ts';

export interface EntityRef {
  id: string; domain: string; deviceClass: string | null; name: string; kind: Kind | null;
  state: string; attributes: Record<string, unknown>; unit: string | null; available: boolean; lastChanged: string;
}
export interface Room { id: string; name: string; hidden: boolean; photo: string | null; order: number; areaTemperature: string | null; areaHumidity: string | null }
export interface HomeDevice {
  key: string; kind: Kind; name: string; roomId: string; icon: string | null; photo: string | null; art: string | null; order: number; enabled: boolean; available: boolean;
  primary: EntityRef; controls: EntityRef[]; metrics: EntityRef[]; parameters: EntityRef[]; diagnostics: EntityRef[];
  manufacturer: string | null; model: string | null; haDeviceId: string | null; section: Section | null;
}
export interface Home { name: string; rooms: Room[]; devices: HomeDevice[]; warnings: string[]; counts: Record<string, number> }

export const NO_ROOM = 'none';
const unitClass = (unit: string | null) => unit ? ({ '°C': 'temperature', 'W': 'power', 'kW': 'power', 'kWh': 'energy', 'Wh': 'energy', 'V': 'voltage', 'A': 'current', 'lx': 'illuminance', 'ppm': 'carbon_dioxide', 'hPa': 'atmospheric_pressure', 'bar': 'pressure' } as Record<string, string>)[unit] ?? null : null;
const ref = (e: EntityRow, s: StateRow | undefined, kind: Kind | null, nameOverride?: string): EntityRef => ({
  id: e.entity_id, domain: domainOf(e.entity_id), deviceClass: e.device_class ?? (s?.attributes.device_class as string | undefined) ?? unitClass(e.unit ?? (s?.attributes.unit_of_measurement as string | undefined) ?? null),
  name: nameOverride ?? (typeof s?.attributes.friendly_name === 'string' ? s.attributes.friendly_name : e.name ?? e.original_name ?? e.entity_id), kind,
  state: s?.state ?? 'unavailable', attributes: s?.attributes ?? {}, unit: e.unit ?? (s?.attributes.unit_of_measurement as string | undefined) ?? null,
  available: !!s && s.state !== 'unavailable', lastChanged: s?.last_changed ?? '',
});
const deviceName = (d: DeviceRow) => d.name?.trim() || d.model || d.id;

/** Build the household model from the HA registries, the live states and the house configuration. Pure; safe to call on every state change. */
export function discover(reg: Registry, config: HouseConfig): Home {
  const warnings: string[] = [];
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
  const entityHidden = (id: string) => config.entities[id]?.hidden === true;
  const entityName = (id: string) => config.entities[id]?.name;

  for (const [deviceId, list] of byDevice) {
    const d = devices.get(deviceId)!;
    const classified = list.filter(e => !entityHidden(e.entity_id)).map(e => { const s = reg.states[e.entity_id]; const kind = entityKind(e, s); return { e, s, kind, cat: entityCategory(e, kind) }; }).filter(x => x.cat !== 'hidden');
    let controls = classified.filter(x => x.cat === 'primary' && x.kind && CONTROL_KINDS.includes(x.kind));
    const sensors = classified.filter(x => x.cat === 'primary' && x.kind && !CONTROL_KINDS.includes(x.kind));
    // A plain switch next to a richer control (thermostat child lock, camera motion toggle…) is a setting of that device, not a card.
    const richer = controls.some(x => x.kind !== 'switch' && x.kind !== 'socket');
    const demoted = richer ? controls.filter(x => x.kind === 'switch' || x.kind === 'socket') : [];
    if (richer) controls = controls.filter(x => x.kind !== 'switch' && x.kind !== 'socket');
    const parameters = [...classified.filter(x => x.cat === 'parameter'), ...demoted].map(x => ref(x.e, x.s, x.kind, entityName(x.e.entity_id)));
    const diagnostics = classified.filter(x => x.cat === 'diagnostic').map(x => ref(x.e, x.s, x.kind, entityName(x.e.entity_id)));
    const sensorRefs = sensors.map(x => ref(x.e, x.s, x.kind, entityName(x.e.entity_id)));
    if (controls.length) {
      controls.sort((a, b) => KIND_PRIORITY.indexOf(a.kind!) - KIND_PRIORITY.indexOf(b.kind!) || a.e.entity_id.localeCompare(b.e.entity_id));
      controls.forEach((c, i) => {
        const primary = ref(c.e, c.s, c.kind, entityName(c.e.entity_id));
        cards.push({ key: `e:${c.e.entity_id}`, kind: c.kind!, name: primary.name, roomId: roomOf(c.e, d), icon: null, photo: null, art: null, order: 0, enabled: true, available: primary.available,
          primary, controls: [primary], metrics: i === 0 ? sensorRefs : [], parameters: i === 0 ? parameters : [], diagnostics: i === 0 ? diagnostics : [],
          manufacturer: d.manufacturer ?? null, model: d.model ?? null, haDeviceId: deviceId, section: sectionOfKind(c.kind!) });
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
        cards.push({ key: `d:${deviceId}${suffix}`, kind, name: deviceName(d), roomId: roomOf(list[0].e, d), icon: null, photo: null, art: null, order: 0, enabled: true, available: refs.some(r => r.available),
          primary: refs[0], controls: [], metrics: refs, parameters: first ? parameters : [], diagnostics: first ? diagnostics : [], manufacturer: d.manufacturer ?? null, model: d.model ?? null, haDeviceId: deviceId, section: sectionOfKind(kind) });
        first = false;
      }
    }
  }
  for (const e of loose) {
    if (entityHidden(e.entity_id)) continue;
    const s = reg.states[e.entity_id], kind = entityKind(e, s);
    if (!kind || entityCategory(e, kind) !== 'primary') continue;
    const primary = ref(e, s, kind, entityName(e.entity_id));
    cards.push({ key: `e:${e.entity_id}`, kind, name: primary.name, roomId: roomOf(e), icon: null, photo: null, art: null, order: 0, enabled: true, available: primary.available, primary, controls: CONTROL_KINDS.includes(kind) ? [primary] : [], metrics: CONTROL_KINDS.includes(kind) ? [] : [primary], parameters: [], diagnostics: [], manufacturer: null, model: null, haDeviceId: null, section: sectionOfKind(kind) });
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
/** Climate summary of a room: temperature/humidity from the area's chosen entities, else from the room's environment devices. */
export function roomClimate(home: Home, reg: Registry, roomId: string) {
  const room = home.rooms.find(r => r.id === roomId);
  const num = (id: string | null | undefined) => { const s = id ? reg.states[id] : undefined; const v = s ? Number(s.state) : NaN; return Number.isFinite(v) ? v : null; };
  const env = home.devices.filter(d => d.enabled && d.roomId === roomId && d.kind === 'environment').flatMap(d => d.metrics);
  const pick = (cls: string) => { const m = env.find(e => e.deviceClass === cls && e.available && Number.isFinite(Number(e.state))); return m ? Number(m.state) : null; };
  return {
    temperature: num(room?.areaTemperature) ?? pick('temperature'), humidity: num(room?.areaHumidity) ?? pick('humidity'), co2: pick('carbon_dioxide'),
    lights: home.devices.filter(d => d.enabled && d.roomId === roomId && d.kind === 'light'),
  };
}
