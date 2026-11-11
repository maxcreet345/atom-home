/* What the Security tile and panel say (docs/SECURITY.md): pure, so it is tested under Node. */
import type { Key, T } from '../i18n/index.ts';
import { openOnes, silentOnes, countdown, type Guarded, type Hazard, type Security } from './security.ts';
export const sk = (t: T, k: string, p?: Record<string, string | number>) => t(`sec.${k}` as Key, p);
const isHazard = (x: Guarded | Hazard): x is Hazard => 'what' in x;
/** Sentences one after another for a screen reader: a full stop between them, but none after a part that already ends with its own mark
 * («Тревога!», «Water leak!») — never «Тревога!. Сработала охрана». */
export const joined = (...parts: string[]): string => parts.map(p => p.trim()).filter(Boolean).map((p, i, all) => i === all.length - 1 || /[.!?…:;]$/.test(p) ? p : `${p}.`).join(' ');
/** A refusal under the buttons, one sentence with one colon: «Не получилось: Нет связи с домом»; a reason that carries its own colon
 * («Дом отклонил команду: …») already says that it did not work and stands alone. */
export const failLine = (prefix: string, reason: string): string => reason.includes(':') ? reason : `${prefix}: ${reason}`;
/** an alarm of gas, smoke or carbon monoxide comes before water */
const hazardNow = (s: Security) => s.hazards.find(h => h.alarm && h.kind === 'gas') ?? s.hazards.find(h => h.alarm) ?? null;
export function stateWord(s: Security, t: T): string {
  const st = s.alarm.state, hz = hazardNow(s);
  if (hz) return sk(t, `st.${hz.what}`);
  if (st === 'triggered') return sk(t, 'st.triggered');
  if (st === 'pending') return sk(t, 'st.pending');
  if (st === 'arming') return sk(t, 'st.arming');
  if (st === 'unknown') return sk(t, 'st.unknown');
  if (st === 'disarmed') return s.vacation?.on ? sk(t, 'st.vacationOff') : sk(t, 'st.disarmed');
  return sk(t, `st.${st}`);
}
/** The tile has room for one word: «Снято», «Не дома», «Охрана», «Отпуск», «Тревога!»; while a delay runs the word carries its seconds («Вход 0:18»). */
export function tileWord(s: Security, t: T, left: number | null = null): string {
  const st = s.alarm.state; if (s.hazards.some(h => h.alarm)) return stateWord(s, t);
  if (st === 'pending' || st === 'arming') return `${sk(t, `tile.${st}`)}${left !== null ? ` ${countdown(left)}` : ''}`; // a no-break space: the seconds never fall onto a line of their own
  return st === 'disarmed' ? sk(t, 'tile.disarmed') : stateWord(s, t);
}
/** «входная дверь», «левое окно · Гостиная», «датчик газа · Кухня» */
export const where = (g: Guarded | Hazard, t: T): string => isHazard(g) ? `${sk(t, `sensor.${g.what}`)}${g.spot ? ` (${g.spot})` : ''}${g.room ? ` · ${g.room}` : ''}`
  : g.kind === 'door' ? sk(t, 'door') : `${g.name.toLowerCase().includes('окн') || g.name.toLowerCase().includes('window') ? g.name.toLowerCase() : sk(t, 'window')} · ${g.room}`;
