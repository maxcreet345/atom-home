/* The card catalog (book/06-dashboards/platform-2026/PROMPT-CARD-CATALOG.md, 20.11.2026). Three things are kept apart:
 *  - the RENDERER: how a card is drawn (`device` — the panel's own tile and sheet; `thermostat`; `heatingRooms` — the heating screen);
 *  - the PROFILE: one model of one make, or one scheme, with the fields it binds (`PROFILES` below; a new model of a known behaviour is a profile
 *    and its fields, nothing else);
 *  - the INSTANCE in a house (`HouseConfig.profileInstances`): its own stable id, its bindings, name, room and where it is shown. Two purifiers of
 *    one model are two instances; one purifier on Home and in its room is one.
 * Pure: reads the registry and the states, never calls a service. Opening the form, the preview and saving send nothing to a device. */
import type { Registry, EntityRow, StateRow } from './registry.ts';
import { domainOf, unavailable } from './registry.ts';
import { entityKind } from './kinds.ts';
import type { Kind } from './kinds.ts';
import { entityRefOf, NO_ROOM, type EntityRef, type HomeDevice } from './discover.ts';

export type Category = 'air_purifier' | 'heating';
export const CATEGORIES: readonly Category[] = ['air_purifier', 'heating'];
export type Renderer = 'device' | 'thermostat' | 'heatingRooms';
export type Place = 'home' | 'room';
/** One field of a card: what it is for, whether the card needs it, and what may fill it. */
export interface RoleSpec {
  id: string; labelKey: string; hintKey?: string; required: boolean;
  /** the HA domains that may fill it (a button, a switch, a number, a mode list may be a binding too) */ domains: string[];
  deviceClass?: string[]; units?: string[];
  /** the entity's own suffix in this model's integration: the first sign that it is THE field (`_pm25`, `_filter_life`) */ suffix?: RegExp;
  /** `own`: only the chosen device's entities; `prefer` (default): its own first, any other on purpose (an external sensor) */ source?: 'own' | 'prefer';
  /** never offered: a boiler's flow, a target, a set point is no room's air temperature */ exclude?: RegExp;
  /** how it stands on the card: a reading, a setting (parameter), the main control */ as?: 'primary' | 'metric' | 'parameter';
}
export interface Profile {
  id: string; version: string; category: Category; brand: string | null; titleKey: string; descKey: string;
  /** exact model codes from HA's device registry (`zhimi.airp.mb5`); empty: a scheme, not one appliance */ models: string[];
  /** the HA integration it is known through, said when the device is not found */ integration?: { platform: string; name: string };
  /** words the search finds it by, besides its title, brand and model codes */ terms: string[];
  renderer: Renderer; kind: Kind;
  /** the glyph of its tile and the word above its sheet's name («Очиститель воздуха», not the HA domain's «Вентилятор») */ icon?: string; kindKey?: string;
  /** the entity a device is found by (the purifier's `fan`); its role id */ anchor?: string;
  roles: RoleSpec[];
  /** the fields of one room of a scheme («＋ Добавить комнату») */ roomRoles?: RoleSpec[];
  places: Place[];
}
/** Heating fields that must never be a room's air temperature (owner's acceptance: «в температуре воздуха кухни исключены уставки и показания котла»). */
const NOT_AIR = /boiler|kotel|котл|котёл|kettle|чайник|fryer|fridge|холодильн|flow|return|dhw|hwc|_target|setpoint|set_point|уставк|_set$|desired|override|manual|_hyst|trv_|_trv$|outdoor|ulic|street/i;
const PURIFIER_4: Profile = {
  id: 'xiaomi.purifier4', version: '1.0.0', category: 'air_purifier', brand: 'Xiaomi', titleKey: 'cat.p.purifier4', descKey: 'cat.p.purifier4.desc',
  models: ['zhimi.airp.mb5'], integration: { platform: 'xiaomi_miot', name: 'Xiaomi Miot' }, terms: ['purifier 4', 'air purifier 4', 'smart air purifier 4', 'mb5', 'очиститель', 'purificator'],
  renderer: 'device', kind: 'fan', icon: 'air', kindKey: 'cat.kind.purifier', anchor: 'fan', places: ['home', 'room'],
  roles: [
    { id: 'fan', labelKey: 'cat.r.fan', hintKey: 'cat.r.fan.hint', required: true, domains: ['fan'], source: 'own', as: 'primary' },
    { id: 'pm25', labelKey: 'cat.r.pm25', required: false, domains: ['sensor'], deviceClass: ['pm25'], units: ['µg/m³', 'μg/m³'], suffix: /_pm25$/, as: 'metric' },
    { id: 'filter', labelKey: 'cat.r.filter', required: false, domains: ['sensor'], units: ['%'], suffix: /_filter_life$/, source: 'own', as: 'metric' },
    { id: 'filterDays', labelKey: 'cat.r.filterDays', required: false, domains: ['sensor'], units: ['days', 'd'], suffix: /_filter_left_time$/, source: 'own', as: 'metric' },
    { id: 'temperature', labelKey: 'cat.r.temperature', required: false, domains: ['sensor'], deviceClass: ['temperature'], suffix: /_temperature$/, as: 'metric', exclude: NOT_AIR },
    { id: 'humidity', labelKey: 'cat.r.humidity', required: false, domains: ['sensor'], deviceClass: ['humidity'], suffix: /_humidity$/, as: 'metric' },
    { id: 'ionizer', labelKey: 'cat.r.ionizer', required: false, domains: ['switch'], suffix: /_(ionizer|anion)$/, source: 'own', as: 'parameter' },
    { id: 'favoriteLevel', labelKey: 'cat.r.favoriteLevel', required: false, domains: ['number'], suffix: /_favorite_level$/, source: 'own', as: 'parameter' },
    { id: 'brightness', labelKey: 'cat.r.brightness', required: false, domains: ['select'], suffix: /_led_brightness$/, source: 'own', as: 'parameter' },
    { id: 'childLock', labelKey: 'cat.r.childLock', required: false, domains: ['switch'], suffix: /_child_lock$/, source: 'own', as: 'parameter' },
    { id: 'buzzer', labelKey: 'cat.r.buzzer', required: false, domains: ['switch'], suffix: /_buzzer$/, source: 'own', as: 'parameter' },
  ],
};
const HEAT_SINGLE: Profile = {
  id: 'heating.single', version: '1.0.0', category: 'heating', brand: null, titleKey: 'cat.p.heatSingle', descKey: 'cat.p.heatSingle.desc', models: [], terms: ['thermostat', 'термостат', 'отопление', 'încălzire', 'heating'],
  renderer: 'thermostat', kind: 'climate', anchor: 'thermostat', places: ['home', 'room'],
  roles: [
    { id: 'thermostat', labelKey: 'cat.r.thermostat', hintKey: 'cat.r.thermostat.hint', required: true, domains: ['climate'], as: 'primary', exclude: /_trv$/ },
    { id: 'air', labelKey: 'cat.r.air', hintKey: 'cat.r.air.hint', required: false, domains: ['sensor'], deviceClass: ['temperature'], units: ['°C'], exclude: NOT_AIR, as: 'metric' },
  ],
};
const HEAT_ROOMS: Profile = {
  id: 'heating.rooms', version: '1.0.0', category: 'heating', brand: null, titleKey: 'cat.p.heatRooms', descKey: 'cat.p.heatRooms.desc', models: [], terms: ['thermostat', 'термостат', 'отопление', 'головк', 'trv', 'радиатор', 'încălzire', 'heating', 'rooms', 'комнат'],
  renderer: 'heatingRooms', kind: 'climate', anchor: 'central', places: ['home'],
  roles: [
    { id: 'central', labelKey: 'cat.r.central', hintKey: 'cat.r.central.hint', required: true, domains: ['climate'], as: 'primary', exclude: /_trv$/ },
    { id: 'mode', labelKey: 'cat.r.mode', hintKey: 'cat.r.mode.hint', required: false, domains: ['input_select', 'select'], suffix: /heating_mode$/ },
    { id: 'homeTemp', labelKey: 'cat.r.homeTemp', hintKey: 'cat.r.homeTemp.hint', required: false, domains: ['input_number', 'number'], suffix: /heating_home_temp$/ },
    { id: 'target', labelKey: 'cat.r.target', required: false, domains: ['sensor', 'input_number'], suffix: /heating_target_temp$/ },
    { id: 'system', labelKey: 'cat.r.system', required: false, domains: ['input_boolean', 'switch'], suffix: /heating_system$/ },
  ],
  roomRoles: [
    { id: 'trv', labelKey: 'cat.r.trv', hintKey: 'cat.r.trv.hint', required: true, domains: ['climate'] },
    { id: 'air', labelKey: 'cat.r.air', hintKey: 'cat.r.air.hint', required: false, domains: ['sensor'], deviceClass: ['temperature'], units: ['°C'], exclude: NOT_AIR },
    { id: 'timer', labelKey: 'cat.r.timer', hintKey: 'cat.r.timer.hint', required: false, domains: ['timer'], suffix: /_heating_override$/ },
    { id: 'overrideTemp', labelKey: 'cat.r.overrideTemp', required: false, domains: ['input_number'], suffix: /_heating_override_temp$/ },
    { id: 'manualTemp', labelKey: 'cat.r.manualTemp', hintKey: 'cat.r.manualTemp.hint', required: false, domains: ['input_number'], suffix: /_heating_manual_temp$/ },
  ],
};
export const PROFILES: Profile[] = [PURIFIER_4, HEAT_SINGLE, HEAT_ROOMS];
export const profileById = (id: string, list: Profile[] = PROFILES) => list.find(p => p.id === id) ?? null;

