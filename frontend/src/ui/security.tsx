import { useEffect, useId, useLayoutEffect, useRef, useState } from 'preact/hooks';
import { Art, Ask, Bars, Battery, Case, Chevron, Ring, Row, SecurityFeed } from './office-security.tsx';
import type { Host } from '../runtime/host.ts';
import { CommandError, type Commands } from '../runtime/commands.ts';
import type { T } from '../i18n/index.ts';
import type { Registry } from '../model/registry.ts';
import type { HouseConfig } from '../model/config.ts';
import { errorText, locales, type Lang } from './format.ts';
import { calendarDay, countdown, delayClock, questionStands, returnDate, secTone, VACATION_LABEL, type AskKind, type Guarded, type Hazard, type Security, type SecTone } from '../model/security.ts';
import { houseToday } from '../runtime/zone.ts';
import { announcement, armWarning, devicesWord, failLine, guardedNow, hazardName, hazardWord, sentence, sk, stateWord, tileLabel, tileWord, valveOpenAsk } from '../model/security-words.ts';
import { people } from '../model/people.ts';
import { NO_RETURN_DAY } from '../model/heating.ts';
/** The alarm panel went silent while «Отпуск» was on its way (ST-06): the sequence stops, the panel says «Нет связи с охраной». */
class AlarmGone extends Error { constructor() { super('alarm gone'); this.name = 'AlarmGone'; } }
/** The Security card and panel (owner, 09.11.2026, book/06-dashboards/SECURITY.md). Mock from real code: Alarmo's state, the modes «Не дома»
 * (by presence), «Охрана» (by hand), «Отпуск», «Гости», the door and windows, tamper, gas and water, the bathroom valve. */
const GLYPH: Record<string, string> = { door: 'M7 3h10v18H7zM14 12h.01M4 21h16', window: 'M5 4h14v16H5zM12 4v16M5 12h14', gas: 'M12 3c1 3 5 5 5 10a5 5 0 0 1-10 0c0-3 2-4 2-7 1 1 2 2 3 4 0-3 0-5 0-7z', leak: 'M12 3c3 4 6 7 6 11a6 6 0 0 1-12 0c0-4 3-7 6-11z', valve: 'M3 12h4M17 12h4M7 8h10v8H7zM12 8V4M9 4h6' };
const Glyph = ({ k }: { k: string }) => <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d={GLYPH[k]} /></svg>;
const hm = (ms: number | null, lang: Lang) => ms === null ? '' : new Date(ms).toLocaleTimeString(locales[lang], { hour: '2-digit', minute: '2-digit' });
/** The mark follows the tone; `mark` overrides it (an office disarmed with a tamper is amber, but not ticked as guarded). */
export function Shield({ tone, size = 64, mark }: { tone: SecTone; size?: number; mark?: 'alert' | 'open' | 'check' }) {
  const m = mark ?? (tone === 'alarm' ? 'alert' : tone === 'calm' || tone === 'off' ? 'open' : 'check');
  return <svg className={`at-sec-shield is-${tone}`} width={size} height={size} viewBox="0 0 64 64" aria-hidden="true">
    <path className="is-body" d="M32 5 9 14v15c0 15 10 26 23 30 13-4 23-15 23-30V14z" />
    {m === 'alert' ? <path className="is-mark" d="M32 19v16M32 42v.5" /> : m === 'open' ? <path className="is-mark" d="M24 33a8 8 0 0 1 16 0" /> : <path className="is-mark" d="m22 32 7 7 13-14" />}
  </svg>;
}
type RingKind = 'open' | 'closed' | 'alert' | 'count';
const ARMED_ST = ['away', 'guard', 'vacation'];
/** Ajax's ring for the house (owner 09.11.2026: «в схожем стиле» with the office's): open = disarmed, closed = guarded, filling = a delay running,
 * a red disc with «!» = an alarm, gas or water. */
const ringKind = (s: Security): RingKind => s.alarm.state === 'triggered' || s.hazards.some(h => h.alarm) ? 'alert' : s.alarm.state === 'arming' || s.alarm.state === 'pending' ? 'count' : ARMED_ST.includes(s.alarm.state) ? 'closed' : 'open';
/** the ring carries the card's own tone: amber, not calm green, for a tamper or a sensor that does not answer while the house is off guard */
const ringTone = (s: Security): SecTone => ringKind(s) === 'alert' ? 'alarm' : ringKind(s) === 'count' ? 'warn' : ringKind(s) === 'closed' ? 'armed' : secTone(s) === 'warn' ? 'warn' : 'calm';
/** The seconds left of the exit or entry delay, counted every second on its own (the shell's clock ticks every 20 s) and by the house's
 * clock, not this device's (`delayClock`): a tablet whose clock is minutes off still shows the seconds that are really left. */
