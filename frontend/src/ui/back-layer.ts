/* «Назад» with a window open over a sheet (a new timer, the alarm editor) closes that window only, as it closes an open question (audit
 * 22.11.2026: «Время → Новый таймер → Назад закрывает всё»). The window says it is open; the shell asks here before it leaves the sheet. */
import { useEffect, useRef } from 'preact/hooks';
const layers: Array<{ back: () => void }> = [];
/** The window on top takes the next «Назад»; `on` false: it is not shown now. */
export function useBackLayer(onBack: () => void, on = true): void {
  const fn = useRef(onBack); fn.current = onBack;
  useEffect(() => { if (!on) return; const layer = { back: () => fn.current() }; layers.push(layer); return () => { const i = layers.indexOf(layer); if (i >= 0) layers.splice(i, 1); }; }, [on]);
}
/** True when a window took the «Назад»: the shell stays on the page it was leaving. */
export function backLayer(): boolean { const top = layers[layers.length - 1]; if (!top) return false; top.back(); return true; }
