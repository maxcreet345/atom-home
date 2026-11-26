import type { Registry } from '../model/registry.ts';

/** The helpers of Home Assistant the panel works through, mirrored from custom_components/atom_home/helpers_check.py (SPECS).
 *  A new house had none of them and the «Time» sheet showed no timers at all (26.11.2026); an older house may lack some. Home Assistant
 *  lets no integration create a helper, so an administrator's panel offers a bar «не хватает помощников» on any house, new or old, until
 *  they exist, and creates them through Home Assistant's own `<domain>/create` (admin-only there too). */
export type HelperUse = 'timers' | 'alarm' | 'sleep';
export interface HelperSpec { entityId: string; use: HelperUse; params: Record<string, unknown> }
export const HELPERS: HelperSpec[] = [
  ...[1, 2, 3].map(n => ({ entityId: `timer.atom_${n}`, use: 'timers' as const, params: { name: `Atom ${n}`, icon: 'mdi:timer-outline', restore: true } })),
  { entityId: 'input_text.atom_timer_labels', use: 'timers', params: { name: 'Atom timer labels', max: 255, icon: 'mdi:label-outline' } },
  { entityId: 'input_boolean.timer_done', use: 'timers', params: { name: 'Timer done', icon: 'mdi:timer-check-outline' } },
  { entityId: 'input_boolean.alarm_ringing', use: 'alarm', params: { name: 'Alarm ringing', icon: 'mdi:alarm-bell' } },
  { entityId: 'input_text.alarm_ringing', use: 'alarm', params: { name: 'Alarm ringing', max: 255, icon: 'mdi:alarm-bell' } },
  { entityId: 'input_text.atom_light_sleep', use: 'sleep', params: { name: 'Atom light sleep', max: 255, icon: 'mdi:lightbulb-auto' } },
];

/** Missing: no state and no registry entry. An entry without a state is one the owner disabled (or one still loading): creating then
 *  would make `timer.atom_1_2`, which nothing reads — such a helper is the owner's choice and is not offered. */
export function missingHelpers(reg: Pick<Registry, 'states' | 'entities'>): HelperSpec[] {
  const known = new Set(reg.entities.map(e => e.entity_id));
  return HELPERS.filter(h => !reg.states[h.entityId] && !known.has(h.entityId));
}
export const missingUses = (missing: HelperSpec[]): HelperUse[] => (['timers', 'alarm', 'sleep'] as const).filter(u => missing.some(h => h.use === u));

export interface CreateResult { busy: boolean; created: string[]; failed: Array<{ entityId: string; error: unknown }> }
type Ws = <T = unknown>(message: Record<string, unknown>) => Promise<T>;
const isUnknownCommand = (e: unknown) => !!e && typeof e === 'object' && (e as { code?: unknown }).code === 'unknown_command';
/** A helper whose name Home Assistant gave another id (`atom_1_2`: the id is taken by a helper renamed since) — removed again, not counted. */
export class TakenError extends Error { readonly entityId: string; readonly got: string; constructor(entityId: string, got: string) { super(`taken: ${entityId} → ${got}`); this.entityId = entityId; this.got = got; } }

/** Creates what is missing. The integration hands out the list under a two-minute lease (`atom_home/helpers/claim`): the kiosks reload
 *  together and two panels creating the same helper would make a `_2`. An integration not restarted since the update does not know the
 *  command yet: then the panel's own list is created as is (one tap of one administrator). One helper that fails does not stop the rest.
 *  The bar and the «Время» sheet share one try: a tap on both while the first runs gets the first one's answer, not a second batch. */
let running: Promise<CreateResult> | null = null;
export function createHelpers(ws: Ws, reg: Pick<Registry, 'states' | 'entities'>): Promise<CreateResult> {
  running ??= createOnce(ws, reg).finally(() => { running = null; });
  return running;
}
async function createOnce(ws: Ws, reg: Pick<Registry, 'states' | 'entities'>): Promise<CreateResult> {
  let list: Array<{ entityId: string; params: Record<string, unknown> }>;
  try {
    const r = await ws<{ create?: Array<{ entity_id: string; params: Record<string, unknown> }>; busy?: boolean }>({ type: 'atom_home/helpers/claim' });
    list = (r?.create ?? []).map(x => ({ entityId: x.entity_id, params: x.params }));
    // nothing to do: another screen holds the lease («уже создают»), or the house already has them all (the screen catches up in a moment)
    if (!list.length) return { busy: r?.busy ?? missingHelpers(reg).length > 0, created: [], failed: [] };
  } catch (e) {
    if (!isUnknownCommand(e)) throw e;
    list = missingHelpers(reg).map(h => ({ entityId: h.entityId, params: h.params }));
  }
  const created: string[] = [], failed: CreateResult['failed'] = [];
  for (const h of list) {
    const dot = h.entityId.indexOf('.'), domain = h.entityId.slice(0, dot), objectId = h.entityId.slice(dot + 1);
    try {
      const item = await ws<{ id?: unknown } | null>({ type: `${domain}/create`, ...h.params });
      const got = item && typeof item.id === 'string' ? item.id : objectId;
      if (got !== objectId) { await ws({ type: `${domain}/delete`, [`${domain}_id`]: got }).catch(() => undefined); throw new TakenError(h.entityId, `${domain}.${got}`); }
      created.push(h.entityId);
    } catch (error) { failed.push({ entityId: h.entityId, error }); }
  }
  return { busy: false, created, failed };
}

/** What the panel says after a try: «созданы», «уже создают на другом экране», or how many of how many and why the rest did not. */
export function outcomeText(r: CreateResult, t: (k: 'helpers.done' | 'helpers.busy' | 'helpers.partly' | 'helpers.failed' | 'helpers.nothing' | 'helpers.taken', v?: Record<string, string | number>) => string, why: (e: unknown) => string): string {
  if (r.busy) return t('helpers.busy');
  if (!r.failed.length) return r.created.length ? t('helpers.done') : t('helpers.nothing');
  const e = r.failed[0].error, reason = e instanceof TakenError ? t('helpers.taken', { id: e.entityId }) : why(e);
  return r.created.length ? t('helpers.partly', { ok: r.created.length, n: r.created.length + r.failed.length, why: reason }) : t('helpers.failed', { why: reason });
}
