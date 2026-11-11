import type { ComponentChildren } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import type { Host } from '../runtime/host.ts';
import type { Key, T } from '../i18n/index.ts';
import { errorText, locales, type Lang } from './format.ts';
import { allItems, osecArmWarning, osecAskStands, osecDevicesWord, osecDisarmAsks, osecSentence, osecStateWord, osecTone, readOsecEvents, STAFF_LABEL, type LogRow, type OfficeSecurity, type OsecEvent, type OsecItem, type OsecState, type OsecTone } from '../model/office-security.ts';
/** Security of an office building (Atom + Okapi, owner 09.11.2026, atom-okapi/SECURITY.md), drawn after the Ajax app the building's staff
 * already use (owner: «посмотри как они сделали»): the state ring (open = disarmed, closed = armed, «!» = alarm), the two big buttons «Под охрану»
 * and «С охраны», the groups, the devices as cards with their picture, signal, battery and the red count of faults, the feed by day. */
const ok = (t: T, k: string, p?: Record<string, string | number>) => t(`osec.${k}` as Key, p);
const hm = (ms: number | null, lang: Lang) => ms === null ? '' : new Date(ms).toLocaleTimeString(locales[lang], { hour: '2-digit', minute: '2-digit' });
const smokeNow = (s: OfficeSecurity) => allItems(s).some(i => i.kind === 'smoke' && i.on);
type RingKind = 'open' | 'closed' | 'alert' | 'count';
/** Ajax colours the ring by the state alone (teal disarmed, blue armed, amber counting, red alarm); a tamper is said in words, not by the ring */
const ringTone = (s: OfficeSecurity): OsecTone => s.alarm.state === 'triggered' || smokeNow(s) ? 'alarm' : s.alarm.state === 'arming' || s.alarm.state === 'pending' ? 'warn' : s.alarm.state === 'armed' ? 'armed' : 'calm';
const ringOf = (s: OfficeSecurity): RingKind => s.alarm.state === 'triggered' || smokeNow(s) ? 'alert' : s.alarm.state === 'arming' || s.alarm.state === 'pending' ? 'count' : s.alarm.state === 'armed' ? 'closed' : 'open';
/** Ajax's state glyph: an open ring (disarmed), a closed ring (armed), a filled disc with «!» (alarm); while counting, the ring fills up. */
export function Ring({ kind, size = 120, progress = 0, tone }: { kind: RingKind; size?: number; progress?: number; tone: OsecTone }) {
  const r = 26, c = 2 * Math.PI * r;
  return <svg className={`at-osec-ring is-${tone}`} width={size} height={size} viewBox="0 0 64 64" aria-hidden="true">
    {kind === 'alert' ? <><circle cx="32" cy="32" r="28" className="is-fill" /><path d="M32 18v17M32 44v.5" className="is-mark" /></>
      : kind === 'closed' ? <circle cx="32" cy="32" r={r} className="is-stroke" />
        : kind === 'count' ? <><circle cx="32" cy="32" r={r} className="is-track" /><circle cx="32" cy="32" r={r} className="is-stroke" stroke-dasharray={`${c * progress} ${c}`} transform="rotate(-90 32 32)" /></>
          : <path d="M13.6 21.5A26 26 0 1 1 9.4 40" className="is-stroke" />}
  </svg>;
}
/** The devices drawn plainly, like Ajax's product pictures: a door contact, a motion sensor, a smoke disc, a presence dome, the hub. */
export function Art({ kind, maker }: { kind: OsecItem['kind'] | 'hub'; maker: OsecItem['maker'] }) {
  const led = maker === 'ajax' ? <rect x="21" y="16" width="6" height="1.6" rx=".8" className="is-led" /> : null;
  return <svg className="at-osec-art" viewBox="0 0 64 64" aria-hidden="true">
    {kind === 'door' || kind === 'window' ? <>
      <rect x={maker === 'ajax' ? 18 : 20} y={maker === 'ajax' ? 10 : 16} width="12" height={maker === 'ajax' ? 44 : 32} rx="5" className="is-body" />
      <rect x={maker === 'ajax' ? 33 : 34} y={maker === 'ajax' ? 10 : 22} width={maker === 'ajax' ? 12 : 9} height={maker === 'ajax' ? 44 : 20} rx="4.5" className="is-body" />{led}</>
      : kind === 'motion' ? <><path d="M20 14q0-5 5-5h14q5 0 5 5v34q0 7-12 7t-12-7z" className="is-body" /><rect x="24.5" y="24" width="15" height="13" rx="2.5" className="is-lens" /><rect x="29" y="14" width="6" height="1.6" rx=".8" className={maker === 'ajax' ? 'is-led' : 'is-lens'} /></>
        : kind === 'presence' ? <><path d="M14 40a18 18 0 0 1 36 0z" className="is-body" /><rect x="12" y="40" width="40" height="5" rx="2.5" className="is-body" /><circle cx="32" cy="31" r="5" className="is-lens" /></>
          : kind === 'smoke' ? <><circle cx="32" cy="32" r="22" className="is-body" /><circle cx="32" cy="32" r="13" className="is-inner" /><circle cx="32" cy="32" r="3" className="is-lens" /></>
            : <><rect x="11" y="11" width="42" height="42" rx="12" className="is-body" /><rect x="25" y="31" width="14" height="1.6" rx=".8" className="is-inner" /></>}
  </svg>;
}
export const Bars = ({ v }: { v: OsecItem['signal'] }) => { const n = v === 'strong' ? 3 : v === 'normal' ? 2 : v === 'weak' ? 1 : 0; return <svg width="18" height="16" viewBox="0 0 18 16" aria-hidden="true" className={`at-osec-bars ${n === 1 ? 'is-weak' : ''}`}>{[0, 1, 2].map(i => <rect x={2 + i * 6} y={11 - i * 4} width="3" height={4 + i * 4} rx="1" className={i < n ? 'is-on' : ''} />)}</svg>; };
export const Battery = ({ v }: { v: number | null }) => <svg width="12" height="18" viewBox="0 0 12 18" aria-hidden="true" className={`at-osec-batt ${v !== null && v <= 20 ? 'is-low' : ''}`}><rect x="1" y="3" width="10" height="14" rx="2" className="is-case" /><rect x="4" y="1" width="4" height="2" rx=".5" className="is-cap" /><rect x="3" y={5 + 10 * (1 - (v ?? 0) / 100)} width="6" height={10 * (v ?? 0) / 100} rx="1" className="is-level" /></svg>;
export const Chevron = () => <svg className="at-osec-chev" width="14" height="22" viewBox="0 0 14 22" aria-hidden="true"><path d="m3 3 8 8-8 8" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" /></svg>;
export const Case = () => <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true" className="at-osec-case"><path d="M4 3h6M4 3v12h10V8" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" /></svg>;
/** the state and the sentence live in the model (CODEX-010: a device that does not answer is said there, tested under Node) */
const stateWord = osecStateWord, sentence = osecSentence;
/** A question before a dangerous action (docs/UX-GUIDE.md), the house's and the office's: the consequence in words, the safe choice first and
 * focused, Escape cancels wherever the focus stands. */
