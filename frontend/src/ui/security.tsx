import { useState } from 'preact/hooks';
import { Art, Bars, Battery, Case, Chevron, Ring, Row, SecurityFeed, useBusy } from './office-security.tsx';
import type { Host } from '../runtime/host.ts';
import type { Key, T } from '../i18n/index.ts';
import type { Registry } from '../model/registry.ts';
import type { HouseConfig } from '../model/config.ts';
import { locales, type Lang } from './format.ts';
import { openOnes, secTone, VACATION_LABEL, type Guarded, type Hazard, type Security, type SecTone } from '../model/security.ts';
import { people } from '../model/people.ts';
/** The Security card and panel (owner, 09.11.2026, book/06-dashboards/SECURITY.md). Mock from real code: Alarmo's state, the modes «Не дома»
 * (by presence), «Охрана» (by hand), «Отпуск», «Гости», the door and windows, tamper, gas and water, the bathroom valve. */
const sk = (t: T, k: string, p?: Record<string, string | number>) => t(`sec.${k}` as Key, p);
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
function stateWord(s: Security, t: T): string {
  const st = s.alarm.state;
  if (s.hazards.some(h => h.alarm && h.kind === 'gas')) return sk(t, 'st.gas');
  if (s.hazards.some(h => h.alarm && h.kind === 'leak')) return sk(t, 'st.leak');
  if (st === 'triggered') return sk(t, 'st.triggered');
  if (st === 'pending') return sk(t, 'st.pending');
  if (st === 'arming') return sk(t, 'st.arming');
  if (st === 'unknown') return sk(t, 'st.unknown');
  if (st === 'disarmed') return s.vacation?.on ? sk(t, 'st.vacationOff') : sk(t, 'st.disarmed');
  return sk(t, `st.${st}`);
}
/** The tile has room for one word: «Снято», «Не дома», «Охрана», «Отпуск», «Тревога!». */
function tileWord(s: Security, t: T): string { const st = s.alarm.state; if (s.hazards.some(h => h.alarm)) return stateWord(s, t); return st === 'disarmed' ? sk(t, 'tile.disarmed') : st === 'pending' || st === 'arming' ? sk(t, `tile.${st}`) : stateWord(s, t); }
function sentence(s: Security, t: T, home: number, guests: boolean): string {
  const gas = s.hazards.find(h => h.alarm && h.kind === 'gas'), leak = s.hazards.find(h => h.alarm && h.kind === 'leak');
  const at = (h: Hazard) => `${h.room || h.name}${h.spot ? `, ${h.spot}` : ''}`;
  if (gas) return sk(t, 'say.gas', { room: at(gas) });
  if (leak) return sk(t, s.valve?.state === 'closed' ? 'say.leakShut' : 'say.leak', { room: at(leak) });
  const open = openOnes(s), tamper = s.guarded.find(x => x.tamper);
  if (s.alarm.state === 'triggered') return open.length ? sk(t, 'say.opened', { what: where(open[0], t) }) : sk(t, 'say.triggered');
  if (tamper) return sk(t, 'say.tamper', { what: where(tamper, t) });
  if (s.alarm.state === 'pending') return sk(t, 'say.pending');
  if (s.alarm.state === 'arming') return open.length ? sk(t, 'say.armingOpen', { what: where(open[0], t) }) : sk(t, 'say.arming');
  if (open.length) return open.length === 1 ? sk(t, 'say.open1', { what: where(open[0], t) }) : sk(t, 'say.openN', { n: open.length });
  if (guests && !home) return sk(t, 'say.guests');
  return sk(t, 'say.closed');
}
const where = (g: Guarded, t: T) => g.kind === 'door' ? sk(t, 'door') : `${g.name.toLowerCase().includes('окн') || g.name.toLowerCase().includes('window') ? g.name.toLowerCase() : sk(t, 'window')} · ${g.room}`;
type RingKind = 'open' | 'closed' | 'alert' | 'count';
const ARMED_ST = ['away', 'guard', 'vacation'];
/** Ajax's ring for the house (owner 09.11.2026: «в схожем стиле» with the office's): open = disarmed, closed = guarded, filling = a delay running,
 * a red disc with «!» = an alarm, gas or water. */
