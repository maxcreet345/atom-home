/* Each device's own arrangement of the cards (owner, 20.11.2026: «увеличивать, уменьшать, менять места — на каждом устройстве отдельно»).
 * A screen («Главная», a room) is a list of cards; a layout keeps their order and their size in grid cells, never x/y: the grid places
 * them, and a phone turned on its side (fewer or more columns) still shows every card. A card the layout does not know yet (a new
 * device) comes after the known ones in the screen's own order; a card that is absent now (no weather today) keeps its place for when
 * it is back. No layout = the screen exactly as before. Pure. */

export interface Span { w: number; h: number }
export interface Placed extends Span { key: string }
/** `{scope: [[key, w, h]…]}` as the integration keeps it (custom_components/atom_home/layouts.py) */
export type Scopes = Record<string, Array<[string, number, number]>>;
export interface LayoutProfile { name: string; scopes: Scopes; rev: number; updated: number }
export const MAX_SPAN = 8;
export const SCOPE_HOME = 'home';
export const roomScope = (roomId: string) => `room:${roomId}`;
const PROFILE_ID = /^[a-z0-9][a-z0-9_-]{0,39}$/;
const SCOPE = /^(home|room:[A-Za-z0-9_.:-]{1,80})$/;
const int = (v: unknown, lo: number, hi: number) => typeof v === 'number' && Number.isInteger(v) && v >= lo && v <= hi;

/** What the integration answered, kept only where it is well formed (a damaged entry is skipped, never repaired into something else). */
export function normaliseProfiles(raw: unknown): Record<string, LayoutProfile> {
  const out: Record<string, LayoutProfile> = {}; // ids are Latin words (`__proto__` never matches)
  const profiles = raw && typeof raw === 'object' ? (raw as { profiles?: unknown }).profiles : null;
  if (!profiles || typeof profiles !== 'object') return out;
  for (const [id, p] of Object.entries(profiles as Record<string, unknown>)) {
    if (!PROFILE_ID.test(id) || !p || typeof p !== 'object') continue;
    const v = p as Record<string, unknown>; if (typeof v.name !== 'string' || !v.name.trim()) continue;
    out[id] = { name: v.name, scopes: cleanScopes(v.scopes), rev: typeof v.rev === 'number' ? v.rev : 0, updated: typeof v.updated === 'number' ? v.updated : 0 };
  }
  return out;
}
export function cleanScopes(raw: unknown): Scopes {
  const out: Scopes = {};
  if (!raw || typeof raw !== 'object') return out;
  for (const [scope, items] of Object.entries(raw as Record<string, unknown>)) {
    if (!SCOPE.test(scope) || !Array.isArray(items)) continue;
    const seen = new Set<string>(), rows: Array<[string, number, number]> = [];
    for (const it of items) if (Array.isArray(it) && typeof it[0] === 'string' && it[0] && !seen.has(it[0]) && int(it[1], 1, MAX_SPAN) && int(it[2], 1, MAX_SPAN)) { seen.add(it[0]); rows.push([it[0], it[1], it[2]]); }
    out[scope] = rows;
  }
  return out;
}

/** The cards of a screen in the device's order and sizes. `present` is the screen's own order; `natural` the size a card has without a layout. */
export function arrange(present: string[], saved: Array<[string, number, number]> | undefined, natural: (key: string) => Span, cols: number): Placed[] {
  const here = new Set(present), c = Math.max(1, cols);
  const fit = (s: Span): Span => ({ w: Math.min(Math.max(1, s.w), c), h: Math.max(1, Math.min(s.h, MAX_SPAN)) });
  if (!saved) return present.map(key => ({ key, ...fit(natural(key)) }));
  const known = saved.filter(([k]) => here.has(k)).map(([key, w, h]) => ({ key, ...fit({ w, h }) }));
  const seen = new Set(known.map(x => x.key));
  // a new card goes in after the card that precedes it on the screen's own list, so it lands near its kin instead of at the very end
  const out = [...known];
  present.forEach((key, i) => {
    if (seen.has(key)) return;
    const before = present.slice(0, i).reverse().find(k => seen.has(k)), at = before ? out.findIndex(x => x.key === before) + 1 : 0;
    out.splice(at, 0, { key, ...fit(natural(key)) }); seen.add(key);
  });
  return out;
}

