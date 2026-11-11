/* The «Air» card's arithmetic (docs/AIR.md): pure, testable under Node. A room's temperature and humidity are the sensors linked on its HA area and nothing else (owner, 06.11.2026), the source the Rooms screen reads.
 * CO₂ and PM2.5 are one sensor per room chosen by class and room, so a new one joins by itself; appliances never speak for the room. */
import type { Registry } from './registry.ts';
export type Tone = 'ok' | 'warn' | 'bad';
export type Metric = 'co2' | 'pm25' | 'humidity' | 'temperature';
/** The look of the card: as Tone, or «none» when the sensors say nothing and the air cannot be called good or bad. */
export type AirTone = Tone | 'none';
export interface Reading { entity: string; value: number | null; unit: string | null }
export type HumidityScale = 'room' | 'kitchen' | 'bath';
export interface AirRoom { id: string; name: string; excluded: boolean; scale: HumidityScale; allowed: AirActionKind[]; temperature: Reading | null; humidity: Reading | null; co2: Reading | null; pm25: Reading | null; voc: Reading | null; windows: string[]; windowOpen: boolean; purifier: string | null; purifierOn: boolean; /** reads exactly off: away or unknown is no such thing */ purifierOff: boolean; humidifier: string | null; vents: string[]; ventOn: boolean }
export interface Span { value: number | null; used: number; total: number; room: string | null }
export interface AirProblem { metric: Metric; tone: Tone; room: AirRoom; high: boolean; value: number }
export interface AirSummary { rooms: AirRoom[]; temperature: Span; humidity: Span; co2: Span; pm25: Span; problem: AirProblem | null; /** readings that have sensors and not one of them answers */ noData: Metric[]; tone: AirTone }
export interface AirOptions { average: string[]; excluded: string[]; bath: string[]; kitchen: string[]; /** what can be done in which room, by its vent; any other room gets numbers and words only (owner, 05.11.2026) */ actions: Record<string, AirActionKind[]> }
export const AIR_DEFAULTS: AirOptions = { average: ['gostinaia', 'detskaia', 'spalnia', 'kompiuternaia', 'kukhnia', 'vannaia'], excluded: ['sklad'], bath: ['vannaia'], kitchen: ['kukhnia', 'sklad'], actions: { kukhnia: ['dehumidify', 'purify'], sklad: ['dehumidify', 'purify'], vannaia: ['dehumidify'], kompiuternaia: ['dehumidify'] } };
const CLASS: Record<string, keyof Pick<AirRoom, 'temperature' | 'humidity' | 'co2' | 'pm25' | 'voc'>> = { temperature: 'temperature', humidity: 'humidity', carbon_dioxide: 'co2', pm25: 'pm25', volatile_organic_compounds: 'voc', volatile_organic_compounds_parts: 'voc', aqi: 'voc' };
/** A relay that drives a vent says so as a whole word: «prevent» on a feeder or a dryer is not a vent (found on the live house, 05.11.2026), nor are a hood's light or a relay's child lock. The server has the same rule. */
export const VENT_SWITCH = /^switch\.(?!(?:.*_)?(?:lights?|lamps?|led|lock|indicator|mode|backlight|svet|podsvetka|lampa|blokirovka|zamok|rezhim|indikator)(?:_|$))(?:[a-z0-9]+_)*(?:vent|ventilation|exhaust|hood|vytiazh[a-z]*|ventiliatsiia|ventiliator|ventilator|extractor|fan$)(?:_[a-z0-9]+)*$/;
const PURIFIER = /purifier|airp/i;
const APPLIANCE = /kettle|boiler|trv|chip|humidifier|fridge|oven|air_?fryer|water_heater|thermostat|ups|nas|router|printer|feeder|dryer|washer/i;
/** Humidity limits: GOST 30494-2011 allows 60 % in the heating season and 65 % in summer for a living room and sets none for a kitchen or a bathroom. The owner's house runs at 62–67 %, so a warning starts at 65 % and turns red at 70 %, where cold walls start to mould (owner, 05.11.2026, docs/AIR.md). */
export const HUMIDITY: Record<HumidityScale, { low: number | null; lowBad: number | null; warn: number; bad: number }> = { room: { low: 40, lowBad: 30, warn: 65, bad: 70 }, kitchen: { low: null, lowBad: null, warn: 70, bad: 80 }, bath: { low: null, lowBad: null, warn: 75, bad: 85 } };
/** The reading as the screen prints it. A limit is judged on this, so a yellow «65%» never stands beside a black «65%» (the server's `reached` too). */
export const shown = (metric: Metric, v: number) => metric === 'temperature' ? Number(v.toFixed(1)) : Math.round(v);
export const toneOf = (metric: Metric, value: number | null, scale: HumidityScale = 'room'): Tone => {
  if (value === null) return 'ok';
  const v = shown(metric, value);
  if (metric === 'co2') return v < 1200 ? 'ok' : v < 2000 ? 'warn' : 'bad';
  if (metric === 'pm25') return v <= 15 ? 'ok' : v <= 35 ? 'warn' : 'bad';
  if (metric === 'humidity') { const h = HUMIDITY[scale]; if (v >= h.bad || (h.lowBad !== null && v < h.lowBad)) return 'bad'; if (v >= h.warn || (h.low !== null && v < h.low)) return 'warn'; /* the upper limits belong to the bad side: exactly 65 % is «Влажно», owner, 06.11.2026 */ return 'ok'; }
  return v >= 19 && v <= 25 ? 'ok' : v >= 18 && v <= 26 ? 'warn' : 'bad';
};
/** Which side of its range a reading is out on, as printed: «Влажно» or «Сухо», «Жарко» or «Холодно». */
export const isHigh = (metric: Metric, v: number, scale: HumidityScale = 'room') => metric === 'humidity' ? shown(metric, v) >= HUMIDITY[scale].warn : metric === 'temperature' ? shown(metric, v) > 25 : true;
const toValue = (state: string | undefined) => { if (state === undefined || state === '' ) return null; const v = Number(state); return Number.isFinite(v) ? v : null; };
/** Rooms of the Air card in dashboard order. Temperature and humidity: the area's link, with no fallback; a link that says nothing is a reading with no value, no link is no reading. The rest is searched and ranked: the CO₂ device of the room first, then pure sensors, then a purifier; appliances are out. */
export function airRooms(reg: Registry, rooms: Array<{ id: string; name: string }>, opts: AirOptions = AIR_DEFAULTS): AirRoom[] {
  // one walk over the registry per call: this runs on every state change of the house, with some 1700 entities
  type Row = Registry['entities'][number];
  const deviceById = new Map(reg.devices.map(d => [d.id, d])), areaById = new Map(reg.areas.map(a => [a.area_id, a])), rowById = new Map<string, Row>(), domainsOf = new Map<string, Set<string>>(), roomRows = new Map<string, { live: Row[]; withDead: Row[] }>(), NONE = new Set<string>();
  for (const e of reg.entities) {
    rowById.set(e.entity_id, e);
    if (e.disabled_by) continue;
    if (e.device_id) { const seen = domainsOf.get(e.device_id) ?? new Set<string>(); seen.add(e.entity_id.split('.')[0]); domainsOf.set(e.device_id, seen); }
    if (e.hidden_by) continue;
    const area = e.area_id ?? (e.device_id ? deviceById.get(e.device_id)?.area_id : null); if (!area) continue;
    const bucket = roomRows.get(area) ?? { live: [], withDead: [] }; roomRows.set(area, bucket); bucket.withDead.push(e); /* a sensor HA has no state for yet still counts as dead */ if (reg.states[e.entity_id]) bucket.live.push(e);
  }
  const linked = (id: string | null | undefined): Reading | null => { if (!id) return null; const s = reg.states[id]; return { entity: id, value: toValue(s?.state), unit: (s?.attributes.unit_of_measurement as string | undefined) ?? rowById.get(id)?.unit ?? null }; };
  const present = new Set(rooms.map(r => r.id)), averageKnown = opts.average.some(a => present.has(a));
  return rooms.map(r => {
    const rows = roomRows.get(r.id) ?? { live: [], withDead: [] }, own = rows.live, dc = (id: string, row?: { device_class?: string | null }) => (reg.states[id]?.attributes.device_class as string | undefined) ?? row?.device_class ?? null;
    const co2Devices = new Set(own.filter(e => dc(e.entity_id, e) === 'carbon_dioxide').map(e => e.device_id));
    const domains = (device: string | null) => (device ? domainsOf.get(device) : null) ?? NONE, modelOf = (e: Row) => (e.device_id ? deviceById.get(e.device_id)?.model : null) ?? '';
    const appliance = (e: (typeof own)[number]) => APPLIANCE.test(e.entity_id) || APPLIANCE.test(modelOf(e)) || ['humidifier', 'climate', 'water_heater'].some(x => domains(e.device_id).has(x)) || e.entity_category === 'diagnostic';
    const rank = (e: (typeof own)[number]) => (co2Devices.has(e.device_id) ? 0 : domains(e.device_id).has('fan') ? 2 : 1);
    const pick = (slot: string) => { const c = rows.withDead.filter(e => e.entity_id.startsWith('sensor.') && CLASS[dc(e.entity_id, e) ?? ''] === slot && !appliance(e)).sort((a, b) => rank(a) - rank(b)); if (!c.length) return null; const alive = c.find(e => toValue(reg.states[e.entity_id]?.state) !== null) ?? c[0]; const s = reg.states[alive.entity_id]; return { entity: alive.entity_id, value: toValue(s?.state), unit: (s?.attributes.unit_of_measurement as string | undefined) ?? alive.unit ?? null }; };
    const windows = own.filter(e => e.entity_id.startsWith('binary_sensor.') && ['window', 'opening'].includes(dc(e.entity_id, e) ?? '')).map(e => e.entity_id);
    const isPurifier = (e: (typeof own)[number]) => PURIFIER.test(e.entity_id) || PURIFIER.test(modelOf(e)), purifier = own.find(e => e.entity_id.startsWith('fan.') && isPurifier(e))?.entity_id ?? null, humidifier = own.find(e => e.entity_id.startsWith('humidifier.'))?.entity_id ?? null;
    const vents = own.filter(e => !e.entity_category && !appliance(e) && !isPurifier(e) && (e.entity_id.startsWith('fan.') || VENT_SWITCH.test(e.entity_id))).map(e => e.entity_id);
    return { id: r.id, name: r.name, excluded: opts.excluded.includes(r.id), scale: (opts.bath.includes(r.id) ? 'bath' : opts.kitchen.includes(r.id) ? 'kitchen' : 'room') as HumidityScale, allowed: opts.actions[r.id] ?? [], temperature: linked(areaById.get(r.id)?.temperature_entity_id), humidity: linked(areaById.get(r.id)?.humidity_entity_id), co2: pick('co2'), pm25: pick('pm25'), voc: pick('voc'), windows, windowOpen: windows.some(w => reg.states[w]?.state === 'on'), purifier, purifierOn: !!purifier && reg.states[purifier]?.state === 'on', purifierOff: !!purifier && reg.states[purifier]?.state === 'off', humidifier, vents, ventOn: vents.some(v => reg.states[v]?.state === 'on') };
  }).filter(r => r.excluded ? !!(r.temperature || r.humidity || r.vents.length || r.pm25 || r.voc) : averageKnown ? opts.average.includes(r.id) || !!(r.co2 || r.pm25 || r.purifier || r.humidifier || r.vents.length) : !!(r.temperature || r.humidity || r.co2 || r.pm25 || r.purifier || r.humidifier || r.vents.length));
}
const mean = (rooms: AirRoom[], key: 'temperature' | 'humidity'): Span => { const all = rooms.filter(r => r[key]), used = all.filter(r => r[key]!.value !== null); return { value: used.length ? used.reduce((s, r) => s + r[key]!.value!, 0) / used.length : null, used: used.length, total: all.length, room: null }; };
const worst = (rooms: AirRoom[], key: 'co2' | 'pm25'): Span => { const all = rooms.filter(r => r[key]), used = all.filter(r => r[key]!.value !== null), top = used.reduce<AirRoom | null>((m, r) => !m || r[key]!.value! > m[key]!.value! ? r : m, null); return { value: top ? top[key]!.value : null, used: used.length, total: all.length, room: top?.name ?? null }; };
/** The tile's numbers and its one sentence. The excluded room never counts. Priority: a red reading before a yellow one (owner, 06.11.2026), then CO₂, PM2.5, humidity, temperature, then the furthest past its limit. */
let lastSummary: { states: Registry['states']; entities: Registry['entities']; devices: Registry['devices']; areas: Registry['areas']; rooms: string; opts: AirOptions; value: AirSummary } | null = null;
export function airSummary(reg: Registry, rooms: Array<{ id: string; name: string }>, opts: AirOptions = AIR_DEFAULTS): AirSummary {
  const roomsKey = rooms.map(r => `${r.id}=${r.name}`).join('|'); // the tile and the open sheet ask in the same draw
  if (lastSummary && lastSummary.states === reg.states && lastSummary.entities === reg.entities && lastSummary.devices === reg.devices && lastSummary.areas === reg.areas && lastSummary.rooms === roomsKey && lastSummary.opts === opts) return lastSummary.value;
  const list = airRooms(reg, rooms, opts), counted = list.filter(r => !r.excluded), six = rooms.some(r => opts.average.includes(r.id)) ? counted.filter(r => opts.average.includes(r.id)) : counted; // a CO₂ sensor in the hall shows in the rooms, it does not move the house's mean
  const problems: AirProblem[] = []; for (const metric of ['co2', 'pm25', 'humidity', 'temperature'] as Metric[]) for (const room of counted) { const v = room[metric]?.value ?? null; const tone = toneOf(metric, v, room.scale); if (v !== null && tone !== 'ok') problems.push({ metric, tone, room, value: v, high: isHigh(metric, v, room.scale) }); }
  const order: Metric[] = ['co2', 'pm25', 'humidity', 'temperature'], spread = (p: AirProblem) => p.metric === 'humidity' ? (p.high ? p.value - HUMIDITY[p.room.scale].warn : (HUMIDITY[p.room.scale].low ?? 0) - p.value) : p.metric === 'temperature' ? Math.abs(p.value - 22) : p.value;
  problems.sort((a, b) => (a.tone === b.tone ? 0 : a.tone === 'bad' ? -1 : 1) || order.indexOf(a.metric) - order.indexOf(b.metric) || spread(b) - spread(a));
  const problem = problems[0] ?? null;
  const spans = { temperature: mean(six, 'temperature'), humidity: mean(six, 'humidity'), co2: worst(counted, 'co2'), pm25: worst(counted, 'pm25') }, noData = order.filter(m => spans[m].total > 0 && spans[m].used === 0), silent = noData.length > 0 || order.every(m => !spans[m].total);
  const value: AirSummary = { rooms: list, ...spans, problem, noData, tone: problem?.tone ?? (silent ? 'none' : 'ok') }; // the look follows the sentence it stands behind; silence is not good air
  lastSummary = { states: reg.states, entities: reg.entities, devices: reg.devices, areas: reg.areas, rooms: roomsKey, opts, value };
  return value;
}
/** A name of one word declines; «в Главная спальне» is not Russian, so a longer one stands as it is, after a colon. */
export const declinable = (name: string) => !/\s/.test(name.trim());
/** «в Детской», «на Кухне». Other languages name the room as it is. */
export function inRoomRu(name: string): string { const n = name.trim(); if (/кухн/i.test(n)) return `на ${n.replace(/я$/, 'е')}`; if (/[жшчщц]ая$/.test(n)) return `в ${n.replace(/ая$/, 'ей')}`; if (/ая$/.test(n)) return `в ${n.replace(/ая$/, 'ой')}`; if (/ня$/.test(n)) return `в ${n.replace(/я$/, 'е')}`; if (/[бвгджзклмнпрстфхцчшщ]$/i.test(n)) return `в ${n}е`; return `в ${n}`; }