function useLeft(alarm: Security['alarm'], states: Registry['states']): number | null {
  const [, tick] = useState(0), clock = useRef<ReturnType<typeof delayClock> | null>(null); clock.current ??= delayClock();
  useEffect(() => { if (alarm.delayEnds === null) return; const i = setInterval(() => tick(x => x + 1), 1000); return () => clearInterval(i); }, [alarm.delayEnds]);
  return clock.current(alarm, states);
}
/* the question before a dangerous action (`Ask`) is the house's and the office's: it lives in office-security.tsx */
export function SecurityTile({ s, registry, config, t, lang: _lang, onOpen }: { s: Security; registry: Registry; config: HouseConfig; t: T; lang: Lang; onOpen: () => void }) {
  const tone = secTone(s), list = people(registry, config), home = list.filter(p => p.state === 'home').length, guests = !!s.guests?.on, left = useLeft(s.alarm, registry.states);
  return <div className={`ah-tile hm-card at-sec-tile at-osec-tile at-house-tile is-${tone} ${ARMED_ST.includes(s.alarm.state) ? 'is-st-armed' : ''}`}>
    <button type="button" className="ah-tile-hit" aria-label={tileLabel(s, t, home, guests)} onClick={onOpen}>
      {/* the ring and the name, the state big, one sentence: a narrow tile (a 3-column phone) keeps only the ring and the state, so a delay's seconds ride in the word */}
      <span className="at-sec-tile-head"><Ring kind={ringKind(s)} size={34} progress={.5} tone={ringTone(s)} /><strong>{sk(t, 'title')}</strong></span>
      <span className="at-sec-tile-word">{tileWord(s, t, left)}</span>
      <small className="at-sec-tile-say">{sentence(s, t, home, guests)}</small>
      {(guests || s.vacation?.on) && <span className="at-sec-badges">{guests && <i>{sk(t, 'guests')}</i>}{s.vacation?.on && <i>{sk(t, 'vacation')}</i>}</span>}
    </button>
    {/* an alarm, gas, water, the entry delay and a tamper are announced (WCAG 4.1.3); the visible words are not repeated to the eye */}
    <span className="at-vh">{announcement(s, t, home, guests)}</span>
  </div>;
}
/** Gas, water and the valve drawn like Ajax's product pictures (the doors and windows are the office's drawings). */
function HouseArt({ kind }: { kind: 'gas' | 'leak' | 'valve' }) {
  return <svg className="at-osec-art" viewBox="0 0 64 64" aria-hidden="true">
    {kind === 'gas' ? <><rect x="14" y="12" width="36" height="40" rx="9" className="is-body" /><circle cx="32" cy="28" r="9" className="is-inner" /><rect x="24" y="43" width="16" height="2" rx="1" className="is-lens" /></>
      : kind === 'leak' ? <><rect x="15" y="16" width="34" height="28" rx="10" className="is-body" /><circle cx="25" cy="48" r="2.4" className="is-lens" /><circle cx="39" cy="48" r="2.4" className="is-lens" /><path d="M32 23c3 4 5 6 5 9a5 5 0 0 1-10 0c0-3 2-5 5-9z" className="is-inner" /></>
        : <><rect x="8" y="27" width="48" height="10" rx="4" className="is-body" /><rect x="22" y="18" width="20" height="24" rx="6" className="is-body" /><rect x="28" y="9" width="8" height="10" rx="2" className="is-body" /><rect x="22" y="7" width="20" height="4" rx="2" className="is-lens" /></>}
  </svg>;
}
type Dev = { id: string; room: string; name: string; art: 'door' | 'window' | 'gas' | 'leak' | 'valve'; now: string; tone: '' | 'is-warn' | 'is-alarm' | 'is-live'; info: Guarded | Hazard | null; tamper: boolean | null };
export function SecurityPanel({ s, registry, config, host, commands, t, lang, now: _now, admin }: { s: Security; registry: Registry; config: HouseConfig; host: Host; commands: Commands; t: T; lang: Lang; now: number; admin: boolean }) {
  const tone = secTone(s), list = people(registry, config), homeList = list.filter(p => p.state === 'home'), guests = !!s.guests?.on, st = s.alarm.state;
  const armed = [...ARMED_ST, 'triggered', 'pending', 'arming'].includes(st), offline = !host.online;
  // every command of the panel goes through the shell's runner: nothing while the house is offline, one command per intent (the button waits until
  // the house shows the new state), a refusal in words under the buttons
  type Part = 'alarm' | 'guests' | 'valve';
  const [err, setErr] = useState(''), seen = useRef<Record<Part, string>>({ alarm: '', guests: '', valve: '' }); seen.current = { alarm: `${st}|${s.vacation?.on}`, guests: String(guests), valve: String(s.valve?.state) };
  // the newest reading of the house, for a command already on its way (ST-06: between the return date and the arming the alarm panel may go)
  const live = useRef(s); live.current = s;
  // a command waits for its own answer only: the alarm's three (arm, disarm, «Отпуск») for one another, «Гости» and the valve for themselves —
  // while the house is being armed the water can still be shut at once. A control that waits is not `disabled` (that would drop the keyboard's
  // and the remote's focus to nowhere): it is `aria-disabled` + `aria-busy` and ignores the press; `disabled` is for what cannot be done at all.
  const waits = (key: string) => commands.pending(`sec:${key}`), alarmBusy = waits('arm') || waits('disarm') || waits('vacation');
  const send = (key: string, part: Part, work: () => Promise<unknown>) => { const was = seen.current[part]; setErr(''); void commands.run(`sec:${key}`, work, { onError: (text, e) => setErr(e instanceof AlarmGone ? sk(t, 'st.unknown') : text), until: () => seen.current[part] !== was }); };
  const call = (domain: string, service: string, data: Record<string, unknown>) => () => host.call(domain, service, data);
  const left = useLeft(s.alarm, registry.states), total = s.alarm.delayEnds && s.alarm.since ? (s.alarm.delayEnds - s.alarm.since) / 1000 : 0;
  const [room, setRoom] = useState('all'), [open, setOpen] = useState<string | null>(null);
  // the questions: disarming, «Отпуск» both ways, opening the water (always); arming is one tap unless a sensor does not answer
  // «today» for the return date is the HOUSE's day, not this browser's
  const [ask, setAsk] = useState<AskKind | null>(null), [back, setBack] = useState(''), [backBad, setBackBad] = useState(false), opener = useRef<HTMLElement | null>(null), dateField = useRef<HTMLInputElement>(null), backId = useId(), today = houseToday();
  const question = (k: AskKind, el: EventTarget | null) => { opener.current = el as HTMLElement | null; if (k === 'vacOn') { setBack(s.vacation?.to ?? ''); setBackBad(false); } setAsk(k); };
  // the focus goes back to the control the question was opened from; when that control can no longer be pressed (ST-06: the alarm panel lost its
  // link and «Отпуск» is `disabled`), to the state line that says why — never to the page
  const stateLine = useRef<HTMLParagraphElement>(null);
  const closeAsk = () => { setAsk(null); const el = opener.current; opener.current = null; requestAnimationFrame(() => { if (el?.isConnected && !(el as HTMLButtonElement).disabled) el.focus(); else if (el) stateLine.current?.focus(); }); };
  // a question whose ground is gone (the house was disarmed, «Отпуск» flipped, the valve turned from another device, the alarm panel lost) is withdrawn
  useEffect(() => { if (ask && !questionStands(ask, s)) closeAsk(); });
  const arm = () => send('arm', 'alarm', call('alarm_control_panel', 'alarm_arm_home', { entity_id: s.alarm.id }));
  const answer = () => { const k = ask;
    if (k === 'vacOn') {
      // ST-06: «Отпуск» is a mode of the same Alarmo — with the house off the line or the alarm panel unknown nothing is written and nothing armed
      if (offline || live.current.alarm.state === 'unknown') { closeAsk(); setErr(offline ? errorText(new CommandError('offline'), t) : sk(t, 'st.unknown')); return; }
      // a return date that is not one, or has passed, is said and kept in the field: «Отпуск» never starts without the date the person believes they set
      const r = returnDate(back, today); if (r.error || dateField.current?.validity.badInput) { setBackBad(true); dateField.current?.focus(); return; }
      // CODEX-011: the return date goes to the house first — an emptied field as the house's «no date», so an earlier plan's date never stays in
      // force; a refused write leaves «Отпуск» off. The alarm panel is read again before each write: lost meanwhile, the arming does not go out.
      const toId = s.vacation!.toId, alarm = s.vacation!.id, gone = () => live.current.alarm.state === 'unknown';
      closeAsk(); send('vacation', 'alarm', async () => { if (gone()) throw new AlarmGone(); if (toId) await host.call('input_datetime', 'set_datetime', { entity_id: toId, datetime: `${r.date ?? NO_RETURN_DAY} 00:00:00` }); if (gone()) throw new AlarmGone(); await host.call('alarm_control_panel', 'alarm_arm_vacation', { entity_id: alarm }); }); return; }
    closeAsk();
    if (k === 'arm') arm();
    else if (k === 'disarm') send('disarm', 'alarm', call('alarm_control_panel', 'alarm_disarm', { entity_id: s.alarm.id }));
    else if (k === 'vacOff') send('vacation', 'alarm', call('alarm_control_panel', 'alarm_disarm', { entity_id: s.vacation!.id }));
    else if (k === 'valve') send('valve:open', 'valve', call('valve', 'open_valve', { entity_id: s.valve!.id }));
  };
  const vs = s.valve?.state, valveAsk = valveOpenAsk(s, t), valveDo = vs === 'closed' ? sk(t, 'valveDoOpen') : sk(t, 'valveDoClose');
  // the valve waits for its own command only, and for its own turning; a valve that does not answer gets no command at all (HA would quietly drop it)
  const valveWaits = waits(vs === 'closed' ? 'valve:open' : 'valve:close') || vs === 'moving';
  // the key that had the focus and went out with the new state (armed → «Под охрану» is off) hands it to the other one, never to nowhere
  const armKey = useRef<HTMLButtonElement>(null), disarmKey = useRef<HTMLButtonElement>(null);
  useLayoutEffect(() => { const a = armKey.current, d = disarmKey.current, at = (a?.getRootNode() as Document | ShadowRoot | undefined)?.activeElement;
    if (at && at === a && a.disabled && d && !d.disabled) d.focus({ preventScroll: true }); else if (at && at === d && d.disabled && a && !a.disabled) a.focus({ preventScroll: true }); }, [armed, st]);
  // every device of the house's security as a card, by room: the door and windows, gas, the leaks, the valve
  const devs: Dev[] = [
    ...s.guarded.map(g => ({ id: g.id, room: g.room, name: g.name, art: g.kind, info: g, tamper: g.tamper, now: guardedNow(g, t, hm(g.since, lang)), tone: (g.open === null || g.open ? 'is-warn' : '') as Dev['tone'] })),
    ...s.hazards.map(h => ({ id: h.id, room: h.room, name: hazardName(h, t), art: h.kind, info: h, tamper: null, now: hazardWord(h, t), tone: (h.alarm ? 'is-alarm' : h.silent ? 'is-warn' : '') as Dev['tone'] })),
  ];
  const rooms = [...new Set([...devs.map(d => d.room), ...(s.valve ? [s.valve.room] : [])].filter(Boolean))];
  // trouble first: an alarm, then what is open or has no data, then a device with a fault (case, battery, radio)
  const rank = (d: Dev) => d.tone === 'is-alarm' ? 0 : d.tone === 'is-warn' ? 1 : d.tamper || d.info?.low || d.info?.signal === 'weak' ? 2 : 3;
  const shown = devs.filter(d => room === 'all' || d.room === room).map((d, i) => ({ d, i })).sort((x, y) => rank(x.d) - rank(y.d) || x.i - y.i).map(x => x.d);
  const away = st === 'away' ? sk(t, 'chip.awayOn') : homeList.length ? sk(t, 'chip.awayWait', { who: homeList.map(p => p.first).join(', ') }) : guests ? sk(t, 'chip.awayGuests') : sk(t, 'chip.awayAuto');
  const backDay = calendarDay(s.vacation?.to ?? null, locales[lang]); // the helper's date as it is written, not moved by the browser's zone
  const persons = Object.keys(registry.states).filter(id => id.startsWith('person.')).map(id => ({ user: typeof registry.states[id].attributes.user_id === 'string' ? registry.states[id].attributes.user_id as string : null, name: String(registry.states[id].attributes.friendly_name ?? id) }));
  const armedWord = (mode: string | undefined) => mode === 'armed_away' ? sk(t, 'ev.away') : mode === 'armed_vacation' ? sk(t, 'ev.vacation') : sk(t, 'ev.guard');
  return <div className={`at-osec-wrap at-sec-panel ${offline ? 'is-stale' : ''}`}><div className="at-osec">
    <section className={`at-osec-control is-${tone} ${ARMED_ST.includes(st) ? 'is-st-armed' : `is-st-${st}`} ${ringKind(s) === 'alert' ? 'is-alarm' : ''}`}>
      <Ring kind={ringKind(s)} size={104} progress={total && left !== null ? 1 - left / total : 0} tone={ringTone(s)} />
      <div className="at-osec-name">
        <h2>{config.home.name || sk(t, 'title')}</h2>
        <p className="at-osec-state" ref={stateLine} tabIndex={-1}>{stateWord(s, t)}{left !== null && <span className="at-osec-count" role="timer"> · {countdown(left)}</span>}</p>
        <small className={tone === 'warn' || tone === 'alarm' ? 'at-sec-say-warn' : ''}>{sentence(s, t, homeList.length, guests)}</small>
        {offline && <small className="at-sec-stale">{sk(t, 'stale')}</small>}
        <span className="at-vh">{announcement(s, t, homeList.length, guests)}</span>
        {armed && s.alarm.since && st !== 'pending' && <small>{sk(t, 'since', { t: hm(s.alarm.since, lang) })}{s.alarm.bypassed.length ? ` · ${sk(t, 'bypassedN', { n: s.alarm.bypassed.length })}` : ''}</small>}
      </div>
      {/* «Под охрану» is the manual «Охрана» (cleared only by hand); «Не дома» sets itself, «Отпуск» is below */}
      <div className="at-osec-pad" role="group" aria-label={sk(t, 'title')}>
        {/* arming is one tap (its exit delay can be cancelled); with a sensor that does not answer it says which one the guard will not see and asks */}
        <button type="button" ref={armKey} className={`at-osec-key at-sec-main ${st === 'guard' ? 'is-now' : ''}`} disabled={offline || st === 'unknown' || armed} aria-disabled={alarmBusy || undefined} aria-busy={waits('arm') || undefined} onClick={e => { if (alarmBusy) return; if (armWarning(s, t)) question('arm', e.currentTarget); else arm(); }}>
          <b>{sk(t, 'key.arm')}</b><Ring kind="closed" size={52} tone="calm" /></button>
        {/* disarming asks; cancelling the exit delay that is still running does not (nothing was guarded yet) */}
        <button type="button" ref={disarmKey} className={`at-osec-key at-sec-disarm ${st === 'disarmed' ? 'is-now' : ''}`} disabled={offline || st === 'unknown' || !armed} aria-disabled={alarmBusy || undefined} aria-busy={waits('disarm') || undefined} onClick={e => { if (alarmBusy) return; if (st === 'arming') send('disarm', 'alarm', call('alarm_control_panel', 'alarm_disarm', { entity_id: s.alarm.id })); else question('disarm', e.currentTarget); }}>
          <b>{sk(t, 'key.disarm')}</b><Ring kind="open" size={52} tone="calm" /></button>
      </div>
      {ask === 'arm' && <Ask text={armWarning(s, t) ?? ''} yes={sk(t, 'key.arm')} no={sk(t, 'ask.no')} onYes={answer} onNo={closeAsk} />}
      {ask === 'disarm' && <Ask text={t('confirm.alarm.disarm')} yes={sk(t, 'key.disarm')} no={sk(t, 'ask.no')} onYes={answer} onNo={closeAsk} />}
      {ask === 'vacOn' && <Ask text={sk(t, s.valve ? 'ask.vacOnValve' : 'ask.vacOn')} yes={sk(t, 'ask.vacOnYes')} no={sk(t, 'ask.no')} onYes={answer} onNo={closeAsk}>
        {s.vacation?.toId && <label className="at-sec-field at-sec-ask-date"><span>{sk(t, 'ask.vacBack')}</span><input type="date" ref={dateField} min={today} value={back} aria-invalid={backBad || undefined} aria-describedby={backBad ? backId : undefined} onInput={e => { setBack((e.currentTarget as HTMLInputElement).value); setBackBad(false); }} /></label>}
        {backBad && <small id={backId} className="at-sec-err" role="alert">{sk(t, 'ask.vacBackBad')}</small>}</Ask>}
      {ask === 'vacOff' && <Ask text={sk(t, 'ask.vacOff')} yes={sk(t, 'ask.vacOffYes')} no={sk(t, 'ask.no')} onYes={answer} onNo={closeAsk} />}
      {err && <small className="at-sec-err" role="alert">{failLine(sk(t, 'fail'), err)}</small>}
      <div className="at-osec-groups">
        {/* «Не дома» sets itself; while «Охрана» or «Отпуск» stands it has nothing to say */}
        {st !== 'guard' && st !== 'vacation' && !s.vacation?.on && <span className={`at-osec-group ${st === 'away' ? 'is-armed' : ''}`}><Ring kind={st === 'away' ? 'closed' : 'open'} size={22} tone={st === 'away' ? 'armed' : 'calm'} /><b>{sk(t, 'mode.away')}</b><small>{away}</small></span>}
        {s.guests && <button type="button" className={`at-osec-group is-btn ${guests ? 'is-on' : ''}`} aria-pressed={guests} disabled={offline} aria-disabled={waits('guests') || undefined} aria-busy={waits('guests') || undefined} onClick={() => send('guests', 'guests', call('input_boolean', guests ? 'turn_off' : 'turn_on', { entity_id: s.guests!.id }))}>
          <i className="at-sec-sw" /><b>{sk(t, 'guests')}</b><small>{guests ? sk(t, 'chip.on') : sk(t, 'chip.off')}</small></button>}
        {/* «Отпуск» is the same Alarmo's mode: with its panel unknown it cannot be pressed, like the two keys (ST-06); «Гости» and the valve stay free */}
        {s.vacation && <button type="button" className={`at-osec-group is-btn ${s.vacation.on ? 'is-on' : ''}`} aria-pressed={s.vacation.on} disabled={offline || st === 'unknown'} aria-disabled={alarmBusy || undefined} aria-busy={waits('vacation') || undefined} onClick={e => { if (!alarmBusy && !offline && st !== 'unknown') question(s.vacation!.on ? 'vacOff' : 'vacOn', e.currentTarget); }}>
          <i className="at-sec-sw" /><b>{sk(t, 'vacation')}</b><small>{s.vacation.on ? (backDay ? sk(t, 'chip.until', { d: backDay }) : sk(t, 'chip.on')) : sk(t, 'chip.off')}</small></button>}
      </div>
    </section>
    <section className="at-osec-devs">
      <div className="hm-section-head"><h2>{sk(t, 'devices')}</h2><small>{devicesWord(s, t)}</small></div>
      <div className="at-osec-chips" role="group" aria-label={t('ui.rooms')}>{/* a filter of the list below, not tabs: buttons with a pressed one (tabs would owe the arrow keys) */}{[{ id: 'all', name: sk(t, 'allRooms') }, ...rooms.map(r => ({ id: r, name: r }))].map(r => <button type="button" aria-pressed={room === r.id} className={room === r.id ? 'is-on' : ''} onClick={() => setRoom(r.id)}>{r.name}</button>)}</div>
      <div className="at-osec-list">
        {shown.filter(d => rank(d) < 2).map(d => { const isOpen = open === d.id, bad = (d.tamper ? 1 : 0) + (d.info?.low ? 1 : 0) + (d.info?.signal === 'weak' ? 1 : 0); return <div className={`at-osec-dev ${isOpen ? 'is-open' : ''} ${d.tone === 'is-alarm' ? 'is-alarm' : ''}`}>
          <button type="button" className="at-osec-dev-hit" aria-expanded={isOpen} onClick={() => setOpen(isOpen ? null : d.id)}>
            <span className="at-osec-pic">{d.art === 'door' || d.art === 'window' ? <Art kind={d.art} maker={d.info?.maker ?? 'zigbee'} /> : <HouseArt kind={d.art} />}{bad > 0 && <i className="at-osec-badge">{bad}</i>}</span>
            <span className="at-osec-dev-text"><b>{d.name}</b><small>{d.room}</small>
              <span className={`at-osec-now ${d.tone}`}>{d.now}</span>
              <span className="at-osec-icons">{d.info?.signal && <Bars v={d.info.signal} />}{d.info?.level != null && <Battery v={d.info.level} />}{d.tamper && <span className="is-bad"><Case /></span>}</span></span>
            <Chevron />
          </button>
          {isOpen && <div className="at-osec-rows">
            <Row k={d.art === 'gas' ? sk(t, 'row.gas') : d.art === 'leak' ? sk(t, 'row.leak') : sk(t, 'row.contact')} v={d.now} bad={d.tone === 'is-alarm' ? true : d.tone === 'is-warn' ? 'warn' : false} />
            {d.tamper !== null && <Row k={sk(t, 'row.case')} v={d.tamper ? sk(t, 'row.caseOpen') : sk(t, 'row.caseClosed')} bad={!!d.tamper} />}
            {d.info?.signal && <Row k={sk(t, 'row.signal')} v={sk(t, `sig.${d.info.signal}`)} bad={d.info.signal === 'weak'} />}
            {d.info?.level != null && <Row k={sk(t, 'row.battery')} v={`${Math.round(d.info.level)} %${d.info.low ? ` · ${sk(t, 'row.low')}` : ''}`} bad={d.info.level <= 20 || d.info.low} />}
            {d.info?.model && <Row k={sk(t, 'row.model')} v={d.info.model} />}
          </div>}
        </div>; })}
        {(room === 'all' || room === s.valve?.room || !s.valve) && <div className={`at-osec-dev at-sec-valve ${s.valve?.state === 'closed' ? 'is-closed' : ''}`}>
          <div className="at-osec-dev-hit is-static">
            <span className="at-osec-pic"><HouseArt kind="valve" /></span>
            <span className="at-osec-dev-text"><b>{sk(t, 'valveName')}</b><small>{s.valve?.room || sk(t, 'valveRoom')}</small>
              <span className={`at-osec-now ${vs === 'closed' || vs === 'offline' ? 'is-warn' : ''}`}>{!s.valve ? sk(t, 'valveMissing') : vs === 'closed' ? sk(t, 'valveClosed') : vs === 'open' ? sk(t, 'valveOpen') : vs === 'moving' ? sk(t, 'valveMoving') : vs === 'offline' ? sk(t, 'valveOffline') : sk(t, 'noData')}</span>
              {s.exercise?.on && <small>{sk(t, 'exercise', { n: String(s.exercise.days ?? 7), t: s.exercise.time ?? '03:00' })}</small>}</span>
            {/* closing is one tap (the safe way); opening always asks, and with a wet leak sensor the question says so and keeping it closed comes first */}
            {s.valve && <button type="button" className="hm-pill at-sec-valve-btn" aria-label={sk(t, 'valveAct', { name: sk(t, 'valveName'), do: valveDo })} disabled={offline || vs === 'offline'} aria-disabled={valveWaits || undefined} aria-busy={valveWaits || undefined} onClick={e => { if (valveWaits) return; if (vs === 'closed') question('valve', e.currentTarget); else send('valve:close', 'valve', call('valve', 'close_valve', { entity_id: s.valve!.id })); }}>{valveDo}</button>}
          </div>
          {ask === 'valve' && <Ask text={valveAsk.text} yes={sk(t, 'ask.valveOpenYes')} no={valveAsk.leak ? sk(t, 'ask.valveKeep') : sk(t, 'ask.no')} danger={valveAsk.leak} onYes={answer} onNo={closeAsk} />}
        </div>}
        {shown.filter(d => rank(d) >= 2).map(d => { const isOpen = open === d.id, bad = (d.tamper ? 1 : 0) + (d.info?.low ? 1 : 0) + (d.info?.signal === 'weak' ? 1 : 0); return <div className={`at-osec-dev ${isOpen ? 'is-open' : ''} ${d.tone === 'is-alarm' ? 'is-alarm' : ''}`}>
          <button type="button" className="at-osec-dev-hit" aria-expanded={isOpen} onClick={() => setOpen(isOpen ? null : d.id)}>
            <span className="at-osec-pic">{d.art === 'door' || d.art === 'window' ? <Art kind={d.art} maker={d.info?.maker ?? 'zigbee'} /> : <HouseArt kind={d.art} />}{bad > 0 && <i className="at-osec-badge">{bad}</i>}</span>
            <span className="at-osec-dev-text"><b>{d.name}</b><small>{d.room}</small>
              <span className={`at-osec-now ${d.tone}`}>{d.now}</span>
              <span className="at-osec-icons">{d.info?.signal && <Bars v={d.info.signal} />}{d.info?.level != null && <Battery v={d.info.level} />}{d.tamper && <span className="is-bad"><Case /></span>}</span></span>
            <Chevron />
          </button>
          {isOpen && <div className="at-osec-rows">
            <Row k={d.art === 'gas' ? sk(t, 'row.gas') : d.art === 'leak' ? sk(t, 'row.leak') : sk(t, 'row.contact')} v={d.now} bad={d.tone === 'is-alarm' ? true : d.tone === 'is-warn' ? 'warn' : false} />
            {d.tamper !== null && <Row k={sk(t, 'row.case')} v={d.tamper ? sk(t, 'row.caseOpen') : sk(t, 'row.caseClosed')} bad={!!d.tamper} />}
            {d.info?.signal && <Row k={sk(t, 'row.signal')} v={sk(t, `sig.${d.info.signal}`)} bad={d.info.signal === 'weak'} />}
            {d.info?.level != null && <Row k={sk(t, 'row.battery')} v={`${Math.round(d.info.level)} %${d.info.low ? ` · ${sk(t, 'row.low')}` : ''}`} bad={d.info.level <= 20 || d.info.low} />}
            {d.info?.model && <Row k={sk(t, 'row.model')} v={d.info.model} />}
          </div>}
        </div>; })}
      </div>
    </section>
    <SecurityFeed alarmId={s.alarm.id} alarmState={st} people={persons} host={host} t={t} lang={lang} armed={armedWord} />
    <div className="at-osec-set">
      {admin && <SecuritySettings s={s} host={host} t={t} lang={lang} />}
      <details className="at-sec-sec at-sec-how"><summary className="hm-section-head"><h2>{sk(t, 'how')}</h2></summary>
        <ul>{['away', 'guard', 'guests', 'vacation', 'alarm', 'water'].map(k => <li><b>{sk(t, `how.${k}.t`)}</b><span>{sk(t, `how.${k}`)}</span></li>)}</ul>
      </details>
    </div>
  </div></div>;
}
/** The owner's settings (HA admin only, owner 09.11.2026): the return date of «Отпуск», the valve's exercise (on, time, every N days) and the
 * sockets «Отпуск» turns off. All of it lives in HA (helpers, the label «Отпуск: выключать»), the panel only edits it. */
