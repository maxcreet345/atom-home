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
/** below the integration's 160 cards a screen (layouts.py MAX_ITEMS) */
export const MAX_KEPT = 150;
export const SCOPE_HOME = 'home';
export const roomScope = (roomId: string) => `room:${roomId}`;
/** A page's own arrangement (owner, 23.11.2026: «расклад карточек должен распространяться на комнаты, свет, устройства, энергию, безопасность»). */
export const pageScope = (page: string) => `page:${page}`;
const PROFILE_ID = /^[a-z0-9][a-z0-9_-]{0,39}$/;
const SCOPE = /^(home|room:[A-Za-z0-9_.:-]{1,80}|page:[a-z]{1,24})$/;
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
  // cards away for good (a replaced sensor) must not fill the screen's list past what the integration takes: the last absent ones go first
  const absent = rows.filter(r => !on.has(r[0]));
  for (let i = absent.length - 1; i >= 0 && rows.length > MAX_KEPT; i--) rows.splice(rows.indexOf(absent[i]), 1);
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

/** A page's own block (the chart of «Энергия», the guard of «Безопасность»): it is as tall as it is, and its width is kept in eighths of the
 * page's row (8 = the whole row), so the same arrangement reads the same whatever number of columns the screen has now. */
export const BLOCK_FULL = 8;
const half = (v: number, up: boolean) => { const f = Math.floor(v), r = v - f; return Math.abs(r - .5) < 1e-6 ? (up ? f + 1 : f) : Math.round(v); };
/** The eighths a block takes from the share of the row it has on the screen (7 of 12 beside 5 of 12 → 5 and 3: together still one row). */
export const blockWidth = (share: number): number => Math.max(1, Math.min(BLOCK_FULL, half(share * BLOCK_FULL, share > .5)));
/** The columns a block of `w` eighths takes on a grid of `cols` (two blocks that shared a row still share it). */
export const blockCols = (w: number, cols: number): number => { const c = Math.max(1, cols), x = Math.max(1, Math.min(BLOCK_FULL, w)); return Math.max(1, Math.min(c, half(x / BLOCK_FULL * c, x > BLOCK_FULL / 2))); };
/** The eighths that draw `want` columns on a grid of `cols`: what a pull of the corner or a press of «шире» keeps. */
export function blockFor(want: number, cols: number): number {
  const c = Math.max(1, cols), k = Math.max(1, Math.min(c, Math.round(want)));
  if (k >= c) return BLOCK_FULL;
  let best = 1, far = Infinity;
  for (let w = 1; w <= BLOCK_FULL; w++) { const d = Math.abs(blockCols(w, c) - k); if (d < far || (d === far && Math.abs(w / BLOCK_FULL * c - k) < Math.abs(best / BLOCK_FULL * c - k))) { best = w; far = d; } }
  return best;
}

/** A device id from its name, unique among the house's: «Планшет кухня» → `planshet-kukhnia`, then `-2`… */
const LAT: Record<string, string> = { а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ё: 'e', ж: 'zh', з: 'z', и: 'i', й: 'i', к: 'k', л: 'l', м: 'm', н: 'n', о: 'o', п: 'p', р: 'r', с: 's', т: 't', у: 'u', ф: 'f', х: 'kh', ц: 'ts', ч: 'ch', ш: 'sh', щ: 'sch', ъ: '', ы: 'y', ь: '', э: 'e', ю: 'iu', я: 'ia', ă: 'a', â: 'a', î: 'i', ș: 's', ş: 's', ț: 't', ţ: 't' };
export function profileIdFor(name: string, taken: Iterable<string>): string {
  const base = ([...name.toLowerCase()].map(ch => LAT[ch] ?? ch).join('').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 32)) || 'device';
  const used = new Set(taken); let id = /^[a-z0-9]/.test(base) ? base : `d-${base}`, n = 2;
  while (used.has(id)) id = `${base.slice(0, 32)}-${n++}`;
  return id;
}