// ---- the instance a house keeps ----
export interface InstanceRoom { id: string; areaId: string; bindings: Record<string, string> }
export interface ProfileInstance {
  profileId: string; profileVersion: string; /** the HA device it was made for (an appliance); a scheme has none */ deviceId?: string;
  bindings: Record<string, string>; name?: string; roomId?: string; placement: Place[];
  /** a scheme's rooms («Центральный термостат и комнаты») */ rooms?: InstanceRoom[];
  /** the auto-made card it replaces (`e:fan.living_air_purifier`): its name, photo and «favourite» were carried over once */ legacyKey?: string;
}
const ENTITY = /^[a-z_]+\.[a-z0-9_]+$/, ID = /^(?!__proto__$|constructor$|prototype$)[A-Za-z0-9_-]{1,40}$/, ROLE = /^\w{1,32}$/;
const plain = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const binds = (v: unknown) => plain(v) ? Object.fromEntries(Object.entries(v).filter(([k, e]) => ROLE.test(k) && typeof e === 'string' && ENTITY.test(e))) as Record<string, string> : {};
/** Same rules as the integration's: a malformed instance is dropped, one of a profile this panel does not know yet is KEPT as it is (a newer
 * panel made it; this one draws nothing for it and never writes it away). */
export function normaliseInstances(raw: unknown, warn: (w: string) => void = () => undefined): Record<string, ProfileInstance> {
  const out: Record<string, ProfileInstance> = {};
  if (!plain(raw)) return out;
  for (const [id, v] of Object.entries(raw).slice(0, 200)) {
    if (!ID.test(id) || !plain(v) || typeof v.profileId !== 'string' || !/^[\w.-]{1,64}$/.test(v.profileId)) { warn(`config: dropped card ${id.slice(0, 40)}`); continue; }
    const placement = Array.isArray(v.placement) ? [...new Set(v.placement.filter((p): p is Place => p === 'home' || p === 'room'))] : [];
    const rooms = Array.isArray(v.rooms) ? v.rooms.slice(0, 40).filter(plain).filter(r => typeof r.id === 'string' && ID.test(r.id) && typeof r.areaId === 'string' && r.areaId.length <= 128).map(r => ({ id: r.id as string, areaId: r.areaId as string, bindings: binds(r.bindings) })) : undefined;
    const str = (x: unknown, max: number) => typeof x === 'string' && x.trim() ? x.trim().slice(0, max) : undefined;
    // fields a newer panel added are carried as they are (spread first); the known ones are checked
    const extra: Record<string, unknown> = { ...v }; for (const k of ['profileId', 'profileVersion', 'bindings', 'placement', 'deviceId', 'name', 'roomId', 'legacyKey', 'rooms']) delete extra[k];
    const inst: ProfileInstance = { ...extra, profileId: v.profileId, profileVersion: typeof v.profileVersion === 'string' && /^\d+\.\d+\.\d+$/.test(v.profileVersion) ? v.profileVersion : '1.0.0', bindings: binds(v.bindings), placement };
    const deviceId = str(v.deviceId, 64), name = str(v.name, 80), roomId = str(v.roomId, 128), legacyKey = str(v.legacyKey, 200);
    if (deviceId && /^[\w-]+$/.test(deviceId)) inst.deviceId = deviceId;
    if (name) inst.name = name; if (roomId) inst.roomId = roomId; if (legacyKey) inst.legacyKey = legacyKey; if (rooms) inst.rooms = rooms;
    out[id] = inst;
  }
  return out;
}
/** A new instance id: stable from then on, never derived from a name, a room or an entity (a rename or a repair keeps it). */
export const newInstanceId = (taken: Record<string, unknown>, rnd: () => number = Math.random): string => { for (;;) { const id = `c${Date.now().toString(36)}${Math.floor(rnd() * 1e6).toString(36)}`; if (!taken[id]) return id; } };
export const INSTANCE_PREFIX = 'p:';
export const instanceKey = (id: string) => `${INSTANCE_PREFIX}${id}`;