/** A button that fixes the problem and stops by itself once the reading is back to normal: always the room's vent, and only where the owner said it helps. */
export type AirActionKind = 'dehumidify' | 'purify';
export interface AirAction { kind: AirActionKind; roomId: string; device: string; sensor: string; target: number; blocked: 'offline' | null; value: number }
/** Where the vent stops. In the heating season outdoor air is dry once warm (Criuleni, November: about 31 %), so 60 % is within reach; in summer it brings 60–66 % itself, so 64 %, just under Влажно. The server decides by the same rule. */
export const airTarget = (kind: AirActionKind, now = new Date()) => kind === 'purify' ? 15 : now.getMonth() >= 4 && now.getMonth() <= 8 ? 64 : 60;
export type AirOutcome = 'no_start' | 'no_stop' | 'out_of_time';
/** A job from `air/tasks`. wasOn: the vent was on before it and stays on. stopping: over, and the vent still has to read off. outcome: this row is how a recent job ended, not a job. */
export interface AirTask { kind: AirActionKind; roomId: string; device: string; sensor: string; target: number; startedAt: number; wasOn?: boolean; stopping?: boolean; outcome?: AirOutcome }
/** The first off reading ends a no_stop row on the panel too, whatever the last list still says: remembered in `over`, so a vent switched on again brings nothing back. A later alarm has a new startedAt. Gives back the same array when nothing is dropped and `kept` when the same rows are left, so what watches the list does not run again for it. */
export function withoutEndedAlarms(tasks: AirTask[] | null, over: Set<string>, reg: Registry, kept: AirTask[] | null = null): AirTask[] | null {
  if (!tasks) return tasks;
  const key = (x: AirTask) => `${x.device}:${x.startedAt}`;
  for (const x of tasks) if (x.outcome === 'no_stop' && reg.states[x.device]?.state === 'off') over.add(key(x));
  const left = tasks.filter(x => x.outcome !== 'no_stop' || !over.has(key(x)));
  if (left.length === tasks.length) return tasks;
  return kept?.length === left.length && left.every((x, i) => x === kept[i]) ? kept : left;
}
/** A device that cannot be spoken to: HA has no state for it, or the state says nothing. */
export const deviceAway = (reg: Registry, id: string) => { const s = reg.states[id]?.state; return s === undefined || s === 'unavailable' || s === 'unknown'; };
export function airActions(room: AirRoom, reg: Registry, now = new Date()): AirAction[] {
  if (!room.allowed.length || !room.vents.length) return [];
  const offline = (id: string) => deviceAway(reg, id), vent = room.vents.find(v => !offline(v)) ?? room.vents[0], out: AirAction[] = [], hum = room.humidity?.value ?? null, pm = room.pm25?.value ?? null, blocked = offline(vent) ? 'offline' as const : null;
  if (room.ventOn) return []; // any vent of the room already running, whichever comes first in the registry: the server would send nothing and leave it on, so a button that promises to stop it would be untrue
  if (room.allowed.includes('dehumidify') && hum !== null && isHigh('humidity', hum, room.scale)) out.push({ kind: 'dehumidify', roomId: room.id, device: vent, sensor: room.humidity!.entity, target: airTarget('dehumidify', now), blocked, value: hum });
  if (room.allowed.includes('purify') && pm !== null && toneOf('pm25', pm) !== 'ok') out.push({ kind: 'purify', roomId: room.id, device: vent, sensor: room.pm25!.entity, target: airTarget('purify'), blocked, value: pm });
  return out;
}
/** A refused command in the owner's language: HA's and the server's messages are English. Returns the key of module.air; for «failed» the card
 * then asks `errorText` for the house's own reason (modules/air.tsx refusalText). */
export function airErrorKey(e: unknown): 'deviceOffline' | 'err.busy' | 'err.starting' | 'err.denied' | 'failed' {
  const { code, message } = (e ?? {}) as { code?: unknown; message?: unknown }, text = String(message ?? e ?? '');
  if (code === 'unauthorized' || /^unauthorized/i.test(text)) return 'err.denied';
  if (code === 'not_ready' || /is starting/i.test(text)) return 'err.starting';
  if (text === 'device offline') return 'deviceOffline';
  if (text === 'device busy') return 'err.busy';
  return 'failed';
}
