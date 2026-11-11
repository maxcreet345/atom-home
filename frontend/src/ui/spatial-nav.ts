/** Arrow keys move the focus (audit 2026-11-09, round 2: a11y2-tv-arrows-do-nothing). A television's remote has four arrows, OK and Back —
 *  no Tab; a keyboard user gets the same on every size. The geometry is pure (`nearest`), the DOM part picks the candidates of the TOP layer:
 *  whatever is not under `inert` (the shell marks the page inert under a sheet, the sheet under a question), so a question → the sheet →
 *  otherwise the page with the navigation and the banners.
 *
 *  Never a trap and never a thief:
 *   - a key somebody already handled (`defaultPrevented`: the energy chart's ←/→, a card's own menu), or pressed with a modifier, is left alone;
 *   - a control that uses the arrows itself keeps them: a text field, a select, a slider (`role="slider"`, `input[type=range]`), editable text;
 *   - no candidate in that direction → nothing is done and the browser scrolls as before;
 *   - somebody who clicked or tapped last keeps the arrows for scrolling (except on a television, which has nothing else). */
export type Dir = 'up' | 'down' | 'left' | 'right';
export interface Box { left: number; top: number; right: number; bottom: number }
export const DIR_OF: Record<string, Dir | undefined> = { ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right' };

/** The index of the box to go to from `from`, or -1. A candidate must lie in the direction (its centre beyond ours); those that overlap us on
 *  the cross axis (the same row for ←/→, the same column for ↑/↓) come first, the nearest of them wins; otherwise the nearest by distance,
 *  the sideways part counted double so that «down» prefers what is below over what is far to the side. */
export function nearest(from: Box, boxes: ReadonlyArray<Box>, dir: Dir): number {
  const horizontal = dir === 'left' || dir === 'right', sign = dir === 'right' || dir === 'down' ? 1 : -1;
  const lo = (b: Box) => horizontal ? b.left : b.top, hi = (b: Box) => horizontal ? b.right : b.bottom;
  const clo = (b: Box) => horizontal ? b.top : b.left, chi = (b: Box) => horizontal ? b.bottom : b.right;
  const mid = (b: Box) => (lo(b) + hi(b)) / 2, cmid = (b: Box) => (clo(b) + chi(b)) / 2;
  let best = -1, bestTier = 2, bestScore = Infinity;
  boxes.forEach((b, i) => {
    if (hi(b) - lo(b) <= 0 || chi(b) - clo(b) <= 0) return; // nothing to see
    const ahead = (mid(b) - mid(from)) * sign; if (ahead < 1) return; // not in that direction
    const gap = Math.max(0, sign > 0 ? lo(b) - hi(from) : lo(from) - hi(b)); // edge to edge along the way; 0 for a box that overlaps or sits inside
    const overlap = Math.min(chi(b), chi(from)) - Math.max(clo(b), clo(from));
    const tier = overlap > 0 ? 0 : 1, side = overlap > 0 ? 0 : -overlap;
    const score = tier === 0 ? gap + Math.abs(cmid(b) - cmid(from)) * 0.3 + ahead * 0.01 : gap + side * 2 + ahead * 0.01;
    if (tier < bestTier || (tier === bestTier && score < bestScore)) { best = i; bestTier = tier; bestScore = score; }
  });
  return best;
}

const FOCUSABLE = 'button, a[href], input, select, textarea, summary, [tabindex]';
/** A control that needs the arrows for itself. */
const OWN_ARROWS = 'textarea, select, [contenteditable=""], [contenteditable="true"], [role="slider"], [role="spinbutton"], input:not([type="checkbox"]):not([type="radio"]):not([type="button"]):not([type="submit"]):not([type="reset"])';
export const keepsArrows = (el: Element | null): boolean => !!el && typeof el.matches === 'function' && el.matches(OWN_ARROWS);

const shown = (el: HTMLElement) => { const r = el.getBoundingClientRect(); if (r.width <= 0 || r.height <= 0) return null; const cs = getComputedStyle(el); return cs.visibility === 'hidden' || cs.display === 'none' ? null : r; };
/** What the arrows can reach now: focusable, enabled, visible, not under `inert`, not the skip link (it shows only when focused). */
export function candidates(shell: HTMLElement): Array<{ el: HTMLElement; box: Box }> {
  const out: Array<{ el: HTMLElement; box: Box }> = [];
  for (const el of Array.from(shell.querySelectorAll<HTMLElement>(FOCUSABLE))) {
    if ((el as HTMLButtonElement).disabled || el.tabIndex < 0 || el.classList.contains('at-skip') || el.closest('[inert]')) continue;
    const box = shown(el); if (box) out.push({ el, box });
  }
  return out;
}
export interface ArrowNav { stop(): void }
/** `tv`: a television (no pointer to scroll with): the arrows always walk. `last`: the control that had the focus last (ui/focus-keep.ts). */
export function arrowNav(win: Window, shell: () => HTMLElement | null, o: { tv: () => boolean; last: () => HTMLElement | null }): ArrowNav {
  let pointer = false; // the last thing the person did was a click or a tap: the arrows are theirs to scroll with
  const down = () => { pointer = true; };
  const key = (e: KeyboardEvent) => {
    if (e.key === 'Tab') { pointer = false; return; }
    const dir = DIR_OF[e.key]; if (!dir) return;
    if (e.defaultPrevented || e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return;
    const root = shell(); if (!root) return;
    if (pointer && !o.tv()) return;
    const target = (e.composedPath?.()[0] ?? e.target) as Element | null;
    if (keepsArrows(target)) return;
    const scope = root.getRootNode() as Document | ShadowRoot, at = scope.activeElement as HTMLElement | null;
    const list = candidates(root); if (!list.length) return;
    let to: HTMLElement | null = null;
    const here = at && root.contains(at) && !at.closest('[inert]') ? at : null;
    const inside = here && !list.some(c => c.el === here) ? list.find(c => here.contains(c.el)) : undefined;
    if (inside) to = inside.el; // the focus stands on a box (a sheet opened by touch, the page after «К содержимому»): its first control
    else if (here && here !== root && shown(here) && (here.matches(FOCUSABLE) || list.some(c => c.el === here))) {
      const others = list.filter(c => c.el !== here), i = nearest(here.getBoundingClientRect(), others.map(c => c.box), dir);
      to = i >= 0 ? others[i].el : null;
    } else {
      // nothing has the focus: back to where it was, else to the first control of the top layer (the page's own before the navigation's)
      const was = o.last();
      to = (was && list.find(c => c.el === was)?.el) ?? list.find(c => c.el.closest('.hm-confirm, .hm-sheet, .hm-page'))?.el ?? list[0].el;
    }
    if (!to) return; // nothing that way: the browser's own scrolling stays
    e.preventDefault();
    to.focus({ preventScroll: true });
    to.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
  };
  win.addEventListener('pointerdown', down, true);
  win.addEventListener('keydown', key);
  return { stop() { win.removeEventListener('pointerdown', down, true); win.removeEventListener('keydown', key); } };
}