// ---- finding: the catalog search, the devices of a profile, the candidates of a field ----
const lower = (s: string) => s.toLowerCase().replace(/ё/g, 'е');
/** The search box and the category/brand filter lead to the same profiles: a model code, a brand, a word of the title. */
export function searchProfiles(query: string, title: (p: Profile) => string, opts: { category?: Category | null; brand?: string | null } = {}, list: Profile[] = PROFILES): Profile[] {
  const q = lower(query.trim());
  return list.filter(p => (!opts.category || p.category === opts.category) && (!opts.brand || p.brand === opts.brand) && (!q || q.split(/\s+/).every(w => [title(p), p.brand ?? '', ...p.models, ...p.terms].some(s => lower(s).includes(w)))));
}
export const brandsOf = (category: Category | null, list: Profile[] = PROFILES): string[] => [...new Set(list.filter(p => !category || p.category === category).map(p => p.brand).filter((b): b is string => !!b))].sort();
const live = (reg: Registry, e: EntityRow) => !e.disabled_by && !!reg.states[e.entity_id];
const areaOf = (reg: Registry, e: EntityRow | undefined) => e ? e.area_id ?? reg.devices.find(d => d.id === e.device_id)?.area_id ?? null : null;
/** The HA devices of this house a profile fits: the model code for an appliance; any climate for a scheme (it is the installer's to say which). */
export function devicesFor(reg: Registry, p: Profile): Array<{ id: string; name: string; areaId: string | null; model: string | null }> {
  if (!p.models.length) return [];
  const anchor = p.roles.find(r => r.id === p.anchor);
  return reg.devices.filter(d => !d.disabled_by && d.model && p.models.includes(d.model) && reg.entities.some(e => e.device_id === d.id && live(reg, e) && (!anchor || anchor.domains.includes(domainOf(e.entity_id)))))
    .map(d => ({ id: d.id, name: (d as { name_by_user?: string | null }).name_by_user ?? d.name ?? d.model ?? d.id, areaId: d.area_id, model: d.model ?? null }));
}
/** Is the profile «found in this house»: an appliance whose model is here, a scheme whose main field has something to bind. */
export const foundHere = (reg: Registry, p: Profile): boolean => p.models.length ? devicesFor(reg, p).length > 0 : candidates(reg, p.roles.find(r => r.id === p.anchor)!, {}).length > 0;
export interface Candidate { id: string; name: string; areaId: string | null; value: string; unit: string | null; own: boolean; exact: boolean; score: number }
const friendly = (reg: Registry, e: EntityRow) => { const n = reg.states[e.entity_id]?.attributes.friendly_name; return typeof n === 'string' && n.trim() ? n.trim() : e.name ?? e.original_name ?? e.entity_id; };
const dcOf = (e: EntityRow, s: StateRow | undefined) => e.device_class ?? (s?.attributes.device_class as string | undefined) ?? null;
const unitOf = (e: EntityRow, s: StateRow | undefined) => e.unit ?? (s?.attributes.unit_of_measurement as string | undefined) ?? null;
/** What may fill one field, best first: by the chosen device, the domain, the class or unit and the model's own suffix. An entity that
 * belongs to the boiler or is a target/set point is never a room's air temperature. `in` = the room the card is for (a closer sensor first). */
