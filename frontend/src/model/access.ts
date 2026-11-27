/** Who sees which building (owner, 27.11.2026; docs/ACCESS.md). The split is the INTERFACE's, the owner's decision: Home Assistant itself,
 * its app, the history and the logbook still show everything, and the server checks nothing here. A building is a floor of Home Assistant,
 * its rooms are the floor's areas. A role is a template — which pages and cards it shows and what may be pressed — and a person gets a role
 * per building (or one role for every building). A named screen of the house (a layout profile, «Планшет бухгалтерия») may be bound to a
 * building and a role: on that screen the binding decides, whoever is signed in — except an administrator, who always sees everything.
 *
 * Everything here is pure: the shell (ui/access-gate.tsx) scopes the registry, the settings and the commands with it; tests/access.test.ts. */
import type { Registry, AreaRow, FloorRow, EntityRow, DeviceRow } from './registry.ts';
import { domainOf } from './registry.ts';
import type { HouseConfig, Alarm, CustomButton, DeviceOverride } from './config.ts';
import type { HomeDevice } from './discover.ts';

export type AccessMode = 'full' | 'lights' | 'view';
export const ACCESS_MODES: readonly AccessMode[] = ['full', 'lights', 'view'];
/** The pages a role may show; «Обзор» and «Комнаты» are always there (as «Настройка → Разделы» never hides them). */
export const ACCESS_SECTIONS = ['lights', 'systems', 'climate', 'cleaning', 'camera', 'energy', 'security'] as const;
export type AccessSection = typeof ACCESS_SECTIONS[number];
/** The panel's own cards a role may show. Without `cameras` no camera of its buildings is shown; without `security` no alarm panel
 * (Alarmo) and no «Безопасность»; without `energy` no «Энергия»; without `clock` the clock is a plain clock (no timers, no alarms);
 * without `climate` no «Климат» and no boiler card. */
export const ACCESS_MODULES = ['cameras', 'security', 'energy', 'clock', 'climate'] as const;
export type AccessModule = typeof ACCESS_MODULES[number];
export interface AccessRole { /** '' — the ready role's own name in the panel's language (access.role.<id>) */ name: string; sections: AccessSection[]; modules: AccessModule[]; mode: AccessMode }
/** A person: one role for every building (`all`, the areas without a building included) or a role per building; `until` — the last day (the house's). */
export interface AccessMember { all?: boolean; role?: string; buildings?: Record<string, string>; until?: string }
/** A named screen (layout profile) bound to a building and a role. */
export interface AccessProfile { building: string; role: string }
export interface AccessConfig {
  enabled: boolean;
  /** what a person the settings do not name sees: nothing, or `defaultBuilding` with `defaultRole` */ newUsers: 'none' | 'default';
  defaultBuilding?: string; defaultRole?: string;
  roles: Record<string, AccessRole>; members: Record<string, AccessMember>; profiles: Record<string, AccessProfile>;
}
/** The areas without a floor («Двор»): no building of their own; only a person with «Все здания» sees them. */
export const NO_BUILDING = '_none';
/** The room id of «Без комнаты» (model/discover.ts NO_ROOM; not imported, to keep this file free of the house model). */
const NO_ROOM_ID = 'none';
/** The switcher's «Все здания» choice. */
export const ALL_BUILDINGS = '*';

const ALL_SECTIONS = [...ACCESS_SECTIONS], ALL_MODULES = [...ACCESS_MODULES];
/** The ready roles (they can be changed and copied). The names are the panel's words: `name: ''`. */
export const DEFAULT_ROLES: Readonly<Record<string, AccessRole>> = {
  manager: { name: '', sections: ALL_SECTIONS, modules: ALL_MODULES, mode: 'full' },
  staff: { name: '', sections: ['lights', 'systems', 'climate'], modules: ['clock', 'climate'], mode: 'full' },
  guard: { name: '', sections: ['lights', 'systems', 'camera', 'security'], modules: ['cameras', 'security', 'clock'], mode: 'full' },
  tablet: { name: '', sections: ['lights', 'climate'], modules: ['clock', 'climate'], mode: 'lights' },
  guest: { name: '', sections: [], modules: [], mode: 'view' },
};
export const defaultRoles = (): Record<string, AccessRole> => structuredClone(DEFAULT_ROLES) as Record<string, AccessRole>;
export const defaultAccess = (): AccessConfig => ({ enabled: false, newUsers: 'none', roles: defaultRoles(), members: {}, profiles: {} });