/** A settings field that keeps what is being typed: the panel is redrawn on every state the house sends, and a field bound straight to the
 * house's value was reset under the fingers (a half-typed «14» became «7» again). While the field has focus it shows its own text; the value
 * goes to the house on `change` (a picked date or time, Enter, leaving the field), and the house's value returns when the field is left. */
function Held({ value, onCommit, ...rest }: { value: string; onCommit: (v: string) => void; type: 'date' | 'time' | 'number'; min?: string | number; max?: number; step?: number; inputMode?: 'numeric'; disabled?: boolean }) {
  const [draft, setDraft] = useState<string | null>(null);
  const attrs = rest as Record<string, unknown>; // the input's role-by-type union does not take a type known only at run time
  return <input {...attrs} value={draft ?? value} onFocus={e => setDraft((e.currentTarget as HTMLInputElement).value)} onInput={e => setDraft((e.currentTarget as HTMLInputElement).value)} onChange={e => onCommit((e.currentTarget as HTMLInputElement).value)} onBlur={() => setDraft(null)} />;
}
/** One save at a time; a refusal in the user's language with the real reason, never a raw object. */
function useSave(t: T) {
  const [busy, setBusy] = useState<string | null>(null), [err, setErr] = useState('');
  const run = async (k: string, f: () => Promise<unknown>) => { setBusy(k); setErr(''); try { await f(); } catch (e) { setErr(errorText(e, t)); } finally { setBusy(null); } };
  return { busy, err, run, /** a value the panel itself does not take (a date that has passed): said in the same line */ fail: setErr };
}
function SecuritySettings({ s, host, t, lang }: { s: Security; host: Host; t: T; lang: Lang }) {
  const ui = useSave(t);
  // the label is edited in the entity registry; the registry mirror refreshes later, so the panel keeps its own answer meanwhile
  const [mine, setMine] = useState<Record<string, boolean>>({});
  const off = (id: string, was: boolean) => mine[id] ?? was;
  const flip = (id: string, was: boolean) => ui.run(`load:${id}`, async () => {
    if (!host.ws || !host.online) throw new CommandError('offline'); // the registry is written over the raw socket, which the command guard does not cover
    const row = await host.ws!<{ entity_entry?: { labels?: string[] }; labels?: string[] }>({ type: 'config/entity_registry/get', entity_id: id });
    const cur = (row.entity_entry?.labels ?? row.labels ?? []).filter(l => l !== VACATION_LABEL), next = !off(id, was);
    await host.ws!({ type: 'config/entity_registry/update', entity_id: id, labels: next ? [...cur, VACATION_LABEL] : cur });
    setMine(m => ({ ...m, [id]: next }));
  });
  const ex = s.exercise, today = houseToday(); // the HOUSE's day: the return date is a date of its calendar
  return <section className="at-sec-sec at-sec-set"><div className="hm-section-head"><h2>{sk(t, 'set.title')}</h2><small>{sk(t, 'set.admin')}</small></div>
    <div className="at-sec-set-grid">
      {s.vacation?.toId && <div className="at-sec-set-card">
        <b>{sk(t, 'set.back')}</b><small>{sk(t, 'set.backHint')}</small>
        <label className="at-sec-field"><span>{sk(t, 'set.backDate')}</span><Held type="date" min={today} value={s.vacation.to ?? ''} disabled={ui.busy !== null} onCommit={v => { if (!v && !s.vacation!.to) return; if (v && returnDate(v, today).error) { ui.fail(sk(t, 'ask.vacBackBad')); return; } /* an emptied field is the house's «no date» (CODEX-011), not a silent «keep the old one» */ void ui.run('back', () => host.call('input_datetime', 'set_datetime', { entity_id: s.vacation!.toId, datetime: `${v || NO_RETURN_DAY} 00:00:00` })); }} /></label>
      </div>}
      {ex && <div className="at-sec-set-card">
        <div className="at-sec-set-row"><span><b>{sk(t, 'set.exercise')}</b><small>{sk(t, 'set.exerciseHint')}</small></span>
          <button type="button" role="switch" className={`at-sec-sw-btn ${ex.on ? 'is-on' : ''}`} aria-checked={ex.on} aria-label={sk(t, 'set.exercise')} aria-disabled={ui.busy !== null || undefined} aria-busy={ui.busy === 'ex' || undefined} onClick={() => { if (ui.busy === null) void ui.run('ex', () => host.call('input_boolean', ex.on ? 'turn_off' : 'turn_on', { entity_id: ex.id })); }}><i className="at-sec-sw" /></button></div>
        <div className="at-sec-set-fields">
          {ex.timeId && <label className="at-sec-field"><span>{sk(t, 'set.time')}</span><Held type="time" value={ex.time ?? ''} disabled={ui.busy !== null || !ex.on} onCommit={v => { if (v) void ui.run('ext', () => host.call('input_datetime', 'set_datetime', { entity_id: ex.timeId, time: `${v}:00` })); }} /></label>}
          {ex.daysId && <label className="at-sec-field"><span>{sk(t, 'set.days')}</span><Held type="number" inputMode="numeric" min={1} max={30} step={1} value={String(ex.days ?? 7)} disabled={ui.busy !== null || !ex.on} onCommit={raw => { const v = Math.round(Number(raw)); if (v >= 1 && v <= 30) void ui.run('exd', () => host.call('input_number', 'set_value', { entity_id: ex.daysId, value: v })); }} /></label>}
        </div>
        {!s.valve && <small className="at-sec-set-note">{sk(t, 'set.noValve')}</small>}
      </div>}
      {s.loads.length > 0 && <div className="at-sec-set-card at-sec-set-loads">
        <b>{sk(t, 'set.loads')}</b><small>{sk(t, 'set.loadsHint')}</small>
        <ul>{s.loads.map(l => { const o = off(l.id, l.off); return <li><span><b>{l.name}</b><small>{l.room}{l.room ? ' · ' : ''}{o ? sk(t, 'set.loadOff') : sk(t, 'set.loadKeep')}</small></span>
          <button type="button" role="switch" className={`at-sec-sw-btn ${o ? '' : 'is-on'}`} aria-checked={!o} aria-label={`${sk(t, 'set.keep')}: ${l.name}`} aria-disabled={ui.busy !== null || undefined} aria-busy={ui.busy === `load:${l.id}` || undefined} onClick={() => { if (ui.busy === null) void flip(l.id, l.off); }}><i className="at-sec-sw" /></button></li>; })}</ul>
      </div>}
    </div>
    {ui.err && <p className="at-sec-err" role="alert">{failLine(sk(t, 'set.error'), ui.err)}</p>}
  </section>;
}