export function Ask({ text, yes, no, onYes, onNo, children, danger }: { text: string; yes: string; no: string; onYes: () => void; onNo: () => void; children?: ComponentChildren; /** the safe choice is also the prominent one (opening the water during a leak) */ danger?: boolean }) {
  const safe = useRef<HTMLButtonElement>(null), box = useRef<HTMLDivElement>(null), cancel = useRef(onNo); cancel.current = onNo;
  // Escape cancels wherever the focus stands while the question is open (it may have been moved off it), and the key ends here: the shell's
  // own Escape (closing a sheet) sees it as handled
  useEffect(() => { safe.current?.focus(); const root = box.current?.getRootNode(); if (!root) return;
    const key = (e: Event) => { const k = e as KeyboardEvent; if (k.key !== 'Escape' || k.defaultPrevented) return; k.preventDefault(); k.stopPropagation(); cancel.current(); };
    root.addEventListener('keydown', key); return () => root.removeEventListener('keydown', key); }, []);
  return <div className="at-sec-ask" role="group" aria-label={text} ref={box}>
    <p>{text}</p>{children}
    <div className="at-sec-ask-btns"><button type="button" ref={safe} className={`hm-pill at-sec-ask-no ${danger ? 'is-primary' : ''}`} onClick={onNo}>{no}</button><button type="button" className={`hm-pill at-sec-ask-yes ${danger ? 'is-danger' : 'is-primary risk-security'}`} onClick={onYes}>{yes}</button></div>
  </div>;
}
/** With the translator the refusal is one sentence in the user's language (`errorText`), never «[object Object]». */
export function useBusy(t?: T) {
  const [busy, setBusy] = useState<string | null>(null), [err, setErr] = useState('');
  const run = async (k: string, f: () => Promise<unknown>) => { setBusy(k); setErr(''); try { await f(); } catch (e) { setErr(t ? errorText(e, t) : e instanceof Error ? e.message : String(e)); } finally { setBusy(null); } };
  return { busy, err, run };
}
export function OfficeSecurityTile({ s, t, onOpen }: { s: OfficeSecurity; t: T; onOpen: () => void }) {
  const tone = osecTone(s), word = smokeNow(s) ? ok(t, 'st.smoke') : ok(t, `tile.${s.alarm.state}`);
  return <div className={`ah-tile hm-card at-sec-tile at-osec-tile is-${tone} is-st-${s.alarm.state}`}>
    <button type="button" className="ah-tile-hit" aria-label={`${ok(t, 'title')}: ${stateWord(s, t)}. ${sentence(s, t)}`} onClick={onOpen}>
      <span className="at-sec-tile-head"><Ring kind={ringOf(s)} size={34} progress={.5} tone={ringTone(s)} /><strong>{ok(t, 'title')}</strong></span>
      <span className="at-sec-tile-word">{word}</span>
      <small className="at-sec-tile-say">{sentence(s, t)}</small>
    </button>
  </div>;
}
const ARMED: OsecState[] = ['armed', 'pending', 'triggered', 'arming'];
/** What a device says now, in Ajax's words («Закрыто», «Движение»…), and whether that is trouble. */
function devState(i: OsecItem, t: T, lang: Lang): { text: string; tone: '' | 'is-warn' | 'is-alarm' | 'is-live' } {
  if (i.on === null) return { text: ok(t, 'noData'), tone: 'is-warn' };
  if (i.kind === 'smoke') return i.on ? { text: ok(t, 'smokeNow'), tone: 'is-alarm' } : { text: ok(t, 'smokeOk'), tone: '' };
  if (i.glass) return { text: ok(t, 'glass'), tone: 'is-alarm' };
  if (i.kind === 'motion') return i.on ? { text: ok(t, 'motionNow'), tone: 'is-live' } : { text: ok(t, 'motionWas', { t: hm(i.since, lang) }), tone: '' };
  if (i.kind === 'presence') return i.on ? { text: ok(t, 'presenceOn'), tone: 'is-live' } : { text: ok(t, 'presenceOff'), tone: '' };
  const w = i.kind === 'window';
  return i.on ? { text: ok(t, w ? 'windowOpen' : 'doorOpen', { t: hm(i.since, lang) }), tone: 'is-warn' } : { text: ok(t, w ? 'windowClosed' : 'doorClosed'), tone: '' };
}
const faults = (i: OsecItem) => [i.tamper, !!i.glass, i.offline, i.problem && !i.offline, i.battery].filter(Boolean).length;
export function OfficeSecurityPanel({ s, host, t, lang, now, admin, title }: { s: OfficeSecurity; host: Host; t: T; lang: Lang; now: number; admin: boolean; title: string }) {
  const tone = osecTone(s), ui = useBusy(t), st = s.alarm.state, armed = ARMED.includes(st);
  const left = s.alarm.delayEnds ? Math.max(0, (s.alarm.delayEnds - now) / 1000) : null, total = s.alarm.delayEnds && s.alarm.since ? (s.alarm.delayEnds - s.alarm.since) / 1000 : 0;
  const act = (arm: boolean) => ui.run(arm ? 'arm' : 'disarm', () => host.call('alarm_control_panel', arm ? 'alarm_arm_away' : 'alarm_disarm', { entity_id: s.alarm.id }));
  // the house's safety rules: «С охраны» asks first — one tap only cancels an arming that has not finished (CODEX-002); arming with a device that
  // does not answer says which one and asks (CODEX-010). The safe choice has the focus, Escape cancels, the focus goes back to the key — or, when
  // the key can no longer be pressed, to the state line; a question whose ground is gone (disarmed from Ajax) is withdrawn.
  const [ask, setAsk] = useState<'arm' | 'disarm' | null>(null), opener = useRef<HTMLButtonElement | null>(null), stateLine = useRef<HTMLParagraphElement>(null);
  const question = (k: 'arm' | 'disarm', el: HTMLButtonElement) => { opener.current = el; setAsk(k); };
  const closeAsk = () => { setAsk(null); const el = opener.current; opener.current = null; requestAnimationFrame(() => { if (el?.isConnected && !el.disabled) el.focus(); else if (el) stateLine.current?.focus(); }); };
  useEffect(() => { if (ask && !osecAskStands(ask, s)) closeAsk(); });
  const armWarn = osecArmWarning(s, t);
  const [room, setRoom] = useState<string>('all'), [open, setOpen] = useState<string | null>(null);
  const items = s.rooms.filter(r => room === 'all' || r.id === room).flatMap(r => r.items.map(i => ({ i, room: r.name, guarded: !!r.zone })));
  // the container is the wrapper: a grid cannot query its own width (the tablet layout fell into one cell)
  return <div className="at-osec-wrap"><div className="at-osec">
      <section className={`at-osec-control is-${tone} is-st-${st}`}>
        <Ring kind={ringOf(s)} size={104} progress={total && left !== null ? 1 - left / total : 0} tone={ringTone(s)} />
        <div className="at-osec-name">
          <h2>{title}</h2>
          <p className="at-osec-state" ref={stateLine} tabIndex={-1}>{stateWord(s, t)}{left !== null && <span className="at-osec-count"> · {Math.floor(left / 60)}:{String(Math.round(left % 60)).padStart(2, '0')}</span>}</p>
          <small>{sentence(s, t)}</small>
        </div>
        <div className="at-osec-pad" role="group" aria-label={ok(t, 'title')}>
          <button type="button" className={`at-osec-key ${st === 'armed' ? 'is-now' : ''}`} disabled={!s.can || ui.busy !== null || st === 'unknown' || armed} onClick={e => { if (armWarn) question('arm', e.currentTarget); else void act(true); }}>
            <b>{ok(t, 'arm')}</b><Ring kind="closed" size={52} tone="calm" /></button>
          <button type="button" className={`at-osec-key ${st === 'disarmed' ? 'is-now' : ''}`} disabled={!s.can || ui.busy !== null || st === 'unknown' || !armed} onClick={e => { if (osecDisarmAsks(s)) question('disarm', e.currentTarget); else void act(false); }}>
            <b>{ok(t, 'disarm')}</b><Ring kind="open" size={52} tone="calm" /></button>
        </div>
        {ask === 'disarm' && <Ask text={ok(t, 'ask.disarm')} yes={ok(t, 'disarm')} no={t('sec.ask.no')} onYes={() => { closeAsk(); void act(false); }} onNo={closeAsk} />}
        {ask === 'arm' && <Ask text={armWarn ?? ''} yes={ok(t, 'arm')} no={t('sec.ask.no')} onYes={() => { closeAsk(); void act(true); }} onNo={closeAsk} />}
        {!s.can && <small className="at-osec-who">{ok(t, 'staffOnly')}</small>}
        {ui.err && <small className="at-sec-err" role="alert">{ok(t, 'fail')}: {ui.err}</small>}
        <div className="at-osec-groups">{s.zones.map(z => <span className={`at-osec-group is-${z.state}`}><Ring kind={z.state === 'triggered' ? 'alert' : z.state === 'armed' ? 'closed' : z.state === 'arming' || z.state === 'pending' ? 'count' : 'open'} size={22} progress={.5} tone={z.state === 'triggered' ? 'alarm' : z.state === 'armed' ? 'armed' : z.state === 'disarmed' ? 'calm' : 'warn'} /><b>{z.name}</b><small>{ok(t, `zone.${z.state}`)}</small></span>)}</div>
      </section>
    <section className="at-osec-devs">
      <div className="hm-section-head"><h2>{ok(t, 'devices')}</h2><small>{osecDevicesWord(s, t)}</small></div>
      <div className="at-osec-chips" role="tablist">{[{ id: 'all', name: ok(t, 'allRooms') }, ...s.rooms.map(r => ({ id: r.id, name: r.name }))].map(r => <button type="button" role="tab" aria-selected={room === r.id} className={room === r.id ? 'is-on' : ''} onClick={() => setRoom(r.id)}>{r.name}</button>)}</div>
      <div className="at-osec-list">
        {s.hub && room === 'all' && <HubCard s={s} t={t} open={open === 'hub'} onToggle={() => setOpen(open === 'hub' ? null : 'hub')} />}
        {items.map(({ i, room: rn, guarded }) => { const ds = devState(i, t, lang), n = faults(i), isOpen = open === i.id; return <div className={`at-osec-dev ${isOpen ? 'is-open' : ''}`}>
          <button type="button" className="at-osec-dev-hit" aria-expanded={isOpen} onClick={() => setOpen(isOpen ? null : i.id)}>
            <span className="at-osec-pic"><Art kind={i.kind} maker={i.maker} />{n > 0 && <i className="at-osec-badge">{n}</i>}</span>
            <span className="at-osec-dev-text"><b>{i.name}</b><small>{rn}{!guarded ? ` · ${ok(t, 'notGuarded')}` : ''}</small>
              <span className={`at-osec-now ${ds.tone}`}>{ds.text}</span>
              <span className="at-osec-icons">{i.signal && <Bars v={i.signal} />}{i.level !== null && <Battery v={i.level} />}{i.tamper && <span className="is-bad"><Case /></span>}{i.temp !== null && <em>{Math.round(i.temp)}°</em>}</span></span>
            <Chevron />
          </button>
          {isOpen && <DevRows i={i} t={t} lang={lang} />}
        </div>; })}
      </div>
    </section>
    <Feed s={s} host={host} t={t} lang={lang} />
    {admin && <StaffSettings s={s} host={host} t={t} />}
  </div></div>;
}
export function Row({ k, v, bad }: { k: string; v: string; bad?: boolean | 'warn' }) { return <div className="at-osec-row"><small>{k}</small><b className={bad === 'warn' ? 'is-warn' : bad ? 'is-bad' : ''}>{v}</b></div>; }
/** Ajax's device screen: a row per reading. */
function DevRows({ i, t, lang }: { i: OsecItem; t: T; lang: Lang }) {
  const sensor = i.kind === 'door' || i.kind === 'window' ? ok(t, 'row.contact') : i.kind === 'motion' ? ok(t, 'row.motion') : i.kind === 'presence' ? ok(t, 'row.presence') : ok(t, 'row.smoke');
  const ds = devState(i, t, lang);
  return <div className="at-osec-rows">
    <Row k={sensor} v={ds.text} bad={ds.tone === 'is-alarm' ? true : ds.tone === 'is-warn' ? 'warn' : false} />
    {/* CODEX-010: a part that has not said its state is «Нет данных», never «Норма», «Закрыт», «В сети» */}
    {i.glass !== null && <Row k={ok(t, 'row.glass')} v={i.glass ? ok(t, 'glass') : i.nodata.includes('glass') ? ok(t, 'noData') : ok(t, 'row.ok')} bad={i.glass || (i.nodata.includes('glass') && 'warn')} />}
    <Row k={ok(t, 'row.case')} v={i.tamper ? ok(t, 'row.caseOpen') : i.nodata.includes('tamper') ? ok(t, 'noData') : ok(t, 'row.caseClosed')} bad={i.tamper || (i.nodata.includes('tamper') && 'warn')} />
    <Row k={ok(t, 'row.link')} v={i.offline ? ok(t, 'offline') : i.nodata.includes('link') ? ok(t, 'noData') : ok(t, 'row.online')} bad={i.offline || (i.nodata.includes('link') && 'warn')} />
    {i.signal && <Row k={ok(t, 'row.signal')} v={ok(t, `sig.${i.signal}`)} bad={i.signal === 'weak'} />}
    {i.level !== null && <Row k={ok(t, 'row.battery')} v={`${Math.round(i.level)} %`} bad={i.level <= 20 || i.battery} />}
    {i.temp !== null && <Row k={ok(t, 'row.temp')} v={`${Math.round(i.temp)} °C`} />}
    {i.problem && !i.offline && <Row k={ok(t, 'row.fault')} v={ok(t, 'problem')} bad />}
  </div>;
}
function HubCard({ s, t, open, onToggle }: { s: OfficeSecurity; t: T; open: boolean; onToggle: () => void }) {
  const h = s.hub!, n = h.malfunctions + (h.lid ? 1 : 0) + (h.online === false ? 1 : 0);
  return <div className={`at-osec-dev is-hub ${open ? 'is-open' : ''}`}>
    <button type="button" className="at-osec-dev-hit" aria-expanded={open} onClick={onToggle}>
      <span className="at-osec-pic"><Art kind="hub" maker="ajax" />{n > 0 && <i className="at-osec-badge">{n}</i>}</span>
      <span className="at-osec-dev-text"><b>{h.name}</b><small>{h.model ?? ''}</small>
        <span className={`at-osec-now ${h.online === false ? 'is-alarm' : h.malfunctions ? 'is-warn' : ''}`}>{h.online === false ? ok(t, 'hub.offline') : h.malfunctions ? ok(t, 'hub.faultsN', { n: h.malfunctions }) : ok(t, 'hub.online')}</span>
        <span className="at-osec-icons">{h.network && <em className="at-osec-net">{h.network}</em>}{h.signal && <Bars v={h.signal} />}{h.level !== null && <Battery v={h.level} />}{h.lid && <span className="is-bad"><Case /></span>}</span></span>
      <Chevron />
    </button>
    {open && <div className="at-osec-rows">
      <Row k={ok(t, 'hub.link')} v={h.online === null ? ok(t, 'noData') : h.online ? ok(t, 'row.online') : ok(t, 'hub.offline')} bad={h.online === false} />
      <Row k={ok(t, 'hub.cell')} v={h.cellular === null ? ok(t, 'noData') : h.cellular ? `${ok(t, 'hub.connected')}${h.network ? ` · ${h.network}` : ''}` : ok(t, 'hub.notConnected')} bad={h.cellular === false} />
      <Row k="Ethernet" v={h.ethernet === null ? ok(t, 'noData') : h.ethernet ? ok(t, 'hub.connected') : ok(t, 'hub.notConnected')} bad={h.ethernet === false} />
      <Row k={ok(t, 'hub.power')} v={h.mains === null ? ok(t, 'noData') : h.mains ? ok(t, 'hub.connected') : ok(t, 'hub.battery')} bad={h.mains === false} />
      {h.level !== null && <Row k={ok(t, 'row.battery')} v={`${Math.round(h.level)} %`} bad={h.level <= 20} />}
      <Row k={ok(t, 'row.case')} v={h.lid === null ? ok(t, 'noData') : h.lid ? ok(t, 'row.caseOpen') : ok(t, 'row.caseClosed')} bad={!!h.lid} />
      <Row k={ok(t, 'hub.monitoring')} v={h.monitoring === null ? ok(t, 'noData') : h.monitoring ? ok(t, 'hub.connected') : ok(t, 'hub.notConnected')} />
      <Row k={ok(t, 'hub.faults')} v={h.malfunctions ? ok(t, 'hub.faultsApp', { n: h.malfunctions }) : ok(t, 'hub.noFaults')} bad={h.malfunctions > 0} />
    </div>}
  </div>;
}
/** The feed of the last week from HA's logbook (Ajax's «Уведомления»): by day, a ring and the time, who did it. */
function Feed({ s, host, t, lang }: { s: OfficeSecurity; host: Host; t: T; lang: Lang }) { return <SecurityFeed alarmId={s.alarm.id} alarmState={s.alarm.state} people={s.people} host={host} t={t} lang={lang} />; }
/** The feed of any Alarmo panel (the office's master, the house's own); `armed` names the mode («Не дома», «Отпуск») where the house has several. */
export function SecurityFeed({ alarmId, alarmState, people, host, t, lang, armed }: { alarmId: string; alarmState: string; people: Array<{ user: string | null; name: string }>; host: Host; t: T; lang: Lang; armed?: (mode: string | undefined) => string }) {
  const [rows, setRows] = useState<OsecEvent[] | null>(null), [kind, setKind] = useState<'all' | 'alarm' | 'mode'>('all'), online = host.online, canRead = !!host.ws;
  // read again when the alarm changes and when the link to the house returns (what happened meanwhile is in the logbook); without the link
  // nothing is asked and what was read stays; a host that cannot read the logbook at all says «нет данных» instead of waiting on «…» for ever
  useEffect(() => { let alive = true; const start = new Date(Date.now() - 7 * 864e5).toISOString();
    if (!host.ws || !online) return;
    host.ws<LogRow[]>({ type: 'logbook/get_events', start_time: start, entity_ids: [alarmId] }).then(r => { if (alive) setRows(readOsecEvents(Array.isArray(r) ? r : [], alarmId, people)); }, () => { if (alive) setRows([]); });
    return () => { alive = false; }; }, [host, alarmId, alarmState, online]);
  const list = (rows ?? []).filter(e => kind === 'all' || (kind === 'alarm' ? e.kind === 'triggered' || e.kind === 'pending' : e.kind === 'armed' || e.kind === 'disarmed')).slice(0, 12);
  const day = (ms: number) => { const d = new Date(ms), today = new Date(); const y = new Date(today); y.setDate(today.getDate() - 1); return d.toDateString() === today.toDateString() ? ok(t, 'today') : d.toDateString() === y.toDateString() ? ok(t, 'yesterday') : d.toLocaleDateString(locales[lang], { day: 'numeric', month: 'long' }); };
  let last = '';
  return <section className="at-osec-feed">
    <div className="hm-section-head"><h2>{ok(t, 'feed')}</h2></div>
    <div className="at-osec-chips" role="group" aria-label={ok(t, 'feed')}>{/* a filter of the list below, not tabs (tabs would owe the arrow keys and a tabpanel): buttons with a pressed one */}{(['all', 'alarm', 'mode'] as const).map(k => <button type="button" aria-pressed={kind === k} className={kind === k ? 'is-on' : ''} onClick={() => setKind(k)}>{ok(t, `feed.${k}`)}</button>)}</div>
    {rows === null ? <p className="at-osec-empty">{canRead ? '…' : ok(t, 'noData')}</p> : !list.length ? <p className="at-osec-empty">{ok(t, 'feed.none')}</p>
      : <div className="at-osec-events">{list.map(e => { const d = day(e.when), head = d !== last; last = d; return <>
        {head && <h3>{d}</h3>}
        <div className={`at-osec-ev is-${e.kind}`}>
          <span className="at-osec-ev-top"><Ring kind={e.kind === 'armed' ? 'closed' : e.kind === 'disarmed' ? 'open' : 'alert'} size={22} tone={e.kind === 'triggered' ? 'alarm' : e.kind === 'pending' ? 'warn' : 'off'} /><small>{hm(e.when, lang)}</small></span>
          <b>{e.kind === 'armed' && armed ? armed(e.mode) : ok(t, `ev.${e.kind}`)}{e.via === 'user' && e.by ? ` · ${e.by}` : e.via === 'ajax' ? ` · ${ok(t, 'ev.ajax')}` : e.via === 'automation' ? ` · ${ok(t, 'ev.auto')}` : ''}</b>
          {e.via && <span className="at-osec-ev-who" aria-hidden="true">{e.via === 'user' && e.by ? e.by.split(/\s+/).map(w => w[0]).slice(0, 2).join('') : e.via === 'ajax' ? 'A' : '⚙'}</span>}
        </div></>; })}</div>}
  </section>;
}
/** Who arms and disarms (HA admins only): a switch per person, the label «Охрана: сотрудник сервиса» on the person in HA. */
function StaffSettings({ s, host, t }: { s: OfficeSecurity; host: Host; t: T }) {
  const ui = useBusy(t), [mine, setMine] = useState<Record<string, boolean>>({});
  const staff = (id: string, was: boolean) => mine[id] ?? was;
  const flip = (id: string, was: boolean) => ui.run(id, async () => {
    if (!host.ws) throw new Error('no WebSocket');
    const row = await host.ws<{ entity_entry?: { labels?: string[] }; labels?: string[] }>({ type: 'config/entity_registry/get', entity_id: id });
    const cur = (row.entity_entry?.labels ?? row.labels ?? []).filter(l => l !== STAFF_LABEL), next = !staff(id, was);
    await host.ws({ type: 'config/entity_registry/update', entity_id: id, labels: next ? [...cur, STAFF_LABEL] : cur });
    setMine(m => ({ ...m, [id]: next }));
  });
  return <section className="at-sec-sec at-sec-set at-osec-set"><div className="hm-section-head"><h2>{ok(t, 'set.title')}</h2><small>{ok(t, 'set.admin')}</small></div>
    <div className="at-sec-set-grid"><div className="at-sec-set-card at-sec-set-loads">
      <b>{ok(t, 'set.staff')}</b><small>{ok(t, 'set.staffHint')}</small>
      <ul>{s.staff.map(p => { const on = staff(p.id, p.staff); return <li><span><b>{p.name}</b><small>{on ? ok(t, 'set.can') : ok(t, 'set.cannot')}</small></span>
        <button type="button" role="switch" className={`at-sec-sw-btn ${on ? 'is-on' : ''}`} aria-checked={on} aria-label={`${ok(t, 'set.staff')}: ${p.name}`} disabled={ui.busy !== null} onClick={() => flip(p.id, p.staff)}><i className="at-sec-sw" /></button></li>; })}</ul>
    </div></div>
    {ui.err && <p className="at-sec-err" role="alert">{ok(t, 'set.error')}: {ui.err}</p>}
  </section>;
}