const plain = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const KEY = /^[\w.:\-]{1,64}$/;
const USER = /^[A-Za-z0-9_-]{1,64}$/;
const PROFILE = /^[a-z0-9][a-z0-9_-]{0,39}$/;
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const key = (v: unknown) => typeof v === 'string' && KEY.test(v) ? v : undefined;
/** The stored `access`, made safe; undefined when there is none (a house that never opened «Acces» saves exactly what it saved before). */
export function normaliseAccess(raw: unknown): AccessConfig | undefined {
  if (!plain(raw)) return undefined;
  const roles: Record<string, AccessRole> = {};
  if (plain(raw.roles)) for (const [id, r] of Object.entries(raw.roles).slice(0, 32)) {
    if (!KEY.test(id) || !plain(r)) continue;
    roles[id] = { name: typeof r.name === 'string' ? r.name.trim().slice(0, 40) : '', sections: Array.isArray(r.sections) ? ACCESS_SECTIONS.filter(s => (r.sections as unknown[]).includes(s)) : [], modules: Array.isArray(r.modules) ? ACCESS_MODULES.filter(m => (r.modules as unknown[]).includes(m)) : [], mode: ACCESS_MODES.includes(r.mode as AccessMode) ? r.mode as AccessMode : 'view' };
  }
  const members: Record<string, AccessMember> = {};
  if (plain(raw.members)) for (const [id, m] of Object.entries(raw.members).slice(0, 500)) {
    if (!USER.test(id) || !plain(m)) continue;
    const out: AccessMember = {};
    if (m.all === true) out.all = true;
    const role = key(m.role); if (role) out.role = role;
    if (plain(m.buildings)) { const b = Object.fromEntries(Object.entries(m.buildings).filter(([f, r]) => KEY.test(f) && !!key(r)).slice(0, 64)) as Record<string, string>; if (Object.keys(b).length) out.buildings = b; }
    if (typeof m.until === 'string' && DAY.test(m.until)) out.until = m.until;
    members[id] = out;
  }
  const profiles: Record<string, AccessProfile> = {};
  if (plain(raw.profiles)) for (const [id, p] of Object.entries(raw.profiles).slice(0, 64)) { const b = plain(p) ? key(p.building) : undefined, r = plain(p) ? key(p.role) : undefined; if (PROFILE.test(id) && b && r) profiles[id] = { building: b, role: r }; }
  const out: AccessConfig = { enabled: raw.enabled === true, newUsers: raw.newUsers === 'default' ? 'default' : 'none', roles: Object.keys(roles).length ? roles : defaultRoles(), members, profiles };
  const db = key(raw.defaultBuilding), dr = key(raw.defaultRole); if (db) out.defaultBuilding = db; if (dr) out.defaultRole = dr;
  return out;
}
/** A device's «Кому видно»: the role ids, or undefined — everyone who has its room. */
export function normaliseRoles(raw: unknown): string[] | undefined {
  return Array.isArray(raw) ? [...new Set(raw.filter((x): x is string => typeof x === 'string' && KEY.test(x)))].slice(0, 32) : undefined;
}

/** Who looks at the panel: the signed-in Home Assistant user (or the one «Посмотреть глазами» shows) and the named screen it is on. */
export interface Viewer { id: string | null; admin: boolean; /** this screen's layout profile (layout-grid.tsx) */ profile?: string | null }
export type Access =
  | { kind: 'open' }
  | { kind: 'none'; why: 'unassigned' | 'expired' }
  | { kind: 'some'; /** building (floor id or NO_BUILDING) → role id */ buildings: Record<string, string>; via: 'member' | 'profile' | 'default' };
