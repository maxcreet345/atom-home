/* «Комнаты» on one screen (1.27.0, owner 11.11.2026: «они должны помещаться на экран без листания»). The page measures the free box under its
 * header (the phone's tab bar and the panel's own padding taken off) and asks this function how many columns and rows its tiles take.
 *
 * Every room fits without scrolling while the tiles can keep their minimums: 88 px tall (the readings and the name stay at 13 px and more),
 * wide enough for a room's name (`minW`), each a target far beyond 44 px. Among the layouts that fit, the one whose tiles are largest wins,
 * in favour of a picture's own shape (about 4:3) and of a grid without empty places; a tile is never taller than 1.6 × its width
 * nor wider than 2.4 × its height (the leftover stays as air below or beside the grid, never stretches a tile into a tower or a strip).
 * Only a house with more rooms than fit at those minimums scrolls — and large text (200 %), whose minimums grow with the font. Pure. */
export interface FitInput { count: number; width: number; height: number; gap: number; minH: number; minW: number }
export interface RoomsFit { cols: number; rows: number; tileW: number; tileH: number; scroll: boolean }

const ASPECT = 4 / 3, TALLEST = 1.6, WIDEST = 2.4;
export function fitRooms({ count, width, height, gap, minH, minW }: FitInput): RoomsFit {
  const n = Math.max(1, Math.floor(count)), W = Math.max(0, width), H = Math.max(0, height);
  let best: (RoomsFit & { score: number }) | null = null;
  for (let c = 1; c <= n; c++) {
    const r = Math.ceil(n / c), w = (W - (c - 1) * gap) / c, h = (H - (r - 1) * gap) / r;
    if (w < minW || h < minH) continue;
    const tileH = Math.min(h, w * TALLEST), tileW = Math.min(w, tileH * WIDEST), shape = 1 - 0.45 * Math.abs(Math.log((tileW / tileH) / ASPECT));
    const score = tileW * tileH * Math.max(0.2, shape) * (1 - 0.06 * (c * r - n));
    if (!best || score > best.score) best = { cols: c, rows: r, tileW: Math.floor(tileW), tileH: Math.floor(tileH), scroll: false, score };
  }
  if (best) { const { score: _score, ...fit } = best; return fit; }
  // nothing fits at the minimums: as many columns as are wide enough, tiles at a calm height, and the page scrolls
  const cols = Math.max(1, Math.min(n, Math.floor((W + gap) / (minW + gap)))), tileW = Math.floor((W - (cols - 1) * gap) / cols);
  return { cols, rows: Math.ceil(n / cols), tileW: Math.max(0, tileW), tileH: Math.floor(Math.max(minH, Math.min(tileW / ASPECT, 220))), scroll: true };
}