export function candidates(reg: Registry, role: RoleSpec, ctx: { deviceId?: string; areaId?: string | null }): Candidate[] {
  const out: Candidate[] = [];
  const boilerDevices = new Set(reg.devices.filter(d => /boiler|котл|котёл|ebus|nitromix|demir/i.test(`${d.name ?? ''} ${d.model ?? ''}`)).map(d => d.id));
  for (const e of reg.entities) {
    if (!live(reg, e) || !role.domains.includes(domainOf(e.entity_id))) continue;
    const own = !!ctx.deviceId && e.device_id === ctx.deviceId;
    if (role.source === 'own' && ctx.deviceId && !own) continue;
    const s = reg.states[e.entity_id], full = friendly(reg, e), dc = dcOf(e, s), unit = unitOf(e, s);
    // «Гостиная · Очиститель воздуха (Xiaomi Air Purifier 4) PM2.5» is «PM2.5» in its own device's list: the device is said once, above
    const devName = e.device_id ? reg.devices.find(d => d.id === e.device_id)?.name ?? '' : '', rest = devName && full.startsWith(devName) ? full.slice(devName.length).trim() : '';
    const name = rest || full;
    if (role.deviceClass && !(dc && role.deviceClass.includes(dc)) && !(role.units && unit && role.units.includes(unit) && !dc)) continue;
    if (!role.deviceClass && role.units && !(unit && role.units.includes(unit))) continue;
    // a sensor of the boiler's own device is no air temperature; the boiler's thermostat («Термостат котла») is still a thermostat
    if (role.exclude && (role.exclude.test(e.entity_id) || role.exclude.test(full) || (role.exclude === NOT_AIR && e.device_id && boilerDevices.has(e.device_id)))) continue;
    if (e.entity_category === 'diagnostic' && role.as !== 'parameter') continue;
    const exact = !!role.suffix && role.suffix.test(e.entity_id), area = areaOf(reg, e);
    const score = (own ? 50 : 0) + (exact ? 30 : 0) + (ctx.areaId && area === ctx.areaId ? 10 : 0) - (e.hidden_by ? 5 : 0);
    out.push({ id: e.entity_id, name, areaId: area, value: s?.state ?? 'unavailable', unit, own, exact, score });
  }
  return out.sort((a, b) => b.score - a.score || a.name.localeCompare(b.name, 'ru'));
}
/** The field's suggestion: only when it is unambiguous — the chosen device's own entity with the model's suffix, or the single candidate of the
 * device. Two equal ones are the installer's choice (the form shows the list with nothing picked). */