/** The house's buildings in Home Assistant's order (level, then name). */
export function buildingsOf(floors: readonly FloorRow[] | undefined): FloorRow[] {
  return [...(floors ?? [])].sort((a, b) => (a.level ?? 0) - (b.level ?? 0) || a.name.localeCompare(b.name));
}
/** What a viewer may see. `today` — the house's day (`dayKey(houseDate())`); `floorIds` — the buildings the house has now. */
export function resolveAccess(access: AccessConfig | undefined, viewer: Viewer, today: string, floorIds: readonly string[]): Access {
  if (!access?.enabled || viewer.admin) return { kind: 'open' };
  const roleOk = (r: string | undefined): r is string => !!r && !!access.roles[r];
  const prof = viewer.profile ? access.profiles[viewer.profile] : undefined;
  if (prof && roleOk(prof.role) && floorIds.includes(prof.building)) return { kind: 'some', buildings: { [prof.building]: prof.role }, via: 'profile' };
  const m = viewer.id ? access.members[viewer.id] : undefined;
  if (!m) return access.newUsers === 'default' && access.defaultBuilding && floorIds.includes(access.defaultBuilding) && roleOk(access.defaultRole) ? { kind: 'some', buildings: { [access.defaultBuilding]: access.defaultRole }, via: 'default' } : { kind: 'none', why: 'unassigned' };
  if (m.until && today > m.until) return { kind: 'none', why: 'expired' };
  if (m.all) return roleOk(m.role) ? { kind: 'some', buildings: Object.fromEntries([...floorIds, NO_BUILDING].map(f => [f, m.role!])), via: 'member' } : { kind: 'none', why: 'unassigned' };
  const b = Object.fromEntries(Object.entries(m.buildings ?? {}).filter(([f, r]) => floorIds.includes(f) && roleOk(r)));
  return Object.keys(b).length ? { kind: 'some', buildings: b, via: 'member' } : { kind: 'none', why: 'unassigned' };
}
/** The buildings the switcher offers (in the house's order; the areas without a building last), and «Все здания» when there are several. */
export function switchChoices(access: Extract<Access, { kind: 'some' }>, floors: readonly FloorRow[] | undefined): string[] {
  const own = [...buildingsOf(floors).map(f => f.floor_id), NO_BUILDING].filter(f => f in access.buildings);
  return own.length > 1 ? [...own, ALL_BUILDINGS] : own;
}
/** The building shown: the one chosen last on this screen if it is still allowed, else the first one. */
export function pickBuilding(choices: readonly string[], remembered: string | null | undefined): string {
  return remembered && choices.includes(remembered) ? remembered : choices[0] ?? ALL_BUILDINGS;
}

