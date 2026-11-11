import { useEffect, useRef, useState } from 'preact/hooks';
import type { Host } from '../runtime/host.ts';
import type { Key, T } from '../i18n/index.ts';
import { errorText, type Lang } from './format.ts';
import { Icon } from './primitives.tsx';
import { DeviceArt } from './device-art.tsx';
import { boilerMark, dayOf, heatTone, heatingRooms, houseSet, hystMax, outdoorText, pressureWord, problemRoom, returnDate, roomLocked, scenarioNow, vacationArming, type HeatRoom, type Heating, type HeatTone, type Scenario } from '../model/heating.ts';
import { heatingActions, vacationDisarms } from '../model/heating-act.ts';
import { stepCore, stepValue, type StepCore } from '../model/heating-step.ts';
import { CommandError } from '../runtime/commands.ts';
export { heatingActions };
/** The Heating card and panel (mock for the owner, 09.11.2026). The look is the Air card's family: a tinted tile with a little character
 * and one sentence, a panel with a wide tinted hero, then the rooms and the boiler. docs/HEATING.md */
const tk = (t: T, k: string, p?: Record<string, string | number>) => t(`module.heat.${k}` as Key, p);
const LOC: Record<Lang, string> = { ru: 'ru-RU', ro: 'ro-RO', en: 'en-GB' };
/** 20 → «20», 20.5 → «20,5»: the set temperature; the room's reading always has its tenth. */
const setT = (v: number | null, lang: Lang) => v === null ? '—' : v.toLocaleString(LOC[lang], { maximumFractionDigits: 1 });
const nowT = (v: number | null, lang: Lang) => v === null ? '—' : v.toLocaleString(LOC[lang], { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const hhmm = (ms: number) => new Date(ms).toTimeString().slice(0, 5);
const left = (ms: number, t: T) => { const m = Math.max(1, Math.round(ms / 60000)), h = Math.floor(m / 60); return h ? tk(t, 'leftHM', { h, m: m % 60 }) : tk(t, 'leftM', { m }); };
const short = (name: string) => name.length > 9 ? `${name.slice(0, 4)}.` : name;
/** One command at a time per card: the button that sent it waits, a refusal is said in words. */
/** The refusal is said next to the control that sent it (a room's card, the scenarios, the hero), and the next accepted command clears it. */
/** The host a card gets is guarded (runtime/commands.ts): with the house offline nothing is sent and the call is refused, the same call on its
 * way is not sent twice. The refusal is told with its real reason (`errorText`: «Нет связи с домом», «Дом отклонил команду: …»). */
/** Pending and the refusal are kept PER KEY (audit round 2): a second command with another key does not take the waiting look off the first
 * button, and an accepted command clears its own refusal only, never another control's. A control that waits is `aria-disabled` + `aria-busy`,
 * not `disabled`: a disabled button drops the keyboard focus to the page. */
const NONE: ReadonlySet<string> = new Set();
export function useAct(t: T) {
  const [busy, setBusy] = useState<ReadonlySet<string>>(NONE), [bad, setBad] = useState<ReadonlyArray<{ key: string; text: string }>>([]), going = useRef(new Set<string>());
  const drop = (key: string) => setBad(b => b.some(x => x.key === key) ? b.filter(x => x.key !== key) : b);
  const fail = (key: string, e?: unknown) => { const text = e === undefined ? tk(t, 'failed') : errorText(e, t); setBad(b => [...b.filter(x => x.key !== key), { key, text }]); };
  /** an accepted command clears its own line; called without a key it clears every line (as before, for a card with one control) */
  const ok = (key?: unknown) => { if (typeof key === 'string') drop(key); else setBad(b => b.length ? [] : b); };
  const run = (key: string, p: () => Promise<unknown>) => { if (going.current.has(key)) return; going.current.add(key); setBusy(new Set(going.current)); drop(key); let work: Promise<unknown>; try { work = p(); } catch (e) { work = Promise.reject(e); } work.then(() => drop(key), e => fail(key, e)).finally(() => { going.current.delete(key); setBusy(new Set(going.current)); }); };
  /** the newest refusal among the keys asked for */
  const err = (...keys: string[]) => { for (let i = bad.length - 1; i >= 0; i--) if (keys.some(k => bad[i].key === k || bad[i].key.startsWith(k + ':'))) return bad[i].text; return null; };
  const pending = (key: string) => busy.has(key);
  /** the house is off the line: a press on a dimmed control is answered with the reason («Нет связи с домом»), nothing is sent */
  const refuse = (key: string) => fail(key, new CommandError());
  return { busy, pending, err, fail, ok, run, refuse };
}
/** After the common temperature changed the automation puts it on every head: for that half a minute a room's own − / + would be undone, so they wait. */
const HOLD_MS = 30000; let commonAt = 0; const holdSubs = new Set<() => void>();
const markCommon = () => { commonAt = Date.now(); holdSubs.forEach(f => f()); };
function useCommonHold(): boolean {
  const [, tick] = useState(0), left = commonAt + HOLD_MS - Date.now();
  useEffect(() => { const f = () => tick(x => x + 1); holdSubs.add(f); return () => { holdSubs.delete(f); }; }, []);
  useEffect(() => { if (left <= 0) return; const i = setTimeout(() => tick(x => x + 1), left + 50); return () => clearTimeout(i); }, [commonAt, left > 0]);
  return left > 0;
}
/** The room the panel shows first after the tile was tapped with a problem (set by the tile, read once by the panel). */
let focusRoom: string | null = null;
export const Err = ({ text }: { text: string | null }) => <p className="at-heat-err" role="alert">{text ?? ''}</p>;
/** Turning the whole house's heating off asks once more; turning it on does not. */
function Power({ on, busy, t, onPower, offline, stale, onStale }: { on: boolean; busy: boolean; t: T; onPower: (v: boolean) => void; offline?: boolean; /** the house is off the line: a press says so */ stale?: boolean; onStale?: () => void }) {
  const [ask, setAsk] = useState(false), cancel = useRef<HTMLButtonElement>(null), main = useRef<HTMLButtonElement>(null), back = useRef(false);
  // focus goes to the safe choice when the question opens, and back to the button when it closes (WCAG 2.4.3)
  useEffect(() => { if (ask) cancel.current?.focus(); else if (back.current) { back.current = false; main.current?.focus(); } }, [ask]);
  const close = () => { back.current = true; setAsk(false); };
  if (offline) return <p className="at-heat-modehint">{tk(t, 'screenOffPower')}</p>; // HA would quietly skip a command to a thermostat it cannot reach
  // «Отмена» first, the action second — the order of every question of the panel (the shell's, «Безопасность»)
  if (ask) return <div className="at-heat-confirm" role="group" aria-label={tk(t, 'confirmOff')} onKeyDown={e => { if (e.key === 'Escape') { e.stopPropagation(); close(); } }}><span>{tk(t, 'confirmOff')}</span><button type="button" ref={cancel} className="at-heat-power is-on" onClick={e => { e.stopPropagation(); close(); }}>{tk(t, 'cancel')}</button><button type="button" className="at-heat-power is-danger" onClick={e => { e.stopPropagation(); close(); onPower(false); }}>{tk(t, 'offYes')}</button></div>;
  return <button type="button" ref={main} className={`at-heat-power ${on ? 'is-on' : ''}`} aria-disabled={busy || stale || undefined} aria-busy={busy || undefined} onClick={e => { e.stopPropagation(); if (stale) { onStale?.(); return; } if (busy) return; if (on) setAsk(true); else onPower(true); }}><Icon name="power" size={16} />{on ? tk(t, 'turnOff') : tk(t, 'turnOn')}</button>;
}
/** The house's little radiator: warm and smiling with heat rising while a room heats, content when all is warm, asleep when off, worried when something is wrong. */
export function Radiator({ tone }: { tone: HeatTone }) {
  const fins = [0, 1, 2, 3].map(i => <rect x={14 + i * 24} y="34" width="20" height="54" rx="9" className="at-heat-fin" />);
  return <svg className={`at-heat-buddy is-${tone}`} viewBox="0 0 124 104" aria-hidden="true">
    {tone === 'heat' && <g className="at-heat-waves" fill="none" stroke="currentColor" stroke-width="4" stroke-linecap="round"><path d="M38 26c-5-5 5-9 0-15" /><path d="M62 24c-5-5 5-9 0-15" /><path d="M86 26c-5-5 5-9 0-15" /></g>}
    {tone === 'off' && <g className="at-heat-zz" fill="currentColor" font-size="15" font-weight="700"><text x="88" y="22">z</text><text x="100" y="12" font-size="11">z</text></g>}
    <rect x="8" y="80" width="108" height="8" rx="4" className="at-heat-pipe" />{fins}
    <rect x="20" y="88" width="8" height="10" rx="3" className="at-heat-pipe" /><rect x="96" y="88" width="8" height="10" rx="3" className="at-heat-pipe" />
    {tone === 'off' ? <path d="M46 58q5 4 10 0M68 58q5 4 10 0" fill="none" stroke="#2b3a44" stroke-width="3.4" stroke-linecap="round" /> : tone === 'warn' ? <g fill="#2b3a44"><ellipse cx="51" cy="57" rx="4.5" ry="5.5" /><ellipse cx="73" cy="57" rx="4.5" ry="5.5" /><path d="M43 47l11 3M81 47l-11 3" stroke="#2b3a44" stroke-width="3" stroke-linecap="round" /></g> : <path d="M45 58q6-7 12 0M67 58q6-7 12 0" fill="none" stroke="#2b3a44" stroke-width="3.4" stroke-linecap="round" />}
    {tone !== 'off' && <><ellipse cx="42" cy="68" rx="6" ry="3.8" fill="#ff6f5a" opacity=".4" /><ellipse cx="82" cy="68" rx="6" ry="3.8" fill="#ff6f5a" opacity=".4" /></>}
    {tone === 'warn' ? <path d="M56 74q6-5 12 0" fill="none" stroke="#2b3a44" stroke-width="3" stroke-linecap="round" /> : tone === 'off' ? <path d="M58 72h8" stroke="#2b3a44" stroke-width="3" stroke-linecap="round" /> : <path d="M55 70q7 6 14 0" fill="none" stroke="#2b3a44" stroke-width="3" stroke-linecap="round" />}
  </svg>;
}
const WIN = 'M5 3h14v18H5zM12 3v18M5 12h14';
export const Glyph = ({ d, size = 14 }: { d: string; size?: number }) => <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d={d} /></svg>;
/** The words for a room's state, the same on the tile's chip (its label) and in the panel. */
function roomWord(r: HeatRoom, t: T, now: number) {
  if (r.action === 'offline') return tk(t, 'r.offline');
  if (r.action === 'window') return tk(t, 'r.window');
  const open = r.windows.find(w => w.open);
  if (open && open.since && now - open.since < 60000) return tk(t, 'r.windowSoon');
  if (r.action === 'off') return tk(t, 'r.off');
  return r.action === 'heating' ? tk(t, 'r.heating') : tk(t, 'r.idle');
}
function sentence(h: Heating, t: T, lang: Lang): string {
  if (!h.systemKnown) return tk(t, 'noState');
  if (!h.system) return tk(t, 'offSentence');
  if (!h.thermostatOnline) return tk(t, 'screenOff');
  // a boiler whose bus is silent, or whose relay does not answer, is said on the tile too, after a lost head and beside the rooms' state
  const off = h.rooms.filter(r => r.action === 'offline'), tail = !h.boiler.online ? tk(t, 'boilerSilent') : h.boiler.relay === null ? tk(t, 'relaySilent') : '';
  if (off.length) return [tk(t, 'noLink', { rooms: off.map(r => r.name).join(', ') }), tail].filter(Boolean).join(' · ');
  if (h.boiler.pressureLow || h.boiler.pressureHigh) return tk(t, h.boiler.pressureLow ? 'pressureLow' : 'pressureHigh', { v: h.boiler.pressure === null ? '—' : h.boiler.pressure.toLocaleString(LOC[lang], { maximumFractionDigits: 2 }) });
  const n = heatingRooms(h), win = h.rooms.filter(r => r.action === 'window');
  const main = n ? tk(t, 'heatN', { n, total: h.rooms.length }) : tk(t, 'warmAll');
  return [main, win.length ? tk(t, 'winPaused', { n: win.length }) : '', tail].filter(Boolean).join(' · ');
}
function caption(h: Heating, t: T): string {
  if (!h.system) return tk(t, 'offHint');
  if (!h.scenarioKnown) return tk(t, 'noScenario');
  if (h.mode === 'manual') return h.scenario === 'vacation' ? tk(t, 'capVacation') : tk(t, 'capManual');
  const sc = tk(t, `sc.${h.scenario}`);
  if (h.scenario === 'home') return tk(t, 'capHome');
  if (h.scenario === 'sleep') return h.scenarioOverride ? tk(t, 'capOwnTill', { s: sc, at: h.sleep.to }) : tk(t, 'capTill', { s: sc, at: h.sleep.to });
  return h.scenarioOverride ? tk(t, 'capOwn', { s: sc }) : sc;
}
/** The number the house is held at (model `houseSet`): in «Ручной» the rooms' common value when they agree, else their range. */
function houseValue(h: Heating, lang: Lang): { text: string; value: number | null; lo?: number } {
  const x = houseSet(h);
  return { text: x.lo !== undefined && x.hi !== undefined ? `${setT(x.lo, lang)}–${setT(x.hi, lang)}` : setT(x.shown, lang), value: x.value, lo: x.lo };
}
/** ± answers at once and sends the last value after a short pause, so five taps are one command. */
/** A refused command puts the real value back and says so; an accepted one that HA never reflects gives up after 20 s. */
/** The logic is `stepCore` (model/heating-step.ts): the value goes out with the `send` of the tap itself — the mode and scenario the person saw —
 * also when the card is left within the pause; stepping back to the house's own value sends nothing. */
export function useStepper(value: number | null, send: (v: number) => Promise<unknown>, onFail: (e?: unknown) => void, onOk: () => void, min = 8, max = 24, lo?: number, by = 0.5) {
  const [local, setLocal] = useState<number | null>(null), core = useRef<StepCore | null>(null);
  core.current ??= stepCore(setLocal);
  useEffect(() => { core.current!.settled(); if (local !== null && value === local) setLocal(null); }, [value]);
  // leaving the card within the pause still sends the last value: a tap is never lost
  useEffect(() => () => core.current!.flush(), []);
  const shown = local ?? value;
  const step = (dir: 1 | -1) => { if (shown === null) return; core.current!.push(stepValue(shown, local, dir, min, max, by, lo), { send, ok: onOk, fail: onFail }, value); };
  return { shown, step, pending: local !== null && local !== value, atMin: shown !== null && (local ?? lo ?? shown) <= min, atMax: shown !== null && shown >= max };
}
export function Stepper({ value, text, onStep, t, size = 'big', disabled, wait, busy, onWait, label, atMin, atMax, pending, fine, words }: { value: number | null; text: string; onStep: (d: 1 | -1) => void; t: T; size?: 'big' | 'small'; /** cannot be stepped at all: a real `disabled` */ disabled?: boolean; /** not now (the house is off the line, a command is being applied): `aria-disabled`, the focus stays, a press calls `onWait` */ wait?: boolean; /** …and it is a wait for a command (`aria-busy`) */ busy?: boolean; onWait?: () => void; label: string; atMin?: boolean; atMax?: boolean; pending?: boolean; /** steps of 0,2° */ fine?: boolean; /** the buttons' own words after the label («Гостиная: теплее») */ words?: [down: string, up: string] }) {
  const dn = words?.[0] ?? tk(t, fine ? 'downFine' : 'down'), up = words?.[1] ?? tk(t, fine ? 'upFine' : 'up');
  return <div className={`at-heat-step is-${size} ${pending ? 'is-pending' : ''} ${text.includes('–') ? 'is-range' : ''}`} role="group" aria-label={label}>
    <button type="button" className="at-heat-pm" aria-label={`${label}: ${dn}`} disabled={disabled || value === null} aria-disabled={wait || atMin || undefined} aria-busy={busy || undefined} onClick={e => { e.stopPropagation(); if (wait) { onWait?.(); return; } if (!atMin) onStep(-1); }}><svg width="20" height="20" viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12h14" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" /></svg></button>
    <b aria-live="polite">{text}<i>°</i></b>
    <button type="button" className="at-heat-pm" aria-label={`${label}: ${up}`} disabled={disabled || value === null} aria-disabled={wait || atMax || undefined} aria-busy={busy || undefined} onClick={e => { e.stopPropagation(); if (wait) { onWait?.(); return; } if (!atMax) onStep(1); }}><svg width="20" height="20" viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12h14M12 5v14" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" /></svg></button>
  </div>;
}
function ModeSwitch({ h, t, onMode, busy, stale, onStale }: { h: Heating; t: T; onMode: (m: 'auto' | 'manual') => void; /** the mode's command is on its way */ busy?: boolean; /** the house is off the line: a press says so */ stale?: boolean; onStale?: () => void }) {
  // the group is the radio set; the arrow keys are not needed for two options, Tab reaches both
  return <div className="at-heat-mode" role="radiogroup" aria-label={tk(t, 'mode')} aria-busy={busy || undefined}>{(['auto', 'manual'] as const).map(m => <button type="button" role="radio" aria-checked={h.mode === m} className={h.mode === m ? 'is-on' : ''} aria-disabled={busy || stale || undefined} onClick={e => { e.stopPropagation(); if (stale) { onStale?.(); return; } if (!busy && h.mode !== m) onMode(m); }}>{tk(t, `mode.${m}`)}</button>)}</div>;
}
/** One room on the tile: its radiator lit while it heats, its reading, its name; a window or a lost head says so instead of the reading. */
function Chip({ r, t, lang, now }: { r: HeatRoom; t: T; lang: Lang; now: number }) {
  const winOpen = r.windows.some(w => w.open);
  return <li className={`at-heat-chip is-${r.action}`} aria-label={`${r.name}: ${nowT(r.current, lang)}°, ${roomWord(r, t, now)}`}>
    <span className="at-heat-chip-dot" aria-hidden="true">{r.action === 'window' || winOpen ? <Glyph d={WIN} size={13} /> : r.action === 'offline' ? '!' : <Icon name="flame" size={13} />}</span>
    <b>{r.action === 'offline' ? '—' : <>{nowT(r.current, lang)}<i>°</i></>}</b><small>{short(r.name)}</small>
  </li>;
}
/** The house's − / + : the value goes out with the mode and scenario of the tap, and the rooms' own steppers wait while the automation applies it. */
function useHouse(h: Heating, host: Host, t: T, lang: Lang) {
  const act = heatingActions(h, host), hv = houseValue(h, lang), ui = useAct(t);
  const st = useStepper(hv.value, v => { markCommon(); return act.house(v); }, e => ui.fail('house', e), () => ui.ok('house'), 8, 24, hv.lo);
  return { act, hv, ui, st, text: st.pending && st.shown !== null ? setT(st.shown, lang) : hv.text };
}
export function HeatingTile({ h, host, t, lang, onOpen, now }: { h: Heating; host: Host; t: T; lang: Lang; onOpen: () => void; now: number }) {
  const tone = heatTone(h), { act, ui, st, text } = useHouse(h, host, t, lang), offline = !host.online;
  // a tile that reports a problem opens the panel at the room with the problem
  return <div className={`ah-tile hm-card at-heat-tile hz-${tone}`} data-mode={h.mode}>
    <button type="button" className="at-heat-open" aria-label={`${tk(t, 'title')}: ${sentence(h, t, lang)}. ${tk(t, 'open')}`} onClick={() => { focusRoom = problemRoom(h)?.key ?? null; onOpen(); }} />
    <span className="at-heat-tile-buddy"><Radiator tone={tone} /></span>
    <div className="at-heat-tile-head"><strong>{tk(t, 'title')}</strong><small>{sentence(h, t, lang)}</small><Err text={ui.err('house', 'mode', 'power')} /></div>
    <div className="at-heat-tile-mid">
      {h.system || !h.systemKnown ? <><ModeSwitch h={h} t={t} busy={ui.pending('mode')} stale={offline} onStale={() => ui.refuse('mode')} onMode={m => ui.run('mode', () => act.mode(m))} />
        <Stepper value={st.shown} text={text} onStep={st.step} t={t} label={tk(t, 'houseTemp')} wait={offline} onWait={() => ui.refuse('house')} atMin={st.atMin} atMax={st.atMax} pending={st.pending} />
        <small className="at-heat-cap">{caption(h, t)}</small></> :
        <><b className="at-heat-offword">{tk(t, 'offWord')}</b>{h.systemKnown && <Power on={false} busy={ui.pending('power')} stale={offline} onStale={() => ui.refuse('power')} offline={!h.thermostatOnline} t={t} onPower={v => ui.run('power', () => act.power(v))} />}</>}
    </div>
    <ul className="at-heat-chips">{h.rooms.map(r => <Chip r={r} t={t} lang={lang} now={now} />)}</ul>
  </div>;
}
/* ---------- the panel ---------- */
function RoomCard({ r, h, act, t, lang, now, ui, offline }: { r: HeatRoom; h: Heating; act: ReturnType<typeof heatingActions>; t: T; lang: Lang; now: number; ui: ReturnType<typeof useAct>; offline?: boolean }) {
  const st = useStepper(r.target, v => act.room(r, v), e => ui.fail(`room:${r.key}`, e), () => ui.ok(`room:${r.key}`), 5, 30), hold = useCommonHold(), locked = roomLocked(h);
  // a tap the automation would undo is not offered: in «Отпуск», and for half a minute after the common temperature changed — with the reason in the room's line
  // what cannot be done at all is `disabled`; what only waits (the common temperature being applied, the house off the line) keeps the focus and answers a press
  const why = locked ? tk(t, 'roomVac') : hold ? tk(t, 'roomHold') : '', dis = !h.system || r.action === 'offline' || r.action === 'window' || locked, wait = hold || !!offline;
  const own = h.mode === 'auto' && r.override, gap = r.current !== null && st.shown !== null ? st.shown - r.current : null;
  const fill = r.current === null || st.shown === null ? 0 : Math.max(4, Math.min(100, 100 - Math.max(0, st.shown - r.current) / 3 * 100));
  const openWins = r.windows.filter(w => w.open), deaf = r.windows.filter(w => !w.known);
  return <article className={`at-heat-room is-${r.action}`} aria-label={r.name} data-room={r.key} tabIndex={-1}>
    <header><strong>{r.name}</strong><span className={`at-heat-badge is-${r.action}`}>{r.action === 'heating' && <i className="at-heat-badge-wave" aria-hidden="true" />}{roomWord(r, t, now)}</span></header>
    <div className="at-heat-room-nums">
      <div className="at-heat-now"><b>{r.action === 'offline' ? '—' : <>{nowT(r.current, lang)}<i>°</i></>}</b><small>{r.sensor === 'head' ? tk(t, 'atHead') : r.sensor === 'lost' ? tk(t, 'lastKnown') : tk(t, 'inRoom')}</small></div>
      <div className="at-heat-set"><small>{own ? tk(t, 'ownSet') : h.mode === 'manual' ? tk(t, 'manualSet') : tk(t, 'set')}</small>
        {r.action === 'window' || r.action === 'off' || !h.system ? <b className="is-muted">{tk(t, 'r.off')}</b> : <Stepper value={st.shown} text={setT(st.shown, lang)} onStep={st.step} t={t} size="small" disabled={dis} wait={wait} busy={hold && !offline} onWait={() => { if (offline) ui.refuse(`room:${r.key}`); }} label={r.name} words={[tk(t, 'cooler'), tk(t, 'warmer')]} atMin={st.atMin} atMax={st.atMax} pending={st.pending} />}</div>
    </div>
    <div className="at-heat-bar" aria-hidden="true"><i style={`width:${fill}%`} /></div>
    <p className="at-heat-room-line">{r.action === 'window' ? tk(t, 'windowLine', { w: openWins.map(w => w.name.toLowerCase()).join(', ') || tk(t, 'aWindow') }) : r.action === 'offline' ? tk(t, 'offlineLine') : why ? why : r.sensor === 'head' ? tk(t, 'headLine') : r.sensor === 'lost' ? tk(t, 'sensorLostLine') : gap !== null && gap > 0.05 && r.action === 'heating' ? tk(t, 'gapLine', { d: setT(Math.round(gap * 10) / 10, lang) }) : r.action === 'idle' ? tk(t, 'idleLine') : r.action === 'off' ? tk(t, 'offLine') : ''}</p>
    {own && r.override && <div className="at-heat-own"><span><Icon name="hourglass" size={15} />{tk(t, 'ownLine', { v: setT(r.override.temp, lang), at: hhmm(r.override.until), left: left(r.override.until - now, t) })}</span><button type="button" className="hm-text-btn" aria-disabled={ui.pending(`back:${r.key}`) || offline || undefined} aria-busy={ui.pending(`back:${r.key}`) || undefined} onClick={() => { if (offline) ui.refuse(`back:${r.key}`); else ui.run(`back:${r.key}`, () => act.back(r)); }}>{tk(t, 'backAuto')}</button></div>}
    <Err text={ui.err(`room:${r.key}`, `back:${r.key}`)} />
    <footer>
      {/* a window whose sensor does not answer is not a closed window */}
      <span className={openWins.length || deaf.length ? 'is-open' : ''}><Glyph d={WIN} />{r.windows.length ? (openWins.length ? tk(t, 'winOpen', { w: openWins.map(w => w.name.toLowerCase()).join(', ') }) + (deaf.length ? ` · ${tk(t, 'winSilent', { n: deaf.length })}` : '') : deaf.length ? tk(t, 'winSilent', { n: deaf.length }) : r.windows.length > 1 ? tk(t, 'winsClosed', { n: r.windows.length }) : tk(t, 'winClosed')) : tk(t, 'noWin')}</span>
      {r.battery !== null && <span className={r.battery < 20 ? 'is-open' : ''}><Icon name="battery" size={14} />{r.battery} %</span>}
    </footer>
  </article>;
}
const SCEN: Array<{ id: Scenario | 'guests'; flag?: 'eco' | 'guests' | 'vacation' }> = [{ id: 'home' }, { id: 'sleep' }, { id: 'away' }, { id: 'eco', flag: 'eco' }, { id: 'guests', flag: 'guests' }, { id: 'vacation', flag: 'vacation' }];
/** «Отпуск» asks both ways (docs/UX-GUIDE.md): switching on with the return date, switching off with what it undoes — with the house's own
 * security it takes the house off guard. The safe choice has the focus; Escape cancels. */
function Scenarios({ h, act, t, lang, ui, now, offline }: { h: Heating; act: ReturnType<typeof heatingActions>; t: T; lang: Lang; ui: ReturnType<typeof useAct>; now: number; offline?: boolean }) {
  const [ask, setAsk] = useState<'on' | 'off' | null>(null), [back, setBack] = useState(''), [past, setPast] = useState(false), cancel = useRef<HTMLButtonElement>(null), opener = useRef<HTMLElement | null>(null), dateEl = useRef<HTMLInputElement>(null);
  useEffect(() => { if (ask) cancel.current?.focus(); else if (opener.current) { opener.current.focus(); opener.current = null; } }, [ask]);
  // the exit delay of the house's security towards «Отпуск»: the heating's own switch is still off, but «Отпуск» is on its way — the card says
  // «Включается…» and a tap asks to switch it OFF (that disarms), never a second «Включить?»
  const arming = vacationArming(h);
  const press = (k: 'eco' | 'guests' | 'vacation', on: boolean, el: HTMLElement) => { if (offline) { ui.refuse(k); return; } if (ui.pending(k)) return; if (k === 'vacation') { opener.current = el; setBack(h.vacationReturn ?? ''); setPast(false); setAsk(on ? 'on' : 'off'); return; } ui.run(k, () => act.flag(k, on)); };
  const sub = (id: string) => id === 'home' ? tk(t, 'scs.home') : id === 'sleep' ? `${h.sleep.from}–${h.sleep.to}` : id === 'away' ? tk(t, 'scs.away') : id === 'eco' ? tk(t, 'scs.eco') : id === 'guests' ? tk(t, 'scs.guests') : h.vacation && h.vacationReturn ? tk(t, 'scs.back', { at: new Date(`${h.vacationReturn}T00:00:00`).toLocaleDateString(LOC[lang], { day: 'numeric', month: 'short' }) }) : tk(t, 'scs.vacation');
  const question = ask === 'on' ? tk(t, h.security?.vacation ? 'vacAskSec' : 'vacAsk', { v: setT(h.temps.vacation, lang) }) : tk(t, vacationDisarms(h) ? 'vacOffAskSec' : 'vacOffAsk');
  // a return date that has passed is not dropped in silence: the field says so and «Отпуск» is not switched on without the date the person believes they set
  const yes = () => { const on = ask === 'on', d = returnDate(on ? back : '', now); if (d.past) { setPast(true); dateEl.current?.focus(); return; } setAsk(null); ui.run('vacation', () => act.vacation(on, d.date)); };
  return <section className="at-heat-sec"><div className="hm-section-head"><h2>{tk(t, 'scenario')}</h2></div>
    <div className="at-heat-scen">{SCEN.map(s => { const cur = scenarioNow(h, s.id), coming = s.flag === 'vacation' && arming, on = s.flag ? h[s.flag] || coming : cur, temp = s.id === 'guests' ? null : h.temps[s.id as Scenario], wait = !!s.flag && ui.pending(s.flag);
      const body = <><span className="at-heat-scen-top"><strong>{tk(t, `sc.${s.id}`)}</strong>{temp !== null && <b>{setT(temp, lang)}°</b>}</span><small>{sub(s.id)}</small>{coming ? <em className="is-sw">{tk(t, 'turningOn')}</em> : cur ? <em>{tk(t, 'now')}</em> : s.flag ? <em className="is-sw">{on ? tk(t, 'on') : tk(t, 'turnOnShort')}</em> : <em className="is-auto">{tk(t, 'byItself')}</em>}</>;
      return s.flag ? <button type="button" role="switch" aria-checked={on} className={`at-heat-scen-card ${cur ? 'is-now' : ''} ${on ? 'is-on' : ''}`} data-coming={coming || undefined} aria-disabled={wait || offline || undefined} aria-busy={wait || coming || undefined} onClick={e => press(s.flag!, !on, e.currentTarget as HTMLElement)}>{body}</button> : <div className={`at-heat-scen-card ${cur ? 'is-now' : ''}`}>{body}</div>; })}</div>
    {ask && <div className="at-heat-confirm is-wide" role="group" aria-label={question} onKeyDown={e => { if (e.key === 'Escape') { e.stopPropagation(); setAsk(null); } }}><span>{question}</span>
      {ask === 'on' && h.vacationReturnId && <label className="at-heat-back"><span>{tk(t, 'vacBack')}</span><input type="date" ref={dateEl} lang={lang} aria-label={tk(t, 'vacBack')} aria-invalid={past || undefined} aria-describedby={past ? 'at-heat-back-err' : undefined} min={dayOf(now)} value={back} onInput={e => { setBack((e.currentTarget as HTMLInputElement).value); setPast(false); }} />{past && <b className="at-heat-err" id="at-heat-back-err" role="alert">{tk(t, 'vacBackPast')}</b>}</label>}
      <button type="button" ref={cancel} className="at-heat-power is-on" onClick={() => setAsk(null)}>{tk(t, 'cancel')}</button><button type="button" className="at-heat-power is-danger" onClick={yes}>{tk(t, ask === 'on' ? 'vacYes' : 'vacOffYes')}</button></div>}
    <Err text={ui.err('eco', 'guests', 'vacation')} /></section>;
}
/** One hysteresis for all five heads. A head can open again at most 1° below where it closes, so «down» and «up» share that degree. */
function Hysteresis({ h, act, t, lang, ui, offline }: { h: Heating; act: ReturnType<typeof heatingActions>; t: T; lang: Lang; ui: ReturnType<typeof useAct>; offline?: boolean }) {
  const y = h.hyst!, down = useStepper(y.down, v => act.hyst('down', v), e => ui.fail('hyst', e), () => ui.ok('hyst'), 0.2, 1, undefined, 0.2), up = useStepper(y.up, v => act.hyst('up', v), e => ui.fail('hyst', e), () => ui.ok('hyst'), 0, 1, undefined, 0.2);
  const base = h.target ?? 20, d = down.shown ?? y.down, u = up.shown ?? y.up, f = (v: number) => v.toLocaleString(LOC[lang], { minimumFractionDigits: 1, maximumFractionDigits: 1 });
  // each ceiling is counted from what the other one shows now, a tap not sent yet included: together never more than 1°
  const dMax = hystMax(u), uMax = hystMax(d), over = (v: number, max: number) => v >= max - 1e-9;
  return <section className="at-heat-sec"><div className="hm-section-head"><h2>{tk(t, 'hyst')}</h2><small className="at-heat-sec-hint">{tk(t, 'hystAll')}</small></div>
    <div className="at-heat-hyst">
      <div className="at-heat-hyst-row"><div><strong>{tk(t, 'hystDown')}</strong><small>{tk(t, 'hystDownHint')}</small></div><Stepper value={down.shown} text={f(d)} onStep={dir => { if (dir < 0 || !over(d, dMax)) down.step(dir); }} t={t} size="small" wait={offline} onWait={() => ui.refuse('hyst')} label={tk(t, 'hystDown')} fine atMin={down.atMin} atMax={down.atMax || over(d, dMax)} pending={down.pending} /></div>
      <div className="at-heat-hyst-row"><div><strong>{tk(t, 'hystUp')}</strong><small>{tk(t, 'hystUpHint')}</small></div><Stepper value={up.shown} text={f(u)} onStep={dir => { if (dir < 0 || !over(u, uMax)) up.step(dir); }} t={t} size="small" wait={offline} onWait={() => ui.refuse('hyst')} label={tk(t, 'hystUp')} fine atMin={up.atMin} atMax={up.atMax || over(u, uMax)} pending={up.pending} /></div>
      <p className="at-heat-hyst-say">{tk(t, 'hystExample', { t: setT(base, lang), from: f(Math.round((base - d) * 10) / 10), to: f(Math.round((base + u) * 10) / 10) })}</p>
      <Err text={ui.err('hyst')} />
    </div></section>;
}
/** The hysteresis for everyone who is not an administrator: one line with the values the house holds, nothing to press — it tunes all five heads
 * and is not an everyday action (audit round 2; as the settings of «Безопасность» and of a device's sheet). */
function HysteresisLine({ h, t, lang }: { h: Heating; t: T; lang: Lang }) {
  const y = h.hyst!, f = (v: number) => v.toLocaleString(LOC[lang], { minimumFractionDigits: 1, maximumFractionDigits: 1 });
  return <section className="at-heat-sec"><div className="hm-section-head"><h2>{tk(t, 'hyst')}</h2><small className="at-heat-sec-hint">{tk(t, 'hystAll')}</small></div>
    <div className="at-heat-hyst is-readonly"><p className="at-heat-hyst-say">{tk(t, 'hystNow', { d: f(y.down), u: f(y.up) })}</p></div></section>;
}
function BoilerCard({ h, t, lang }: { h: Heating; t: T; lang: Lang }) {
  const b = h.boiler, f = (v: number | null, d = 1) => v === null ? '—' : v.toLocaleString(LOC[lang], { maximumFractionDigits: d }), pw = pressureWord(b);
  const cell = (label: string, value: string, unit: string, sub: string, tone = '') => <div className={`at-heat-bcell ${tone}`}><small>{label}</small><b>{value}{value !== '—' && <i>{unit}</i>}</b><span>{sub}</span></div>;
  // three answers each: the flame and the relay may be unknown, and unknown is neither «не горит» nor «нет запроса»
  const state = !b.online ? tk(t, 'b.offline') : b.flame === null ? tk(t, 'b.flameUnknown') : b.flame ? (b.relay === null ? tk(t, 'b.burning') : b.relay ? tk(t, 'b.burningHeat') : tk(t, 'b.burningDhw')) : tk(t, 'b.idle');
  return <section className="at-heat-sec"><div className="hm-section-head"><h2>{tk(t, 'boiler')}</h2></div>
    <article className={`at-heat-boiler ${b.online ? '' : 'is-offline'} ${b.flame ? 'is-burning' : ''}`}>
      <header><span className="at-heat-boiler-art"><DeviceArt type="boiler" fill /></span><div><strong>Demir Döküm Nitromix P24</strong><small>{state}</small></div>
        <span className={`at-heat-relay ${b.relay ? 'is-on' : ''} ${b.relay === null ? 'is-lost' : ''}`}><Icon name={b.relay === null ? 'warning' : 'flame'} size={15} />{b.relay === null ? tk(t, 'b.relayLost') : b.online ? (b.relay ? tk(t, 'b.ask') : tk(t, 'b.noAsk')) : b.relay ? tk(t, 'b.askRelay') : tk(t, 'b.noAskRelay') /* with the bus silent the word is the relay's own, not the boiler's */}</span></header>
      <div className="at-heat-bgrid">
        {cell(tk(t, 'b.flow'), f(b.flow), '°', b.flowTarget !== null ? tk(t, 'b.target', { v: f(b.flowTarget, 0) }) : '')}
        {cell(tk(t, 'b.dhw'), f(b.dhw), '°', b.dhwTarget !== null ? tk(t, 'b.target', { v: f(b.dhwTarget, 0) }) : '')}
        {cell(tk(t, 'b.return'), f(b.ret), '°', b.flow !== null && b.ret !== null ? `Δ ${f(Math.abs(b.flow - b.ret))}°` : '')}
        {cell(tk(t, 'b.pressure'), f(b.pressure, 2), ' bar', pw === null ? '' : pw === 'low' ? tk(t, 'b.low') : pw === 'high' ? tk(t, 'b.high') : pw === 'norm' ? tk(t, 'b.norm') : tk(t, 'b.normBy'), pw === 'low' || pw === 'high' ? 'is-warn' : '')}
      </div>
      {/* ST-05: with the boiler silent the note says exactly what is known — the relay asks for heat, does not, or does not answer itself;
          the relay is never taken for a burning flame */}
      {!b.online && <p className="at-heat-bnote">{tk(t, b.relay === null ? 'b.offlineRelayUnknown' : b.relay ? 'b.offlineRelayOn' : 'b.offlineRelayOff')}</p>}
    </article></section>;
}
export function HeatingPanel({ h, host, t, lang, now }: { h: Heating; host: Host; t: T; lang: Lang; now: number }) {
  const tone = heatTone(h), { act, ui, st, text } = useHouse(h, host, t, lang), offline = !host.online, root = useRef<HTMLDivElement>(null);
  const o = outdoorText(h.outdoor), out = o ? tk(t, 'outside', { v: setT(o.temp, lang).replace('-', '−'), w: o.key && t(o.key as Key) !== o.key ? ` · ${t(o.key as Key).toLocaleLowerCase()}` : '' }) : '';
  const wins = h.rooms.flatMap(r => r.windows), openN = wins.filter(w => w.open).length, deafN = wins.filter(w => !w.known).length;
  // opened from a tile that reported a problem: the room with the problem comes into view and takes the focus
  useEffect(() => { const key = focusRoom; focusRoom = null; if (!key) return; const el = root.current?.querySelector<HTMLElement>(`[data-room="${key}"]`); if (!el) return; const raf = requestAnimationFrame(() => { el.scrollIntoView({ block: 'center' }); el.focus({ preventScroll: true }); }); return () => cancelAnimationFrame(raf); }, []);
  return <div className={`at-heat-panel ${offline ? 'is-stale' : ''}`} ref={root}>
    <section className={`at-heat-hero hz-${tone}`} aria-label={tk(t, 'title')}>
      <div className="at-heat-hero-text"><h2>{tk(t, 'title')}</h2>{out && <small>{out}</small>}<p className="at-heat-hero-say">{sentence(h, t, lang)}</p>{offline && <p className="at-heat-stale">{tk(t, 'stale')}</p>}<Err text={ui.err('house', 'mode', 'power')} /></div>
      <span className="at-heat-hero-buddy"><Radiator tone={tone} /></span>
      <div className="at-heat-hero-ctl">
        {h.system || !h.systemKnown ? <div className="at-heat-hero-temp"><Stepper value={st.shown} text={text} onStep={st.step} t={t} label={tk(t, 'houseTemp')} wait={offline} onWait={() => ui.refuse('house')} atMin={st.atMin} atMax={st.atMax} pending={st.pending} /><small className="at-heat-cap">{caption(h, t)}</small></div> : <div className="at-heat-hero-temp"><b className="at-heat-offword">{tk(t, 'offWord')}</b><small className="at-heat-cap">{tk(t, 'offHint')}</small></div>}
        <ul className="at-heat-hero-facts">
        <li className={(m => m ? `is-${m}` : '')(boilerMark(h.boiler))}><Icon name={!h.boiler.online || h.boiler.relay === null ? 'warning' : 'flame'} size={15} />{!h.boiler.online ? tk(t, 'f.boilerOff') : h.boiler.relay === null ? tk(t, 'b.relayLost') : h.boiler.flame ? tk(t, 'f.burning', { v: setT(h.boiler.flow === null ? null : Math.round(h.boiler.flow), lang) }) : h.boiler.flame === null ? tk(t, 'b.flameUnknown') : tk(t, 'f.rest')}</li>
        <li><Icon name="thermo" size={15} />{h.thermostatOnline ? tk(t, 'f.screen') : tk(t, 'f.screenOff')}</li>
        <li className={openN || deafN ? 'is-warn' : ''}><Glyph d={WIN} />{[openN ? tk(t, 'f.winOpen', { n: openN }) : '', deafN ? tk(t, 'f.winSilent', { n: deafN }) : ''].filter(Boolean).join(' · ') || tk(t, 'f.winClosed')}</li>
      </ul>
        <div className="at-heat-hero-side">{(h.system || !h.systemKnown) && <ModeSwitch h={h} t={t} busy={ui.pending('mode')} stale={offline} onStale={() => ui.refuse('mode')} onMode={m => ui.run('mode', () => act.mode(m))} />}<small className="at-heat-modehint">{h.mode === 'manual' ? tk(t, 'manualHint') : tk(t, 'autoHint')}</small>
          {h.systemKnown && <Power on={h.system} busy={ui.pending('power')} stale={offline} onStale={() => ui.refuse('power')} offline={!h.thermostatOnline} t={t} onPower={v => ui.run('power', () => act.power(v))} />}</div>
      </div>

    </section>
    <section className="at-heat-sec"><div className="hm-section-head"><h2>{tk(t, 'rooms')}</h2><small className="at-heat-sec-hint">{roomLocked(h) ? tk(t, 'roomVac') : h.mode === 'manual' ? tk(t, 'roomsManual') : tk(t, 'roomsAuto')}</small></div>
      <div className="at-heat-rooms">{h.rooms.map(r => <RoomCard r={r} h={h} act={act} t={t} lang={lang} now={now} ui={ui} offline={offline} />)}</div></section>
    <Scenarios h={h} act={act} t={t} lang={lang} ui={ui} now={now} offline={offline} />
    <BoilerCard h={h} t={t} lang={lang} />
    {h.hyst && (host.admin ? <Hysteresis h={h} act={act} t={t} lang={lang} ui={ui} offline={offline} /> : <HysteresisLine h={h} t={t} lang={lang} />)}
  </div>;
}
/** One room's head as the panel draws it, for that room's own page (room page mock, 09.11.2026). */
export function HeatRoomCard({ h, room, host, t, lang, now }: { h: Heating; room: HeatRoom; host: Host; t: T; lang: Lang; now: number }) {
  const act = heatingActions(h, host), ui = useAct(t);
  return <RoomCard r={room} h={h} act={act} t={t} lang={lang} now={now} ui={ui} offline={!host.online} />;
}
/** The room's line of the head, in the panel's own words: «Греет до 20,5°», «Окно открыто — ждёт». */
export function heatRoomWord(r: HeatRoom, t: T, now: number): string { return roomWord(r, t, now); }
export { setT as heatSetText };
