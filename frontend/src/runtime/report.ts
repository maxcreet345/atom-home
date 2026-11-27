/** Where the panel tells what went wrong (27.11.2026). Two kinds, two budgets (runtime/self-heal.ts): a part that broke (a card, a page, a timer
 *  of the panel) and a refusal — a save or a command the house turned down, which the person saw only as a message that faded. live-main.tsx
 *  sets both to the integration's own log (`atom_home/log/write`, kept across restarts); here they only reach the console. */
type Report = (error: unknown, where: string) => void;
let crash: Report = (error, where) => { console.error(`[atom-home] ${where}:`, error); };
let refusal: Report = (error, where) => { console.info(`[atom-home] refused ${where}:`, error); };
export function setErrorReporter(report: Report) { crash = report; }
export function setRefusalReporter(report: Report) { refusal = report; }
export function reportError(error: unknown, where: string) { try { crash(error, where); } catch { /* reporting must never throw */ } }
export function reportRefusal(error: unknown, where: string) { try { refusal(error, where); } catch { /* reporting must never throw */ } }
/** What is worth the house's log: not a lost connection (the panel says «Нет связи с домом» itself; home-assistant-js-websocket's code 3,
 *  the panel's own `offline`), not a conflict (two screens saving at once is ordinary and the panel reads afresh). */
export function isRefusal(e: unknown): boolean {
  const code = (e as { code?: unknown } | null)?.code;
  return code !== 3 && code !== 'offline' && code !== 'conflict';
}
