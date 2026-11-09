/* A room as its owner sees it (docs/ROOM.md, 09.11.2026): one strip of readings, the room's own climate, a card per real device, who draws the power.
 * Pure: reads the registry and the live states, never writes. HA devices, not entities: a kettle is one card, not its eleven switches;
 * a plug or a meter that powers a device of the room gives that device its watts instead of a card of its own. */
import type { Registry, EntityRow } from './registry.ts';
import { airRooms, toneOf, type Tone, type HumidityScale } from './air.ts';
import type { Heating, HeatRoom } from './heating.ts';
import type { Vacuum } from './vacuum.ts';

export type Metric = 'temperature' | 'humidity' | 'co2' | 'pm25';
export interface Num { id: string; value: number | null; tone: Tone }
export interface Binary { ids: string[]; on: string[]; unknown: boolean; since: number | null }
export interface Readings { temperature: Num | null; humidity: Num | null; co2: Num | null; pm25: Num | null; lux: Num | null; motion: Binary | null; windows: Binary | null; door: Binary | null; leak: Binary | null; gas: Binary | null; scale: HumidityScale }
export type ThingKind = 'light' | 'kettle' | 'feeder' | 'fountain' | 'fridge' | 'tv' | 'speaker' | 'player' | 'vacuum' | 'washer' | 'dryer' | 'camera' | 'purifier' | 'humidifier' | 'vent' | 'airfryer' | 'boiler' | 'valve' | 'socket' | 'other';
export interface Thing {
  key: string; kind: ThingKind; name: string; model: string | null; available: boolean;
  /** the entity a tap switches, if the device has one worth a tap */ main: string | null; on: boolean | null;
  /** watts now and kWh today, its own or its plug's */ power: number | null; today: number | null; powerIds: string[];
  /** every entity of the device, for its sentence */ ids: string[];
}
export interface Consumer { key: string; name: string; power: number; today: number | null }
export interface RoomModel { id: string; readings: Readings; heat: HeatRoom | null; air: Thing[]; things: Thing[]; consumers: Consumer[]; total: number | null; vacuum: { linked: boolean } | null }