/** What one screen shows: the buildings (with their roles) on it now, and the roles themselves. */
export interface Scope { buildings: Record<string, string>; roles: Record<string, AccessRole> }
export function scopeOf(access: AccessConfig, granted: Extract<Access, { kind: 'some' }>, shown: string): Scope {
  const buildings = shown === ALL_BUILDINGS || !(shown in granted.buildings) ? granted.buildings : { [shown]: granted.buildings[shown] };
  return { buildings, roles: access.roles };
}
export const areaBuilding = (a: Pick<AreaRow, 'floor_id'>): string => a.floor_id || NO_BUILDING;
const union = <T extends string>(scope: Scope, pick: (r: AccessRole) => readonly T[]): Set<T> => new Set(Object.values(scope.buildings).flatMap(r => scope.roles[r] ? pick(scope.roles[r]) : []));
export const scopeSections = (scope: Scope) => union(scope, r => r.sections);
export const scopeModules = (scope: Scope) => union(scope, r => r.modules);
const RANK: Record<AccessMode, number> = { view: 0, lights: 1, full: 2 };
/** The widest mode among the buildings shown: for what belongs to no room (a timer of the clock, the house's helpers). */
export function scopeMode(scope: Scope): AccessMode { let best: AccessMode = 'view'; for (const r of Object.values(scope.buildings)) { const m = scope.roles[r]?.mode; if (m && RANK[m] > RANK[best]) best = m; } return best; }
/** Whether a device's «Кому видно» lets this role see it (no list — everyone who has its room). */
export const seenBy = (o: Pick<DeviceOverride, 'roles'> | undefined, role: string | undefined): boolean => !o?.roles || (!!role && o.roles.includes(role));
const CAMERA_MODULES = (id: string) => id.startsWith('camera_') || id === 'doorbell';
/** The panel's modules a scope hides (their settings get `enabled: false` on this screen). */
export function hiddenModules(scope: Scope, moduleIds: readonly string[]): string[] {
  const m = scopeModules(scope);
  return moduleIds.filter(id => (CAMERA_MODULES(id) && !m.has('cameras')) || (id === 'clock' && !m.has('clock')) || (id === 'boiler_ebus' && !m.has('climate')));
}
/** The pages a scope hides: those no role of it shows, and those of a card no role of it shows. */
export function hiddenSections(scope: Scope): AccessSection[] {
  const s = scopeSections(scope), m = scopeModules(scope), implied: Partial<Record<AccessSection, AccessModule>> = { camera: 'cameras', security: 'security', energy: 'energy', climate: 'climate' };
  return ACCESS_SECTIONS.filter(x => !s.has(x) || (implied[x] !== undefined && !m.has(implied[x]!)));
}

/** Where an entity stands for the split: the room the panel puts it in (the owner's move in «Устройства» first, then Home Assistant's area). */
export function entityArea(e: EntityRow, device: DeviceRow | undefined, devices: HouseConfig['devices']): string | null {
  return devices[`e:${e.entity_id}`]?.roomId ?? (e.device_id ? devices[`d:${e.device_id}`]?.roomId : undefined) ?? e.area_id ?? device?.area_id ?? null;
}
/** The building of a room id, and the role that building has on this screen (undefined: not shown). */
export function roomRole(scope: Scope, areaToBuilding: ReadonlyMap<string, string>, roomId: string | null): string | undefined {
  if (!roomId) return undefined; const b = areaToBuilding.get(roomId); return b === undefined ? undefined : scope.buildings[b];
}
export const areaIndex = (areas: readonly AreaRow[]) => new Map(areas.map(a => [a.area_id, areaBuilding(a)]));

/** The registry as this screen may see it. Kept: the areas of the buildings shown and their floors; an entity whose room is one of them
 * (less the cameras and alarm panels of a role without them — with their whole device —, a device whose «Кому видно» keeps it from the role,
 * and `drop` — the entities a module hidden here draws inside its own card, which must not come back as tiles); an entity of no room (the
 * house's helpers, people, the weather, the house's own meters, Alarmo) stays for the readings of the whole house, its cards are left out by
 * `deviceShown`. A device whose room is in another building goes with its entities and states. */