export function suggestion(list: Candidate[], role: RoleSpec): string | undefined {
  const own = list.filter(c => c.own);
  const exact = own.filter(c => c.exact);
  if (exact.length === 1) return exact[0].id;
  if (exact.length > 1) return undefined;
  if (role.source === 'own' && own.length === 1) return own[0].id;
  return undefined;
}
/** The first bindings of a new card on a chosen device: every unambiguous field; nothing else. */
export function suggestBindings(reg: Registry, p: Profile, deviceId?: string): Record<string, string> {
  const dev = deviceId ? reg.devices.find(d => d.id === deviceId) : undefined, out: Record<string, string> = {};
  for (const r of p.roles) { const s = suggestion(candidates(reg, r, { deviceId, areaId: dev?.area_id ?? null }), r); if (s) out[r.id] = s; }
  return out;
}
/** The room bindings a scheme suggests for one area: the area's own head and its air sensor; the timer and the temperatures by the head's name. */
export function suggestRoom(reg: Registry, p: Profile, areaId: string): Record<string, string> {
  const out: Record<string, string> = {}, roles = p.roomRoles ?? [];
  const heads = candidates(reg, roles.find(r => r.id === 'trv')!, { areaId }).filter(c => c.areaId === areaId && /_trv$|trv|головк|radiator/i.test(`${c.id} ${c.name}`));
  if (heads.length !== 1) return out;
  out.trv = heads[0].id; const key = heads[0].id.slice('climate.'.length).replace(/_trv$/, '');
  const air = candidates(reg, roles.find(r => r.id === 'air')!, { areaId }).filter(c => c.areaId === areaId);
  const preferred = air.filter(c => /_climate_temperature$|_co2_temperature$/.test(c.id));
  if (preferred.length === 1) out.air = preferred[0].id; else if (air.length === 1) out.air = air[0].id;
  for (const [role, id] of [['timer', `timer.${key}_heating_override`], ['overrideTemp', `input_number.${key}_heating_override_temp`], ['manualTemp', `input_number.${key}_heating_manual_temp`]] as const) if (reg.states[id]) out[role] = id;
  return out;
}

