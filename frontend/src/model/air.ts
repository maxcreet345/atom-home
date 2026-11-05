/* The «Air» card's arithmetic (docs/AIR.md): pure, testable under Node. One sensor per room for each reading, chosen by class and room, so a new sensor joins by itself.
 * Appliances that happen to report a temperature (a kettle, a boiler, a humidifier reading 3–4 °C off) never speak for the room. */
import type { Registry } from './registry.ts';
export type Tone = 'ok' | 'warn' | 'bad';
export type Metric = 'co2' | 'pm25' | 'humidity' | 'temperature';
export interface Reading { entity: string; value: number | null; unit: string | null }
export type HumidityScale = 'room' | 'kitchen' | 'bath';
export interface AirRoom { id: string; name: string; excluded: boolean; scale: HumidityScale; allowed: AirActionKind[]; temperature: Reading | null; humidity: Reading | null; co2: Reading | null; pm25: Reading | null; voc: Reading | null; windows: string[]; windowOpen: boolean; purifier: string | null; purifierOn: boolean; humidifier: string | null; vents: string[]; ventOn: boolean }
export interface Span { value: number | null; used: number; total: number; room: string | null }
export interface AirProblem { metric: Metric; tone: Tone; room: AirRoom; high: boolean; value: number }
export interface AirSummary { rooms: AirRoom[]; temperature: Span; humidity: Span; co2: Span; pm25: Span; problem: AirProblem | null; tone: Tone }
export interface AirOptions { average: string[]; excluded: string[]; bath: string[]; kitchen: string[]; /** what can be done in which room, by its vent; any other room gets numbers and words only (owner, 05.11.2026) */ actions: Record<string, AirActionKind[]> }
export const AIR_DEFAULTS: AirOptions = { average: ['gostinaia', 'detskaia', 'spalnia', 'kompiuternaia', 'kukhnia', 'vannaia'], excluded: ['sklad'], bath: ['vannaia'], kitchen: ['kukhnia', 'sklad'], actions: { kukhnia: ['dehumidify', 'purify'], sklad: ['dehumidify', 'purify'], vannaia: ['dehumidify'], kompiuternaia: ['dehumidify'] } };
const CLASS: Record<string, keyof Pick<AirRoom, 'temperature' | 'humidity' | 'co2' | 'pm25' | 'voc'>> = { temperature: 'temperature', humidity: 'humidity', carbon_dioxide: 'co2', pm25: 'pm25', volatile_organic_compounds: 'voc', volatile_organic_compounds_parts: 'voc', aqi: 'voc' };
/** A relay that drives a vent says so as a whole word: «prevent» on a feeder or a dryer is not a vent (found on the live house, 05.11.2026), nor are a hood's light or a relay's child lock. The server has the same rule. */
export const VENT_SWITCH = /^switch\.(?!(?:.*_)?(?:light|lamp|led|lock|indicator|mode|backlight)(?:_|$))(?:[a-z0-9]+_)*(?:vent|ventilation|exhaust|hood|vytiazhka|vytiazh)(?:_[a-z0-9]+)*$/;
const PURIFIER = /purifier|airp/i;
const APPLIANCE = /kettle|boiler|trv|chip|humidifier|fridge|oven|air_?fryer|water_heater|thermostat|ups|nas|router|printer|feeder|dryer|washer/i;
/** Humidity limits: GOST 30494-2011 allows 60 % in the heating season and 65 % in summer for a living room and sets none for a kitchen or a bathroom. The owner's house runs at 62–67 %, so a warning starts at 65 % and turns red at 70 %, where cold walls start to mould (owner, 05.11.2026, docs/AIR.md). */
export const HUMIDITY: Record<HumidityScale, { low: number | null; lowBad: number | null; warn: number; bad: number }> = { room: { low: 40, lowBad: 30, warn: 65, bad: 70 }, kitchen: { low: null, lowBad: null, warn: 70, bad: 80 }, bath: { low: null, lowBad: null, warn: 75, bad: 85 } };
export const toneOf = (metric: Metric, v: number | null, scale: HumidityScale = 'room'): Tone => {
  if (v === null) return 'ok';
  if (metric === 'co2') return v < 1200 ? 'ok' : v < 2000 ? 'warn' : 'bad';
  if (metric === 'pm25') return v <= 15 ? 'ok' : v <= 35 ? 'warn' : 'bad';
  if (metric === 'humidity') { const h = HUMIDITY[scale]; if (v > h.bad || (h.lowBad !== null && v < h.lowBad)) return 'bad'; if (v > h.warn || (h.low !== null && v < h.low)) return 'warn'; return 'ok'; }
  return v >= 19 && v <= 25 ? 'ok' : v >= 18 && v <= 26 ? 'warn' : 'bad';
};
const toValue = (state: string | undefined) => { if (state === undefined || state === '' ) return null; const v = Number(state); return Number.isFinite(v) ? v : null; };
/** Rooms of the Air card in dashboard order. A sensor is ranked: the CO₂ device of the room first, then pure sensors, then a purifier; appliances are out. */
export function airRooms(reg: Registry, rooms: Array<{ id: string; name: string }>, opts: AirOptions = AIR_DEFAULTS): AirRoom[] {
  const deviceArea = new Map(reg.devices.map(d => [d.id, d.area_id])), byDevice = new Map<string, string[]>();
  for (const e of reg.entities) if (e.device_id && !e.disabled_by) byDevice.set(e.device_id, [...(byDevice.get(e.device_id) ?? []), e.entity_id]);
  const live = reg.entities.filter(e => !e.disabled_by && !e.hidden_by && reg.states[e.entity_id]);
  const here = (id: string) => (e: Registry['entities'][number]) => (e.area_id ?? (e.device_id ? deviceArea.get(e.device_id) : null)) === id, inRoom = (id: string) => live.filter(here(id)), withDead = (id: string) => reg.entities.filter(e => !e.disabled_by && !e.hidden_by).filter(here(id)); // a sensor HA has no state for yet still counts as dead
  const present = new Set(rooms.map(r => r.id)), averageKnown = opts.average.some(a => present.has(a));
  return rooms.map(r => {
    const own = inRoom(r.id), dc = (id: string, row?: { device_class?: string | null }) => (reg.states[id]?.attributes.device_class as string | undefined) ?? row?.device_class ?? null;
    const co2Devices = new Set(own.filter(e => dc(e.entity_id, e) === 'carbon_dioxide').map(e => e.device_id));
    const domains = (device: string | null) => (device ? byDevice.get(device) ?? [] : []).map(x => x.split('.')[0]);
    const appliance = (e: (typeof own)[number]) => APPLIANCE.test(e.entity_id) || APPLIANCE.test(reg.devices.find(d => d.id === e.device_id)?.model ?? '') || ['humidifier', 'climate', 'water_heater'].some(x => domains(e.device_id).includes(x)) || e.entity_category === 'diagnostic';
    const rank = (e: (typeof own)[number]) => (co2Devices.has(e.device_id) ? 0 : domains(e.device_id).includes('fan') ? 2 : 1);
    const pick = (slot: string) => { const c = withDead(r.id).filter(e => e.entity_id.startsWith('sensor.') && CLASS[dc(e.entity_id, e) ?? ''] === slot && !appliance(e)).sort((a, b) => rank(a) - rank(b)); if (!c.length) return null; const alive = c.find(e => toValue(reg.states[e.entity_id]?.state) !== null) ?? c[0]; const s = reg.states[alive.entity_id]; return { entity: alive.entity_id, value: toValue(s?.state), unit: (s?.attributes.unit_of_measurement as string | undefined) ?? alive.unit ?? null }; };
    const windows = own.filter(e => e.entity_id.startsWith('binary_sensor.') && ['window', 'opening'].includes(dc(e.entity_id, e) ?? '')).map(e => e.entity_id);
    const modelOf = (e: (typeof own)[number]) => reg.devices.find(d => d.id === e.device_id)?.model ?? '', isPurifier = (e: (typeof own)[number]) => PURIFIER.test(e.entity_id) || PURIFIER.test(modelOf(e)), purifier = own.find(e => e.entity_id.startsWith('fan.') && isPurifier(e))?.entity_id ?? null, humidifier = own.find(e => e.entity_id.startsWith('humidifier.'))?.entity_id ?? null;
    const vents = own.filter(e => !e.entity_category && !appliance(e) && ((e.entity_id.startsWith('fan.') && !isPurifier(e)) || VENT_SWITCH.test(e.entity_id))).map(e => e.entity_id);
    return { id: r.id, name: r.name, excluded: opts.excluded.includes(r.id), scale: (opts.bath.includes(r.id) ? 'bath' : opts.kitchen.includes(r.id) ? 'kitchen' : 'room') as HumidityScale, allowed: opts.actions[r.id] ?? [], temperature: pick('temperature'), humidity: pick('humidity'), co2: pick('co2'), pm25: pick('pm25'), voc: pick('voc'), windows, windowOpen: windows.some(w => reg.states[w]?.state === 'on'), purifier, purifierOn: !!purifier && reg.states[purifier]?.state === 'on', humidifier, vents, ventOn: vents.some(v => reg.states[v]?.state === 'on') };
  }).filter(r => r.excluded ? !!(r.temperature || r.humidity || r.vents.length || r.pm25 || r.voc) : averageKnown ? opts.average.includes(r.id) || !!(r.co2 || r.pm25 || r.purifier || r.humidifier || r.vents.length) : !!(r.temperature || r.humidity || r.co2 || r.pm25 || r.purifier || r.humidifier || r.vents.length));
}
const mean = (rooms: AirRoom[], key: 'temperature' | 'humidity'): Span => { const all = rooms.filter(r => r[key]), used = all.filter(r => r[key]!.value !== null); return { value: used.length ? used.reduce((s, r) => s + r[key]!.value!, 0) / used.length : null, used: used.length, total: all.length, room: null }; };
const worst = (rooms: AirRoom[], key: 'co2' | 'pm25'): Span => { const all = rooms.filter(r => r[key]), used = all.filter(r => r[key]!.value !== null), top = used.reduce<AirRoom | null>((m, r) => !m || r[key]!.value! > m[key]!.value! ? r : m, null); return { value: top ? top[key]!.value : null, used: used.length, total: all.length, room: top?.name ?? null }; };
/** The tile's numbers and its one sentence. The excluded room never counts. Priority: CO₂, PM2.5, humidity, temperature; the worse tone first within each. */
export function airSummary(reg: Registry, rooms: Array<{ id: string; name: string }>, opts: AirOptions = AIR_DEFAULTS): AirSummary {
  const list = airRooms(reg, rooms, opts), counted = list.filter(r => !r.excluded), six = rooms.some(r => opts.average.includes(r.id)) ? counted.filter(r => opts.average.includes(r.id)) : counted; // a CO₂ sensor in the hall shows in the rooms, it does not move the house's mean
  const problems: AirProblem[] = []; for (const metric of ['co2', 'pm25', 'humidity', 'temperature'] as Metric[]) for (const room of counted) { const v = room[metric]?.value ?? null; const tone = toneOf(metric, v, room.scale); if (v !== null && tone !== 'ok') problems.push({ metric, tone, room, value: v, high: metric === 'humidity' ? v > HUMIDITY[room.scale].warn : metric === 'temperature' ? v > 25 : true }); }
  const order: Metric[] = ['co2', 'pm25', 'humidity', 'temperature'], spread = (p: AirProblem) => p.metric === 'humidity' ? Math.abs(p.value - HUMIDITY[p.room.scale].warn) : p.metric === 'temperature' ? Math.abs(p.value - 22) : p.value;
  problems.sort((a, b) => order.indexOf(a.metric) - order.indexOf(b.metric) || (a.tone === b.tone ? spread(b) - spread(a) : a.tone === 'bad' ? -1 : 1));
  const problem = problems[0] ?? null;
  return { rooms: list, temperature: mean(six, 'temperature'), humidity: mean(six, 'humidity'), co2: worst(counted, 'co2'), pm25: worst(counted, 'pm25'), problem, tone: problem?.tone ?? 'ok' }; // the look follows the sentence it stands behind
}
/** «в Детской», «на Кухне». Other languages name the room as it is. */
export function inRoomRu(name: string): string { const n = name.trim(); if (/кухн/i.test(n)) return `на ${n.replace(/я$/, 'е')}`; if (/ая$/.test(n)) return `в ${n.replace(/ая$/, 'ой')}`; if (/ня$/.test(n)) return `в ${n.replace(/я$/, 'е')}`; if (/[бвгджзклмнпрстфхцчшщ]$/i.test(n)) return `в ${n}е`; return `в ${n}`; }