const ringKind = (s: Security): RingKind => s.alarm.state === 'triggered' || s.hazards.some(h => h.alarm) ? 'alert' : s.alarm.state === 'arming' || s.alarm.state === 'pending' ? 'count' : ARMED_ST.includes(s.alarm.state) ? 'closed' : 'open';
const ringTone = (s: Security): SecTone => ringKind(s) === 'alert' ? 'alarm' : ringKind(s) === 'count' ? 'warn' : ringKind(s) === 'closed' ? 'armed' : 'calm';
export function SecurityTile({ s, registry, config, t, lang: _lang, onOpen }: { s: Security; registry: Registry; config: HouseConfig; t: T; lang: Lang; onOpen: () => void }) {
  const tone = secTone(s), list = people(registry, config), home = list.filter(p => p.state === 'home').length, guests = !!s.guests?.on;
  return <div className={`ah-tile hm-card at-sec-tile at-osec-tile at-house-tile is-${tone} ${ARMED_ST.includes(s.alarm.state) ? 'is-st-armed' : ''}`}>
    <button type="button" className="ah-tile-hit" aria-label={`${sk(t, 'title')}: ${stateWord(s, t)}. ${sentence(s, t, home, guests)}`} onClick={onOpen}>
      {/* the ring and the name, the state big, one sentence: a narrow tile (a 3-column phone) keeps only the ring and the state */}
      <span className="at-sec-tile-head"><Ring kind={ringKind(s)} size={34} progress={.5} tone={ringTone(s)} /><strong>{sk(t, 'title')}</strong></span>
      <span className="at-sec-tile-word">{tileWord(s, t)}</span>
      <small className="at-sec-tile-say">{sentence(s, t, home, guests)}</small>
      {(guests || s.vacation?.on) && <span className="at-sec-badges">{guests && <i>{sk(t, 'guests')}</i>}{s.vacation?.on && <i>{sk(t, 'vacation')}</i>}</span>}
    </button>
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
export function SecurityPanel({ s, registry, config, host, t, lang, now, admin }: { s: Security; registry: Registry; config: HouseConfig; host: Host; t: T; lang: Lang; now: number; admin: boolean }) {
  const tone = secTone(s), ui = useBusy(), list = people(registry, config), homeList = list.filter(p => p.state === 'home'), guests = !!s.guests?.on, st = s.alarm.state;
  const armed = [...ARMED_ST, 'triggered', 'pending', 'arming'].includes(st);
  const call = (domain: string, service: string, data: Record<string, unknown>) => () => host.call(domain, service, data);
  const left = s.alarm.delayEnds ? Math.max(0, (s.alarm.delayEnds - now) / 1000) : null, total = s.alarm.delayEnds && s.alarm.since ? (s.alarm.delayEnds - s.alarm.since) / 1000 : 0;
  const [room, setRoom] = useState('all'), [open, setOpen] = useState<string | null>(null);
  // every device of the house's security as a card, by room: the door and windows, gas, the leaks, the valve
  const devs: Dev[] = [
    ...s.guarded.map(g => ({ id: g.id, room: g.room, name: g.name, art: g.kind, info: g, tamper: g.tamper, now: g.open === null ? sk(t, 'noData') : g.open ? sk(t, 'openSince', { t: hm(g.since, lang) }) + (g.bypassed ? ` · ${sk(t, 'bypassed')}` : '') : sk(t, 'closed'), tone: (g.open === null || g.open ? 'is-warn' : '') as Dev['tone'] })),
    ...s.hazards.map(h => ({ id: h.id, room: h.room, name: `${h.kind === 'gas' ? sk(t, 'gas') : sk(t, 'leak')}${h.spot ? ` · ${h.spot}` : ''}`, art: h.kind, info: h, tamper: null, now: h.alarm === null ? sk(t, 'waitFirst') : h.alarm ? (h.kind === 'gas' ? sk(t, 'gasNow') : sk(t, 'leakNow')) : sk(t, 'dry'), tone: (h.alarm ? 'is-alarm' : '') as Dev['tone'] })),
  ];
  const rooms = [...new Set([...devs.map(d => d.room), ...(s.valve ? [s.valve.room] : [])].filter(Boolean))];
  // trouble first: an alarm, then what is open or has no data, then a device with a fault (case, battery, radio)
  const rank = (d: Dev) => d.tone === 'is-alarm' ? 0 : d.tone === 'is-warn' ? 1 : d.tamper || d.info?.low || d.info?.signal === 'weak' ? 2 : 3;
  const shown = devs.filter(d => room === 'all' || d.room === room).map((d, i) => ({ d, i })).sort((x, y) => rank(x.d) - rank(y.d) || x.i - y.i).map(x => x.d);
  const away = st === 'away' ? sk(t, 'chip.awayOn') : homeList.length ? sk(t, 'chip.awayWait', { who: homeList.map(p => p.first).join(', ') }) : guests ? sk(t, 'chip.awayGuests') : sk(t, 'chip.awayAuto');
  const backDay = s.vacation?.to ? new Date(s.vacation.to).toLocaleDateString(locales[lang], { day: 'numeric', month: 'long' }) : null;
  const persons = Object.keys(registry.states).filter(id => id.startsWith('person.')).map(id => ({ user: typeof registry.states[id].attributes.user_id === 'string' ? registry.states[id].attributes.user_id as string : null, name: String(registry.states[id].attributes.friendly_name ?? id) }));
  const armedWord = (mode: string | undefined) => mode === 'armed_away' ? sk(t, 'ev.away') : mode === 'armed_vacation' ? sk(t, 'ev.vacation') : sk(t, 'ev.guard');
  return <div className="at-osec-wrap at-sec-panel"><div className="at-osec">
    <section className={`at-osec-control is-${tone} ${ARMED_ST.includes(st) ? 'is-st-armed' : `is-st-${st}`} ${ringKind(s) === 'alert' ? 'is-alarm' : ''}`}>
      <Ring kind={ringKind(s)} size={104} progress={total && left !== null ? 1 - left / total : 0} tone={ringTone(s)} />
      <div className="at-osec-name">
        <h2>{config.home.name || sk(t, 'title')}</h2>
        <p className="at-osec-state">{stateWord(s, t)}{left !== null && <span className="at-osec-count"> · {Math.floor(left / 60)}:{String(Math.round(left % 60)).padStart(2, '0')}</span>}</p>
        <small>{sentence(s, t, homeList.length, guests)}</small>
        {armed && s.alarm.since && st !== 'pending' && <small>{sk(t, 'since', { t: hm(s.alarm.since, lang) })}{s.alarm.bypassed.length ? ` · ${sk(t, 'bypassedN', { n: s.alarm.bypassed.length })}` : ''}</small>}
      </div>
      {/* «Под охрану» is the manual «Охрана» (cleared only by hand); «Не дома» sets itself, «Отпуск» is below */}
      <div className="at-osec-pad" role="group" aria-label={sk(t, 'title')}>
        <button type="button" className={`at-osec-key at-sec-main ${st === 'guard' ? 'is-now' : ''}`} disabled={ui.busy !== null || st === 'unknown' || armed} onClick={() => ui.run('arm', call('alarm_control_panel', 'alarm_arm_home', { entity_id: s.alarm.id }))}>
          <b>{sk(t, 'key.arm')}</b><Ring kind="closed" size={52} tone="calm" /></button>
        <button type="button" className={`at-osec-key ${st === 'disarmed' ? 'is-now' : ''}`} disabled={ui.busy !== null || st === 'unknown' || !armed} onClick={() => ui.run('disarm', call('alarm_control_panel', 'alarm_disarm', { entity_id: s.alarm.id }))}>
          <b>{sk(t, 'key.disarm')}</b><Ring kind="open" size={52} tone="calm" /></button>
      </div>
      {ui.err && <small className="at-sec-err" role="alert">{sk(t, 'fail')}: {ui.err}</small>}
      <div className="at-osec-groups">
        {/* «Не дома» sets itself; while «Охрана» or «Отпуск» stands it has nothing to say */}
        {st !== 'guard' && st !== 'vacation' && !s.vacation?.on && <span className={`at-osec-group ${st === 'away' ? 'is-armed' : ''}`}><Ring kind={st === 'away' ? 'closed' : 'open'} size={22} tone={st === 'away' ? 'armed' : 'calm'} /><b>{sk(t, 'mode.away')}</b><small>{away}</small></span>}
        {s.guests && <button type="button" className={`at-osec-group is-btn ${guests ? 'is-on' : ''}`} aria-pressed={guests} disabled={ui.busy !== null} onClick={() => ui.run('guests', call('input_boolean', guests ? 'turn_off' : 'turn_on', { entity_id: s.guests!.id }))}>
          <i className="at-sec-sw" /><b>{sk(t, 'guests')}</b><small>{guests ? sk(t, 'chip.on') : sk(t, 'chip.off')}</small></button>}
        {s.vacation && <button type="button" className={`at-osec-group is-btn ${s.vacation.on ? 'is-on' : ''}`} aria-pressed={s.vacation.on} disabled={ui.busy !== null} onClick={() => ui.run('vacation', call('alarm_control_panel', s.vacation!.on ? 'alarm_disarm' : 'alarm_arm_vacation', { entity_id: s.vacation!.id }))}>
          <i className="at-sec-sw" /><b>{sk(t, 'vacation')}</b><small>{s.vacation.on ? (backDay ? sk(t, 'chip.until', { d: backDay }) : sk(t, 'chip.on')) : sk(t, 'chip.off')}</small></button>}
      </div>
    </section>
    <section className="at-osec-devs">
      <div className="hm-section-head"><h2>{sk(t, 'devices')}</h2><small>{s.hazards.some(h => h.alarm) ? sk(t, 'hazardNow') : openOnes(s).length ? sk(t, 'openN', { n: openOnes(s).length }) : sk(t, 'allClosed')}</small></div>
      <div className="at-osec-chips" role="tablist">{[{ id: 'all', name: sk(t, 'allRooms') }, ...rooms.map(r => ({ id: r, name: r }))].map(r => <button type="button" role="tab" aria-selected={room === r.id} className={room === r.id ? 'is-on' : ''} onClick={() => setRoom(r.id)}>{r.name}</button>)}</div>
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
              <span className={`at-osec-now ${s.valve?.state === 'closed' ? 'is-warn' : ''}`}>{!s.valve ? sk(t, 'valveMissing') : s.valve.state === 'closed' ? sk(t, 'valveClosed') : s.valve.state === 'open' ? sk(t, 'valveOpen') : sk(t, 'noData')}</span>
              {s.exercise?.on && <small>{sk(t, 'exercise', { n: String(s.exercise.days ?? 7), t: s.exercise.time ?? '03:00' })}</small>}</span>
            {s.valve && <button type="button" className="hm-pill at-sec-valve-btn" disabled={ui.busy !== null} onClick={() => ui.run('valve', call('valve', s.valve!.state === 'closed' ? 'open_valve' : 'close_valve', { entity_id: s.valve!.id }))}>{s.valve.state === 'closed' ? sk(t, 'valveDoOpen') : sk(t, 'valveDoClose')}</button>}
          </div>
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
function SecuritySettings({ s, host, t, lang }: { s: Security; host: Host; t: T; lang: Lang }) {
  const ui = useBusy();
  // the label is edited in the entity registry; the registry mirror refreshes later, so the panel keeps its own answer meanwhile
  const [mine, setMine] = useState<Record<string, boolean>>({});
  const off = (id: string, was: boolean) => mine[id] ?? was;
  const flip = (id: string, was: boolean) => ui.run(`load:${id}`, async () => {
    if (!host.ws) throw new Error('no WebSocket');
    const row = await host.ws!<{ entity_entry?: { labels?: string[] }; labels?: string[] }>({ type: 'config/entity_registry/get', entity_id: id });
    const cur = (row.entity_entry?.labels ?? row.labels ?? []).filter(l => l !== VACATION_LABEL), next = !off(id, was);
    await host.ws!({ type: 'config/entity_registry/update', entity_id: id, labels: next ? [...cur, VACATION_LABEL] : cur });
    setMine(m => ({ ...m, [id]: next }));
  });
  const ex = s.exercise, today = new Date().toISOString().slice(0, 10);
  return <section className="at-sec-sec at-sec-set"><div className="hm-section-head"><h2>{sk(t, 'set.title')}</h2><small>{sk(t, 'set.admin')}</small></div>
    <div className="at-sec-set-grid">
      {s.vacation?.toId && <div className="at-sec-set-card">
        <b>{sk(t, 'set.back')}</b><small>{sk(t, 'set.backHint')}</small>
        <label className="at-sec-field"><span>{sk(t, 'set.backDate')}</span><input type="date" min={today} value={s.vacation.to ?? ''} disabled={ui.busy !== null} onChange={e => { const v = (e.currentTarget as HTMLInputElement).value; if (v) void ui.run('back', () => host.call('input_datetime', 'set_datetime', { entity_id: s.vacation!.toId, datetime: `${v} 00:00:00` })); }} /></label>
      </div>}
      {ex && <div className="at-sec-set-card">
        <div className="at-sec-set-row"><span><b>{sk(t, 'set.exercise')}</b><small>{sk(t, 'set.exerciseHint')}</small></span>
          <button type="button" role="switch" className={`at-sec-sw-btn ${ex.on ? 'is-on' : ''}`} aria-checked={ex.on} aria-label={sk(t, 'set.exercise')} disabled={ui.busy !== null} onClick={() => ui.run('ex', () => host.call('input_boolean', ex.on ? 'turn_off' : 'turn_on', { entity_id: ex.id }))}><i className="at-sec-sw" /></button></div>
        <div className="at-sec-set-fields">
          {ex.timeId && <label className="at-sec-field"><span>{sk(t, 'set.time')}</span><input type="time" value={ex.time ?? ''} disabled={ui.busy !== null || !ex.on} onChange={e => { const v = (e.currentTarget as HTMLInputElement).value; if (v) void ui.run('ext', () => host.call('input_datetime', 'set_datetime', { entity_id: ex.timeId, time: `${v}:00` })); }} /></label>}
          {ex.daysId && <label className="at-sec-field"><span>{sk(t, 'set.days')}</span><input type="number" inputMode="numeric" min={1} max={30} step={1} value={ex.days ?? 7} disabled={ui.busy !== null || !ex.on} onChange={e => { const v = Math.round(Number((e.currentTarget as HTMLInputElement).value)); if (v >= 1 && v <= 30) void ui.run('exd', () => host.call('input_number', 'set_value', { entity_id: ex.daysId, value: v })); }} /></label>}
        </div>
        {!s.valve && <small className="at-sec-set-note">{sk(t, 'set.noValve')}</small>}
      </div>}
      {s.loads.length > 0 && <div className="at-sec-set-card at-sec-set-loads">
        <b>{sk(t, 'set.loads')}</b><small>{sk(t, 'set.loadsHint')}</small>
        <ul>{s.loads.map(l => { const o = off(l.id, l.off); return <li><span><b>{l.name}</b><small>{l.room}{l.room ? ' · ' : ''}{o ? sk(t, 'set.loadOff') : sk(t, 'set.loadKeep')}</small></span>
          <button type="button" role="switch" className={`at-sec-sw-btn ${o ? '' : 'is-on'}`} aria-checked={!o} aria-label={`${sk(t, 'set.keep')}: ${l.name}`} disabled={ui.busy !== null} onClick={() => flip(l.id, l.off)}><i className="at-sec-sw" /></button></li>; })}</ul>
      </div>}
    </div>
    {ui.err && <p className="at-sec-err" role="alert">{sk(t, 'set.error')}: {ui.err}</p>}
  </section>;
}