/** One sentence under the state. An alarm first, then what is open, then a sensor that does not answer — never «Дверь и окна закрыты» with one. */
export function sentence(s: Security, t: T, home: number, guests: boolean): string {
  const hz = hazardNow(s), at = (h: Hazard) => `${h.room || h.name}${h.spot ? `, ${h.spot}` : ''}`;
  if (hz && hz.what !== 'leak') return sk(t, `say.${hz.what}`, { room: at(hz) });
  if (hz) return sk(t, s.valve?.state === 'closed' ? 'say.leakShut' : 'say.leak', { room: at(hz) });
  const open = openOnes(s), tamper = s.guarded.find(x => x.tamper), silent = silentOnes(s);
  if (s.alarm.state === 'triggered') return open.length ? sk(t, 'say.opened', { what: where(open[0], t) }) : sk(t, 'say.triggered');
  if (tamper) return sk(t, 'say.tamper', { what: where(tamper, t) });
  if (s.alarm.state === 'pending') return sk(t, 'say.pending');
  if (s.alarm.state === 'arming') return open.length ? sk(t, 'say.armingOpen', { what: where(open[0], t) }) : sk(t, 'say.arming');
  if (open.length) return open.length === 1 ? sk(t, 'say.open1', { what: where(open[0], t) }) : sk(t, 'say.openN', { n: open.length });
  if (silent.length) return silent.length === 1 ? sk(t, 'say.silent1', { what: where(silent[0], t) }) : sk(t, 'say.silentN', { n: silent.length });
  if (guests && !home) return sk(t, 'say.guests');
  return sk(t, 'say.closed');
}
/** The devices' heading: an alarm, what is open and what does not answer; «всё закрыто» only when every sensor answers and is closed. */
export function devicesWord(s: Security, t: T): string {
  if (s.hazards.some(h => h.alarm)) return sk(t, 'hazardNow');
  const open = openOnes(s).length, silent = silentOnes(s).length;
  return [open ? sk(t, 'openN', { n: open }) : '', silent ? sk(t, 'silentN', { n: silent }) : ''].filter(Boolean).join(' · ') || sk(t, 'allClosed');
}
/** What a door or a window says now. */
export const guardedNow = (g: Guarded, t: T, time: string): string => g.open === null ? sk(t, 'silent') : g.open ? sk(t, 'openSince', { t: time }) + (g.bypassed ? ` · ${sk(t, 'bypassed')}` : '') : sk(t, 'closed');
/** What a gas, smoke or water sensor says now: a silent one «не отвечает», never «сухо»; only a leak sensor that has not reported yet «ждёт первого срабатывания». */
export const hazardWord = (h: Hazard, t: T): string => h.alarm ? sk(t, `${h.what}Now`) : h.alarm === false ? sk(t, h.kind === 'leak' ? 'dry' : 'calmGas') : h.silent ? sk(t, 'silent') : sk(t, 'waitFirst');
export const hazardName = (h: Hazard, t: T): string => `${sk(t, h.what)}${h.spot ? ` · ${h.spot}` : ''}`;
/** Arming is one tap, unless a sensor does not answer: then the panel says which one the guard will not see and asks. */
export function armWarning(s: Security, t: T): string | null {
  const silent = silentOnes(s); if (!silent.length) return null;
  return silent.length === 1 ? sk(t, 'ask.armSilent1', { what: where(silent[0], t) }) : sk(t, 'ask.armSilentN', { n: silent.length });
}
/** Opening the water always asks; while a leak sensor is wet the question names the leak and the safe choice comes first. */
export function valveOpenAsk(s: Security, t: T): { text: string; leak: boolean } {
  const wet = s.hazards.filter(h => h.kind === 'leak' && h.alarm);
  return wet.length ? { text: sk(t, 'ask.valveOpenLeak', { room: wet.map(h => `${h.room || h.name}${h.spot ? `, ${h.spot}` : ''}`).join('; ') }), leak: true } : { text: sk(t, 'ask.valveOpen'), leak: false };
}
/** What the live region announces: only the states a person must hear about (an alarm, gas, water, the entry delay, a tamper), else nothing. */
export function announcement(s: Security, t: T, home: number, guests: boolean): string {
  const loud = s.alarm.state === 'triggered' || s.alarm.state === 'pending' || s.hazards.some(h => h.alarm) || s.guarded.some(x => x.tamper);
  return loud ? joined(stateWord(s, t), sentence(s, t, home, guests)) : '';
}
/** The tile's accessible name: «Безопасность: Тревога! Сработала охрана» — the state and the sentence joined like the announcement. */
export const tileLabel = (s: Security, t: T, home: number, guests: boolean): string => `${sk(t, 'title')}: ${joined(stateWord(s, t), sentence(s, t, home, guests))}`;
/** The shell's banner over every page and sheet (ui/shell-banner.tsx): an alarm, gas or smoke, water and the entry delay, in the tile's own
 *  words; null otherwise (a tamper alone stays on the card, it is announced but does not cover the screen). `id` changes when the reason does. */
export function shellAlarm(s: Security, t: T, home: number, guests: boolean): { id: string; text: string; sub: string; /** the entry delay is running: the banner shows its seconds */ counting: boolean } | null {
  const wet = s.hazards.filter(h => h.alarm), st = s.alarm.state;
  if (!wet.length && st !== 'triggered' && st !== 'pending') return null;
  return { id: wet.length ? `hazard:${wet.map(h => h.id).join(',')}` : st, text: stateWord(s, t), sub: sentence(s, t, home, guests), counting: !wet.length && st === 'pending' && s.alarm.delayEnds !== null };
}
