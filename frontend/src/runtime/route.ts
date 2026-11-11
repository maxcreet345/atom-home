import { SECTIONS, type Section } from '../model/kinds.ts';

/** Where the panel is: a section, inside «Комнаты» a room, over the page a sheet (`device`), and a page's own switch (`filter`). */
export type View = { section: Section | 'setup'; room: string | null; device: string | null; filter: string | null };
export const decode = (hash: string): View => { const [s, q = ''] = hash.replace(/^#/, '').split('?'); const p = new URLSearchParams(q); return { section: s === 'setup' ? 'setup' : (SECTIONS as readonly string[]).includes(s) ? s as Section : 'home', room: p.get('room'), device: p.get('device'), filter: p.get('filter') }; };
export const encode = (v: View) => { const p = new URLSearchParams(); if (v.room) p.set('room', v.room); if (v.device) p.set('device', v.device); if (v.filter) p.set('filter', v.filter); const q = p.toString(); /* not the params' `size`: Safari ≤ 16 and Chromium ≤ 112 have none, and every room and sheet then stayed shut */ return `#${v.section}${q ? '?' + q : ''}`; };
/** One scroll position and one keyboard place per page: a sheet or a filter does not make a new page. */
export const pageOf = (v: View) => `${v.section}/${v.room ?? ''}`;

/** The slice of `window` navigation uses (a test hands its own). */
export interface NavWindow { location: { hash: string }; history: { readonly state: unknown; pushState(state: unknown, unused: string, url: string): void; replaceState(state: unknown, unused: string, url: string): void; back(): void } }
/** Every entry the panel pushes remembers the address it was pushed from: that is the entry «Back» leads to. */
const FROM = 'atomHomeFrom';
const cameFrom = (win: NavWindow): View | null => { const s = win.history.state as Record<string, unknown> | null; return s && typeof s === 'object' && typeof s[FROM] === 'string' ? decode(s[FROM] as string) : null; };
/** Opens `next` as a new history entry. False when the address is already this one: nothing is pushed (two taps make one entry). */
export function pushView(win: NavWindow, next: View): boolean {
  const from = encode(decode(win.location.hash)), to = encode(next);
  if (from === to) return false;
  win.history.pushState({ [FROM]: from }, '', to);
  return true;
}
/** The same entry under another address (a page's own switch, a stale address being repaired). */
export function replaceView(win: NavWindow, next: View): void { win.history.replaceState(win.history.state, '', encode(next)); }
/** Leaving what was opened (a sheet's «×», «‹ Комнаты», «‹ Пылесос»): when the entry before this one is where we are going, go back in
 * history — «Back» then never reopens what was just closed, and opening and closing three times costs no extra «Back». Otherwise (a
 * deep link, an entry reached another way) this entry becomes the target. Returns what it did; after 'back' the `popstate` brings the view. */
export function leaveTo(win: NavWindow, target: View, fits: (previous: View) => boolean = p => encode(p) === encode(target)): 'back' | 'replace' {
  // `history.back()` lands a tick later: a second close before that (the doorbell's auto-close together with a tap on «×», two Escapes)
  // is the same close, not one more step back
  const gone = leaving.get(win);
  if (gone && gone.hash === win.location.hash && gone.state === win.history.state && Date.now() - gone.at < 1000) return 'back';
  const prev = cameFrom(win);
  if (prev && fits(prev)) { leaving.set(win, { hash: win.location.hash, state: win.history.state, at: Date.now() }); win.history.back(); return 'back'; }
  replaceView(win, target);
  return 'replace';
}
const leaving = new WeakMap<NavWindow, { hash: string; state: unknown; at: number }>();
/** The browser went somewhere (popstate): the step back asked for by `leaveTo` has landed. */
export function landed(win: NavWindow): void { leaving.delete(win); }
/** «Back» pressed while a question was open closes the question only: the entry the browser has just left is opened again, with the same
 * way back as before (the entry it was pushed from is the one the browser stands on now). False when the address did not change. */
export function stayOn(win: NavWindow, view: View): boolean {
  const from = encode(decode(win.location.hash)), to = encode(view);
  if (from === to) return false;
  win.history.pushState({ [FROM]: from }, '', to);
  return true;
}
/** What an address that does not exist (any more) falls back to; null when the view is fine.
 * `sections` are the ones that can be shown now, `rooms` the known room ids, `sheet` whether `device` names something that opens. */
export function repair(v: View, known: { sections: ReadonlyArray<string>; systems: ReadonlyArray<string>; allSystems: ReadonlyArray<string>; rooms: ReadonlyArray<string>; sheet: boolean }): View | null {
  if (!known.sections.includes(v.section)) return { section: (known.allSystems.includes(v.section) ? known.systems[0] as View['section'] | undefined : undefined) ?? 'home', room: null, device: null, filter: null };
  if (v.room && (v.section !== 'rooms' || !known.rooms.includes(v.room))) return { section: v.section, room: null, device: null, filter: v.section === 'rooms' ? null : v.filter };
  if (v.device && !known.sheet) return { ...v, device: null };
  return null;
}
/** A control of a page as it can be found again after the page was drawn anew: its name and which of the same-named ones it is. */
export interface FocusMark { label: string; nth: number }
const FOCUSABLE = 'button, a[href], input, select, textarea, [tabindex]:not([tabindex="-1"])';
const labelOf = (el: Element) => (el.getAttribute('aria-label') ?? el.textContent ?? '').replace(/\s+/g, ' ').trim().slice(0, 80);
export function markOf(page: ParentNode | null, el: Element | null): FocusMark | null {
  if (!page || !el || !(el as HTMLElement).isConnected) return null;
  const hit = el.closest(FOCUSABLE); if (!hit || !page.contains(hit)) return null;
  const label = labelOf(hit), same = Array.from(page.querySelectorAll(FOCUSABLE)).filter(x => labelOf(x) === label);
  return { label, nth: Math.max(0, same.indexOf(hit)) };
}
export function findMark(page: ParentNode | null, mark: FocusMark | null): HTMLElement | null {
  if (!page || !mark) return null;
  const same = Array.from(page.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(x => labelOf(x) === mark.label && !(x as HTMLButtonElement).disabled);
  return same[mark.nth] ?? same[0] ?? null;
}
