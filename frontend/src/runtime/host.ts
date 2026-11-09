import type { Registry, StateRow, AreaRow, DeviceRow, EntityRow, FloorRow } from '../model/registry.ts';
import type { FeederLog } from '../modules/feeder-log.ts';
import type { AirTask } from '../model/air.ts';
import { previewStatistic, previewStatistics, type PreviewStats } from './preview-stats.ts';
/** The slice of the HA frontend `hass` object the panel uses. Authentication stays with HA. */
export interface Hass {
  states: Record<string, { state: string; attributes: Record<string, unknown>; last_changed: string; last_updated: string }>;
  user?: { id: string; is_admin: boolean; name?: string };
  connected?: boolean; language?: string;
  callWS<T = unknown>(message: Record<string, unknown>): Promise<T>;
  callService(domain: string, service: string, data?: Record<string, unknown>): Promise<unknown>;
  connection?: { subscribeEvents?(cb: (e: unknown) => void, type: string): Promise<() => void>; subscribeMessage?<T = unknown>(cb: (message: T) => void, message: Record<string, unknown>): Promise<() => void> };
}
/** An HA automation that touches a card (AUTO-2 of the audit): read-only — the panel never turns automations on or off. */
export interface AutomationRow { entityId: string; name: string; description: string; enabled: boolean; lastTriggered: string | null; entities: string[]; devices: string[]; areas: string[] }
export type StatPeriod = '5minute' | 'hour' | 'day' | 'week' | 'month';
export type StatType = 'change' | 'mean' | 'min' | 'max';
export interface StatRow { start: number; end: number; change?: number | null; mean?: number | null; min?: number | null; max?: number | null }
/** Units by HA's unit class: the keys are the recorder's closed UNIT_SCHEMA (`electric_current`, not `current`: HA refuses the whole read otherwise). */
export const UNITS = { energy: 'kWh', power: 'W', voltage: 'V', electric_current: 'A' };
const ms = (v: unknown): number => typeof v === 'number' ? (v < 1e11 ? v * 1000 : v) : Date.parse(String(v));
type StatRead = (ids: string[], start: number, end: number, period: StatPeriod, types: StatType[]) => Promise<Record<string, StatRow[]>>;
/** HA moves a day, week or month query to its own boundaries (recorder/statistics.py, _statistics_during_period_with_session): the start back
 * to midnight, Monday or the 1st, the end on to the boundary after the end's day, week or month. The panel's end is the next period's start, so
 * HA would add one more day, week or month (the week of 26.10 got Monday 2.11). Asked up to a millisecond before the end, every row outside
 * [start, end) dropped. The live host and the preview both read through this. */