const CONTROL = /^(light|switch|fan|media_player|vacuum|water_heater|humidifier|camera|valve|cover|lock)\./;
const INFRA = /zigbee-роутер|slzb|router|роутер|mi hub|шлюз|ebus|bridge|мост/i; // by the name only: a «Zigbee smart plug» model is a plug
const val = (reg: Registry, id: string | null | undefined) => { const s = id ? reg.states[id] : undefined; if (!s) return null; const v = Number(s.state); return Number.isFinite(v) ? v : null; };
const dcOf = (reg: Registry, e: EntityRow) => (reg.states[e.entity_id]?.attributes.device_class as string | undefined) ?? e.device_class ?? null;
const live = (reg: Registry, id: string) => { const s = reg.states[id]?.state; return s !== undefined && s !== 'unavailable'; };
/** «Гостиная · Розетка Apple TV (Xiaomi)» → «Розетка Apple TV»: the room and the model are said elsewhere. */
export const plainName = (raw: string, room: string) => { let n = raw.replace(/\s*\([^)]*\)\s*/g, ' ').replace(/\s+/g, ' ').trim(); const r = room.toLowerCase(); for (const sep of [' · ', ' — ']) { if (n.toLowerCase().startsWith(r + sep)) n = n.slice(r.length + sep.length); } return n; };
const GEN: Record<string, string> = { 'холодильника': 'Холодильник', 'чайника': 'Чайник', 'котла': 'Котёл', 'монитора': 'Монитор', 'компьютера': 'Компьютер', 'ибп': 'ИБП', 'телевизора': 'Телевизор', 'увлажнителя': 'Увлажнитель', 'очистителя': 'Очиститель' };
/** what a plug or a meter powers, from its own name: «Розетка холодильника», «Счётчик энергии (телевизор)» */
const poweredBy = (raw: string): string | null => { const m = raw.match(/\(([^)]*)\)\s*$/); if (/счётчик|счетчик|meter/i.test(raw) && m) return m[1]; const p = raw.replace(/^.*·\s*/, '').match(/^(?:розетка|реле)\s+(.+?)(?:\s*\(.*)?$/i); if (p && m && /^(xiaomi|sonoff|tapo|tuya|aqara)$/i.test(p[1])) return m[1]; /* «Розетка Xiaomi (Apple TV)» */ return p ? p[1] : null; };
const stem = (w: string) => w.toLowerCase().replace(/ё/g, 'е').slice(0, 5);
const kindOf = (name: string, ids: string[], model: string): ThingKind => {
  const s = `${name} ${model} ${ids.join(' ')}`;
  if (ids.some(i => i.startsWith('vacuum.'))) return 'vacuum';
  if (ids.some(i => i.startsWith('valve.'))) return 'valve';
  if (/kettle|чайник/i.test(s)) return 'kettle';
  if (/feeder|кормушк/i.test(s)) return 'feeder';
  if (/fountain|поилк/i.test(s)) return 'fountain';
  if (/fridge|холодильн/i.test(s)) return 'fridge';
  if (/purifier|очистител/i.test(s)) return 'purifier';
  if (ids.some(i => i.startsWith('humidifier.')) || /увлажнител/i.test(s)) return 'humidifier';
  if (/(^|[._\s])(vent|exhaust|hood)([._\s]|$)|вытяжк|вентилятор/i.test(s)) return 'vent';
  if (/washer|стиральн/i.test(s)) return 'washer';
  if (/dryer|сушильн/i.test(s)) return 'dryer';
  if (/airfryer|аэрогрил/i.test(s)) return 'airfryer';
  if (/boiler|котл|котёл/i.test(s)) return 'boiler';
  if (ids.some(i => i.startsWith('camera.')) && !/yandex|lyrics/i.test(s)) return 'camera';
  if (ids.some(i => i.startsWith('light.'))) return 'light';
  if (/yandex|станци|колонк|speaker/i.test(s)) return 'speaker';
  if (/apple tv|приставк|stick|chromecast/i.test(s)) return 'player';
  if (/\btv\b|телевизор|_tv/i.test(s)) return 'tv';
  if (ids.some(i => i.startsWith('switch.'))) return 'socket';
  return 'other';
};
const MAIN: Partial<Record<ThingKind, RegExp>> = { valve: /^valve\./, kettle: /^switch\..*kettle_power$/, fountain: /^switch\..*_pump$/, light: /^light\.(?!.*_ambient)/, tv: /^media_player\./, speaker: /^media_player\./, player: /^media_player\./, purifier: /^fan\./, humidifier: /^humidifier\./, vent: /^(fan|switch)\./, fridge: /^switch\./, socket: /^switch\./, washer: /^switch\..*socket$/, dryer: /^switch\..*socket$/, boiler: /^switch\./ };

