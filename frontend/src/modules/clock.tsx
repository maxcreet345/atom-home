import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import type { ComponentChildren } from 'preact';
import type { ModuleDef, ModuleEntities } from './types.ts';
import { clockSpec } from './catalog.ts';
import { sunInfo, timerInfo, nearestTimer, fmtRemaining, toDuration, parseLabels, withLabel, labelText, weekNumber, PRESETS, NAMED_PRESETS, iconForLabel, dialMinutes, readClockSettings, writeClockSettings, personState, initials, type ClockSettings, type TimerInfo } from './clock-state.ts';
import { Icon } from '../ui/primitives.tsx';
import { Switch } from '../ui/cards.tsx';
import type { Runner } from '../ui/sheet.tsx';
import type { Registry, StateRow } from '../model/registry.ts';
import type { HomeDevice } from '../model/discover.ts';
import type { Host } from '../runtime/host.ts';
import type { T, Key } from '../i18n/index.ts';
import { num, type Lang } from '../ui/format.ts';

const locale = (lang: Lang) => lang === 'ru' ? 'ru-RU' : lang === 'ro' ? 'ro-RO' : 'en-GB';
const pt = (angle: number, r: number) => [50 + r * Math.sin(angle * Math.PI / 180), 50 - r * Math.cos(angle * Math.PI / 180)] as const;
const clockTime = (at: number, lang: Lang) => new Intl.DateTimeFormat(locale(lang), { hour: '2-digit', minute: '2-digit' }).format(at);
/** One-second heartbeat for countdowns and the digital seconds, only while something needs it. */
function useTick(active: boolean) { const [, set] = useState(0); useEffect(() => { if (!active) return; const i = setInterval(() => set(x => x + 1), 1000); return () => clearInterval(i); }, [active]); }

/** The analog face: daylight arc on a 24-hour rim, numerals, hands; the seconds hand sweeps with a CSS animation started at the current second. In timer mode the hands give way to a ring and the remaining time. */
export function ClockFace({ now, sun, settings, timer }: { now: Date; sun?: StateRow; settings: ClockSettings; timer?: { remainingMs: number; durationMs: number; label: string; more: number } | null }) {
  const h = now.getHours(), m = now.getMinutes();
  const info = sunInfo(sun, now.getTime());
  const secDelay = useMemo(() => -(new Date().getSeconds() + new Date().getMilliseconds() / 1000), []);
  const arc = settings.arc && info.rise !== null && info.set !== null ? (() => { const a1 = (new Date(info.rise!).getHours() + new Date(info.rise!).getMinutes() / 60) * 15, a2 = (new Date(info.set!).getHours() + new Date(info.set!).getMinutes() / 60) * 15; const p1 = pt(a1, 44), p2 = pt(a2, 44); const nowA = (h + m / 60) * 15, sp = pt(nowA, 44); return { d: `M${p1[0].toFixed(2)} ${p1[1].toFixed(2)} A44 44 0 ${a2 - a1 > 180 ? 1 : 0} 1 ${p2[0].toFixed(2)} ${p2[1].toFixed(2)}`, sp }; })() : null;
  const hourA = ((h % 12) + m / 60) * 30, minA = m * 6;
  const [hx, hy] = pt(hourA, 22), [hx0, hy0] = pt(hourA + 180, 5), [mx, my] = pt(minA, 31), [mx0, my0] = pt(minA + 180, 6);
  const C = 2 * Math.PI * 38;
  return <svg viewBox="0 0 100 100" aria-hidden="true" className={`ah-clock-svg ${info.night ? 'is-night' : ''} ${timer ? 'is-timer' : ''}`}>
    <circle cx="50" cy="50" r="46" className="ah-clock-face" />
    {arc && <><path d={arc.d} className="ah-clock-arc" /><circle cx={arc.sp[0]} cy={arc.sp[1]} r="3.2" className="ah-clock-sun" /></>}
    {timer ? <>
      <circle cx="50" cy="50" r="38" className="ah-clock-ring-bg" />
      <circle cx="50" cy="50" r="38" className="ah-clock-ring" stroke-dasharray={C.toFixed(2)} stroke-dashoffset={(C * (1 - (timer.durationMs ? timer.remainingMs / timer.durationMs : 0))).toFixed(2)} transform="rotate(-90 50 50)" />
    </> : <>
      <g className="ah-clock-nums">{Array.from({ length: 12 }, (_, i) => { const [x, y] = pt((i + 1) * 30, 36); return <text x={x} y={y} text-anchor="middle" dominant-baseline="central" font-size="7" font-weight="500">{i + 1}</text>; })}</g>
      <line x1={hx0} y1={hy0} x2={hx} y2={hy} className="ah-hand is-hour" />
      <line x1={mx0} y1={my0} x2={mx} y2={my} className="ah-hand is-min" />
      {settings.seconds && <g className="ah-sec" style={`animation-delay:${secDelay.toFixed(2)}s`}><line x1="50" y1="59" x2="50" y2="16" className="ah-hand is-sec" /></g>}
      <circle cx="50" cy="50" r="2.2" className="ah-hand-cap" />
    </>}
  </svg>;
}