export function scopeRegistry(reg: Registry, scope: Scope, devicesCfg: HouseConfig['devices'], drop: ReadonlySet<string> = new Set()): Registry {
  const shape = scopeShape(reg, scope, devicesCfg, drop);
  return { ...reg, ...shape.rows, states: scopeStates(reg.states, shape.dropped) };
}
interface Shape { rows: Pick<Registry, 'areas' | 'devices' | 'entities' | 'floors'>; dropped: ReadonlySet<string> }
function scopeShape(reg: Registry, scope: Scope, devicesCfg: HouseConfig['devices'], drop: ReadonlySet<string>): Shape {
  const idx = areaIndex(reg.areas), devById = new Map(reg.devices.map(d => [d.id, d])), mods = (role: string | undefined) => role ? scope.roles[role]?.modules ?? [] : [...scopeModules(scope)];
  // a camera or an alarm panel a role does not show goes with its whole device: its motion switch, its privacy mode, its sensors would
  // otherwise come back as cards of their own (model/discover.ts builds the device anew from what is left)
  const roleOf = (e: EntityRow) => { const dev = e.device_id ? devById.get(e.device_id) : undefined, area = entityArea(e, dev, devicesCfg); return area && idx.has(area) ? roomRole(scope, idx, area) : undefined; };
  const unshown = (e: EntityRow) => { const dom = domainOf(e.entity_id), m = mods(roleOf(e)); return (dom === 'camera' && !m.includes('cameras')) || (dom === 'alarm_control_panel' && !m.includes('security')); };
  const goneDevices = new Set(reg.entities.filter(e => e.device_id && unshown(e)).map(e => e.device_id!));
  const dropped = new Set<string>(), keptDevices = new Set<string>();
  const entities = reg.entities.filter(e => {
    const dev = e.device_id ? devById.get(e.device_id) : undefined, area = entityArea(e, dev, devicesCfg);
    let ok: boolean;
    if (drop.has(e.entity_id) || (e.device_id && goneDevices.has(e.device_id))) ok = false;
    // what has no room is the house's own: the helpers, the people, the weather, the house's meters, Alarmo (its device has no room in a real
    // house) — kept for the house's readings, less a camera or an alarm panel no role shown shows. Its CARDS («Без комнаты») are the
    // administrator's: deviceShown leaves them out. A room id that is no area of the house (a room gone): not shown.
    else if (!area || area === NO_ROOM_ID || !idx.has(area)) ok = (!area || area === NO_ROOM_ID) && !unshown(e);
    else {
      // «Кому видно» of a whole device (`d:`) takes it out here; that of one card (`e:`) is the card's (deviceShown), so the device is not reshaped
      const role = roomRole(scope, idx, area);
      ok = role !== undefined && !unshown(e) && (!e.device_id || seenBy(devicesCfg[`d:${e.device_id}`], role)) && (!!e.device_id || seenBy(devicesCfg[`e:${e.entity_id}`], role));
    }
    if (!ok) dropped.add(e.entity_id); else if (e.device_id) keptDevices.add(e.device_id);
    return ok;
  });
  const areas = reg.areas.filter(a => areaBuilding(a) in scope.buildings);
  const devices = reg.devices.filter(d => keptDevices.has(d.id));
  const floors = reg.floors?.filter(f => f.floor_id in scope.buildings);
  return { rows: { areas, devices, entities, ...(reg.floors ? { floors } : {}) }, dropped };
}
function scopeStates(states: Registry['states'], dropped: ReadonlySet<string>): Registry['states'] {
  if (!dropped.size) return states;
  const out: Registry['states'] = {};
  for (const id in states) if (!dropped.has(id)) out[id] = states[id];
  return out;
}
/** `scopeRegistry` with a memory: the rows (areas, devices, entities, floors) are the very same arrays until the registry, the scope or the
 * settings of the devices change, so the house model answers from its own memory on a state change (model/discover.ts rememberDiscover). */
export function rememberScope(): (reg: Registry, scope: Scope, devicesCfg: HouseConfig['devices'], drop?: ReadonlySet<string>) => Registry {
  let last: { entities: unknown; devices: unknown; areas: unknown; floors: unknown; scope: string; cfg: unknown; drop: string; shape: Shape; states: Registry['states']; out: Registry } | null = null;
  return (reg, scope, devicesCfg, drop = new Set()) => {
    const s = JSON.stringify([scope.buildings, scope.roles]), d = [...drop].sort().join('|');
    if (last && last.entities === reg.entities && last.devices === reg.devices && last.areas === reg.areas && last.floors === reg.floors && last.scope === s && last.cfg === devicesCfg && last.drop === d) {
      if (last.states === reg.states && last.out.services === reg.services) return last.out;
      const out = { ...reg, ...last.shape.rows, states: scopeStates(reg.states, last.shape.dropped) };
      last = { ...last, states: reg.states, out }; return out;
    }
    const shape = scopeShape(reg, scope, devicesCfg, drop), out = { ...reg, ...shape.rows, states: scopeStates(reg.states, shape.dropped) };
    last = { entities: reg.entities, devices: reg.devices, areas: reg.areas, floors: reg.floors, scope: s, cfg: devicesCfg, drop: d, shape, states: reg.states, out };
    return out;
  };
}