export function readRoom(reg: Registry, roomId: string, roomName: string, heating: Heating | null, vacuum: Vacuum | null, now = Date.now()): RoomModel {
  const devById = new Map(reg.devices.map(d => [d.id, d]));
  const rows = reg.entities.filter(e => !e.disabled_by && !e.hidden_by && !e.entity_category && (e.area_id ?? (e.device_id ? devById.get(e.device_id)?.area_id : null)) === roomId && reg.states[e.entity_id] && !/_lyrics$/.test(e.entity_id)); // a speaker's lyrics «camera» is not a camera
  // readings: the Air card's own choice of sensor per room (docs/AIR.md), so the strip and «Воздух» never disagree
  const air = airRooms(reg, [{ id: roomId, name: roomName }])[0];
  const num = (m: Metric, r: { entity: string; value: number | null } | null): Num | null => r ? { id: r.entity, value: r.value, tone: r.value === null ? 'ok' : toneOf(m, r.value, air?.scale ?? 'room') } : null;
  const bin = (test: (e: EntityRow, dc: string | null) => boolean): Binary | null => { const list = rows.filter(e => e.entity_id.startsWith('binary_sensor.') && test(e, dcOf(reg, e))); if (!list.length) return null; const st = list.map(e => reg.states[e.entity_id]); const on = list.filter(e => reg.states[e.entity_id].state === 'on').map(e => e.entity_id); const since = Math.max(...st.map(s => Date.parse(s.last_changed) || 0)); return { ids: list.map(e => e.entity_id), on, unknown: st.every(s => s.state === 'unknown' || s.state === 'unavailable'), since: since || null }; };
  const luxRow = rows.find(e => e.entity_id.startsWith('sensor.') && dcOf(reg, e) === 'illuminance');
  const readings: Readings = {
    temperature: num('temperature', air?.temperature ?? null), humidity: num('humidity', air?.humidity ?? null), co2: num('co2', air?.co2 ?? null), pm25: num('pm25', air?.pm25 ?? null),
    lux: luxRow ? { id: luxRow.entity_id, value: val(reg, luxRow.entity_id), tone: 'ok' } : null,
    motion: bin((e, dc) => ['motion', 'occupancy', 'presence'].includes(dc ?? '') && !/_zone_\d/.test(e.entity_id)),
    windows: bin((e, dc) => (dc === 'window' || (dc === 'opening' && /window|okn/.test(e.entity_id)))),
    door: bin((e, dc) => ['door', 'opening'].includes(dc ?? '') && /door|dver/.test(e.entity_id)),
    leak: bin((_, dc) => dc === 'moisture'), gas: bin((_, dc) => dc === 'gas'), scale: air?.scale ?? 'room',
  };
  // devices
  const groups = new Map<string, EntityRow[]>();
  for (const e of rows) { const k = e.device_id ?? e.entity_id; (groups.get(k) ?? groups.set(k, []).get(k)!).push(e); }
  const things: Thing[] = [], meters: Array<{ target: string | null; thing: Thing }> = [];
  for (const [key, list] of groups) {
    const d = devById.get(key), raw = d ? ((d as { name_by_user?: string | null }).name_by_user ?? d.name ?? '') : (reg.states[list[0].entity_id]?.attributes.friendly_name as string ?? list[0].entity_id), ids = list.map(e => e.entity_id);
    if (/\bspm\b|ввод/i.test(`${raw} ${d?.model ?? ''}`)) continue; // the house's mains belong to «Энергия», never to a room's cards
    if (INFRA.test(raw) || ids.some(i => i.startsWith('climate.')) || /котл|котёл|boiler/i.test(raw)) continue; // the hub's own relays; the radiator heads and the boiler belong to the heating
    if (list.some(e => e.entity_id.startsWith('binary_sensor.') && ['gas', 'moisture', 'window', 'door', 'opening', 'smoke'].includes(dcOf(reg, e) ?? ''))) continue; // a detector with a test switch is still a detector: the strip // the hub's own relays; the radiator heads live in the climate block
    if (/док-станц|dock/i.test(raw) && vacuum) continue; // the dock is part of the robot
    const powerId = ids.find(i => i.startsWith('sensor.') && reg.states[i]?.attributes.device_class === 'power' && !/_est$/.test(i)) ?? ids.find(i => i.startsWith('sensor.') && reg.states[i]?.attributes.device_class === 'power') ?? null;
    const todayId = ids.find(i => /_energy_today$/.test(i)) ?? null;
    const controls = ids.filter(i => CONTROL.test(i));
    if (!controls.length && !powerId) continue; // a pure sensor speaks in the strip
    const name = plainName(raw, roomName), kind = kindOf(name, ids, d?.model ?? '');
    const mainRe = MAIN[kind], main = mainRe ? ids.find(i => mainRe.test(i)) ?? null : null;
    const t: Thing = { key, kind, name, model: d?.model ?? null, available: ids.some(i => live(reg, i)), main, on: main ? ['on', 'playing', 'paused', 'idle', 'cleaning'].includes(reg.states[main]?.state ?? '') && reg.states[main]?.state !== 'off' : null, power: val(reg, powerId), today: val(reg, todayId), powerIds: powerId ? [powerId] : [], ids };
    const target = poweredBy(raw);
    if (target && (/розетк|счётчик|счетчик|реле/i.test(name))) meters.push({ target, thing: t }); else things.push(t);
  }
  for (const { target, thing } of meters) {
    const words = target!.split(/\s+/).filter(w => w.length > 2).map(stem);
    const score = (t: Thing) => words.filter(w => t.name.toLowerCase().replace(/ё/g, 'е').includes(w) || (w.startsWith('пылес') && t.kind === 'vacuum')).length * 2 + (t.main ? 1 : 0);
    const host = things.filter(t => score(t) > 1).sort((a, b) => score(b) - score(a))[0];
    if (host) { host.power = (host.power ?? 0) + (thing.power ?? 0); host.today = thing.today !== null ? (host.today ?? 0) + thing.today : host.today; host.powerIds.push(...thing.powerIds); host.available ||= thing.available; if (!host.main && thing.main) { host.main = thing.main; host.on = thing.on; } continue; }
    const w = target!.toLowerCase().split(/\s+/)[0]; thing.name = GEN[w] ?? (target![0].toUpperCase() + target!.slice(1)); thing.kind = kindOf(thing.name, thing.ids, ''); if (thing.kind === 'other') thing.kind = 'socket';
    things.push(thing);
  }
  for (let i = things.length - 1; i >= 0; i--) { const twin = things.findIndex((t, j) => j < i && t.name === things[i].name); if (twin >= 0) { const a = things[twin], b = things[i]; a.ids.push(...b.ids); a.main ??= b.main; a.available ||= b.available; things.splice(i, 1); } } // one camera, two HA devices
  const ORDER: ThingKind[] = ['light', 'vacuum', 'kettle', 'feeder', 'fountain', 'airfryer', 'tv', 'player', 'speaker', 'washer', 'dryer', 'fridge', 'valve', 'camera', 'boiler', 'socket', 'other'];
  const airKinds: ThingKind[] = ['purifier', 'humidifier', 'vent'];
  const sorted = things.sort((a, b) => ORDER.indexOf(a.kind) - ORDER.indexOf(b.kind) || a.name.localeCompare(b.name, 'ru'));
  const consumers = sorted.filter(t => t.power !== null && t.available).map(t => ({ key: t.key, name: t.name, power: t.power!, today: t.today })).sort((a, b) => b.power - a.power);
  const total = consumers.length ? consumers.reduce((s, c) => s + c.power, 0) : null;
  void now;
  return {
    id: roomId, readings, heat: heating?.rooms.find(r => r.areaId === roomId) ?? null,
    air: sorted.filter(t => airKinds.includes(t.kind)), things: sorted.filter(t => !airKinds.includes(t.kind) && (t.kind !== 'vacuum' || !vacuum)),
    consumers, total, vacuum: vacuum ? { linked: vacuum.rooms.some(r => r.areaId === roomId) } : null,
  };
}
/** The worst reading of the room, red over yellow (owner, 06.11.2026): what the strip says first. */
export function worst(r: Readings): { metric: Metric; tone: Tone; value: number } | null {
  const list = (['co2', 'pm25', 'humidity', 'temperature'] as Metric[]).map(m => ({ m, n: r[m] })).filter(x => x.n && x.n.value !== null && x.n.tone !== 'ok');
  const pick = list.find(x => x.n!.tone === 'bad') ?? list[0]; return pick ? { metric: pick.m, tone: pick.n!.tone, value: pick.n!.value! } : null;
}