export async function withinPeriod(read: StatRead, ids: string[], start: number, end: number, period: StatPeriod, types: StatType[]): Promise<Record<string, StatRow[]>> {
  if (period !== 'day' && period !== 'week' && period !== 'month') return read(ids, start, end, period, types);
  const raw = await read(ids, start, end - 1, period, types), out: Record<string, StatRow[]> = {};
  for (const [id, rows] of Object.entries(raw)) { const r = rows.filter(x => x.start >= start && x.start < end); if (r.length) out[id] = r; }
  return out;
}
export interface Host {
  registry(): Promise<Pick<Registry, 'areas' | 'devices' | 'entities' | 'floors'>>;
  states(): Record<string, StateRow>;
  call(domain: string, service: string, data: Record<string, unknown>): Promise<void>;
  history?(entityIds: string[], hours: number): Promise<Record<string, Array<[number, number]>>>;
  /** Preview only: a recorded frame that stands in for a camera's live stream (the stream or entity name), so the preview shows what a device would. */
  previewFrame?(id: string): string | null;
  /** Raw WebSocket command on the authenticated connection (modules such as the go2rtc player need Supervisor ingress info). */
  ws?<T = unknown>(message: Record<string, unknown>): Promise<T>;
  /** Subscription on the authenticated connection (WebRTC offer/answer/candidates for the camera stream). Resolves to the unsubscribe function. */
  subscribe?<T = unknown>(message: Record<string, unknown>, callback: (message: T) => void): Promise<() => void>;
  /** Automations referencing entities, devices or areas (read-only, `atom_home/automations`); an older backend yields []. */
  automations?(): Promise<AutomationRow[]>;
  /** The feeder's journal, eaten grams and desiccant from Xiaomi's cloud (read-only, `atom_home/feeder/log`); null when the backend or the cloud has none. */
  feederLog?(entityId: string, fresh?: boolean): Promise<FeederLog | null>;
  /** «Fix it» jobs of the Air card, run by the integration so they finish with the panel closed: on until the reading is back to normal. */
  /** HA's long-term statistics (`recorder/statistics_during_period`), read-only: rows per id, energy in kWh and power in W. Throws when the read fails. */
  statistics?(ids: string[], start: number, end: number, period: StatPeriod, types: StatType[]): Promise<Record<string, StatRow[]>>;
  /** One figure over a fixed stretch (`recorder/statistic_during_period`). Throws when the read fails. */
  statistic?(id: string, start: number, end: number, types: StatType[]): Promise<{ change?: number | null; min?: number | null; max?: number | null }>;
  energyMonth?(statisticIds: string[]): Promise<number | null>; /* kWh since the 1st of this month from HA's statistics; null: not known */
  airTasks?(): Promise<AirTask[] | null>; /* null: the read failed, which says nothing about the jobs */
  airStart?(task: Omit<AirTask, 'startedAt'>): Promise<void>;
  airStop?(device: string): Promise<void>;
  readonly admin: boolean; readonly online: boolean;
}
const toRow = (e: Record<string, unknown>): EntityRow => ({
  entity_id: String(e.entity_id), device_id: (e.device_id as string | null) ?? null, area_id: (e.area_id as string | null) ?? null, name: (e.name as string | null) ?? null, original_name: (e.original_name as string | null) ?? null,
  platform: String(e.platform ?? ''), entity_category: (e.entity_category as EntityRow['entity_category']) ?? null, disabled_by: (e.disabled_by as string | null) ?? null, hidden_by: (e.hidden_by as string | null) ?? null,
  icon: (e.icon as string | null) ?? null, original_icon: (e.original_icon as string | null) ?? null, device_class: ((e.original_device_class ?? e.device_class) as string | null) ?? null, unit: (e.unit_of_measurement as string | null) ?? null, has_entity_name: e.has_entity_name === true,
});
/** Live host over the authenticated `hass` object: registry via WebSocket (read-only), states from hass, commands via callService.
 * HA hands the panel a new `hass` on every state change, several times a second. One host lives as long as the panel and reads the current
 * `hass` when asked: effects keyed on the host must not restart with every update (the chart blinked and every panel re-queried HA, 05.11.2026). */
