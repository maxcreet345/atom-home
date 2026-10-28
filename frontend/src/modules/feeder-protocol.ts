/* Xiaomi MIOT pet feeder (xiaomi.feeder.iv2001 and alike): pure helpers, testable under Node.
 * Schedule format and the dosed feed action were established on the Traian feeder (see the Traian project's FEEDER-COMMAND-FIX.md):
 * the device rejects a small dose written to property 2/7 (-4005); action 2/1 takes its own dose in property 2/8. */
export interface FeederMeal { time: string; portions: number }
export const FEED_SIID = 2, FEED_AIID = 1, FEED_DOSE_PIID = 8;
export const SCHEDULE_ATTR = 'feeder_schedule-5-1';
/** `[1,HHMMPP01,…]` → meals; `[0]`/`[1]` → no meals; anything else → null (unknown format, never guessed). */
export function parseFeederSchedule(raw: unknown): { raw: string; meals: FeederMeal[] } | null {
  if (typeof raw !== 'string') return null;
  const compact = raw.replace(/\s/g, '');
  if (compact === '[0]' || compact === '[1]') return { raw: compact, meals: [] };
  if (!/^\[1(?:,\d{8})+\]$/.test(compact)) return null;
  const tokens = compact.slice(1, -1).split(',').slice(1); if (tokens.length > 35) return null;
  const meals: FeederMeal[] = [];
  for (const token of tokens) {
    const h = Number(token.slice(0, 2)), m = Number(token.slice(2, 4)), portions = Number(token.slice(4, 6));
    if (h > 23 || m > 59 || portions < 1 || portions > 15 || token.slice(6) !== '01') return null;
    meals.push({ time: `${token.slice(0, 2)}:${token.slice(2, 4)}`, portions });
  }
  if (new Set(meals.map(m => m.time)).size !== meals.length) return null;
  return { raw: compact, meals: meals.sort((a, b) => a.time.localeCompare(b.time)) };
}
/** The next meal after `nowHHMM` (wraps to the first one tomorrow); null without meals. */
export function nextMeal(meals: FeederMeal[], nowHHMM: string): FeederMeal | null {
  if (!meals.length) return null;
  const sorted = [...meals].sort((a, b) => a.time.localeCompare(b.time));
  return sorted.find(m => m.time > nowHHMM) ?? sorted[0];
}
/** Service call for one dosed feed; throws instead of guessing when the dose is out of range. */
export function feedCall(entityId: string, portions: number, maxPortions: number): { domain: string; service: string; data: Record<string, unknown> } {
  if (!/^button\.[a-z0-9_]+$/.test(entityId)) throw new Error('feeder: bad entity');
  if (!Number.isInteger(portions) || portions < 1 || portions > maxPortions) throw new Error('feeder: bad dose');
  return { domain: 'xiaomi_miot', service: 'call_action', data: { entity_id: entityId, siid: FEED_SIID, aiid: FEED_AIID, params: [{ piid: FEED_DOSE_PIID, value: portions }] } };
}
export const optionInt = (v: string | undefined, fallback: number, min: number, max: number) => { const n = Number(v); return Number.isInteger(n) && n >= min && n <= max ? n : fallback; };
/** Rewrite only the time and dose of the existing rows (the fields confirmed against the device's Xiaomi Home UI); header, row count and per-row suffix are preserved. Throws on any mismatch. */
export function editFeederSchedule(original: string, meals: FeederMeal[]): string {
  const source = parseFeederSchedule(original);
  if (!source?.meals.length || source.meals.length !== meals.length) throw new Error('schedule: row set changed');
  if (meals.some(m => !/^([01]\d|2[0-3]):[0-5]\d$/.test(m.time) || !Number.isInteger(m.portions) || m.portions < 1 || m.portions > 15)) throw new Error('schedule: bad time or dose');
  if (new Set(meals.map(m => m.time)).size !== meals.length) throw new Error('schedule: duplicate time');
  const tokens = source.raw.slice(1, -1).split(',');
  return '[' + tokens[0] + ',' + meals.map((m, n) => m.time.replace(':', '') + String(m.portions).padStart(2, '0') + tokens[n + 1].slice(6)).join(',') + ']';
}
export const SCHEDULE_SIID = 5, SCHEDULE_AIID = 2;
/** Service call that stores a daily plan on the feeder (MIOT action 5/2 with the schedule string as its only parameter). */
export function scheduleCall(infoEntityId: string, value: string): { domain: string; service: string; data: Record<string, unknown> } {
  if (!/^button\.[a-z0-9_]+$/.test(infoEntityId)) throw new Error('feeder: bad entity');
  if (!parseFeederSchedule(value)) throw new Error('feeder: bad schedule');
  return { domain: 'xiaomi_miot', service: 'call_action', data: { entity_id: infoEntityId, siid: SCHEDULE_SIID, aiid: SCHEDULE_AIID, params: [value] } };
}
