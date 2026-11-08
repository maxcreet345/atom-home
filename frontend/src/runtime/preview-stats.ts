import type { StatPeriod, StatRow, StatType } from './host.ts';
/** HA's long-term statistics as the preview has them (made-up, from scripts/energy-report-fixture.mjs): hourly changes for the last weeks,
 * daily changes for every day, five-minute and hourly power means, daily min/max of voltage and current. Answers the same two questions the
 * real recorder does, with its bucketing by local calendar, so the Energy panel's real loading code runs in the preview and the audits. */
export interface PreviewStats { hour: Record<string, Array<[number, number]>>; /** older hours around each 1st of a month: HA keeps hourly statistics for good, the preview only where a period begins */ hourEdge?: Record<string, Array<[number, number]>>; day: Record<string, Array<[number, number]>>; five: Record<string, Array<[number, number]>>; /** the channels' energy per finished 5 minutes, the last 9 days */ fiveE?: Record<string, Array<[number, number]>>; hourMean: Record<string, Array<[number, number, number]>>; dayMinMax: Record<string, Array<[number, number, number]>> }
const HOUR = 3600000;
const startOf = (t: number, p: StatPeriod): number => { const d = new Date(t); if (p === '5minute') return t - t % 300000; if (p === 'hour') { d.setMinutes(0, 0, 0); return d.getTime(); } d.setHours(0, 0, 0, 0); if (p === 'week') d.setDate(d.getDate() - (d.getDay() + 6) % 7); if (p === 'month') d.setDate(1); return d.getTime(); };
const endOf = (t: number, p: StatPeriod): number => { if (p === '5minute') return t + 300000; if (p === 'hour') return t + HOUR; const d = new Date(t); if (p === 'day') d.setDate(d.getDate() + 1); else if (p === 'week') d.setDate(d.getDate() + 7); else d.setMonth(d.getMonth() + 1); return d.getTime(); };
export function previewStatistics(s: PreviewStats, ids: string[], start: number, end: number, period: StatPeriod, types: StatType[]): Record<string, StatRow[]> {
  const out: Record<string, StatRow[]> = {};
  // as HA does for a day, week or month: the start back to its midnight, Monday or 1st, the end on to the boundary after the end's own day, week
  // or month (recorder/statistics.py); without it the preview could not show a query that takes one period too many
  if (period === 'day' || period === 'week' || period === 'month') { start = startOf(start, period); end = endOf(startOf(end, period), period); }
  for (const id of ids) {
    const groups = new Map<number, StatRow>(), add = (t: number, f: (r: StatRow) => void) => { if (t < start || t >= end) return; const k = startOf(t, period); const r = groups.get(k) ?? { start: k, end: endOf(k, period) }; f(r); groups.set(k, r); };
    if (types.includes('change')) { const fine = period === 'hour' || period === '5minute'; for (const [t, v] of (fine ? [...(period === 'hour' ? s.hourEdge?.[id] ?? [] : []), ...(s.hour[id] ?? [])] : s.day[id]) ?? []) add(t, r => { r.change = (r.change ?? 0) + v; }); }
    if (types.includes('mean')) {
      if (period === '5minute') for (const [t, v] of s.five[id] ?? []) add(t, r => { r.mean = v; r.max = v; });
      else { const n = new Map<number, number>(); for (const [t, v, m] of s.hourMean[id] ?? []) add(t, r => { const c = (n.get(r.start) ?? 0) + 1; n.set(r.start, c); r.mean = ((r.mean ?? 0) * (c - 1) + v) / c; r.max = Math.max(r.max ?? -Infinity, m); }); }
    } else if (types.includes('min') || types.includes('max')) for (const [t, lo, hi] of s.dayMinMax[id] ?? []) add(t, r => { r.min = Math.min(r.min ?? Infinity, lo); r.max = Math.max(r.max ?? -Infinity, hi); });
    const rows = [...groups.values()].sort((a, b) => a.start - b.start); if (rows.length) out[id] = rows;
  }
  return out;
}
/** One figure over a fixed stretch, as HA's statistic_during_period: the finished hours inside it, then the 5-minute rows of its tail (the
 * running hour); whole days where the preview has no hours any more. A tail row counts when it starts before the end, as in HA
 * (recorder/statistics.py, `start_ts < end_time_ts`), and the slot that holds now does not exist yet (the fixture writes finished ones only),
 * so a query that ends inside a slot gets that slot whole on a past day and not today, as the real recorder does. */
export function previewStatistic(s: PreviewStats, id: string, start: number, end: number, types: StatType[]): { change?: number | null; min?: number | null; max?: number | null } {
  if (types.includes('change')) {
    const hours = s.hour[id] ?? [], first = hours[0]?.[0] ?? Infinity, add = (rows: Array<[number, number]>) => rows.reduce((a, [, v]) => a + v, 0);
    if (start < first) { const days = s.day[id] ?? []; return days.length ? { change: add(days.filter(([t]) => t >= start && t < end)) } : { change: null }; }
    const inside = hours.filter(([t]) => t >= start && t + HOUR <= end), upTo = inside.length ? inside.at(-1)![0] + HOUR : start;
    return { change: add(inside) + add((s.fiveE?.[id] ?? []).filter(([t]) => t >= upTo && t < end)) };
  }
  const rows = (s.dayMinMax[id] ?? []).filter(([t]) => t >= startOf(start, 'day') && t < end); return rows.length ? { min: Math.min(...rows.map(r => r[1])), max: Math.max(...rows.map(r => r[2])) } : {};
}