/** Home-face tile: analog or digital clock, date, timer countdown; a tap opens the «Time» sheet. */
export function ClockTile({ now, lang, t, registry, entities, onOpen }: { now: Date; lang: Lang; t: T; registry: Registry; entities: ModuleEntities; onOpen: () => void }) {
  const settings = readClockSettings();
  const timerIds = [entities.timer1, entities.timer2, entities.timer3].filter((x): x is string => !!x);
  const near = nearestTimer(registry.states, timerIds, Date.now());
  useTick(!!near || settings.style === 'digital');
  const live = new Date();
  const labels = parseLabels(registry.states[entities.labels ?? '']?.state);
  const timer = near ? { remainingMs: near.timer.state === 'active' && near.timer.finishesAt ? Math.max(0, near.timer.finishesAt - live.getTime()) : near.timer.remainingMs, durationMs: near.timer.durationMs, label: labelText(labels[near.timer.id]), more: near.running - 1 } : null;
  const date = new Intl.DateTimeFormat(locale(lang), { weekday: 'short', day: 'numeric', month: 'long' }).format(now);
  const time = clockTime(now.getTime(), lang);
  return <button type="button" className={`ah-tile ah-clock hm-card ${timer ? 'is-timer' : ''} is-${settings.style}`} aria-label={`${time} · ${date}`} onClick={onOpen}>
    {settings.style === 'digital' && !timer
      ? <div className="ah-clock-digital"><b>{clockTime(live.getTime(), lang)}</b><span>{String(live.getSeconds()).padStart(2, '0')}</span></div>
      : <ClockFace now={now} sun={entities.sun ? registry.states[entities.sun] : undefined} settings={settings} timer={timer} />}
    {timer && <div className="ah-clock-big"><b>{fmtRemaining(timer.remainingMs)}</b><small>{timer.label || t('clock.timer')}{timer.more > 0 ? ` · +${timer.more}` : ''}</small></div>}
    <span className="ah-clock-date">{timer && timer.more > 0 ? t('clock.more', { n: timer.more }) : date}</span>
  </button>;
}

const Title = ({ children }: { children: ComponentChildren }) => <div className="ah-row at-cam-title"><small>{children}</small></div>;
const KV = ({ k, v }: { k: string; v: ComponentChildren }) => <div className="at-cam-kv"><span>{k}</span><small>{v}</small></div>;
const CONDITIONS = ['clear-night', 'cloudy', 'fog', 'hail', 'lightning', 'lightning-rainy', 'partlycloudy', 'pouring', 'rainy', 'snowy', 'snowy-rainy', 'sunny', 'windy', 'windy-variant', 'exceptional'];

