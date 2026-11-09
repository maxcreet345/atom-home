import { useState } from 'preact/hooks';
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
function useBusy() {
  const [busy, setBusy] = useState<string | null>(null), [err, setErr] = useState('');
  const run = async (k: string, f: () => Promise<unknown>) => { setBusy(k); setErr(''); try { await f(); } catch (e) { setErr(e instanceof Error ? e.message : String(e)); } finally { setBusy(null); } };
  return { busy, err, run };
}
export function SecurityTile({ s, registry, config, t, lang, onOpen }: { s: Security; registry: Registry; config: HouseConfig; t: T; lang: Lang; onOpen: () => void }) {
  const tone = secTone(s), list = people(registry, config), home = list.filter(p => p.state === 'home').length, guests = !!s.guests?.on;
  return <div className={`ah-tile hm-card at-sec-tile is-${tone}`}>
    <button type="button" className="ah-tile-hit" aria-label={`${sk(t, 'title')}: ${stateWord(s, t)}. ${sentence(s, t, home, guests)}`} onClick={onOpen}>
      {/* the name beside the shield, the state big, one sentence under it: a narrow tile (a 3-column phone) keeps only the shield and the state */}
      <span className="at-sec-tile-head"><Shield tone={tone} size={32} /><strong>{sk(t, 'title')}</strong></span>
      <span className="at-sec-tile-word">{tileWord(s, t)}</span>
      <small className="at-sec-tile-say">{sentence(s, t, home, guests)}</small>
      {(guests || s.vacation?.on) && <span className="at-sec-badges">{guests && <i>{sk(t, 'guests')}</i>}{s.vacation?.on && <i>{sk(t, 'vacation')}</i>}</span>}
    </button>
  </div>;
}
export function SecurityPanel({ s, registry, config, host, t, lang, now, admin }: { s: Security; registry: Registry; config: HouseConfig; host: Host; t: T; lang: Lang; now: number; admin: boolean }) {
  const tone = secTone(s), ui = useBusy(), list = people(registry, config), homeList = list.filter(p => p.state === 'home'), guests = !!s.guests?.on, st = s.alarm.state;
  const armed = ['away', 'guard', 'vacation', 'triggered', 'pending'].includes(st);
  const call = (domain: string, service: string, data: Record<string, unknown>) => () => host.call(domain, service, data);
  const left = s.alarm.delayEnds ? Math.max(0, Math.round((s.alarm.delayEnds - now) / 1000)) : null;
  const rooms = [...new Set(s.guarded.map(g => g.room))];
  return <div className="at-sec-panel">
    <section className={`at-sec-hero is-${tone}`}>
      <Shield tone={tone} size={88} />
      <div className="at-sec-hero-text">
        <small>{sk(t, 'title')}</small>
        <h2>{stateWord(s, t)}{left !== null && <span className="at-sec-count"> · {Math.floor(left / 60)}:{String(left % 60).padStart(2, '0')}</span>}</h2>
        <p>{sentence(s, t, homeList.length, guests)}</p>
        {armed && s.alarm.since && st !== 'pending' && <small>{sk(t, 'since', { t: hm(s.alarm.since, lang) })}{s.alarm.bypassed.length ? ` · ${sk(t, 'bypassedN', { n: s.alarm.bypassed.length })}` : ''}</small>}
      </div>
      <div className="at-sec-hero-act">
        {armed || st === 'arming' ? <button type="button" className="hm-pill at-sec-main is-off" disabled={ui.busy !== null} onClick={() => ui.run('disarm', call('alarm_control_panel', 'alarm_disarm', { entity_id: s.alarm.id }))}>{sk(t, 'disarm')}</button>
          : <button type="button" className="hm-pill at-sec-main" disabled={ui.busy !== null || st === 'unknown'} onClick={() => ui.run('arm', call('alarm_control_panel', 'alarm_arm_home', { entity_id: s.alarm.id }))}>{sk(t, 'arm')}</button>}
        {ui.err && <small className="at-sec-err" role="alert">{sk(t, 'fail')}: {ui.err}</small>}
      </div>
    </section>
    <section className="at-sec-modes">
      <div className={`at-sec-mode ${st === 'away' ? 'is-on' : ''}`}><b>{sk(t, 'mode.away')}</b><small>{homeList.length ? sk(t, 'mode.awayWait', { who: homeList.map(p => p.first).join(', ') }) : guests ? sk(t, 'mode.awayGuests') : st === 'away' ? sk(t, 'mode.awayOn') : sk(t, 'mode.awaySoon')}</small></div>
      <div className={`at-sec-mode ${st === 'guard' ? 'is-on' : ''}`}><b>{sk(t, 'mode.guard')}</b><small>{sk(t, 'mode.guardHint')}</small></div>
      {s.guests && <button type="button" className={`at-sec-mode is-switch ${guests ? 'is-on' : ''}`} aria-pressed={guests} disabled={ui.busy !== null} onClick={() => ui.run('guests', call('input_boolean', guests ? 'turn_off' : 'turn_on', { entity_id: s.guests!.id }))}><b>{sk(t, 'guests')}</b><small>{guests ? sk(t, 'mode.guestsOn') : sk(t, 'mode.guestsHint')}</small><i className="at-sec-sw" /></button>}
      {s.vacation && <button type="button" className={`at-sec-mode is-switch ${s.vacation.on ? 'is-on' : ''}`} aria-pressed={s.vacation.on} disabled={ui.busy !== null} onClick={() => ui.run('vacation', call('alarm_control_panel', s.vacation!.on ? 'alarm_disarm' : 'alarm_arm_vacation', { entity_id: s.vacation!.id }))}><b>{sk(t, 'vacation')}</b><small>{s.vacation.on ? (s.vacation.to ? sk(t, 'mode.vacationTo', { d: new Date(s.vacation.to).toLocaleDateString(locales[lang], { day: 'numeric', month: 'long' }) }) : sk(t, 'mode.vacationOn')) : sk(t, 'mode.vacationHint')}</small><i className="at-sec-sw" /></button>}
    </section>
    <section className="at-sec-sec"><div className="hm-section-head"><h2>{sk(t, 'openings')}</h2><small>{openOnes(s).length ? sk(t, 'openN', { n: openOnes(s).length }) : sk(t, 'allClosed')}</small></div>
      <div className="at-sec-rooms">{rooms.map(r => <div className="at-sec-room"><h3>{r}</h3>{s.guarded.filter(g => g.room === r).map(g => <div className={`at-sec-item ${g.open ? 'is-open' : ''} ${g.tamper ? 'is-tamper' : ''}`}>
        <span className="at-sec-ico"><Glyph k={g.kind} /></span>
        <span className="at-sec-item-text"><b>{g.name}</b><small>{g.open === null ? sk(t, 'noData') : g.open ? sk(t, 'openSince', { t: hm(g.since, lang) }) : sk(t, 'closed')}{g.bypassed ? ` · ${sk(t, 'bypassed')}` : ''}</small></span>
        {g.tamper && <em>{sk(t, 'tamper')}</em>}
      </div>)}</div>)}</div>
    </section>
    <section className="at-sec-sec"><div className="hm-section-head"><h2>{sk(t, 'hazards')}</h2><small>{s.hazards.some(h => h.alarm) ? sk(t, 'hazardNow') : sk(t, 'hazardOk')}</small></div>
      <div className="at-sec-hz">{s.hazards.map(h => <div className={`at-sec-item ${h.alarm ? 'is-alarm' : ''}`}><span className="at-sec-ico"><Glyph k={h.kind} /></span><span className="at-sec-item-text"><b>{h.kind === 'gas' ? sk(t, 'gas') : sk(t, 'leak')} · {h.room}{h.spot ? `, ${h.spot}` : ''}</b><small>{h.alarm === null ? sk(t, 'waitFirst') : h.alarm ? (h.kind === 'gas' ? sk(t, 'gasNow') : sk(t, 'leakNow')) : sk(t, 'dry')}</small></span></div>)}
        <div className={`at-sec-item at-sec-valve ${s.valve?.state === 'closed' ? 'is-closed' : ''}`}><span className="at-sec-ico"><Glyph k="valve" /></span>
          <span className="at-sec-item-text"><b>{sk(t, 'valve')}</b><small>{!s.valve ? sk(t, 'valveMissing') : s.valve.state === 'closed' ? sk(t, 'valveClosed') : s.valve.state === 'open' ? sk(t, 'valveOpen') : sk(t, 'noData')}{s.exercise?.on ? ` · ${sk(t, 'exercise', { n: String(s.exercise.days ?? 7), t: s.exercise.time ?? '03:00' })}` : ''}</small></span>
          {s.valve && <button type="button" className="hm-pill" disabled={ui.busy !== null} onClick={() => ui.run('valve', call('valve', s.valve!.state === 'closed' ? 'open_valve' : 'close_valve', { entity_id: s.valve!.id }))}>{s.valve.state === 'closed' ? sk(t, 'valveDoOpen') : sk(t, 'valveDoClose')}</button>}
        </div>
      </div>
    </section>
    <section className="at-sec-sec at-sec-how"><div className="hm-section-head"><h2>{sk(t, 'how')}</h2></div>
      <ul>{['away', 'guard', 'guests', 'vacation', 'alarm', 'water'].map(k => <li><b>{sk(t, `how.${k}.t`)}</b><span>{sk(t, `how.${k}`)}</span></li>)}</ul>
    </section>
    {admin && <SecuritySettings s={s} host={host} t={t} lang={lang} />}
  </div>;
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
