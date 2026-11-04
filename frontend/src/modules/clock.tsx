import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import type { ComponentChildren } from 'preact';
import type { ModuleDef, ModuleEntities } from './types.ts';
import { clockSpec } from './catalog.ts';
import { sunInfo, timerInfo, nearestTimer, fmtRemaining, toDuration, parseLabels, withLabel, withLabelStation, labelStation, aliceTimerCommand, ALICE_CANCEL_TIMER, labelText, weekNumber, PRESETS, NAMED_PRESETS, iconForLabel, dialMinutes, WEEKDAYS, WORKDAYS, WEEKEND, daysText, parseRinging, newAlarmId, readClockSettings, writeClockSettings, personState, initials, type ClockSettings, type TimerInfo } from './clock-state.ts';
import { Icon } from '../ui/primitives.tsx';
import { Switch } from '../ui/cards.tsx';
import type { Runner } from '../ui/sheet.tsx';
import type { Registry, StateRow } from '../model/registry.ts';
import { ALARM_FADE, ALARM_REPEAT_EVERY, type Alarm } from '../model/config.ts';
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
/** A window over the sheet (centred card on a tablet, the whole sheet on a phone); closes by the cross or a tap outside. Module-level on purpose: a component created inside the sheet would be a new type on every one-second tick and remount (and re-animate) the window each time. */
function Win({ title, onBack, children, wide, t }: { title: string; onBack: () => void; children: ComponentChildren; wide?: boolean; t: T }) {
  return <div className="at-win-scrim" onClick={e => { if (e.target === e.currentTarget) onBack(); }}><div className={`at-win ${wide ? 'is-wide' : ''}`} role="dialog" aria-modal="true" aria-label={title}><div className="at-win-head"><button type="button" className="hm-icon-btn" aria-label={t('ui.back')} onClick={onBack}><Icon name="back" size={22} /></button><h3>{title}</h3><button type="button" className="hm-icon-btn" aria-label={t('ui.close')} onClick={onBack}>×</button></div><div className="at-win-body">{children}</div></div></div>;
}
/** The big digits with seconds: the only part of the sheet that re-renders every second. */
function LiveTime({ lang }: { lang: Lang }) {
  useTick(true); const live = new Date();
  return <div className="at-clock-big"><b>{clockTime(live.getTime(), lang)}</b><span>{String(live.getSeconds()).padStart(2, '0')}</span></div>;
}
/** A running timer's ring and remaining time, ticking on its own. */
function TimerRing({ timer: x }: { timer: TimerInfo }) {
  useTick(x.state === 'active'); const nowMs = Date.now();
  const left = x.state === 'active' && x.finishesAt ? Math.max(0, x.finishesAt - nowMs) : x.remainingMs, frac = x.durationMs ? left / x.durationMs : 0, C = 2 * Math.PI * 28;
  return <div className="at-clock-ring"><svg viewBox="0 0 64 64"><circle className="bg" cx="32" cy="32" r="28" /><circle className="fg" cx="32" cy="32" r="28" stroke-dasharray={C.toFixed(1)} stroke-dashoffset={(C * (1 - frac)).toFixed(1)} /></svg><b>{fmtRemaining(left)}</b></div>;
}
export interface RoomRef { id: string; name: string }
export function ClockSheet({ registry, entities, host, t, lang, runner, onClose, wide, rooms = [], room, alarms = [], onAlarms }: { registry: Registry; entities: ModuleEntities; host: Host; t: T; lang: Lang; runner: Runner; onClose: () => void; wide: boolean; rooms?: RoomRef[]; /** opened from a room page: the editor starts with this room */ room?: string | null; alarms?: Alarm[]; onAlarms?: (alarms: Alarm[]) => Promise<void> }) {
  const [win, setWin] = useState<'timer' | 'alarms' | 'settings' | null>(null); // windows over the sheet: no long column, no scroll
  const [settings, setSettings] = useState(readClockSettings);
  const [label, setLabel] = useState(''), [dial, setDial] = useState<number | null>(null), [note, setNote] = useState('');
  const [station, setStation] = useState<string | null | undefined>(undefined); // undefined = not chosen yet (mandatory), null = without Alice
  const [edit, setEdit] = useState<Alarm | null>(null);
  const blankRef = useRef<(rid: string) => Alarm>(() => ({ id: 'x', room: '', time: '07:00', days: [], enabled: true, label: '', alice: 'off', phrase: '', station: '', light: false, lightEntity: '', fadeMin: 15, push: false, repeats: 0, repeatEveryMin: 5 }));
  const blankFor = (rid: string) => blankRef.current(rid);
  const dialRef = useRef<SVGSVGElement>(null), dragging = useRef(false);
  const tx = (k: string, p?: Record<string, string | number>) => t(k as Key, p);
  useEffect(() => { if (room && onAlarms && canAlarm(room)) { setWin('alarms'); if (!alarms.some(a => a.room === room)) setEdit(blankFor(room)); } }, [room]);
  const now = new Date(), nowMs = now.getTime();
  const S = registry.states;
  const sun = sunInfo(entities.sun ? S[entities.sun] : undefined, nowMs);
  const timerIds = [entities.timer1, entities.timer2, entities.timer3].filter((x): x is string => !!x);
  const timers = timerIds.map(id => timerInfo(id, S[id], nowMs));
  const labels = parseLabels(S[entities.labels ?? '']?.state);
  const weather = entities.weather ? S[entities.weather] : undefined;
  const wTemp = typeof weather?.attributes.temperature === 'number' ? weather.attributes.temperature : null;
  const wCond = weather && CONDITIONS.includes(weather.state) ? tx(`clock.weather.${weather.state}`) : null;
  // People with the picture from their HA profile (the person entity's entity_picture); initials until a picture is set.
  const persons = registry.entities.filter(e => e.entity_id.startsWith('person.') && !e.disabled_by && S[e.entity_id]).map(e => { const a = S[e.entity_id].attributes; return { id: e.entity_id, name: typeof a.friendly_name === 'string' ? a.friendly_name as string : e.entity_id, picture: typeof a.entity_picture === 'string' && /^(\/|https?:\/\/|data:image\/)/.test(a.entity_picture) ? a.entity_picture as string : null, ...personState(S[e.entity_id]) }; });
  const stationAlarms = registry.entities.filter(e => e.entity_id.startsWith('calendar.') && /_alarms$/.test(e.entity_id) && !e.disabled_by && S[e.entity_id]).map(e => { const a = S[e.entity_id].attributes; const start = typeof a.start_time === 'string' ? Date.parse(a.start_time) : NaN; return { id: e.entity_id, name: typeof a.friendly_name === 'string' ? a.friendly_name as string : e.entity_id, message: typeof a.message === 'string' ? a.message as string : '', start: Number.isFinite(start) ? start : null }; }).filter(a => a.start !== null).sort((a, b) => a.start! - b.start!);
  const dev = { key: 'clock', name: tx('clock.title'), primary: { available: true } } as unknown as HomeDevice;
  const busy = runner.busy.has('clock');
  const call = async (domain: string, service: string, data: Record<string, unknown>) => { try { await host.call(domain, service, data); } catch (e) { setNote(e instanceof Error ? e.message : String(e)); } };
  const saveLabel = (id: string, text: string, seconds: number) => entities.labels ? call('input_text', 'set_value', { entity_id: entities.labels, value: withLabel(labels, id, text, seconds) }) : Promise.resolve();
  const names = Object.fromEntries(NAMED_PRESETS.map(p => [p.key, tx(`clock.preset.${p.key}`)]));
  // Rooms' gear for alarms and the timer: Yandex speakers and dimmable lights (brightness-capable, not indicators), by HA area.
  const areaOf = (id: string) => { const e = registry.entities.find(x => x.entity_id === id); if (!e) return null; return e.area_id ?? registry.devices.find(d => d.id === e.device_id)?.area_id ?? null; };
  const stations = registry.entities.filter(e => e.entity_id.startsWith('media_player.') && e.platform === 'yandex_station' && !e.disabled_by && S[e.entity_id]).map(e => ({ id: e.entity_id, name: String(S[e.entity_id].attributes.friendly_name ?? e.entity_id), area: areaOf(e.entity_id) })).sort((a, b) => (rooms.find(r => r.id === a.area)?.name ?? a.name).localeCompare(rooms.find(r => r.id === b.area)?.name ?? b.name, 'ru'));
  const dimmable = registry.entities.filter(e => e.entity_id.startsWith('light.') && !e.disabled_by && S[e.entity_id]).map(e => { const a = S[e.entity_id].attributes; const modes = Array.isArray(a.supported_color_modes) ? a.supported_color_modes as string[] : []; return { id: e.entity_id, name: String(a.friendly_name ?? e.entity_id), area: areaOf(e.entity_id), dim: modes.some(m => m !== 'onoff') }; }).filter(l => l.dim && !/индикатор|indicator/i.test(l.name));
  const roomName = (id: string) => rooms.find(r => r.id === id)?.name ?? id;
  // Alarms are offered only for rooms with a Yandex speaker (owner's rule 04.11): Alice does the waking, the light is an extra.
  const alarmRooms = rooms.filter(r => stations.some(st => st.area === r.id));
  const canAlarm = (rid: string | null | undefined) => !!rid && alarmRooms.some(r => r.id === rid);
  const shortRoom = (name: string, rid: string) => { const r = rooms.find(x => x.id === rid)?.name ?? ''; return r && name.startsWith(r + ' · ') ? name.slice(r.length + 3) : name; };
  const start = async (totalSec: number, withLabelText = label) => {
    if (station === undefined && stations.length) { setNote(tx('clock.pickStation')); return; }
    const slot = timers.find(x => x.state === 'idle' || x.state === 'unknown'); if (!slot) { setNote(tx('clock.timer.full')); return; }
    if (entities.labels) await call('input_text', 'set_value', { entity_id: entities.labels, value: withLabelStation(labels, slot.id, withLabelText, totalSec, station ?? null) });
    await call('timer', 'start', { entity_id: slot.id, duration: toDuration(totalSec) });
    if (station) await call('yandex_station', 'send_command', { entity_id: station, command: aliceTimerCommand(totalSec) });
    setLabel(''); setDial(null); setStation(undefined); setWin(null);
  };
  const cancelTimer = async (x: TimerInfo) => { const st = labelStation(labels[x.id]); await call('timer', 'cancel', { entity_id: x.id }); if (st) await call('yandex_station', 'send_command', { entity_id: st, command: ALICE_CANCEL_TIMER }); };
  const mustPick = station === undefined && stations.length > 0;
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

  const headBtns = <div className="at-cam-head-btns"><button type="button" className="hm-icon-btn at-cam-gear" aria-label={tx('clock.settings')} onClick={() => setWin('settings')}><Icon name="gear" size={20} /></button><button type="button" className="hm-icon-btn" aria-label={t('ui.close')} onClick={onClose}>×</button></div>;
  const head = <div className="hm-sheet-head"><span className="hm-sheet-photo at-clock-photo"><Icon name="clock" size={30} /></span><div><small>{t('section.home')}</small><h2>{tx('clock.title')}</h2></div>{!wide && headBtns}</div>;
  const face = <>
    {wide && <div className="at-clock-face-wrap"><ClockFace now={now} sun={entities.sun ? S[entities.sun] : undefined} settings={{ ...settings, seconds: true }} /></div>}
    <LiveTime lang={lang} />
    <div className="at-clock-date"><b>{new Intl.DateTimeFormat(locale(lang), { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }).format(now)}</b> · {tx('clock.week', { n: weekNumber(now) })}{wTemp !== null ? ` · ${num(wTemp, lang, 1)}°${wCond ? ' ' + wCond : ''}` : ''}</div>
    {sun.rise !== null && sun.set !== null && <div className="at-clock-sun">
      <div className="at-clock-sun-row"><span>{tx('clock.sunrise')} <b>{clockTime(sun.rise, lang)}</b></span><span>{tx('clock.day')} <b>{hm(sun.dayMs ?? 0)}</b></span><span>{tx('clock.sunset')} <b>{clockTime(sun.set, lang)}</b></span></div>
      <svg viewBox="0 0 300 64" className="at-clock-arc" aria-hidden="true"><path d="M20 58 Q150 -40 280 58" className="bg" />{sun.frac !== null && <><path d="M20 58 Q150 -40 280 58" className="fg" stroke-dasharray="330" stroke-dashoffset={(330 * (1 - sun.frac)).toFixed(1)} /><circle cx={(20 + 260 * sun.frac).toFixed(1)} cy={(58 - 196 * sun.frac * (1 - sun.frac)).toFixed(1)} r="7" className="dot" /></>}<line x1="20" y1="58" x2="280" y2="58" className="base" /></svg>
      <div className="at-clock-sun-row"><span>{sun.night ? tx('clock.untilSunrise') : tx('clock.untilSunset')} <b>{sun.untilNext !== null ? hm(sun.untilNext) : '—'}</b></span>{sun.elevation !== null && <span>{tx('clock.elevation')} <b>{Math.round(sun.elevation)}°</b></span>}</div>
    </div>}
  </>;
  const running = timers.filter(x => x.state === 'active' || x.state === 'paused');
  const timerRow = (x: TimerInfo) => { const text = labelText(labels[x.id]);
    return <div className={`at-clock-trow is-${x.state}`} key={x.id}><TimerRing timer={x} />
      <span className="at-clock-trow-icon"><Icon name={iconForLabel(text, names)} size={20} /></span>
      <div className="at-clock-tt"><strong>{text || tx('clock.timer')}</strong><small>{Math.round(x.durationMs / 60_000)} {tx('clock.min')}{labelStation(labels[x.id]) ? ` · ${tx('clock.withAlice')}` : ''}{x.state === 'paused' ? ` · ${tx('clock.paused')}` : ''}</small></div>
      <button type="button" className="at-clock-ctl" aria-label={x.state === 'paused' ? tx('clock.resume') : tx('clock.pause')} disabled={busy} onClick={() => void call('timer', x.state === 'paused' ? 'start' : 'pause', { entity_id: x.id })}><Icon name={x.state === 'paused' ? 'play' : 'pause'} size={18} /></button>
      <button type="button" className="at-clock-ctl is-stop" aria-label={tx('clock.cancel')} disabled={busy} onClick={() => void cancelTimer(x)}>×</button></div>; };
  const timersCard = timerIds.length > 0 && <div className="at-clock-card at-clock-timers"><div className="at-clock-card-head"><h4>{tx('clock.timers')}</h4>{running.length < timerIds.length && <button type="button" className="hm-pill is-primary is-small at-clock-new" onClick={() => setWin('timer')}>+ {tx('clock.newTimer')}</button>}</div>
    {running.length ? running.map(timerRow) : <p className="at-clock-empty">{tx('clock.noTimers')}</p>}
  </div>;
  const timerWin = <>
      {stations.length > 0 && <div className={`at-clock-stations ${mustPick ? 'is-required' : ''}`}><span className="at-clock-stations-label">{tx('clock.whereRing')}{mustPick && <b> *</b>}</span><div className="at-clock-presets"><button type="button" className={`hm-pill ${station === null ? 'is-primary' : ''}`} onClick={() => setStation(null)}>{tx('clock.noAlice')}</button>{stations.map(st => <button type="button" className={`hm-pill ${station === st.id ? 'is-primary' : ''}`} onClick={() => setStation(st.id)}>{roomName(st.area ?? '') || st.name}</button>)}</div>{mustPick && <small>{tx('clock.pickStation')}</small>}</div>}
      <div className={`at-clock-grid ${mustPick ? 'is-waiting' : ''}`}>{PRESETS.map(p => <button type="button" className="at-clock-tile" disabled={busy || mustPick} onClick={() => void start(p * 60)}><b>{p === 60 ? 1 : p}</b><small>{p === 60 ? tx('clock.hour') : tx('clock.min')}</small></button>)}</div>
      <div className={`at-clock-grid is-named ${mustPick ? 'is-waiting' : ''}`}>{NAMED_PRESETS.map(p => <button type="button" className="at-clock-tile is-named" disabled={busy || mustPick} onClick={() => void start(p.minutes * 60, names[p.key])}><span className="at-clock-tile-icon"><Icon name={p.icon} size={22} /></span><strong>{names[p.key]}</strong><small>{p.minutes} {tx('clock.min')}</small></button>)}
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
          <button type="button" className="hm-pill is-primary at-clock-go" disabled={busy || dial === 0 || mustPick} onClick={() => void start(dial)}>{tx('clock.start')} {mins}:{String(dial % 60).padStart(2, '0')}</button>
        </div>; })()}
      <input className="at-clock-label-input" type="text" maxLength={20} placeholder={tx('clock.label')} value={label} onInput={e => setLabel((e.target as HTMLInputElement).value)} />
  </>;
  const people = persons.length > 0 && <div className="at-clock-card at-clock-people">{persons.map(p => <div className={`at-clock-person ${p.home ? 'is-home' : ''}`}><b>{p.picture ? <img src={p.picture} alt="" onError={e => { (e.target as HTMLImageElement).remove(); }} /> : null}{initials(p.name)}</b><strong>{p.name.split(' ')[0]}</strong><small>{p.home ? tx('clock.home') : p.zone ?? tx('clock.away')}</small></div>)}</div>;
  const alarmBlock = stationAlarms.length > 0 && <div className="ah-rows at-clock-card is-rows">{stationAlarms.slice(0, 2).map(a => <div className="ah-row"><span className="ah-row-icon" style="--tile:#7b74d8"><Icon name="bell" size={18} /></span><span className="ah-row-text"><strong>{a.name.replace(/\s*·\s*будильники и таймеры$/i, '')}</strong><small>{a.message}</small></span><small className="at-door-when">{when(a.start!)}</small></div>)}</div>;
  // ---- room alarms (stored in the integration, rung by it) ----
  const dayNames = tx('alarm.dayNames').split(',');
  const save = async (list: Alarm[]) => { if (!onAlarms) return; try { await onAlarms(list); setEdit(null); } catch (e) { setNote(e instanceof Error ? e.message : String(e)); } };
  blankRef.current = (rid: string): Alarm => { const st = stations.find(x => x.area === rid), li = dimmable.find(x => x.area === rid); return { id: newAlarmId(), room: rid, time: '07:00', days: [...WORKDAYS], enabled: true, label: '', alice: st ? 'tts' : 'off', phrase: '', station: st?.id ?? '', light: !!li, lightEntity: li?.id ?? '', fadeMin: 15, push: false, repeats: 0, repeatEveryMin: 5 }; };
  const alarmRow = (a: Alarm) => { const bits = [daysText(a.days, dayNames, tx), a.light && a.lightEntity ? `${tx('alarm.sunrise')} ${a.fadeMin} ${tx('clock.min')}` : '', a.alice !== 'off' && a.station ? (a.alice === 'tts' ? tx('alarm.alicePhrase') : tx('alarm.aliceMusic')) : '', a.repeats ? tx('alarm.repeatsShort', { n: a.repeats }) : ''].filter(Boolean).join(' · ');
    return <div className={`ah-row at-alarm-row ${a.enabled ? '' : 'is-off'}`} key={a.id}><button type="button" className="at-alarm-main" onClick={() => setEdit({ ...a })}><span className="ah-row-icon" style={`--tile:${a.enabled ? '#7b74d8' : '#8e8e93'}`}><Icon name="bell" size={18} /></span><span className="ah-row-text"><strong>{roomName(a.room)} · {a.time}{a.label ? ` · ${a.label}` : ''}</strong><small>{bits}</small></span></button><Switch on={a.enabled} label={a.time} disabled={!onAlarms} onToggle={() => void save(alarms.map(x => x.id === a.id ? { ...x, enabled: !x.enabled } : x))} /></div>; };
  const sortedAlarms = [...alarms].sort((a, b) => a.time.localeCompare(b.time) || a.room.localeCompare(b.room));
  const nextAlarms = sortedAlarms.filter(a => a.enabled).slice(0, 2);
  const alarmsCard = <div className="at-clock-card at-clock-alarms"><div className="at-clock-card-head"><h4>{tx('alarm.title')}{alarms.length ? ` · ${alarms.length}` : ''}</h4>{onAlarms && alarmRooms.length > 0 && <button type="button" className="hm-pill is-primary is-small at-alarm-add" onClick={() => { setWin('alarms'); setEdit(blankFor(canAlarm(room) ? room! : alarms[0]?.room && canAlarm(alarms[0].room) ? alarms[0].room : alarmRooms[0].id)); }}>+ {tx('alarm.add')}</button>}</div>
    {alarmRooms.length === 0 && <p className="at-clock-empty">{tx('alarm.noStationRooms')}</p>}
    {nextAlarms.length ? nextAlarms.map(a => <button type="button" className="at-alarm-chip" onClick={() => setWin('alarms')}><b>{a.time}</b><span>{roomName(a.room)}</span><small>{daysText(a.days, dayNames, tx)}</small></button>) : alarmRooms.length > 0 ? <p className="at-clock-empty">{tx('alarm.none')}</p> : null}
    {alarms.length > 0 && <button type="button" className="hm-text-btn at-clock-all" onClick={() => setWin('alarms')}>{tx('alarm.all', { n: alarms.length })}<Icon name="next" size={16} /></button>}
  </div>;
  const alarmsWin = <div className="ah-rows at-alarms">
    {alarms.length === 0 && <div className="at-cam-kv"><span>{tx('alarm.none')}</span></div>}
    {sortedAlarms.map(alarmRow)}
    {onAlarms && alarmRooms.length > 0 && <button type="button" className="ah-row at-door-row-btn at-alarm-add" onClick={() => setEdit(blankFor(canAlarm(room) ? room! : alarmRooms[0].id))}><span className="ah-row-icon" style="--tile:#7b74d8">+</span><span className="ah-row-text"><strong>{tx('alarm.add')}</strong></span></button>}
  </div>;
  const editor = edit && (() => { const a = edit, set = (patch: Partial<Alarm>) => setEdit({ ...a, ...patch }); const roomStations = stations.filter(x => x.area === a.room), roomLights = dimmable.filter(x => x.area === a.room);
    const toggleDay = (d: number) => set({ days: a.days.includes(d) ? a.days.filter(x => x !== d) : [...a.days, d].sort() });
    const pickRoom = (rid: string) => { const st = stations.find(x => x.area === rid), li = dimmable.find(x => x.area === rid); set({ room: rid, station: st?.id ?? '', alice: st ? (a.alice === 'off' ? 'tts' : a.alice) : 'off', lightEntity: li?.id ?? '', light: !!li }); };
    const exists = alarms.some(x => x.id === a.id);
    return <div className="at-alarm-editor">
      <div className="at-clock-presets">{alarmRooms.map(r => <button type="button" className={`hm-pill ${a.room === r.id ? 'is-primary' : ''}`} onClick={() => pickRoom(r.id)}>{r.name}</button>)}</div>
      <div className="at-alarm-time"><input type="time" value={a.time} onInput={e => { const v = (e.target as HTMLInputElement).value; if (/^\d\d:\d\d$/.test(v)) set({ time: v }); }} /><input className="at-clock-label-input" type="text" maxLength={40} placeholder={tx('clock.label')} value={a.label} onInput={e => set({ label: (e.target as HTMLInputElement).value })} /></div>
      <div className="at-clock-presets at-alarm-days">{WEEKDAYS.map(d => <button type="button" className={`hm-pill is-day ${a.days.includes(d) ? 'is-primary' : ''}`} onClick={() => toggleDay(d)}>{dayNames[d - 1]}</button>)}<button type="button" className="hm-pill is-small" onClick={() => set({ days: [...WORKDAYS] })}>{tx('alarm.workdays')}</button><button type="button" className="hm-pill is-small" onClick={() => set({ days: [...WEEKEND] })}>{tx('alarm.weekend')}</button><button type="button" className="hm-pill is-small" onClick={() => set({ days: [] })}>{tx('alarm.once')}</button></div>
      {roomLights.length > 0 ? <>
        <div className="ah-row hm-setting"><span className="ah-row-icon" style="--tile:#ff9f0a"><Icon name="sun" size={18} /></span><span className="ah-row-text"><strong>{tx('alarm.light')}</strong><small>{tx('alarm.lightNote', { n: a.fadeMin })}</small></span><Switch on={a.light} label={tx('alarm.light')} onToggle={() => set({ light: !a.light, lightEntity: a.lightEntity || roomLights[0].id })} /></div>
        {a.light && <><div className="at-clock-presets">{roomLights.map(l => <button type="button" className={`hm-pill is-small ${a.lightEntity === l.id ? 'is-primary' : ''}`} onClick={() => set({ lightEntity: l.id })}>{shortRoom(l.name, a.room)}</button>)}</div>
        <div className="at-clock-presets">{ALARM_FADE.filter(m => m > 0).map(m => <button type="button" className={`hm-pill is-small ${a.fadeMin === m ? 'is-primary' : ''}`} onClick={() => set({ fadeMin: m })}>{m} {tx('clock.min')}</button>)}</div></>}
      </> : <div className="ah-row"><span className="ah-row-icon" style="--tile:#8e8e93"><Icon name="sun" size={18} /></span><span className="ah-row-text"><strong>{tx('alarm.light')}</strong><small>{tx('alarm.noDimmer')}</small></span></div>}
      {roomStations.length > 0 ? <>
        <div className="ah-row hm-setting"><span className="ah-row-icon" style="--tile:#0a84ff"><Icon name="speaker" size={18} /></span><span className="ah-row-text"><strong>{tx('alarm.alice')}</strong><small>{roomStations.map(x => shortRoom(x.name, a.room)).join(', ')}</small></span><div className="at-door-seg at-clock-seg" role="tablist">{(['off', 'tts', 'music'] as const).map(m => <button type="button" role="tab" aria-selected={a.alice === m} className={a.alice === m ? 'is-on' : ''} onClick={() => set({ alice: m, station: a.station || roomStations[0].id })}>{tx(`alarm.alice.${m}`)}</button>)}</div></div>
        {a.alice === 'tts' && <input className="at-clock-label-input" type="text" maxLength={120} placeholder={tx('alarm.phrasePlaceholder')} value={a.phrase} onInput={e => set({ phrase: (e.target as HTMLInputElement).value })} />}
      </> : <div className="ah-row"><span className="ah-row-icon" style="--tile:#8e8e93"><Icon name="speaker" size={18} /></span><span className="ah-row-text"><strong>{tx('alarm.alice')}</strong><small>{tx('alarm.noStation')}</small></span></div>}
      <div className="ah-row hm-setting"><span className="ah-row-icon" style="--tile:#7b74d8"><Icon name="hourglass" size={18} /></span><span className="ah-row-text"><strong>{tx('alarm.repeats')}</strong><small>{a.repeats ? tx('alarm.repeatsNote', { n: a.repeats, m: a.repeatEveryMin }) : tx('alarm.noRepeats')}</small></span></div>
      <div className="at-clock-presets">{[0, 1, 2, 3, 5, 10].map(n => <button type="button" className={`hm-pill is-small ${a.repeats === n ? 'is-primary' : ''}`} onClick={() => set({ repeats: n })}>{n === 0 ? tx('alarm.repeats0') : `×${n}`}</button>)}{a.repeats > 0 && ALARM_REPEAT_EVERY.map(m => <button type="button" className={`hm-pill is-small ${a.repeatEveryMin === m ? 'is-primary' : ''}`} onClick={() => set({ repeatEveryMin: m })}>{tx('alarm.every', { m })}</button>)}</div>
      <div className="at-alarm-actions"><button type="button" className="hm-pill is-primary at-alarm-save" onClick={() => void save(exists ? alarms.map(x => x.id === a.id ? a : x) : [...alarms, a])}>{tx('alarm.save')}</button><button type="button" className="hm-pill" onClick={() => setEdit(null)}>{t('confirm.no')}</button>{exists && <button type="button" className="hm-pill at-alarm-delete" onClick={() => void save(alarms.filter(x => x.id !== a.id))}>{tx('alarm.delete')}</button>}</div>
    </div>; })();
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
  const cards = <>{timersCard}{alarmsCard}{people}{alarmBlock}{note && <p className="at-feeder-note at-cam-note" role="status">{note}</p>}</>;
  const windows = <>
    {win === 'timer' && <Win t={t} title={tx('clock.newTimer')} onBack={() => setWin(null)} wide>{timerWin}</Win>}
    {win === 'alarms' && !edit && <Win t={t} title={tx('alarm.title')} onBack={() => setWin(null)}>{alarmsWin}</Win>}
    {win === 'alarms' && edit && <Win t={t} title={alarms.some(x => x.id === edit.id) ? tx('alarm.edit') : tx('alarm.new')} onBack={() => setEdit(null)} wide>{editor}</Win>}
    {win === 'settings' && <Win t={t} title={tx('clock.settings')} onBack={() => setWin(null)}>{settingsPage}</Win>}
  </>;
  if (wide) return <div className="hm-sheet-body ah-sheet at-cam at-clock is-split" data-kind="clock" data-win={win ?? 'none'}>
    <div className="at-cam-left">{head}{face}</div>
    <div className="at-cam-right">{headBtns}{cards}</div>
    {windows}
  </div>;
  return <div className="hm-sheet-body ah-sheet at-cam at-clock" data-kind="clock" data-win={win ?? 'none'}>{head}{face}{cards}{windows}</div>;
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
  claims: entities => [entities.done, entities.labels, entities.timer1, entities.timer2, entities.timer3, entities.announce, entities.push, entities.alarmFlag, entities.alarmText].filter((x): x is string => !!x),
  banner: (registry, entities, t, host) => {
    const flag = entities.alarmFlag ? registry.states[entities.alarmFlag] : undefined;
    if (flag && flag.state === 'on') {
      const r = parseRinging(registry.states[entities.alarmText ?? '']?.state);
      const ws = host.ws, stopAlarm = async () => { if (ws) { try { await ws({ type: 'atom_home/alarm/stop' }); return; } catch { /* older integration */ } } await host.call('input_boolean', 'turn_off', { entity_id: entities.alarmFlag! }); };
      const roomLabel = r ? (registry.areas.find(a => a.area_id === r.room)?.name ?? r.room) : '';
      return { id: 'alarm', text: `${t('alarm.ringing' as Key)}${r ? ` · ${roomLabel} · ${r.time}` : ''}`, sub: r ? [r.label, r.left ? t('alarm.repeatsLeft' as Key, { n: r.left }) : ''].filter(Boolean).join(' · ') : '', icon: 'bell', sound: true, stop: stopAlarm, extra: ws ? { label: t('alarm.snooze' as Key), run: async () => { await ws({ type: 'atom_home/alarm/snooze', minutes: 9 }); } } : undefined };
    }
    const done = entities.done ? registry.states[entities.done] : undefined; if (!done || done.state !== 'on') return null;
    const ids = [entities.timer1, entities.timer2, entities.timer3].filter((x): x is string => !!x);
    const labels = parseLabels(registry.states[entities.labels ?? '']?.state);
    const raw = ids.map(id => labels[id]).find(Boolean); const label = labelText(raw), sec = raw ? Number(raw.split('|')[1]) : NaN;
    const sub = [label, Number.isFinite(sec) && sec > 0 ? `${Math.round(sec / 60)} ${t('clock.min' as Key)}` : ''].filter(Boolean).join(' · ');
    return { id: 'timer', text: t('clock.timerDone' as Key), sub, icon: 'clock', sound: true, stop: async () => { await host.call('input_boolean', 'turn_off', { entity_id: entities.done! }); } };
  },
};