/** A card of the house model on this screen: its room shown (no room — only the weather, which belongs to the whole house) and its
 * «Кому видно» keeps it for that room's role. The registry is scoped already; this catches what only the settings know (a card moved to a
 * room, a catalog card, the key of a sensor group). */
export function deviceShown(d: Pick<HomeDevice, 'key' | 'roomId' | 'kind' | 'haDeviceId'>, scope: Scope, areaToBuilding: ReadonlyMap<string, string>, devicesCfg: HouseConfig['devices']): boolean {
  if (!areaToBuilding.has(d.roomId)) return d.kind === 'weather';
  const role = roomRole(scope, areaToBuilding, d.roomId);
  return role !== undefined && seenBy(devicesCfg[d.key], role) && (!d.haDeviceId || seenBy(devicesCfg[`d:${d.haDeviceId}`], role));
}
const LIGHT_KINDS = ['light', 'switch', 'socket'];
/** Whether a role's mode lets a control be pressed: `full` — any; `lights` — lights, switches and sockets; `view` — none. */
export function modeAllows(mode: AccessMode | undefined, kindOrDomain: string | null | undefined): boolean {
  return mode === 'full' || (mode === 'lights' && !!kindOrDomain && LIGHT_KINDS.includes(kindOrDomain));
}
/** The control policy of a screen: may this entity be commanded (by the role of its room's building; an entity of no room — by the widest
 * mode shown). `kind` — the card's kind when the caller knows it (a socket is the `switch` domain). */
export function controlPolicy(reg: Pick<Registry, 'entities' | 'devices' | 'areas'>, scope: Scope, devicesCfg: HouseConfig['devices']): (entityId: string, kind?: string | null) => boolean {
  const idx = areaIndex(reg.areas), ents = new Map(reg.entities.map(e => [e.entity_id, e])), devs = new Map(reg.devices.map(d => [d.id, d])), wide = scopeMode(scope);
  return (id, kind) => {
    const e = ents.get(id), area = e ? entityArea(e, e.device_id ? devs.get(e.device_id) : undefined, devicesCfg) : null;
    const role = area ? roomRole(scope, idx, area) : undefined, mode = area ? (role ? scope.roles[role]?.mode : undefined) : wide;
    return modeAllows(mode, kind ?? domainOf(id));
  };
}
/** The entity ids a service call names (`entity_id` as a string or a list). */
export const callTargets = (data: Record<string, unknown> | undefined): string[] => { const v = data?.entity_id ?? (data?.target as Record<string, unknown> | undefined)?.entity_id; return typeof v === 'string' ? [v] : Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []; };

/** The settings as this screen draws them: the pages and cards the roles do not show are hidden, the owner's buttons that may not be pressed
 * here are gone, the alarms of other buildings' rooms are not listed. Never saved (ui/access-gate.tsx gives the panel a store that refuses it). */