// ---- what the house shows: an instance as a card ----
export interface InstanceView { id: string; instance: ProfileInstance; profile: Profile; device: HomeDevice;
  /** bound fields whose entity is gone or silent: the card says so and offers a replacement, it never takes another sensor in their place */ lost: string[];
  /** the required fields that have no binding: the card is not drawn for the residents */ incomplete: string[] }
const kindOf = (reg: Registry, id: string): Kind | null => { const e = reg.entities.find(x => x.entity_id === id); return e ? entityKind(e, reg.states[id]) : null; };
const refOf = (reg: Registry, id: string): EntityRef | null => { const e = reg.entities.find(x => x.entity_id === id); if (!e) return null; return entityRefOf(e, reg.states[id], kindOf(reg, id)); };
/** The card a profile instance draws, as a household device of the panel: its main control, then the readings and the settings that were
 * bound — and only those. A field left empty is a function the card does not have. */
export function instanceView(reg: Registry, id: string, inst: ProfileInstance, roomName: (areaId: string) => string | null = () => null, list: Profile[] = PROFILES, label?: (key: string) => string): InstanceView | null {
  const profile = profileById(inst.profileId, list); if (!profile) return null;
  const lost: string[] = [], incomplete: string[] = [];
  const isLost = (eid: string) => { const s = reg.states[eid]; return !s || s.state === 'unavailable' || !reg.entities.some(e => e.entity_id === eid && !e.disabled_by); };
  for (const r of profile.roles) { const b = inst.bindings[r.id]; if (!b) { if (r.required) incomplete.push(r.id); continue; } if (isLost(b)) lost.push(r.id); }
  for (const room of inst.rooms ?? []) for (const r of profile.roomRoles ?? []) { const b = room.bindings[r.id]; if (!b) { if (r.required) incomplete.push(`${room.id}.${r.id}`); continue; } if (isLost(b)) lost.push(`${room.id}.${r.id}`); }
  const anchorId = inst.bindings[profile.anchor ?? ''];
  const primary = anchorId ? refOf(reg, anchorId) : null;
  const ghost: EntityRef = { id: anchorId ?? `${profile.kind}.none`, domain: anchorId ? domainOf(anchorId) : profile.kind, deviceClass: null, name: '', kind: profile.kind, state: 'unavailable', attributes: {}, unit: null, available: false, lastChanged: '' };
  const p = primary ?? ghost;
  // a reading is called by its field («Ресурс фильтра»), not by the integration's name («Filter Filter Life Level»)
  const pick = (as: RoleSpec['as']) => profile.roles.filter(r => r.as === as && inst.bindings[r.id]).map(r => { const x = refOf(reg, inst.bindings[r.id]); return x && label ? { ...x, name: label(r.labelKey) } : x; }).filter((x): x is EntityRef => !!x);
  const dev = inst.deviceId ? reg.devices.find(d => d.id === inst.deviceId) : (anchorId ? reg.devices.find(d => d.id === reg.entities.find(e => e.entity_id === anchorId)?.device_id) : undefined);
  const anchorEnt = anchorId ? reg.entities.find(e => e.entity_id === anchorId) : undefined;
  const roomId = inst.roomId ?? dev?.area_id ?? areaOf(reg, anchorEnt) ?? NO_ROOM;
  const name = inst.name ?? (typeof p.attributes.friendly_name === 'string' ? stripRoom(p.attributes.friendly_name, roomName(roomId)) : null) ?? dev?.name ?? id;
  const device: HomeDevice = {
    key: instanceKey(id), kind: profile.kind, name, roomId, icon: profile.icon ?? null, photo: null, art: null, favorite: inst.placement.includes('home'), order: 0, enabled: true,
    available: !!primary && primary.available, primary: { ...p, name }, controls: primary ? [{ ...p, name }] : [], metrics: pick('metric'), parameters: pick('parameter'), diagnostics: [],
    manufacturer: dev?.manufacturer ?? null, model: dev?.model ?? null, haDeviceId: dev?.id ?? null, section: profile.kind === 'climate' ? 'climate' : 'systems',
  };
  return { id, instance: inst, profile, device, lost, incomplete };
}
/** «Гостиная · Очиститель воздуха» on the Living room's card is «Очиститель воздуха»: the room stands beside it. */
const stripRoom = (n: string, room: string | null) => { const parts = n.split(' · '); return parts.length > 1 && (!room || parts[0].trim() === room) ? parts.slice(1).join(' · ').trim() : n; };
/** Every instance of the house this panel can draw, with the problems of each. Unknown profiles (a newer panel's) are skipped, not lost. */
export function instanceViews(reg: Registry, all: Record<string, ProfileInstance>, roomName?: (areaId: string) => string | null, list: Profile[] = PROFILES, label?: (key: string) => string): InstanceView[] {
  return Object.entries(all).map(([id, inst]) => instanceView(reg, id, inst, roomName, list, label)).filter((v): v is InstanceView => !!v);
}
/** The entities an instance takes from the auto-made cards, so that a profile that already represents an appliance never stands beside its old
 * tile: every entity of its own HA device and its bound ones of that device. An external sensor bound on purpose stays where it was. */
export function instanceClaims(reg: Registry, all: Record<string, ProfileInstance>, list: Profile[] = PROFILES): Set<string> {
  const out = new Set<string>();
  for (const inst of Object.values(all)) {
    const profile = profileById(inst.profileId, list); if (!profile) continue;
    if (inst.deviceId) for (const e of reg.entities) if (e.device_id === inst.deviceId) out.add(e.entity_id);
    if (profile.renderer !== 'device') { const a = inst.bindings[profile.anchor ?? '']; if (a) out.add(a); for (const r of inst.rooms ?? []) if (r.bindings.trv) out.add(r.bindings.trv); }
  }
  return out;
}
/** The value a candidate shows in the form: its state with its unit, words for on/off. */
export const candidateValue = (c: Pick<Candidate, 'value' | 'unit'>) => unavailable(c.value) ? '' : `${c.value}${c.unit ? ` ${c.unit}` : ''}`;