/** The «Time» sheet: big clock, sun, three shared timers, who is home, the speakers' next alarm, settings. */
export function ClockSheet({ registry, entities, host, t, lang, runner, onClose, wide }: { registry: Registry; entities: ModuleEntities; host: Host; t: T; lang: Lang; runner: Runner; onClose: () => void; wide: boolean }) {
  const [page, setPage] = useState<'main' | 'settings'>('main');
  const [settings, setSettings] = useState(readClockSettings);
  const [label, setLabel] = useState(''), [dial, setDial] = useState<number | null>(null), [note, setNote] = useState('');
  const dialRef = useRef<SVGSVGElement>(null), dragging = useRef(false);
  useTick(true);
  const tx = (k: string, p?: Record<string, string | number>) => t(k as Key, p);
  const now = new Date(), nowMs = now.getTime();
  const S = registry.states;
  const sun = sunInfo(entities.sun ? S[entities.sun] : undefined, nowMs);
  const timerIds = [entities.timer1, entities.timer2, entities.timer3].filter((x): x is string => !!x);
  const timers = timerIds.map(id => timerInfo(id, S[id], nowMs));
  const labels = parseLabels(S[entities.labels ?? '']?.state);
  const weather = entities.weather ? S[entities.weather] : undefined;
  const wTemp = typeof weather?.attributes.temperature === 'number' ? weather.attributes.temperature : null;
  const wCond = weather && CONDITIONS.includes(weather.state) ? tx(`clock.weather.${weather.state}`) : null;
  const persons = registry.entities.filter(e => e.entity_id.startsWith('person.') && !e.disabled_by && S[e.entity_id]).map(e => ({ id: e.entity_id, name: typeof S[e.entity_id].attributes.friendly_name === 'string' ? S[e.entity_id].attributes.friendly_name as string : e.entity_id, ...personState(S[e.entity_id]) }));
  const alarms = registry.entities.filter(e => e.entity_id.startsWith('calendar.') && /_alarms$/.test(e.entity_id) && !e.disabled_by && S[e.entity_id]).map(e => { const a = S[e.entity_id].attributes; const start = typeof a.start_time === 'string' ? Date.parse(a.start_time) : NaN; return { id: e.entity_id, name: typeof a.friendly_name === 'string' ? a.friendly_name as string : e.entity_id, message: typeof a.message === 'string' ? a.message as string : '', start: Number.isFinite(start) ? start : null }; }).filter(a => a.start !== null).sort((a, b) => a.start! - b.start!);
  const dev = { key: 'clock', name: tx('clock.title'), primary: { available: true } } as unknown as HomeDevice;
  const busy = runner.busy.has('clock');
  const call = async (domain: string, service: string, data: Record<string, unknown>) => { try { await host.call(domain, service, data); } catch (e) { setNote(e instanceof Error ? e.message : String(e)); } };
  const saveLabel = (id: string, text: string, seconds: number) => entities.labels ? call('input_text', 'set_value', { entity_id: entities.labels, value: withLabel(labels, id, text, seconds) }) : Promise.resolve();
  const start = async (totalSec: number, withLabelText = label) => {
    const slot = timers.find(x => x.state === 'idle' || x.state === 'unknown'); if (!slot) { setNote(tx('clock.timer.full')); return; }
    await saveLabel(slot.id, withLabelText, totalSec); await call('timer', 'start', { entity_id: slot.id, duration: toDuration(totalSec) }); setLabel(''); setDial(null);
  };
  const names = Object.fromEntries(NAMED_PRESETS.map(p => [p.key, tx(`clock.preset.${p.key}`)]));
  /** The dial: drag (or tap) anywhere on the ring to set minutes; the knob and the arc follow the finger. */
  const dialAt = (ev: PointerEvent) => { const svg = dialRef.current; if (!svg) return; const r = svg.getBoundingClientRect(); setDial(dialMinutes(ev.clientX - r.left, ev.clientY - r.top, r.width / 2, r.height / 2) * 60); };
  const dialDown = (ev: PointerEvent) => { dragging.current = true; (ev.currentTarget as Element).setPointerCapture?.(ev.pointerId); dialAt(ev); };
  const dialMove = (ev: PointerEvent) => { if (dragging.current) dialAt(ev); };
  const dialUp = () => { dragging.current = false; };
  useEffect(() => { if (!note) return; const i = setTimeout(() => setNote(''), 4000); return () => clearTimeout(i); }, [note]);
  const update = (patch: Partial<ClockSettings>) => { const next = { ...settings, ...patch }; setSettings(next); writeClockSettings(next); };
  const when = (at: number) => { const d = new Date(at), same = d.toDateString() === now.toDateString(); const tm = clockTime(at, lang); if (same) return tm; const tomorrow = new Date(nowMs + 86_400_000).toDateString() === d.toDateString(); return tomorrow ? `${tx('clock.tomorrow')} ${tm}` : `${new Intl.DateTimeFormat(locale(lang), { weekday: 'short' }).format(d)} ${tm}`; };
  const hm = (v: number) => `${Math.floor(v / 3_600_000)} ${tx('clock.h')} ${String(Math.round((v % 3_600_000) / 60_000)).padStart(2, '0')} ${tx('clock.min')}`;
  const boolRow = (role: string, text: string, icon: string, color: string, sub?: string) => { const id = entities[role]; const row = id ? S[id] : undefined; if (!id || !row) return null; const on = row.state === 'on'; return <div className="ah-row hm-setting"><span className="ah-row-icon" style={`--tile:${color}`}><Icon name={icon} size={18} /></span><span className="ah-row-text"><strong>{text}</strong>{sub && <small>{sub}</small>}</span><Switch on={on} pending={busy} label={text} onToggle={() => void call('input_boolean', on ? 'turn_off' : 'turn_on', { entity_id: id })} /></div>; };
  const localRow = (text: string, icon: string, color: string, on: boolean, toggle: () => void, sub?: string) => <div className="ah-row hm-setting"><span className="ah-row-icon" style={`--tile:${color}`}><Icon name={icon} size={18} /></span><span className="ah-row-text"><strong>{text}</strong>{sub && <small>{sub}</small>}</span><Switch on={on} label={text} onToggle={toggle} /></div>;

  const headBtns = <div className="at-cam-head-btns">{page === 'settings' && wide && <button type="button" className="hm-icon-btn" aria-label={t('ui.back')} onClick={() => setPage('main')}><Icon name="back" size={22} /></button>}{page === 'main' && <button type="button" className="hm-icon-btn at-cam-gear" aria-label={tx('clock.settings')} onClick={() => setPage('settings')}><Icon name="gear" size={20} /></button>}<button type="button" className="hm-icon-btn" aria-label={t('ui.close')} onClick={onClose}>×</button></div>;
  const head = page === 'main' || wide
    ? <div className="hm-sheet-head"><span className="hm-sheet-photo at-clock-photo"><Icon name="clock" size={30} /></span><div><small>{t('section.home')}</small><h2>{tx('clock.title')}</h2></div>{!wide && headBtns}</div>
    : <div className="hm-sheet-head"><button type="button" className="hm-icon-btn" aria-label={t('ui.back')} onClick={() => setPage('main')}><Icon name="back" size={22} /></button><div><small>{tx('clock.title')}</small><h2>{tx('clock.settings')}</h2></div>{headBtns}</div>;
  const face = <>
    {wide && <div className="at-clock-face-wrap"><ClockFace now={now} sun={entities.sun ? S[entities.sun] : undefined} settings={{ ...settings, seconds: true }} /></div>}
    <div className="at-clock-big"><b>{clockTime(nowMs, lang)}</b><span>{String(now.getSeconds()).padStart(2, '0')}</span></div>
    <div className="at-clock-date"><b>{new Intl.DateTimeFormat(locale(lang), { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }).format(now)}</b> · {tx('clock.week', { n: weekNumber(now) })}{wTemp !== null ? ` · ${num(wTemp, lang, 1)}°${wCond ? ' ' + wCond : ''}` : ''}</div>
    {sun.rise !== null && sun.set !== null && <div className="at-clock-sun">
      <div className="at-clock-sun-row"><span>{tx('clock.sunrise')} <b>{clockTime(sun.rise, lang)}</b></span><span>{tx('clock.day')} <b>{hm(sun.dayMs ?? 0)}</b></span><span>{tx('clock.sunset')} <b>{clockTime(sun.set, lang)}</b></span></div>
      <svg viewBox="0 0 300 64" className="at-clock-arc" aria-hidden="true"><path d="M20 58 Q150 -40 280 58" className="bg" />{sun.frac !== null && <><path d="M20 58 Q150 -40 280 58" className="fg" stroke-dasharray="330" stroke-dashoffset={(330 * (1 - sun.frac)).toFixed(1)} /><circle cx={(20 + 260 * sun.frac).toFixed(1)} cy={(58 - 196 * sun.frac * (1 - sun.frac)).toFixed(1)} r="7" className="dot" /></>}<line x1="20" y1="58" x2="280" y2="58" className="base" /></svg>
      <div className="at-clock-sun-row"><span>{sun.night ? tx('clock.untilSunrise') : tx('clock.untilSunset')} <b>{sun.untilNext !== null ? hm(sun.untilNext) : '—'}</b></span>{sun.elevation !== null && <span>{tx('clock.elevation')} <b>{Math.round(sun.elevation)}°</b></span>}</div>
    </div>}
  </>;
  const running = timers.filter(x => x.state === 'active' || x.state === 'paused');
  const timerRow = (x: TimerInfo) => { const left = x.state === 'active' && x.finishesAt ? Math.max(0, x.finishesAt - nowMs) : x.remainingMs; const frac = x.durationMs ? left / x.durationMs : 0; const C = 2 * Math.PI * 28;
    const text = labelText(labels[x.id]);
    return <div className={`at-clock-trow is-${x.state}`} key={x.id}><div className="at-clock-ring"><svg viewBox="0 0 64 64"><circle className="bg" cx="32" cy="32" r="28" /><circle className="fg" cx="32" cy="32" r="28" stroke-dasharray={C.toFixed(1)} stroke-dashoffset={(C * (1 - frac)).toFixed(1)} /></svg><b>{fmtRemaining(left)}</b></div>
      <span className="at-clock-trow-icon"><Icon name={iconForLabel(text, names)} size={20} /></span>
      <div className="at-clock-tt"><strong>{text || tx('clock.timer')}</strong><small>{Math.round(x.durationMs / 60_000)} {tx('clock.min')}{x.state === 'paused' ? ` · ${tx('clock.paused')}` : ''}</small></div>
      <button type="button" className="at-clock-ctl" aria-label={x.state === 'paused' ? tx('clock.resume') : tx('clock.pause')} disabled={busy} onClick={() => void call('timer', x.state === 'paused' ? 'start' : 'pause', { entity_id: x.id })}><Icon name={x.state === 'paused' ? 'play' : 'pause'} size={18} /></button>
      <button type="button" className="at-clock-ctl is-stop" aria-label={tx('clock.cancel')} disabled={busy} onClick={() => void call('timer', 'cancel', { entity_id: x.id })}>×</button></div>; };
  const timersBlock = timerIds.length > 0 && <div className="at-clock-timers">
    {running.length > 0 && <><h4>{tx('clock.timers')}</h4>{running.map(timerRow)}</>}
    {running.length < timerIds.length && <>
      <h4>{tx('clock.newTimer')}</h4>
      <div className="at-clock-grid">{PRESETS.map(p => <button type="button" className="at-clock-tile" disabled={busy} onClick={() => void start(p * 60)}><b>{p === 60 ? 1 : p}</b><small>{p === 60 ? tx('clock.hour') : tx('clock.min')}</small></button>)}</div>
      <div className="at-clock-grid is-named">{NAMED_PRESETS.map(p => <button type="button" className="at-clock-tile is-named" disabled={busy} onClick={() => void start(p.minutes * 60, names[p.key])}><span className="at-clock-tile-icon"><Icon name={p.icon} size={22} /></span><strong>{names[p.key]}</strong><small>{p.minutes} {tx('clock.min')}</small></button>)}
        <button type="button" className={`at-clock-tile is-named is-dial ${dial !== null ? 'is-on' : ''}`} onClick={() => setDial(dial === null ? 600 : null)}><span className="at-clock-tile-icon"><Icon name="hourglass" size={22} /></span><strong>{tx('clock.custom')}</strong><small>{tx('clock.dialHint')}</small></button></div>
      {dial !== null && (() => { const mins = Math.floor(dial / 60), frac = (dial / 60) / 60, C = 2 * Math.PI * 80, ang = frac * 360, kx = 100 + 80 * Math.sin(ang * Math.PI / 180), ky = 100 - 80 * Math.cos(ang * Math.PI / 180);
        return <div className="at-clock-dial-wrap">
          <svg ref={dialRef} viewBox="0 0 200 200" className="at-clock-dial" onPointerDown={dialDown} onPointerMove={dialMove} onPointerUp={dialUp} onPointerCancel={dialUp}>
            <rect x="0" y="0" width="200" height="200" fill="transparent" />
            <circle cx="100" cy="100" r="80" className="track" />
            {Array.from({ length: 12 }, (_, i) => { const a = i * 30 * Math.PI / 180; return <line x1={100 + 70 * Math.sin(a)} y1={100 - 70 * Math.cos(a)} x2={100 + 74 * Math.sin(a)} y2={100 - 74 * Math.cos(a)} className="tick" />; })}
            <circle cx="100" cy="100" r="80" className="fill" stroke-dasharray={C.toFixed(1)} stroke-dashoffset={(C * (1 - Math.min(1, frac))).toFixed(1)} transform="rotate(-90 100 100)" />
            <circle cx={kx.toFixed(1)} cy={ky.toFixed(1)} r="11" className="knob" />
            <text x="100" y="96" text-anchor="middle" className="value">{mins}:{String(dial % 60).padStart(2, '0')}</text>
            <text x="100" y="118" text-anchor="middle" className="unit">{tx('clock.dialDrag')}</text>
          </svg>
          <div className="at-clock-dial-ctl"><button type="button" className="hm-pill" onClick={() => setDial(Math.max(15, dial - 15))}>−15 {tx('clock.s')}</button><button type="button" className="hm-pill" onClick={() => setDial(Math.min(5400, dial + 15))}>+15 {tx('clock.s')}</button><button type="button" className="hm-pill" onClick={() => setDial(Math.min(5400, dial + 600))}>+10 {tx('clock.min')}</button></div>
          <button type="button" className="hm-pill is-primary at-clock-go" disabled={busy || dial === 0} onClick={() => void start(dial)}>{tx('clock.start')} {mins}:{String(dial % 60).padStart(2, '0')}</button>
        </div>; })()}
      <input className="at-clock-label-input" type="text" maxLength={20} placeholder={tx('clock.label')} value={label} onInput={e => setLabel((e.target as HTMLInputElement).value)} />
    </>}
  </div>;
  const people = persons.length > 0 && <div className="at-clock-people">{persons.map(p => <div className={`at-clock-person ${p.home ? 'is-home' : ''}`}><b>{initials(p.name)}</b><strong>{p.name.split(' ')[0]}</strong><small>{p.home ? tx('clock.home') : p.zone ?? tx('clock.away')}</small></div>)}</div>;
  const alarmBlock = alarms.length > 0 && <div className="ah-rows"><Title>{tx('clock.alarms')}</Title>{alarms.slice(0, 3).map(a => <div className="ah-row"><span className="ah-row-icon" style="--tile:#7b74d8"><Icon name="bell" size={18} /></span><span className="ah-row-text"><strong>{a.name.replace(/\s*·\s*будильники и таймеры$/i, '')}</strong><small>{a.message}</small></span><small className="at-door-when">{when(a.start!)}</small></div>)}</div>;
  const main = <>{timersBlock}{people}{alarmBlock}{note && <p className="at-feeder-note at-cam-note" role="status">{note}</p>}</>;
  const settingsPage = <>
    <div className="ah-rows"><Title>{tx('clock.group.device')}</Title>
      <div className="ah-row hm-setting"><span className="ah-row-icon" style="--tile:#7b74d8"><Icon name="clock" size={18} /></span><span className="ah-row-text"><strong>{tx('clock.style')}</strong></span><div className="at-door-seg at-clock-seg" role="tablist">{(['analog', 'digital'] as const).map(s => <button type="button" role="tab" aria-selected={settings.style === s} className={settings.style === s ? 'is-on' : ''} onClick={() => update({ style: s })}>{tx(`clock.style.${s}`)}</button>)}</div></div>
      {localRow(tx('clock.secondsHand'), 'clock', '#7b74d8', settings.seconds, () => update({ seconds: !settings.seconds }))}
      {localRow(tx('clock.arc'), 'sun', '#ff9f0a', settings.arc, () => update({ arc: !settings.arc }))}
      {localRow(tx('clock.beep'), 'speaker', '#30d158', settings.beep, () => update({ beep: !settings.beep }), tx('clock.beepNote'))}
    </div>
    <div className="ah-rows"><Title>{tx('clock.group.shared')}</Title>
      {boolRow('announce', tx('clock.announce'), 'speaker', '#0a84ff', tx('clock.announceNote'))}{boolRow('push', tx('clock.push'), 'phone', '#0a84ff')}
      {timerIds.length > 0 && <KV k={tx('clock.timersInHa')} v={timerIds.join(' · ')} />}
    </div>
  </>;
  if (wide) return <div className="hm-sheet-body ah-sheet at-cam at-clock is-split" data-kind="clock" data-page={page}>
    <div className="at-cam-left">{head}{face}</div>
    <div className="at-cam-right">{headBtns}{page === 'main' ? main : <><h3 className="at-cam-h3">{tx('clock.settings')}</h3>{settingsPage}</>}</div>
  </div>;
  return <div className="hm-sheet-body ah-sheet at-cam at-clock" data-kind="clock" data-page={page}>{head}{page === 'main' ? <>{face}{main}</> : settingsPage}</div>;
}