export function scopeConfig(config: HouseConfig, scope: Scope, areaToBuilding: ReadonlyMap<string, string>, moduleIds: readonly string[], may: (entityId: string, kind?: string | null) => boolean): HouseConfig {
  const sections = { ...config.sections } as HouseConfig['sections'];
  for (const s of hiddenSections(scope)) (sections as Record<string, { hidden?: boolean }>)[s] = { hidden: true };
  const modules = { ...config.modules };
  for (const id of hiddenModules(scope, moduleIds)) modules[id] = { ...(modules[id] ?? {}), enabled: false };
  const roomOk = (room: string | undefined) => !room || roomRole(scope, areaToBuilding, room) !== undefined;
  const buttons = config.buttons.filter(b => buttonShown(b, scope, areaToBuilding, may));
  return { ...config, sections, modules, buttons, alarms: config.alarms.filter(a => roomOk(a.room) && !!a.room) };
}
function buttonShown(b: CustomButton, scope: Scope, idx: ReadonlyMap<string, string>, may: (entityId: string, kind?: string | null) => boolean): boolean {
  if (b.roomId && roomRole(scope, idx, b.roomId) === undefined) return false;
  const targets = [...callTargets(b.target), ...callTargets(b.data)];
  if (targets.length) return targets.every(id => may(id));
  // a script or a scene names no entity: only a role that may press anything presses it
  return modeAllows(b.roomId ? scope.roles[roomRole(scope, idx, b.roomId)!]?.mode : scopeMode(scope), null);
}
/** The alarms to save from a screen that lists only some of them: the ones it does not list, as the house holds them, and then its own list. */
export function mergeAlarms(house: readonly Alarm[], visible: readonly Alarm[], listed: (a: Alarm) => boolean): Alarm[] {
  const mine = new Set(visible.map(a => a.id));
  return [...house.filter(a => !listed(a) && !mine.has(a.id)), ...visible];
}

/** A user of Home Assistant as «Acces» lists them (`config/auth/list`, administrators only; system users are left out). */
export interface AccessUser { id: string; name: string; admin: boolean; active: boolean; localOnly: boolean }
export function accessUsers(raw: unknown): AccessUser[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter((u): u is Record<string, unknown> => plain(u) && typeof u.id === 'string' && u.system_generated !== true).map(u => ({
    id: String(u.id), name: typeof u.name === 'string' && u.name.trim() ? u.name.trim() : typeof u.username === 'string' ? u.username : String(u.id),
    // `is_admin` where Home Assistant gives it; the owner and the «system-admin» group are administrators too (components/config/auth.py)
    admin: u.is_admin === true || u.is_owner === true || (Array.isArray(u.group_ids) && u.group_ids.includes('system-admin')),
    active: u.is_active !== false, localOnly: u.local_only === true,
  })).sort((a, b) => Number(b.admin) - Number(a.admin) || a.name.localeCompare(b.name));
}
/** The starting point the switch-on offers: every present person who is not an administrator gets «Сотрудник» in every building, so nobody
 * loses the panel at once; the existing entries stay. */
export function starterAccess(access: AccessConfig | undefined, users: readonly AccessUser[]): AccessConfig {
  const base = access ? structuredClone(access) : defaultAccess();
  if (!base.roles.staff) base.roles.staff = structuredClone(DEFAULT_ROLES.staff) as AccessRole;
  for (const u of users) if (!u.admin && !base.members[u.id]) base.members[u.id] = { all: true, role: 'staff' };
  return { ...base, enabled: true };
}
/** A copy of a role under a new id («Копировать»). */
export function copyRole(roles: Record<string, AccessRole>, id: string, name: string): { id: string; roles: Record<string, AccessRole> } {
  let n = 2, next = `${id}_${n}`; while (roles[next]) next = `${id}_${++n}`;
  return { id: next, roles: { ...roles, [next]: { ...structuredClone(roles[id]), name } } };
}
/** What removing a role leaves: the people and screens that had it lose that building (never another role in its place). */
export function withoutRole(access: AccessConfig, id: string): AccessConfig {
  const roles = { ...access.roles }; delete roles[id];
  const members = Object.fromEntries(Object.entries(access.members).map(([u, m]) => { const b = Object.fromEntries(Object.entries(m.buildings ?? {}).filter(([, r]) => r !== id)); const next: AccessMember = { ...m, buildings: b }; if (m.role === id) { delete next.role; delete next.all; } if (!Object.keys(b).length) delete next.buildings; return [u, next]; }));
  const profiles = Object.fromEntries(Object.entries(access.profiles).filter(([, p]) => p.role !== id));
  return { ...access, roles, members, profiles, ...(access.defaultRole === id ? { defaultRole: undefined } : {}) };
}
