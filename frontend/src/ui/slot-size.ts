/* The size a card has on an arranged screen (ui/layout-grid.tsx, «Расставить»), so it can show itself the way that size reads best
 * (owner 21.11.2026: «карточки оптимизируются под разные стандарты?» — «делай все карточки»). Outside an arrangement there is no
 * size here and every card draws exactly as before. Size classes, as phone widgets have them:
 *   s  — one cell: the glyph, the one thing that matters, its name;
 *   w  — wide, one row high (2×1, 3×1…): the same laid out across, plus two or three readings or buttons;
 *   t  — tall, one column wide (1×2, 1×3…): the same stacked, plus a short list;
 *   l  — two by two: the card as it is today;
 *   xl — three or more cells either way: the card at its largest, with what it has to say in more detail.
 * CSS reads the same class on the slot (`.at-slot[data-size="w"]`) and the slot is a size container named `slot`. */
import { createContext } from 'preact';
import { useContext } from 'preact/hooks';

export type SizeClass = 's' | 'w' | 't' | 'l' | 'xl';
export interface SlotSize { w: number; h: number; size: SizeClass }
export function sizeClass(w: number, h: number): SizeClass {
  if (w <= 1 && h <= 1) return 's';
  if (h <= 1) return 'w';
  if (w <= 1) return 't';
  return w >= 3 || h >= 3 ? 'xl' : 'l';
}
export const SlotSizeCtx = createContext<SlotSize | null>(null);
/** The card's size on an arranged screen; null everywhere else (draw as before). */
export const useSlotSize = () => useContext(SlotSizeCtx);