/** A button that fixes the problem and stops by itself once the reading is back to normal: always the room's vent, and only where the owner said it helps. */
export type AirActionKind = 'dehumidify' | 'purify';
export interface AirAction { kind: AirActionKind; roomId: string; device: string; sensor: string; target: number; blocked: 'offline' | null; value: number }
/** Where the vent stops. In the heating season outdoor air is dry once warm (Criuleni, November: about 31 %), so 60 % is within reach; in summer it brings 60–66 % itself, so 65 %. The server decides by the same rule. */
export const airTarget = (kind: AirActionKind, now = new Date()) => kind === 'purify' ? 15 : now.getMonth() >= 4 && now.getMonth() <= 8 ? 65 : 60;
export interface AirTask { kind: AirActionKind; roomId: string; device: string; sensor: string; target: number; startedAt: number }
export function airActions(room: AirRoom, reg: Registry, now = new Date()): AirAction[] {
  if (!room.allowed.length || !room.vents.length) return [];
  const offline = (id: string) => { const s = reg.states[id]?.state; return s === undefined || s === 'unavailable'; }, vent = room.vents.find(v => !offline(v)) ?? room.vents[0], out: AirAction[] = [], hum = room.humidity?.value ?? null, pm = room.pm25?.value ?? null, blocked = offline(vent) ? 'offline' as const : null;
  if (room.allowed.includes('dehumidify') && hum !== null && hum > HUMIDITY[room.scale].warn) out.push({ kind: 'dehumidify', roomId: room.id, device: vent, sensor: room.humidity!.entity, target: airTarget('dehumidify', now), blocked, value: hum });
  if (room.allowed.includes('purify') && pm !== null && toneOf('pm25', pm) !== 'ok') out.push({ kind: 'purify', roomId: room.id, device: vent, sensor: room.pm25!.entity, target: airTarget('purify'), blocked, value: pm });
  return out;
}
