/** Small decisions of the shell that need no DOM (tested under Node: tests/round2-nav.test.ts). */
import type { Key, T } from '../i18n/index.ts';
import type { Action } from '../runtime/actions.ts';
import type { Security } from '../model/security.ts';
import { sk, valveOpenAsk } from '../model/security-words.ts';

/** How long a message stays: never under six seconds, longer for a long sentence («Дом отклонил команду: …» with the house's own reason is
 *  read slower than «Нет связи с домом»), at most twenty. The timer is paused while the pointer rests on it or it has the keyboard focus. */
export function toastLife(text: string, ms = 6000): number {
  const read = 2500 + 75 * [...text.trim()].length;
  return Math.max(6000, ms, Math.min(20000, read));
}

/** The shell's question before a command: what is asked and what the two buttons say (the first one is the one that changes nothing).
 *  Opening the water while a leak sensor is wet takes the Security panel's own words — from a room page and from the valve's sheet alike —
 *  the leak is named and the safe choice («Оставить закрытым») is the prominent one (docs/SECURITY.md, «Кран: открыть»). */
export function confirmWords(a: Action, device: string, t: T, security: Security | null): { text: string; no: string; yes: string; leak: boolean } {
  // an owner's button that opens the water (`valve.*`, or `homeassistant.turn_on` at a valve: `mandatoryRisk`) names the leak the same way (CODEX-001)
  if (((a.domain === 'valve' && a.service === 'open_valve') || (a.risk === 'water' && a.id.startsWith('custom:'))) && security) {
    const ask = valveOpenAsk(security, t);
    if (ask.leak) return { text: ask.text, no: sk(t, 'ask.valveKeep'), yes: sk(t, 'ask.valveOpenYes'), leak: true };
  }
  const special = `confirm.${a.domain === 'alarm_control_panel' ? 'alarm' : a.domain}.${a.id}` as Key, hasSpecial = t(special) !== special;
  const label = t(a.label as Key) === a.label ? a.label : t(a.label as Key);
  const text = a.id === 'all_off' ? t('confirm.lightsOff', { n: a.entityId.split(',').length }) : hasSpecial ? t(special, { device }) : label === device ? t('confirm.text.one', { action: label }) : t('confirm.text', { action: label, device });
  return { text, no: t('confirm.no'), yes: hasSpecial ? label : t('confirm.yes'), leak: false };
}

/** How far a sheet follows the finger, in the shell's OWN pixels: the pointer moves in screen pixels, and inside a zoomed shell (a 4K monitor
 *  with a touch layer, ui/panel-size.ts) a length written into a style is multiplied by the zoom again — the sheet ran ahead of the finger. */
export function swipeDelta(clientY: number, startY: number, zoom: number): number {
  const k = zoom > 0 && Number.isFinite(zoom) ? zoom : 1;
  return Math.max(0, (clientY - startY) / k);
}
/** Whether the toast would lie over the control a person just pressed (1.26.1): a refused «Добавить кнопку» at the foot of a phone's page said its
 *  refusal right over the button for six seconds, so the retry first had to tap the message away. Then the toast says it at the top instead. */
export function rectsMeet(a: { top: number; bottom: number; left: number; right: number }, b: { top: number; bottom: number; left: number; right: number }): boolean {
  return a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;
}
