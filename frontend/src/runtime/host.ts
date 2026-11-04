import type { Registry, StateRow, AreaRow, DeviceRow, EntityRow } from '../model/registry.ts';
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
export interface Host {
  registry(): Promise<Pick<Registry, 'areas' | 'devices' | 'entities'>>;
  states(): Record<string, StateRow>;
  call(domain: string, service: string, data: Record<string, unknown>): Promise<void>;
  history?(entityIds: string[], hours: number): Promise<Record<string, Array<[number, number]>>>;
  /** Raw WebSocket command on the authenticated connection (modules such as the go2rtc player need Supervisor ingress info). */
  ws?<T = unknown>(message: Record<string, unknown>): Promise<T>;
  /** Subscription on the authenticated connection (WebRTC offer/answer/candidates for the camera stream). Resolves to the unsubscribe function. */
  subscribe?<T = unknown>(message: Record<string, unknown>, callback: (message: T) => void): Promise<() => void>;
  /** Automations referencing entities, devices or areas (read-only, `atom_home/automations`); an older backend yields []. */
  automations?(): Promise<AutomationRow[]>;
  readonly admin: boolean; readonly online: boolean;
}
const toRow = (e: Record<string, unknown>): EntityRow => ({
  entity_id: String(e.entity_id), device_id: (e.device_id as string | null) ?? null, area_id: (e.area_id as string | null) ?? null, name: (e.name as string | null) ?? null, original_name: (e.original_name as string | null) ?? null,
  platform: String(e.platform ?? ''), entity_category: (e.entity_category as EntityRow['entity_category']) ?? null, disabled_by: (e.disabled_by as string | null) ?? null, hidden_by: (e.hidden_by as string | null) ?? null,
  icon: (e.icon as string | null) ?? null, original_icon: (e.original_icon as string | null) ?? null, device_class: ((e.original_device_class ?? e.device_class) as string | null) ?? null, unit: (e.unit_of_measurement as string | null) ?? null, has_entity_name: e.has_entity_name === true,
});
/** Live host over the authenticated `hass` object: registry via WebSocket (read-only), states from hass, commands via callService. */
export function liveHost(hass: Hass): Host {
  return {
    get admin() { return hass.user?.is_admin === true; },
    get online() { return hass.connected !== false; },
    states: () => hass.states,
    async registry() {
      const [areas, devices, entities] = await Promise.all([
        hass.callWS<AreaRow[]>({ type: 'config/area_registry/list' }), hass.callWS<Array<Record<string, unknown>>>({ type: 'config/device_registry/list' }), hass.callWS<Array<Record<string, unknown>>>({ type: 'config/entity_registry/list' }),
      ]);
      return { areas, devices: devices.map(d => ({ id: String(d.id), name: ((d.name_by_user ?? d.name) as string | null) ?? null, model: (d.model as string | null) ?? null, manufacturer: (d.manufacturer as string | null) ?? null, area_id: (d.area_id as string | null) ?? null, entry_type: (d.entry_type as string | null) ?? null, disabled_by: (d.disabled_by as string | null) ?? null, via_device_id: (d.via_device_id as string | null) ?? null } satisfies DeviceRow)), entities: entities.map(toRow) };
    },
    async call(domain, service, data) { await hass.callService(domain, service, data); },
    ws: <T,>(message: Record<string, unknown>) => hass.callWS<T>(message),
    async automations() { try { const rows = await hass.callWS<AutomationRow[]>({ type: 'atom_home/automations' }); return Array.isArray(rows) ? rows : []; } catch { return []; } },
    subscribe: <T,>(message: Record<string, unknown>, callback: (m: T) => void) => { const conn = hass.connection; if (!conn?.subscribeMessage) return Promise.reject(new Error('no subscription API')); return conn.subscribeMessage<T>(callback, message); },
    async history(entityIds, hours) {
      const end = new Date(), start = new Date(end.getTime() - hours * 3600000);
      const raw = await hass.callWS<Record<string, Array<{ s?: unknown; lu?: number; lc?: number }>>>({ type: 'history/history_during_period', start_time: start.toISOString(), end_time: end.toISOString(), entity_ids: entityIds, minimal_response: true, no_attributes: true, significant_changes_only: false });
      const out: Record<string, Array<[number, number]>> = {};
      for (const id of entityIds) { const rows = Array.isArray(raw?.[id]) ? raw[id] : []; const pts: Array<[number, number]> = []; for (const r of rows) { const v = Number(r.s); const t = (r.lu ?? r.lc ?? 0) * 1000; if (Number.isFinite(v) && t > 0) pts.push([t, v]); } const step = Math.max(1, Math.ceil(pts.length / 144)); out[id] = pts.filter((_, i) => i % step === 0 || i === pts.length - 1); }
      return out;
    },
  };
}
/** Isolated host for previews and QA: a frozen snapshot, every command recorded and rejected. */
export function previewHost(snapshot: Registry, log: Array<{ domain: string; service: string; data: Record<string, unknown> }> = []): Host & { log: typeof log; setOnline(v: boolean): void; setDelay(ms: number): void; setAutomations(rows: AutomationRow[]): void } {
  let online = true, delay = 0, automations: AutomationRow[] = []; // ST-4 / ST-3 of the audit: QA flips the connection and slows the answer to see the banner, the veil, the pending state and the refused command
  return { admin: true, get online() { return online; }, setOnline(v: boolean) { online = v; }, setDelay(ms: number) { delay = ms; }, setAutomations(rows: AutomationRow[]) { automations = rows; }, async automations() { return automations; }, log, states: () => snapshot.states, registry: async () => ({ areas: snapshot.areas, devices: snapshot.devices, entities: snapshot.entities }), async call(domain, service, data) { log.push({ domain, service, data }); if (delay) await new Promise(r => setTimeout(r, delay)); throw new Error('preview: commands are rejected'); }, async ws(message) { log.push({ domain: 'ws', service: String(message.type), data: message }); throw new Error('preview: commands are rejected'); }, async history() { return {}; } };
}