/** Three short tones through WebAudio when a timer ends (kiosk tablets have no HA app to buzz). The context is created on the first touch, as browsers require. */
let audio: AudioContext | null = null;
export function armBeep(): void { try { if (!audio) audio = new (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)(); if (audio.state === 'suspended') void audio.resume(); } catch { /* no audio */ } }
export function beep(): void {
  try { if (!audio) armBeep(); if (!audio) return; const ctx = audio, t0 = ctx.currentTime; [0, 0.25, 0.5].forEach((d, i) => { const o = ctx.createOscillator(), g = ctx.createGain(); o.type = 'sine'; o.frequency.value = i === 2 ? 1318 : 1046; g.gain.setValueAtTime(0.0001, t0 + d); g.gain.exponentialRampToValueAtTime(0.4, t0 + d + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, t0 + d + 0.2); o.connect(g).connect(ctx.destination); o.start(t0 + d); o.stop(t0 + d + 0.22); }); } catch { /* no audio */ }
}

export const clock: ModuleDef = {
  ...clockSpec,
  Card: () => null,
  claims: entities => [entities.done, entities.labels, entities.timer1, entities.timer2, entities.timer3, entities.announce, entities.push].filter((x): x is string => !!x),
  banner: (registry, entities, t, host) => {
    const done = entities.done ? registry.states[entities.done] : undefined; if (!done || done.state !== 'on') return null;
    const ids = [entities.timer1, entities.timer2, entities.timer3].filter((x): x is string => !!x);
    const labels = parseLabels(registry.states[entities.labels ?? '']?.state);
    const raw = ids.map(id => labels[id]).find(Boolean); const label = labelText(raw), sec = raw ? Number(raw.split('|')[1]) : NaN;
    const sub = [label, Number.isFinite(sec) && sec > 0 ? `${Math.round(sec / 60)} ${t('clock.min' as Key)}` : ''].filter(Boolean).join(' · ');
    return { id: 'timer', text: t('clock.timerDone' as Key), sub, icon: 'clock', sound: true, stop: async () => { await host.call('input_boolean', 'turn_off', { entity_id: entities.done! }); } };
  },
};