export function liveHost(current: () => Hass): Host {
  return {
    get admin() { return current().user?.is_admin === true; },
    get online() { return current().connected !== false; },
    states: () => current().states,
    async registry() {
      const [areas, devices, entities, floors] = await Promise.all([
        current().callWS<AreaRow[]>({ type: 'config/area_registry/list' }), current().callWS<Array<Record<string, unknown>>>({ type: 'config/device_registry/list' }), current().callWS<Array<Record<string, unknown>>>({ type: 'config/entity_registry/list' }),
        // the floors only name the buildings of the Energy panel: an HA that will not say (older, no floors) is one building, never a failed load
        current().callWS<FloorRow[]>({ type: 'config/floor_registry/list' }).catch(() => [] as FloorRow[]),
      ]);
      return { areas, devices: devices.map(d => ({ id: String(d.id), name: ((d.name_by_user ?? d.name) as string | null) ?? null, model: (d.model as string | null) ?? null, manufacturer: (d.manufacturer as string | null) ?? null, area_id: (d.area_id as string | null) ?? null, entry_type: (d.entry_type as string | null) ?? null, disabled_by: (d.disabled_by as string | null) ?? null, via_device_id: (d.via_device_id as string | null) ?? null } satisfies DeviceRow)), entities: entities.map(toRow), floors };
    },
    async call(domain, service, data) { await current().callService(domain, service, data); },
    ws: <T,>(message: Record<string, unknown>) => current().callWS<T>(message),
    async automations() { try { const rows = await current().callWS<AutomationRow[]>({ type: 'atom_home/automations' }); return Array.isArray(rows) ? rows : []; } catch { return []; } },
    async feederLog(entityId, fresh = false) { try { return await current().callWS<FeederLog | null>({ type: 'atom_home/feeder/log', entity_id: entityId, fresh }); } catch { return null; } },
    async airTasks() { try { const r = await current().callWS<AirTask[]>({ type: 'atom_home/air/tasks' }); return Array.isArray(r) ? r : null; } catch { return null; } },
    async statistics(ids, start, end, period, types) {
      if (!ids.length) return {};
      return withinPeriod(async (ids, start, end, period, types) => {
        const raw = await current().callWS<Record<string, Array<Record<string, unknown>>>>({ type: 'recorder/statistics_during_period', start_time: new Date(start).toISOString(), end_time: new Date(end).toISOString(), statistic_ids: ids, period, types, units: UNITS });
        const out: Record<string, StatRow[]> = {}; const n = (v: unknown) => typeof v === 'number' && Number.isFinite(v) ? v : null;
        for (const [id, rows] of Object.entries(raw ?? {})) if (Array.isArray(rows)) out[id] = rows.map(r => ({ start: ms(r.start), end: ms(r.end), change: n(r.change), mean: n(r.mean), min: n(r.min), max: n(r.max) })).filter(r => Number.isFinite(r.start));
        return out;
      }, ids, start, end, period, types);
    },
    async statistic(id, start, end, types) { const r = await current().callWS<Record<string, unknown>>({ type: 'recorder/statistic_during_period', statistic_id: id, fixed_period: { start_time: new Date(start).toISOString(), end_time: new Date(end).toISOString() }, types, units: UNITS }); const n = (v: unknown) => typeof v === 'number' && Number.isFinite(v) ? v : null; return { change: n(r?.change), min: n(r?.min), max: n(r?.max) }; },
    async energyMonth(ids) { if (!ids.length) return null; try { const rows = await Promise.all(ids.map(id => current().callWS<{ change?: number | null }>({ type: 'recorder/statistic_during_period', statistic_id: id, calendar: { period: 'month' }, types: ['change'], units: { energy: 'kWh' } }))); const v = rows.map(r => r?.change); return v.every(x => typeof x === 'number' && Number.isFinite(x)) ? (v as number[]).reduce((a, x) => a + x, 0) : null; } catch { return null; } },
    async airStart(task) { await current().callWS({ type: 'atom_home/air/start', ...task }); },
    async airStop(device) { await current().callWS({ type: 'atom_home/air/stop', device }); },
    subscribe: <T,>(message: Record<string, unknown>, callback: (m: T) => void) => { const conn = current().connection; if (!conn?.subscribeMessage) return Promise.reject(new Error('no subscription API')); return conn.subscribeMessage<T>(callback, message); },
    async history(entityIds, hours) {
      const end = new Date(), start = new Date(end.getTime() - hours * 3600000);
      const raw = await current().callWS<Record<string, Array<{ s?: unknown; lu?: number; lc?: number }>>>({ type: 'history/history_during_period', start_time: start.toISOString(), end_time: end.toISOString(), entity_ids: entityIds, minimal_response: true, no_attributes: true, significant_changes_only: false });
      const out: Record<string, Array<[number, number]>> = {};
      for (const id of entityIds) { const rows = Array.isArray(raw?.[id]) ? raw[id] : []; const pts: Array<[number, number]> = []; for (const r of rows) { const v = Number(r.s); const t = (r.lu ?? r.lc ?? 0) * 1000; if (Number.isFinite(v) && t > 0) pts.push([t, v]); } const step = Math.max(1, Math.ceil(pts.length / 144)); out[id] = pts.filter((_, i) => i % step === 0 || i === pts.length - 1); }
      return out;
    },
  };
}
/** Isolated host for previews and QA: a frozen snapshot, every command recorded and rejected. */
export function previewHost(snapshot: Registry, log: Array<{ domain: string; service: string; data: Record<string, unknown> }> = []): Host & { log: typeof log; setOnline(v: boolean): void; setDelay(ms: number): void; setAutomations(rows: AutomationRow[]): void; setFeederLog(log: FeederLog | null): void; setAccept(v: boolean): void; setAirTasks(t: AirTask[]): void; setAirRead(ok: boolean): void; setAirRefuse(e: unknown): void } {
  let online = true, delay = 0, automations: AutomationRow[] = [], feeder: FeederLog | null = null, accept = false, airTasks: AirTask[] = [], airRead = true, airRefuse: unknown = null; // ST-4 / ST-3 of the audit: QA flips the connection and slows the answer to see the banner, the veil, the pending state and the refused command
  const stats = () => { const s = (globalThis as { __energyStats?: PreviewStats | 'fail' | null }).__energyStats; if (s === 'fail') throw new Error('preview: statistics refused'); return s; };
  const hasStats = !!(globalThis as { __energyStats?: unknown }).__energyStats;
  return { admin: true, ...(hasStats ? { async statistics(ids: string[], start: number, end: number, period: StatPeriod, types: StatType[]) { return withinPeriod(async (...a) => previewStatistics(stats()!, ...a), ids, start, end, period, types); }, async statistic(id: string, start: number, end: number, types: StatType[]) { return previewStatistic(stats()!, id, start, end, types); } } : {}), async energyMonth() { const v = (globalThis as { __energyMonth?: unknown }).__energyMonth; return typeof v === 'number' ? v : null; }, get online() { return online; }, setOnline(v: boolean) { online = v; }, setDelay(ms: number) { delay = ms; }, setAutomations(rows: AutomationRow[]) { automations = rows; }, setFeederLog(log: FeederLog | null) { feeder = log; }, setAccept(v: boolean) { accept = v; }, setAirTasks(t: AirTask[]) { airTasks = t; }, setAirRead(ok: boolean) { airRead = ok; }, setAirRefuse(e: unknown) { airRefuse = e; }, async airTasks() { return airRead ? airTasks : null; }, async airStart(task) { log.push({ domain: 'air', service: 'start', data: task }); if (accept && !airRefuse) airTasks = [...airTasks, { ...task, startedAt: Date.now(), wasOn: false, stopping: false }]; /* listed before the device answers, as the server does */ if (delay) await new Promise(r => setTimeout(r, delay)); if (airRefuse) throw airRefuse; if (!accept) throw new Error('preview: commands are rejected'); }, async airStop(device) { log.push({ domain: 'air', service: 'stop', data: { device } }); if (delay) await new Promise(r => setTimeout(r, delay)); if (airRefuse) throw airRefuse; if (!accept) throw new Error('preview: commands are rejected'); airTasks = airTasks.filter(x => x.device !== device); }, async feederLog() { return feeder; }, async automations() { return automations; }, previewFrame(id: string) { const f = (globalThis as { __frames?: Record<string, string> }).__frames; return f?.[id] ?? null; }, log, states: () => snapshot.states, registry: async () => ({ areas: snapshot.areas, devices: snapshot.devices, entities: snapshot.entities }), async call(domain, service, data) { log.push({ domain, service, data }); if (delay) await new Promise(r => setTimeout(r, delay)); if (accept) return; throw new Error('preview: commands are rejected'); }, async ws<T>(message: Record<string, unknown>) { log.push({ domain: 'ws', service: String(message.type), data: message }); if (message.type === 'history/history_during_period') { const h = (globalThis as { __camHistory?: Record<string, Array<{ s: string; lc: number }>> }).__camHistory; if (h) { const ids = (message.entity_ids as string[]) ?? []; return Object.fromEntries(ids.filter(id => h[id]).map(id => [id, h[id]])) as T; } } if (message.type === 'energy/get_prefs') { const p = (globalThis as { __energyPrefs?: unknown }).__energyPrefs; if (p === 'fail') throw new Error('preview: energy prefs refused'); if (p === 'none') throw { code: 'not_found', message: 'No prefs' }; /* HA without Energy settings (energy/websocket_api.py) */ return (p ?? { device_consumption: [] }) as T; } /* read-only, like the real one */ throw new Error('preview: commands are rejected'); }, async history() { return {}; } };
}