/** The layout to keep after an edit: the cards shown, plus those absent now in the place they had (so «Погода» comes back where it was). */
export function keep(shown: Placed[], saved: Array<[string, number, number]> | undefined): Array<[string, number, number]> {
  const rows: Array<[string, number, number]> = shown.map(x => [x.key, x.w, x.h]);
  if (!saved) return rows;
  const on = new Set(shown.map(x => x.key));
  saved.forEach(([k, w, h], i) => {
    if (on.has(k)) return;
    const prev = saved.slice(0, i).reverse().find(([p]) => rows.some(r => r[0] === p));
    const at = prev ? rows.findIndex(r => r[0] === prev[0]) + 1 : 0;
    rows.splice(at, 0, [k, w, h]);
  });
  return rows;
}

/** Move a card to another's place (drag), or by one step (keyboard). */
export function moveTo(list: Placed[], key: string, target: string): Placed[] {
  const from = list.findIndex(x => x.key === key), to = list.findIndex(x => x.key === target);
  if (from < 0 || to < 0 || from === to) return list;
  const next = [...list]; const [it] = next.splice(from, 1); next.splice(to, 0, it); return next;
}
export function moveBy(list: Placed[], key: string, step: number): Placed[] {
  const from = list.findIndex(x => x.key === key), to = Math.max(0, Math.min(list.length - 1, from + step));
  return from < 0 || to === from ? list : moveTo(list, key, list[to].key);
}
export function resize(list: Placed[], key: string, s: Span, cols: number, min: Span = { w: 1, h: 1 }): Placed[] {
  const w = Math.max(min.w, Math.min(cols, Math.round(s.w), MAX_SPAN)), h = Math.max(min.h, Math.min(MAX_SPAN, Math.round(s.h)));
  const cur = list.find(x => x.key === key); if (!cur || (cur.w === w && cur.h === h)) return list; // unchanged: the same list, nothing re-renders
  return list.map(x => x.key === key ? { ...x, w, h } : x);
}

/** The span a card has on the screen without a layout, from its box: whole cells, at least one. */
export function spanOf(box: { width: number; height: number }, cell: number, gap: number, cols: number): Span {
  const n = (px: number) => Math.max(1, Math.round((px + gap) / (cell + gap)));
  return { w: Math.min(cols, n(box.width)), h: Math.min(MAX_SPAN, n(box.height)) };
}

/** A device id from its name, unique among the house's: «Планшет кухня» → `planshet-kukhnia`, then `-2`… */
const LAT: Record<string, string> = { а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ё: 'e', ж: 'zh', з: 'z', и: 'i', й: 'i', к: 'k', л: 'l', м: 'm', н: 'n', о: 'o', п: 'p', р: 'r', с: 's', т: 't', у: 'u', ф: 'f', х: 'kh', ц: 'ts', ч: 'ch', ш: 'sh', щ: 'sch', ъ: '', ы: 'y', ь: '', э: 'e', ю: 'iu', я: 'ia', ă: 'a', â: 'a', î: 'i', ș: 's', ş: 's', ț: 't', ţ: 't' };
export function profileIdFor(name: string, taken: Iterable<string>): string {
  const base = ([...name.toLowerCase()].map(ch => LAT[ch] ?? ch).join('').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 32)) || 'device';
  const used = new Set(taken); let id = /^[a-z0-9]/.test(base) ? base : `d-${base}`, n = 2;
  while (used.has(id)) id = `${base.slice(0, 32)}-${n++}`;
  return id;
}
