/** Layout decisions of the shell, taken from the PANEL's own size (inside Home Assistant the panel is 256 px narrower than the window, so
 *  `@media` would lie): the size classes the stylesheets key on, and the scale of a screen read from far away. */

/** Panel widths the stylesheets branch on: the shell carries `pw-N` when it is at least N px wide (apple.css / atom.css: «panel (…)» rules). */
export const WIDTH_STEPS = [381, 421, 561, 601, 641, 700, 701, 980, 991, 1180, 1300, 2000, 2400] as const;
/** The same for the panel's height (`ph-N`). */
export const HEIGHT_STEPS = [421, 461, 521, 641, 821] as const;

export interface PanelInput { /** no pointer that can hover: a touch screen or a remote */ noHover: boolean; /** no pointing device at all: a television with a remote */ noPointer: boolean; /** the screen takes fingers (`navigator.maxTouchPoints > 0`): a wall kiosk however large, never a television */ touch?: boolean }
/** A television: nothing hovers, nothing touches, and either there is no pointer at all or the screen is Full HD and wider (a TV browser that
 *  reports its remote as a coarse pointer). A touch screen of 1920 px on a wall is a big tablet: laid out 1:1 (audit 2026-11-09, round 2). */
export const isTv = (width: number, input: PanelInput): boolean => input.noHover && !input.touch && (input.noPointer || width >= 1800);
export interface PanelLayout { scale: number; width: number; height: number; wide: boolean; landscape: boolean; short: boolean; compact: boolean; tv: boolean; classes: string }

const clamp = (lo: number, v: number, hi: number) => Math.max(lo, Math.min(hi, v));

/** How much bigger than CSS pixels the panel is drawn.
 *  A television (a remote, seen from 3 m) is laid out as a 960×540 screen and enlarged to fill: 2× on Full HD, 4× on 4K, so 12 px reads as 24 px.
 *  A monitor beyond 2560×1440 at 100 % (4K, 5K2K) is laid out as 2560×1440 and enlarged, so nothing is left at 11–12 px on a 4K panel.
 *  Everything else is 1: phones, tablets, laptops and ultrawide monitors up to 1440 px tall. */
export function panelScale(width: number, height: number, input: PanelInput): number {
  const tv = isTv(width, input);
  const k = tv ? clamp(1, Math.min(width / 960, height / 540), 4) : input.noHover ? 1 : clamp(1, Math.min(width / 2560, height / 1440), 2);
  return Math.round(k * 100) / 100;
}

export function panelLayout(outer: { width: number; height: number }, input: PanelInput): PanelLayout {
  const scale = panelScale(outer.width, outer.height, input), tv = isTv(outer.width, input);
  const width = Math.floor(outer.width / scale), height = Math.floor(outer.height / scale);
  const wide = width >= 600, landscape = width > height, short = height <= 700, compact = wide && width < 760;
  const classes = [wide ? 'is-wide' : 'is-narrow', compact ? 'is-compact' : '', landscape ? 'is-landscape' : 'is-portrait', short ? 'is-short' : '', tv ? 'is-tv' : '',
    ...WIDTH_STEPS.filter(n => width >= n).map(n => `pw-${n}`), ...HEIGHT_STEPS.filter(n => height >= n).map(n => `ph-${n}`)].filter(Boolean).join(' ');
  return { scale, width, height, wide, landscape, short, compact, tv, classes };
}

/** What the browser says about the pointing devices (a television's browser reports neither hover nor a pointer). */
export function panelInput(win: (Pick<Window, 'matchMedia'> & { navigator?: { maxTouchPoints?: number } }) | undefined): PanelInput {
  const q = (s: string) => { try { return !!win?.matchMedia?.(s).matches; } catch { return false; } };
  let touch = false; try { touch = (win?.navigator?.maxTouchPoints ?? 0) > 0; } catch { /* a window that hides its navigator */ }
  return { noHover: q('(any-hover: none)'), noPointer: q('(any-pointer: none)'), touch };
}

/** Whether the header has room for one chip per person (photo, name, «дома»). Below 760 px of panel the chips were cut to «Cri…», and on a phone
 *  on its side they pushed the header into a second row (130 of 360 px): there the people collapse into the avatar stack with one summary, as on a phone. */
export function peopleChips(panel: Pick<PanelLayout, 'wide' | 'compact' | 'short' | 'width'>, count: number): boolean {
  return panel.wide && !panel.compact && !(panel.short && panel.width < 1000) && count <= 4;
}
/** Where a header menu may stand. `r` is its box as measured (screen pixels), `view` the window, `zoom` how much the shell is enlarged (a
 *  television, a 4K monitor: panelScale). The answers are in the shell's OWN pixels — a style length written inside a zoomed shell is multiplied
 *  by the zoom again, so a height taken straight from the measurement came out 2–4× too large there and the menu ran off the screen. */
/*  ST-09 (studio): the room a menu may take ends where the panel's own tab bar begins (a phone on its side: the last person used to sit under
 *  «Acasă»), at the panel's bottom inside Home Assistant, and at the window's: `view.bottom` / `view.top`, screen pixels, when the caller knows
 *  them. The menu ends 12 px above that bottom and scrolls inside itself; only when under its button there are not even 96 px of the panel's own
 *  does it move up (`dy`, the shell's own pixels), never above `view.top`. */
export function menuFit(r: { left: number; right: number; top: number; bottom: number }, view: { width: number; height: number; bottom?: number; top?: number }, zoom: number): { dx: number; maxHeight: number | null; dy?: number } {
  const k = zoom > 0 && Number.isFinite(zoom) ? zoom : 1, edge = 12 * k;
  const dx = r.left < edge ? edge - r.left : r.right > view.width - edge ? view.width - edge - r.right : 0;
  const B = Math.min(view.height, view.bottom ?? Infinity) - edge, T = Math.max(0, view.top ?? 0) + edge;
  if (r.bottom <= B) return { dx: dx / k, maxHeight: null };
  const room = B - r.top, least = 96 * k;
  if (room >= least) return { dx: dx / k, maxHeight: room / k };
  const dy = Math.min(0, Math.max(T, B - least) - r.top); // up just enough for two rows, never above the top
  return { dx: dx / k, maxHeight: Math.max(96, (B - (r.top + dy)) / k), ...(dy ? { dy: dy / k } : {}) };
}

/** The panel's size in whole pixels, never under 320: the SAME object when nothing changed, so the caller can tell without comparing. */
export function nextViewport(now: { width: number; height: number }, width: number, height: number): { width: number; height: number } {
  const w = Math.max(320, Math.floor(width)), h = Math.max(320, Math.floor(height));
  return w === now.width && h === now.height ? now : { width: w, height: h };
}
