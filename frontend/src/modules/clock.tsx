import { useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks';
import { createPortal, type ComponentChildren } from 'preact';
import type { ModuleDef, ModuleEntities } from './types.ts';
import { clockSpec } from './catalog.ts';
import { sunInfo, timerInfo, nearestTimer, fmtRemaining, toDuration, parseLabels, withLabel, withLabelStation, labelStation, aliceTimerCommand, ALICE_CANCEL_TIMER, labelText, weekNumber, PRESETS, NAMED_PRESETS, iconForLabel, dialMinutes, WEEKDAYS, WORKDAYS, WEEKEND, daysText, parseRinging, newAlarmId, readClockSettings, writeClockSettings, fmtDuration, hoursMinutes, nextFire, isTomorrow, finishedTimer, stopAlarm, snoozeAlarm, type ClockSettings, type TimerInfo } from './clock-state.ts';
import { people as peopleOf } from '../model/people.ts';
import { Icon } from '../ui/primitives.tsx';
import { Switch } from '../ui/cards.tsx';
import type { Runner } from '../ui/sheet.tsx';
import type { Registry, StateRow } from '../model/registry.ts';
import { ALARM_FADE, ALARM_REPEAT_EVERY, type Alarm, type HouseConfig } from '../model/config.ts';
import type { HomeDevice } from '../model/discover.ts';
import type { Host } from '../runtime/host.ts';
import type { T, Key } from '../i18n/index.ts';
import { houseDate, zoneOption } from '../runtime/zone.ts';
import { errorText, num, type Lang } from '../ui/format.ts';

const locale = (lang: Lang) => lang === 'ru' ? 'ru-RU' : lang === 'ro' ? 'ro-RO' : 'en-GB';
const pt = (angle: number, r: number) => [50 + r * Math.sin(angle * Math.PI / 180), 50 - r * Math.cos(angle * Math.PI / 180)] as const;
/** One formatter per language, shape and zone: the digits redraw every second, and building an `Intl.DateTimeFormat` is the dear part. */
const formats = new Map<string, Intl.DateTimeFormat>();
const dtf = (lang: Lang, options: Intl.DateTimeFormatOptions, zoned = true) => { const o = zoned ? { ...options, ...zoneOption() } : options, key = `${lang}|${JSON.stringify(o)}`; let f = formats.get(key); if (!f) formats.set(key, f = new Intl.DateTimeFormat(locale(lang), o)); return f; };
const clockTime = (at: number, lang: Lang) => dtf(lang, { hour: '2-digit', minute: '2-digit' }).format(at); // the house's clock, wherever the panel is opened
/** The control that holds the focus where the panel really lives: inside Home Assistant's shadow root `document.activeElement` is the host element. */
const activeOf = (el: Element | null | undefined) => ((el?.getRootNode() as Document | ShadowRoot | undefined)?.activeElement as HTMLElement | null | undefined) ?? null;
/** One-second heartbeat for countdowns and the digital seconds, only while something needs it. */
function useTick(active: boolean) { const [, set] = useState(0); useEffect(() => { if (!active) return; const i = setInterval(() => set(x => x + 1), 1000); return () => clearInterval(i); }, [active]); }

/** A redraw at every minute boundary: the hands and the digits follow the real minute (the shell's own clock ticks every 20 s, so the minute
 * hand stood up to 20 s behind a seconds hand that was exact: 10:00:06 shown at 10:01:06). */
function useMinute() { const [, set] = useState(0); useEffect(() => { let i: ReturnType<typeof setTimeout>; const arm = () => { i = setTimeout(() => { set(x => x + 1); arm(); }, 60_000 - Date.now() % 60_000 + 15); }; arm(); return () => clearTimeout(i); }, []); }

/** The seconds hand steps once a second from its own tick: a continuous CSS animation on SVG makes Android WebView repaint the whole tile at 60 fps (visible flicker on the tablet and phones). */
function SecondsHand() {
  useTick(true); const sec = new Date().getSeconds();
  return <line x1="50" y1="59" x2="50" y2="16" className="ah-hand is-sec" transform={`rotate(${sec * 6} 50 50)`} />;
}
/** The analog face: daylight arc on a 24-hour rim, numerals, hands; the seconds hand sweeps with a CSS animation started at the current second. In timer mode the hands give way to a ring and the remaining time. */
export function ClockFace({ now, sun, settings, timer }: { now: Date; sun?: StateRow; settings: ClockSettings; timer?: { remainingMs: number; durationMs: number; label: string; more: number } | null }) {
  const wall = houseDate(now.getTime()), h = wall.getHours(), m = wall.getMinutes(); // the hands show the house's time (runtime/zone.ts)
  const info = sunInfo(sun, now.getTime());
  const arc = settings.arc && info.rise !== null && info.set !== null ? (() => { const a1 = (houseDate(info.rise!).getHours() + houseDate(info.rise!).getMinutes() / 60) * 15, a2 = (houseDate(info.set!).getHours() + houseDate(info.set!).getMinutes() / 60) * 15; const p1 = pt(a1, 44), p2 = pt(a2, 44); const nowA = (h + m / 60) * 15, sp = pt(nowA, 44); return { d: `M${p1[0].toFixed(2)} ${p1[1].toFixed(2)} A44 44 0 ${a2 - a1 > 180 ? 1 : 0} 1 ${p2[0].toFixed(2)} ${p2[1].toFixed(2)}`, sp }; })() : null;
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
      {settings.seconds && <SecondsHand />}
      <circle cx="50" cy="50" r="2.2" className="ah-hand-cap" />
    </>}
  </svg>;
}

/** Home-face tile: analog or digital clock, date, timer countdown; a tap opens the «Time» sheet. */
export function ClockTile({ lang, t, registry, entities, onOpen }: { /** the shell's clock: it only makes the tile redraw, the time shown is read at the moment of drawing */ now: Date; lang: Lang; t: T; registry: Registry; entities: ModuleEntities; onOpen: () => void }) {
  const settings = readClockSettings();
  const timerIds = [entities.timer1, entities.timer2, entities.timer3].filter((x): x is string => !!x);
  const near = nearestTimer(registry.states, timerIds, Date.now());
  useTick(!!near || settings.style === 'digital'); useMinute();
  const live = new Date(), now = live;
  const labels = parseLabels(registry.states[entities.labels ?? '']?.state);
  const timer = near ? { remainingMs: near.timer.state === 'active' && near.timer.finishesAt ? Math.max(0, near.timer.finishesAt - live.getTime()) : near.timer.remainingMs, durationMs: near.timer.durationMs, label: labelText(labels[near.timer.id]), more: near.running - 1, paused: near.timer.state === 'paused' } : null;
  const date = dtf(lang, { weekday: 'short', day: 'numeric', month: 'long' }).format(now);
  const time = clockTime(now.getTime(), lang);
  // the name comes from the content (Lighthouse: an aria-label must contain the visible text, and the numerals of the face are visible); the time is read but not drawn twice
  return <button type="button" className={`ah-tile ah-clock hm-card ${timer ? 'is-timer' : ''} is-${settings.style}`} onClick={onOpen}>
    <span className="at-vh">{time} · </span>
    {settings.style === 'digital' && !timer
      ? <div className="ah-clock-digital"><b>{clockTime(live.getTime(), lang)}</b><span>{String(live.getSeconds()).padStart(2, '0')}</span></div>
      : <ClockFace now={now} sun={entities.sun ? registry.states[entities.sun] : undefined} settings={settings} timer={timer} />}
    {timer && <div className="ah-clock-big"><b>{fmtRemaining(timer.remainingMs)}</b><small>{timer.label || t('clock.timer')}{timer.paused ? ` · ${t('clock.paused')}` : ''}{timer.more > 0 ? ` · +${timer.more}` : ''}</small></div>}
    <span className="ah-clock-date">{timer && timer.more > 0 ? t('clock.more', { n: timer.more }) : date}</span>
  </button>;
}

const Title = ({ children }: { children: ComponentChildren }) => <div className="ah-row at-cam-title"><small>{children}</small></div>;
const KV = ({ k, v }: { k: string; v: ComponentChildren }) => <div className="at-cam-kv"><span>{k}</span><small>{v}</small></div>;
const CONDITIONS = ['clear-night', 'cloudy', 'fog', 'hail', 'lightning', 'lightning-rainy', 'partlycloudy', 'pouring', 'rainy', 'snowy', 'snowy-rainy', 'sunny', 'windy', 'windy-variant', 'exceptional'];

/** The «Time» sheet: big clock, sun, three shared timers, who is home, the speakers' next alarm, settings. */
/** A window over the sheet (centred card on a tablet, the whole sheet on a phone); closes by the cross or a tap outside. Module-level on purpose: a component created inside the sheet would be a new type on every one-second tick and remount (and re-animate) the window each time. */
function Win({ title, onBack, children, wide, t, bodyKey, keepOnScrim }: { title: string; onBack: () => void; children: ComponentChildren; wide?: boolean; t: T; bodyKey: string; /** something typed would be lost: a tap beside the window does not close it (the cross, «Назад», «Отмена» and Escape do) */ keepOnScrim?: boolean }) {
  // The window and its dim layer live in the sheet's full-screen scrim, not inside the rounded sheet: a composited
  // dim layer clipped by the sheet's corners is anti-aliased separately from the sheet and draws a bright hairline
  // around it while the window opens (seen on the tablet and phones).
  const anchor = useRef<HTMLSpanElement>(null); const [host, setHost] = useState<Element | null | undefined>(undefined);
  useLayoutEffect(() => { setHost(anchor.current?.closest('.hm-scrim') ?? null); }, []);
  // The window is a dialog over a dialog: the focus moves into it (and to its new screen when the list gives way to the editor) and returns
  // to the control that opened it; Escape closes this window only, not the sheet under it; Tab does not leave it. The focus is read from the
  // window's own root (activeOf): in Home Assistant the panel is in a shadow root, where `document.activeElement` is always the host element —
  // Tab then never moved and the focus was lost on closing.
  const box = useRef<HTMLDivElement>(null), opener = useRef<HTMLElement | null>(null), back = useRef(onBack); back.current = onBack;
  useEffect(() => {
    if (host === undefined) return; const sheet = anchor.current?.closest<HTMLElement>('.hm-sheet') ?? null; opener.current = activeOf(anchor.current);
    // back to the control that opened the window; when that one is gone or cannot take the focus (the room page under the sheet is inert), to the
    // sheet's first button — never to <body>, from where the keyboard starts at the top of the page under the dialog
    return () => { const o = opener.current; if (o?.isConnected) o.focus({ preventScroll: true }); if (!sheet?.isConnected) return; const at = activeOf(sheet); if (o && at === o && sheet.contains(o)) return; if (at && at !== sheet && sheet.contains(at)) return; (sheet.querySelector<HTMLElement>('button:not([disabled])') ?? sheet).focus({ preventScroll: true }); };
  }, [host]);
  const enter = () => { const el = box.current; if (!el) return; const at = activeOf(el); if (el.contains(at) && at !== el.querySelector('.at-win-head button')) return; (el.querySelector<HTMLElement>('.at-win-body :is(input, button, select):not([disabled])') ?? el.querySelector<HTMLElement>('.at-win-head button'))?.focus({ preventScroll: true }); };
  // (once more two frames later: a sheet that opens together with its window — the alarm editor from a room page — moves the focus to itself in its own frame)
  useEffect(() => { if (host === undefined) return; enter(); let b = 0; const a = requestAnimationFrame(() => { b = requestAnimationFrame(() => { if (!box.current?.contains(activeOf(box.current))) enter(); }); }); return () => { cancelAnimationFrame(a); cancelAnimationFrame(b); }; }, [host, bodyKey]);
  const key = (e: KeyboardEvent) => {
    if (e.key === 'Escape') { e.stopPropagation(); e.preventDefault(); back.current(); return; }
    if (e.key !== 'Tab') return; const all = [...(box.current?.querySelectorAll<HTMLElement>('button, input, select, textarea, [tabindex]:not([tabindex="-1"])') ?? [])].filter(x => !(x as HTMLButtonElement).disabled && x.offsetParent !== null);
    if (!all.length) return; const first = all[0], last = all[all.length - 1], at = activeOf(box.current);
    if (e.shiftKey && (at === first || !box.current?.contains(at))) { e.preventDefault(); last.focus(); } else if (!e.shiftKey && (at === last || !box.current?.contains(at))) { e.preventDefault(); first.focus(); }
  };
  const node = <div className="at-win-scrim" onClick={e => { if (e.target === e.currentTarget && !keepOnScrim) onBack(); }} onKeyDown={key}><div className={`at-win ${wide ? 'is-wide' : ''}`} role="dialog" aria-modal="true" aria-label={title} ref={box} tabIndex={-1}><div className="at-win-head"><button type="button" className="hm-icon-btn" aria-label={t('ui.back')} onClick={onBack}><Icon name="back" size={22} /></button><h3>{title}</h3><button type="button" className="hm-icon-btn" aria-label={t('ui.closeSheet')} onClick={onBack}>×</button></div><div className="at-win-body" key={bodyKey}>{children}</div></div></div>;
  return <><span ref={anchor} hidden />{host === undefined ? null : host ? createPortal(node, host) : node}</>;
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
export function ClockSheet({ registry, entities, host, t, lang, runner, onClose, wide, rooms = [], room, alarms = [], onAlarms, config }: { registry: Registry; entities: ModuleEntities; host: Host; t: T; lang: Lang; runner: Runner; onClose: () => void; wide: boolean; /** which people the house shows (hidden ones are not listed) */ config?: Pick<HouseConfig, 'entities' | 'devices'>; rooms?: RoomRef[]; /** opened from a room page: the editor starts with this room */ room?: string | null; alarms?: Alarm[]; onAlarms?: (alarms: Alarm[]) => Promise<void> }) {
  const [win, setWin] = useState<'timer' | 'alarms' | 'settings' | null>(null); // windows over the sheet: no long column, no scroll
  const [settings, setSettings] = useState(readClockSettings);
  const [label, setLabel] = useState(''), [dial, setDial] = useState<number | null>(null), [note, setNote] = useState('');
  const [station, setStation] = useState<string | null | undefined>(undefined); // undefined = not chosen yet (mandatory), null = without Alice
  const [edit, setEdit] = useState<Alarm | null>(null), [saving, setSaving] = useState(false), [askDelete, setAskDelete] = useState(false);
  const startLock = useRef(false), [starting, setStarting] = useState<string | null>(null);
  // what the editor was opened with (a tap beside the window must not throw away something typed), and whether it was opened straight from the
  // sheet or a room page: «Отмена», «Назад» and Escape then lead back there, not into the list «Будильники» nobody had opened
  const editBase = useRef(''), direct = useRef(false);
  const openEdit = (a: Alarm, straight: boolean) => { editBase.current = JSON.stringify(a); direct.current = straight; setAskDelete(false); setEdit(a); };
  const closeEdit = () => { setEdit(null); setAskDelete(false); if (direct.current) { direct.current = false; setWin(null); } };
  // commands on their way, by what was pressed: the button waits, and a second tap is not a second command
  const [sending, setSending] = useState<ReadonlySet<string>>(new Set()), sendingNow = useRef(new Set<string>());
  const during = async (key: string, work: () => Promise<unknown>) => { if (sendingNow.current.has(key)) return; sendingNow.current.add(key); setSending(new Set(sendingNow.current)); try { await work(); } finally { sendingNow.current.delete(key); setSending(new Set(sendingNow.current)); } };
  useMinute();
  const blankRef = useRef<(rid: string) => Alarm>(() => ({ id: 'x', room: '', time: '07:00', days: [], enabled: true, label: '', alice: 'off', phrase: '', station: '', light: false, lightEntity: '', fadeMin: 15, push: false, repeats: 0, repeatEveryMin: 5 }));
  const blankFor = (rid: string) => blankRef.current(rid);
  const dialRef = useRef<SVGSVGElement>(null), dragging = useRef(false), sheetRef = useRef<HTMLDivElement>(null);
  const askRef = useRef<HTMLDivElement>(null), asked = useRef(false);
  const tx = (k: string, p?: Record<string, string | number>) => t(k as Key, p);
  useEffect(() => { if (room && onAlarms && canAlarm(room)) { setWin('alarms'); if (!alarms.some(a => a.room === room)) openEdit(blankFor(room), true); } }, [room]);
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
  // The same list as the header's «кто дома» (model/people.ts): people hidden in the settings are not shown, and a person HA knows nothing about is «нет данных», not «не дома».
  const persons = peopleOf(registry, config ?? { entities: {}, devices: {} });
  const stationAlarms = registry.entities.filter(e => e.entity_id.startsWith('calendar.') && /_alarms$/.test(e.entity_id) && !e.disabled_by && S[e.entity_id]).map(e => { const a = S[e.entity_id].attributes; const start = typeof a.start_time === 'string' ? Date.parse(a.start_time) : NaN; return { id: e.entity_id, name: typeof a.friendly_name === 'string' ? a.friendly_name as string : e.entity_id, message: typeof a.message === 'string' ? a.message as string : '', start: Number.isFinite(start) ? start : null }; }).filter(a => a.start !== null).sort((a, b) => a.start! - b.start!);
  const dev = { key: 'clock', name: tx('clock.title'), primary: { available: true } } as unknown as HomeDevice;
  /** true = the house accepted the command; a refusal is said in the user's language and answers false, so the next step is not taken blindly */
  const call = async (domain: string, service: string, data: Record<string, unknown>): Promise<boolean> => { try { await host.call(domain, service, data); return true; } catch (e) { setNote(errorText(e, t)); return false; } };
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
  /** One intent, one timer: while the three commands are on their way the window waits (a second tap used to take the next slot and tell
   * Alice twice). A timer that did not start is not labelled and not sent to Alice; a speaker that refused is not written down as «у Алисы». */
  const start = async (totalSec: number, withLabelText = label, key = 'dial') => {
    if (station === undefined && stations.length) { setNote(tx('clock.pickStation')); return; }
    const slot = timers.find(x => x.state === 'idle' || x.state === 'unknown'); if (!slot) { setNote(tx('clock.timer.full')); return; }
    if (startLock.current) return; startLock.current = true; setStarting(key);
    try {
      const mark = (to: string | null) => entities.labels ? call('input_text', 'set_value', { entity_id: entities.labels, value: withLabelStation(labels, slot.id, withLabelText, totalSec, to) }) : Promise.resolve(true);
      // (the label goes first, as before: the house's automation reads it when the timer starts and ends; a timer that did not start gives its slot's label back)
      // A label the house refused stops here, with the reason in the window: the timer would run nameless, and «Отмена» would not reach the
      // speaker it was mirrored to (the speaker's name is kept in that label).
      if (!await mark(station ?? null)) return;
      if (!await call('timer', 'start', { entity_id: slot.id, duration: toDuration(totalSec) })) { if (entities.labels) await host.call('input_text', 'set_value', { entity_id: entities.labels, value: JSON.stringify(labels) }).catch(() => undefined); return; }
      if (station && !await call('yandex_station', 'send_command', { entity_id: station, command: aliceTimerCommand(totalSec) })) { await mark(null); setNote(tx('clock.aliceFailed')); }
      setLabel(''); setDial(null); setStation(undefined); setWin(null);
    } finally { startLock.current = false; setStarting(null); }
  };
  // «Отмена» goes to the speaker the timer was mirrored to, if that speaker is still in the house
  const cancelTimer = (x: TimerInfo) => during(`cancel:${x.id}`, async () => { const st = labelStation(labels[x.id]); if (!await call('timer', 'cancel', { entity_id: x.id })) return; /* a timer that still runs keeps its mirror on the speaker */ if (st && S[st]) await call('yandex_station', 'send_command', { entity_id: st, command: ALICE_CANCEL_TIMER }); });
  const mustPick = station === undefined && stations.length > 0;
  /** The dial: drag (or tap) anywhere on the ring to set minutes; the knob and the arc follow the finger. */
  const dialAt = (ev: PointerEvent) => { const svg = dialRef.current; if (!svg) return; const r = svg.getBoundingClientRect(); setDial(dialMinutes(ev.clientX - r.left, ev.clientY - r.top, r.width / 2, r.height / 2) * 60); };
  const dialDown = (ev: PointerEvent) => { dragging.current = true; (ev.currentTarget as Element).setPointerCapture?.(ev.pointerId); dialAt(ev); };
  const dialMove = (ev: PointerEvent) => { if (dragging.current) dialAt(ev); };
  const dialUp = () => { dragging.current = false; };
  useEffect(() => { if (!note) return; const i = setTimeout(() => setNote(''), 4000); return () => clearTimeout(i); }, [note]);
  const update = (patch: Partial<ClockSettings>) => { const next = { ...settings, ...patch }; setSettings(next); writeClockSettings(next); };
  const when = (at: number) => { const d = new Date(at), same = houseDate(at).toDateString() === houseDate(nowMs).toDateString(); const tm = clockTime(at, lang); if (same) return tm; const tomorrow = isTomorrow(at, now); return tomorrow ? `${tx('clock.tomorrow')} ${tm}` : `${dtf(lang, { weekday: 'short' }).format(d)} ${tm}`; };
  const hm = (v: number) => { const x = hoursMinutes(v); return `${x.h} ${tx('clock.h')} ${String(x.m).padStart(2, '0')} ${tx('clock.min')}`; };
  const boolRow = (role: string, text: string, icon: string, color: string, sub?: string) => { const id = entities[role]; const row = id ? S[id] : undefined; if (!id || !row) return null; const on = row.state === 'on', key = `bool:${id}`; return <div className="ah-row hm-setting"><span className="ah-row-icon" style={`--tile:${color}`}><Icon name={icon} size={18} /></span><span className="ah-row-text"><strong>{text}</strong>{sub && <small>{sub}</small>}</span><Switch on={on} pending={sending.has(key)} label={text} onToggle={() => void during(key, () => call('input_boolean', on ? 'turn_off' : 'turn_on', { entity_id: id }))} /></div>; };
  const localRow = (text: string, icon: string, color: string, on: boolean, toggle: () => void, sub?: string) => <div className="ah-row hm-setting"><span className="ah-row-icon" style={`--tile:${color}`}><Icon name={icon} size={18} /></span><span className="ah-row-text"><strong>{text}</strong>{sub && <small>{sub}</small>}</span><Switch on={on} label={text} onToggle={toggle} /></div>;

  const headBtns = <div className="at-cam-head-btns"><button type="button" className="hm-icon-btn at-cam-gear" aria-label={tx('clock.settings')} onClick={() => setWin('settings')}><Icon name="gear" size={20} /></button><button type="button" className="hm-icon-btn" aria-label={t('ui.closeSheet')} onClick={onClose}>×</button></div>;
  const head = <div className="hm-sheet-head"><span className="hm-sheet-photo at-clock-photo"><Icon name="clock" size={30} /></span><div><small>{t('section.home')}</small><h2>{tx('clock.title')}</h2></div>{!wide && headBtns}</div>;
  const face = <>
    {wide && <div className="at-clock-face-wrap"><ClockFace now={now} sun={entities.sun ? S[entities.sun] : undefined} settings={{ ...settings, seconds: true }} /></div>}
    <LiveTime lang={lang} />
    <div className="at-clock-date"><b>{dtf(lang, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }).format(now)}</b> · {tx('clock.week', { n: weekNumber(houseDate(nowMs)) })}{wTemp !== null ? ` · ${num(wTemp, lang, 1)}°${wCond ? ' ' + wCond : ''}` : ''}</div>
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
      <div className="at-clock-tt"><strong>{text || tx('clock.timer')}</strong><small>{fmtDuration(x.durationMs, tx('clock.min'), tx('clock.s'))}{labelStation(labels[x.id]) ? ` · ${tx('clock.withAlice')}` : ''}{x.state === 'paused' ? ` · ${tx('clock.paused')}` : ''}</small></div>
      <button type="button" className="at-clock-ctl" aria-label={x.state === 'paused' ? tx('clock.resume') : tx('clock.pause')} disabled={sending.has(`pause:${x.id}`) || sending.has(`cancel:${x.id}`)} aria-busy={sending.has(`pause:${x.id}`)} onClick={() => void during(`pause:${x.id}`, () => call('timer', x.state === 'paused' ? 'start' : 'pause', { entity_id: x.id }))}><Icon name={x.state === 'paused' ? 'play' : 'pause'} size={18} /></button>
      <button type="button" className="at-clock-ctl is-stop" aria-label={tx('clock.cancel')} disabled={sending.has(`cancel:${x.id}`) || sending.has(`pause:${x.id}`)} aria-busy={sending.has(`cancel:${x.id}`)} onClick={() => void cancelTimer(x)}>×</button></div>; };
  const timersCard = timerIds.length > 0 && <div className="at-clock-card at-clock-timers"><div className="at-clock-card-head"><h3 className="at-h4">{tx('clock.timers')}</h3>{running.length < timerIds.length && <button type="button" className="hm-pill is-primary is-small at-clock-new" onClick={() => setWin('timer')}>+ {tx('clock.newTimer')}</button>}</div>
    {running.length ? running.map(timerRow) : <p className="at-clock-empty">{tx('clock.noTimers')}</p>}
  </div>;
  const timerWin = <>
      {stations.length > 0 && <div className={`at-clock-stations ${mustPick ? 'is-required' : ''}`}><span className="at-clock-stations-label">{tx('clock.whereRing')}{mustPick && <b> *</b>}</span><div className="at-clock-presets"><button type="button" className={`hm-pill ${station === null ? 'is-primary' : ''}`} aria-pressed={station === null} disabled={starting !== null} onClick={() => setStation(null)}>{tx('clock.noAlice')}</button>{stations.map(st => <button type="button" className={`hm-pill ${station === st.id ? 'is-primary' : ''}`} aria-pressed={station === st.id} disabled={starting !== null} onClick={() => setStation(st.id)}>{roomName(st.area ?? '') || st.name}</button>)}</div>{mustPick && <small>{tx('clock.pickStation')}</small>}</div>}
      {!mustPick && <div className="at-clock-grid">{PRESETS.map(p => <button type="button" className="at-clock-tile" disabled={mustPick || starting !== null} aria-busy={starting === `p${p}`} onClick={() => void start(p * 60, label, `p${p}`)}><b>{starting === `p${p}` ? '…' : p === 60 ? 1 : p}</b><small>{p === 60 ? tx('clock.hour') : tx('clock.min')}</small></button>)}</div>}
      {!mustPick && <div className="at-clock-grid is-named">{NAMED_PRESETS.map(p => <button type="button" className="at-clock-tile is-named" disabled={mustPick || starting !== null} aria-busy={starting === p.key} onClick={() => void start(p.minutes * 60, names[p.key], p.key)}><span className="at-clock-tile-icon"><Icon name={p.icon} size={22} /></span><strong>{names[p.key]}</strong><small>{starting === p.key ? '…' : `${p.minutes} ${tx('clock.min')}`}</small></button>)}
        <button type="button" className={`at-clock-tile is-named is-dial ${dial !== null ? 'is-on' : ''}`} aria-expanded={dial !== null} disabled={starting !== null} onClick={() => setDial(dial === null ? 600 : null)}><span className="at-clock-tile-icon"><Icon name="hourglass" size={22} /></span><strong>{tx('clock.custom')}</strong><small>{tx('clock.dialHint')}</small></button></div>}
      {!mustPick && dial !== null && (() => { const mins = Math.floor(dial / 60), frac = (dial / 60) / 60, C = 2 * Math.PI * 80, ang = frac * 360, kx = 100 + 80 * Math.sin(ang * Math.PI / 180), ky = 100 - 80 * Math.cos(ang * Math.PI / 180);
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
          <button type="button" className="hm-pill is-primary at-clock-go" disabled={dial === 0 || mustPick || starting !== null} aria-busy={starting === 'dial'} onClick={() => void start(dial)}>{starting === 'dial' ? '…' : `${tx('clock.start')} ${mins}:${String(dial % 60).padStart(2, '0')}`}</button>
        </div>; })()}
      {!mustPick && <input className="at-clock-label-input" type="text" maxLength={20} aria-label={tx('clock.labelField')} autocomplete="off" enterkeyhint="done" placeholder={tx('clock.label')} value={label} onInput={e => setLabel((e.target as HTMLInputElement).value)} />}
  </>;
  const people = persons.length > 0 && <div className="at-clock-card at-clock-people">{persons.map(p => <div className={`at-clock-person ${p.state === 'home' ? 'is-home' : ''} ${p.state === 'unknown' ? 'is-unknown' : ''}`} key={p.id}><b>{p.picture ? <img src={p.picture} alt="" onError={e => { (e.target as HTMLImageElement).remove(); }} /> : null}{p.initials}</b><strong>{p.first}</strong><small>{p.state === 'home' ? tx('clock.home') : p.state === 'unknown' ? t('people.unknown') : p.zone ? `${tx('clock.away')} · ${p.zone}` : tx('clock.away')}</small></div>)}</div>;
  const alarmBlock = stationAlarms.length > 0 && <div className="ah-rows at-clock-card is-rows">{stationAlarms.slice(0, 2).map(a => <div className="ah-row"><span className="ah-row-icon" style="--tile:#7b74d8"><Icon name="bell" size={18} /></span><span className="ah-row-text"><strong>{a.name.replace(/\s*·\s*будильники и таймеры$/i, '')}</strong><small>{a.message}</small></span><small className="at-door-when">{when(a.start!)}</small></div>)}</div>;
  // ---- room alarms (stored in the integration, rung by it) ----
  const dayNames = tx('alarm.dayNames').split(','), dayFull = WEEKDAYS.map(d => dtf(lang, { weekday: 'long' }, false).format(new Date(2024, 0, d))); // 1 January 2024 was a Monday
  // the choice in words under the chips, so that it is not carried by the fill alone: «один раз — прозвонит и выключится»
  const daysLine = (days: number[]) => days.length ? `${tx('alarm.rings')}: ${daysText(days, dayNames, tx)}` : tx('alarm.onceNote');
  const save = async (list: Alarm[]) => { if (!onAlarms || saving) return; setSaving(true); try { await onAlarms(list); direct.current = false; setEdit(null); setAskDelete(false); } catch (e) { setNote(errorText(e, t)); } finally { setSaving(false); } };
  blankRef.current = (rid: string): Alarm => { const st = stations.find(x => x.area === rid), li = dimmable.find(x => x.area === rid); return { id: newAlarmId(), room: rid, time: '07:00', days: [...WORKDAYS], enabled: true, label: '', alice: st ? 'tts' : 'off', phrase: '', station: st?.id ?? '', light: !!li, lightEntity: li?.id ?? '', fadeMin: 15, push: false, repeats: 0, repeatEveryMin: 5 }; };
  const alarmRow = (a: Alarm) => { const bits = [daysText(a.days, dayNames, tx), a.light && a.lightEntity ? `${tx('alarm.sunrise')} ${a.fadeMin} ${tx('clock.min')}` : '', a.alice !== 'off' && a.station ? (a.alice === 'tts' ? tx('alarm.alicePhrase') : tx('alarm.aliceMusic')) : '', a.repeats ? tx('alarm.repeatsShort', { n: a.repeats }) : ''].filter(Boolean).join(' · ');
    return <div className={`ah-row at-alarm-row ${a.enabled ? '' : 'is-off'}`} key={a.id}><button type="button" className="at-alarm-main" onClick={() => openEdit({ ...a }, false)}><span className="ah-row-icon" style={`--tile:${a.enabled ? '#7b74d8' : '#8e8e93'}`}><Icon name="bell" size={18} /></span><span className="ah-row-text"><strong>{roomName(a.room)} · {a.time}{a.label ? ` · ${a.label}` : ''}</strong><small>{bits}</small></span></button><Switch on={a.enabled} label={`${roomName(a.room)} · ${a.time}`} pending={saving} disabled={!onAlarms} onToggle={() => void save(alarms.map(x => x.id === a.id ? { ...x, enabled: !x.enabled } : x))} /></div>; };
  const sortedAlarms = [...alarms].sort((a, b) => a.time.localeCompare(b.time) || a.room.localeCompare(b.room));
  // the card shows the two that ring NEXT (the same rule as the server's next_fire), not the two earliest by the clock
  const nextAlarms = alarms.map(a => ({ a, at: nextFire(a, now) })).filter((x): x is { a: Alarm; at: number } => x.at !== null).sort((x, y) => x.at - y.at).slice(0, 2).map(x => x.a);
  const alarmsCard = <div className="at-clock-card at-clock-alarms"><div className="at-clock-card-head"><h3 className="at-h4">{tx('alarm.title')}{alarms.length ? ` · ${alarms.length}` : ''}</h3>{onAlarms && alarmRooms.length > 0 && <button type="button" className="hm-pill is-primary is-small at-alarm-add" onClick={() => { setWin('alarms'); openEdit(blankFor(canAlarm(room) ? room! : alarms[0]?.room && canAlarm(alarms[0].room) ? alarms[0].room : alarmRooms[0].id), true); }}>+ {tx('alarm.add')}</button>}</div>
    {alarmRooms.length === 0 && <p className="at-clock-empty">{tx('alarm.noStationRooms')}</p>}
    {nextAlarms.length ? nextAlarms.map(a => <button type="button" className="at-alarm-chip" onClick={() => setWin('alarms')}><b>{a.time}</b><span>{roomName(a.room)}</span><small>{daysText(a.days, dayNames, tx)}</small></button>) : alarmRooms.length > 0 ? <p className="at-clock-empty">{tx('alarm.none')}</p> : null}
    {alarms.length > 0 && <button type="button" className="hm-text-btn at-clock-all" onClick={() => setWin('alarms')}>{tx('alarm.all', { n: alarms.length })}<Icon name="next" size={16} /></button>}
  </div>;
  const alarmsWin = <div className="ah-rows at-alarms">
    {alarms.length === 0 && <div className="at-cam-kv"><span>{tx('alarm.none')}</span></div>}
    {sortedAlarms.map(alarmRow)}
    {onAlarms && alarmRooms.length > 0 && <button type="button" className="ah-row at-door-row-btn at-alarm-add" onClick={() => openEdit(blankFor(canAlarm(room) ? room! : alarmRooms[0].id), false)}><span className="ah-row-icon" style="--tile:#7b74d8">+</span><span className="ah-row-text"><strong>{tx('alarm.add')}</strong></span></button>}
  </div>;
  const editor = edit && (() => { const a = edit, set = (patch: Partial<Alarm>) => setEdit({ ...a, ...patch }); const roomStations = stations.filter(x => x.area === a.room), roomLights = dimmable.filter(x => x.area === a.room);
    const toggleDay = (d: number) => set({ days: a.days.includes(d) ? a.days.filter(x => x !== d) : [...a.days, d].sort() });
    const pickRoom = (rid: string) => { const st = stations.find(x => x.area === rid), li = dimmable.find(x => x.area === rid); set({ room: rid, station: st?.id ?? '', alice: st ? (a.alice === 'off' ? 'tts' : a.alice) : 'off', lightEntity: li?.id ?? '', light: !!li }); };
    const exists = alarms.some(x => x.id === a.id);
    return <div className="at-alarm-editor">
      <div className="at-clock-presets">{alarmRooms.map(r => <button type="button" className={`hm-pill ${a.room === r.id ? 'is-primary' : ''}`} aria-pressed={a.room === r.id} onClick={() => pickRoom(r.id)}>{r.name}</button>)}</div>
      <div className="at-alarm-time"><input type="time" aria-label={tx('alarm.time')} required value={a.time} onInput={e => { const v = (e.target as HTMLInputElement).value; if (/^\d\d:\d\d$/.test(v)) set({ time: v }); }} /><input className="at-clock-label-input" type="text" maxLength={40} aria-label={tx('alarm.labelField')} autocomplete="off" enterkeyhint="done" placeholder={tx('clock.label')} value={a.label} onInput={e => set({ label: (e.target as HTMLInputElement).value })} /></div>
      <div className="at-clock-presets at-alarm-days" role="group" aria-label={tx('alarm.days')}>{WEEKDAYS.map(d => <button type="button" className={`hm-pill is-day ${a.days.includes(d) ? 'is-primary' : ''}`} aria-pressed={a.days.includes(d)} aria-label={dayFull[d - 1]} onClick={() => toggleDay(d)}>{dayNames[d - 1]}</button>)}{([[WORKDAYS, 'alarm.workdays'], [WEEKEND, 'alarm.weekend'], [[], 'alarm.once']] as Array<[number[], string]>).map(([set_, k]) => { const on = a.days.length === set_.length && set_.every(d => a.days.includes(d)); return <button type="button" className={`hm-pill is-small ${on ? 'is-primary' : ''}`} aria-pressed={on} onClick={() => set({ days: [...set_] })}>{tx(k)}</button>; })}</div>
      <p className="at-alarm-when" role="status">{daysLine(a.days)}</p>
      {roomLights.length > 0 ? <>
        <div className="ah-row hm-setting"><span className="ah-row-icon" style="--tile:#ff9f0a"><Icon name="sun" size={18} /></span><span className="ah-row-text"><strong>{tx('alarm.light')}</strong><small>{tx('alarm.lightNote', { n: a.fadeMin })}</small></span><Switch on={a.light} label={tx('alarm.light')} onToggle={() => set({ light: !a.light, lightEntity: a.lightEntity || roomLights[0].id })} /></div>
        {a.light && <><div className="at-clock-presets">{roomLights.map(l => <button type="button" className={`hm-pill is-small ${a.lightEntity === l.id ? 'is-primary' : ''}`} aria-pressed={a.lightEntity === l.id} onClick={() => set({ lightEntity: l.id })}>{shortRoom(l.name, a.room)}</button>)}</div>
        <div className="at-clock-presets">{ALARM_FADE.filter(m => m > 0).map(m => <button type="button" className={`hm-pill is-small ${a.fadeMin === m ? 'is-primary' : ''}`} aria-pressed={a.fadeMin === m} onClick={() => set({ fadeMin: m })}>{m} {tx('clock.min')}</button>)}</div></>}
      </> : <div className="ah-row"><span className="ah-row-icon" style="--tile:#8e8e93"><Icon name="sun" size={18} /></span><span className="ah-row-text"><strong>{tx('alarm.light')}</strong><small>{tx('alarm.noDimmer')}</small></span></div>}
      {roomStations.length > 0 ? <>
        <div className="ah-row hm-setting"><span className="ah-row-icon" style="--tile:#0a84ff"><Icon name="speaker" size={18} /></span><span className="ah-row-text"><strong>{tx('alarm.alice')}</strong><small>{roomStations.map(x => shortRoom(x.name, a.room)).join(', ')}</small></span><div className="at-door-seg at-clock-seg" role="group" aria-label={tx('alarm.alice')}>{(['off', 'tts', 'music'] as const).map(m => <button type="button" aria-pressed={a.alice === m} className={a.alice === m ? 'is-on' : ''} onClick={() => set({ alice: m, station: a.station || roomStations[0].id })}>{tx(`alarm.alice.${m}`)}</button>)}</div></div>
        {a.alice === 'tts' && <input className="at-clock-label-input" type="text" maxLength={120} aria-label={tx('alarm.phraseField')} autocomplete="off" enterkeyhint="done" placeholder={tx('alarm.phrasePlaceholder')} value={a.phrase} onInput={e => set({ phrase: (e.target as HTMLInputElement).value })} />}
      </> : <div className="ah-row"><span className="ah-row-icon" style="--tile:#8e8e93"><Icon name="speaker" size={18} /></span><span className="ah-row-text"><strong>{tx('alarm.alice')}</strong><small>{tx('alarm.noStation')}</small></span></div>}
      <div className="ah-row hm-setting"><span className="ah-row-icon" style="--tile:#7b74d8"><Icon name="hourglass" size={18} /></span><span className="ah-row-text"><strong>{tx('alarm.repeats')}</strong><small>{a.repeats ? tx('alarm.repeatsNote', { n: a.repeats, m: a.repeatEveryMin }) : tx('alarm.noRepeats')}</small></span></div>
      <div className="at-clock-presets">{[0, 1, 2, 3, 5, 10].map(n => <button type="button" className={`hm-pill is-small ${a.repeats === n ? 'is-primary' : ''}`} aria-pressed={a.repeats === n} onClick={() => set({ repeats: n })}>{n === 0 ? tx('alarm.repeats0') : `×${n}`}</button>)}{a.repeats > 0 && ALARM_REPEAT_EVERY.map(m => <button type="button" className={`hm-pill is-small ${a.repeatEveryMin === m ? 'is-primary' : ''}`} aria-pressed={a.repeatEveryMin === m} onClick={() => set({ repeatEveryMin: m })}>{tx('alarm.every', { m })}</button>)}</div>
      {note && <p className="at-feeder-note at-alarm-note" role="alert">{note}</p>}
      {askDelete && exists ? <div className="at-alarm-actions at-alarm-ask" ref={askRef} role="alertdialog" aria-label={tx('alarm.deleteAsk', { name: `${roomName(a.room)} · ${a.time}` })}><span>{tx('alarm.deleteAsk', { name: `${roomName(a.room)} · ${a.time}` })}</span><button type="button" className="hm-pill" disabled={saving} onClick={() => setAskDelete(false)}>{t('confirm.no')}</button><button type="button" className="hm-pill at-alarm-delete at-alarm-delete-yes" disabled={saving} onClick={() => void save(alarms.filter(x => x.id !== a.id))}>{saving ? '…' : tx('alarm.delete')}</button></div>
        : <div className="at-alarm-actions"><button type="button" className="hm-pill is-primary at-alarm-save" disabled={saving} aria-busy={saving} onClick={() => void save(exists ? alarms.map(x => x.id === a.id ? a : x) : [...alarms, a])}>{saving ? '…' : tx('alarm.save')}</button><button type="button" className="hm-pill" disabled={saving} onClick={closeEdit}>{t('confirm.no')}</button>{exists && <button type="button" className="hm-pill at-alarm-delete" disabled={saving} onClick={() => setAskDelete(true)}>{tx('alarm.delete')}</button>}</div>}
    </div>; })();
  // the question's default answer is «Отмена», as in every other question of the panel (the focus used to stay where «Удалить» had been: Enter
  // twice deleted the alarm); answered «Отмена», the focus goes back to «Удалить»
  useEffect(() => { if (askDelete) { asked.current = true; askRef.current?.querySelector<HTMLElement>('button:not([disabled])')?.focus({ preventScroll: true }); return; } if (!asked.current) return; asked.current = false; (sheetRef.current?.closest('.hm-scrim') ?? sheetRef.current)?.querySelector<HTMLElement>('.at-alarm-editor .at-alarm-delete')?.focus({ preventScroll: true }); }, [askDelete]);
  const settingsPage = <>
    <div className="ah-rows"><Title>{tx('clock.group.device')}</Title>
      <div className="ah-row hm-setting"><span className="ah-row-icon" style="--tile:#7b74d8"><Icon name="clock" size={18} /></span><span className="ah-row-text"><strong>{tx('clock.style')}</strong></span><div className="at-door-seg at-clock-seg" role="group" aria-label={tx('clock.style')}>{(['analog', 'digital'] as const).map(s => <button type="button" aria-pressed={settings.style === s} className={settings.style === s ? 'is-on' : ''} onClick={() => update({ style: s })}>{tx(`clock.style.${s}`)}</button>)}</div></div>
      {localRow(tx('clock.secondsHand'), 'clock', '#7b74d8', settings.seconds, () => update({ seconds: !settings.seconds }))}
      {localRow(tx('clock.arc'), 'sun', '#ff9f0a', settings.arc, () => update({ arc: !settings.arc }))}
      {localRow(tx('clock.beep'), 'speaker', '#30d158', settings.beep, () => update({ beep: !settings.beep }), tx('clock.beepNote'))}
    </div>
    <div className="ah-rows"><Title>{tx('clock.group.shared')}</Title>
      {boolRow('announce', tx('clock.announce'), 'speaker', '#0a84ff', tx('clock.announceNote'))}{boolRow('push', tx('clock.push'), 'phone', '#0a84ff')}
      {timerIds.length > 0 && host.admin && <KV k={tx('clock.timersInHa')} v={timerIds.join(' · ')} />}
    </div>
  </>;
  // a refusal is said where the person is looking: in the window when one is open (on a phone it covers the sheet whole), else in the sheet
  const cards = <>{timersCard}{alarmsCard}{people}{alarmBlock}{note && !win && <p className="at-feeder-note at-cam-note" role="status">{note}</p>}</>;
  const winNote = note ? <p className="at-feeder-note at-alarm-note" role="alert">{note}</p> : null;
  // One window element for every screen: switching list → editor swaps only the body, so the scrim and the card never re-animate.
  const screen = win === 'timer' ? { title: tx('clock.newTimer'), back: () => setWin(null), wide: true, body: <>{timerWin}{winNote}</>, key: 'timer', keep: false }
    : win === 'alarms' && edit ? { title: alarms.some(x => x.id === edit.id) ? tx('alarm.edit') : tx('alarm.new'), back: closeEdit, wide: true, body: editor, key: 'alarm-edit', keep: JSON.stringify(edit) !== editBase.current }
    : win === 'alarms' ? { title: tx('alarm.title'), back: () => setWin(null), wide: false, body: <>{alarmsWin}{winNote}</>, key: 'alarms', keep: false }
    : win === 'settings' ? { title: tx('clock.settings'), back: () => setWin(null), wide: false, body: <>{settingsPage}{winNote}</>, key: 'settings', keep: false } : null;
  const windows = screen && <Win t={t} title={screen.title} onBack={screen.back} wide={screen.wide} bodyKey={screen.key} keepOnScrim={screen.keep}>{screen.body}</Win>;
  // The left half scrolls when the sheet is lower than the dial and the sun (a television laid out as 960×540): it is then a stop for the keyboard
  // and the remote, whose arrows scroll it — it holds only words and the dial, so nothing in it could take the focus.
  const leftRef = useRef<HTMLDivElement>(null), [leftScrolls, setLeftScrolls] = useState(false);
  useLayoutEffect(() => { const el = leftRef.current, v = !!el && el.scrollHeight > el.clientHeight + 1; if (v !== leftScrolls) setLeftScrolls(v); });
  useEffect(() => { const el = leftRef.current; if (!el || typeof ResizeObserver === 'undefined') return; const ro = new ResizeObserver(() => setLeftScrolls(el.scrollHeight > el.clientHeight + 1)); ro.observe(el); return () => ro.disconnect(); }, [wide]);
  if (wide) return <div ref={sheetRef} className="hm-sheet-body ah-sheet at-cam at-clock is-split" data-kind="clock" data-win={win ?? 'none'}>
    <div className="at-cam-left" ref={leftRef} role="group" aria-label={tx('clock.faceGroup')} tabIndex={leftScrolls ? 0 : undefined}>{head}{face}</div>
    <div className="at-cam-right">{headBtns}{cards}</div>
    {windows}
  </div>;
  return <div ref={sheetRef} className="hm-sheet-body ah-sheet at-cam at-clock" data-kind="clock" data-win={win ?? 'none'}>{head}{face}{cards}{windows}</div>;
}

/** Three short tones through WebAudio when a timer ends or an alarm rings (kiosk tablets have no HA app to buzz). The context is made when the
 * first sound is due, not on the first touch: building an AudioContext blocks the main thread for 0.1–1 s (longer on a busy device), and that
 * used to happen under the finger of whoever touched the panel first after a load (audit 2026-11-09, round 2, PERF-2). */
let audio: AudioContext | null = null, rest: ReturnType<typeof setTimeout> | null = null;
/** After a sound the context is put to sleep: a context left running keeps the audio thread of a wall tablet awake for ever. */
const sleepLater = (ms: number) => { if (rest) clearTimeout(rest); rest = setTimeout(() => { rest = null; void audio?.suspend().catch(() => undefined); }, ms); };
/** Kept for the shell, which used to call it on the first touch: it creates nothing any more (see above) — `beep()` makes the context itself. */
export function armBeep(): void { /* nothing to prepare */ }
/** A browser that has not been touched yet keeps the context suspended; a sound that could only start much later is dropped, not played out of the blue. */
const LATE_MS = 5000;
export function beep(): void {
  try {
    audio ??= new (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)(); const ctx = audio, due = Date.now();
    const play = () => { if (Date.now() - due > LATE_MS) { sleepLater(0); return; } const t0 = ctx.currentTime; [0, 0.25, 0.5].forEach((d, i) => { const o = ctx.createOscillator(), g = ctx.createGain(); o.type = 'sine'; o.frequency.value = i === 2 ? 1318 : 1046; g.gain.setValueAtTime(0.0001, t0 + d); g.gain.exponentialRampToValueAtTime(0.4, t0 + d + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, t0 + d + 0.2); o.connect(g).connect(ctx.destination); o.start(t0 + d); o.stop(t0 + d + 0.22); }); sleepLater(1500); };
    if (rest) { clearTimeout(rest); rest = null; }
    if (ctx.state === 'running') play(); else void ctx.resume().then(play, play);
  } catch { /* no audio */ }
}

export const clock: ModuleDef = {
  ...clockSpec,
  Card: () => null,
  claims: entities => [entities.done, entities.labels, entities.timer1, entities.timer2, entities.timer3, entities.announce, entities.push, entities.alarmFlag, entities.alarmText].filter((x): x is string => !!x),
  banner: (registry, entities, t, host) => {
    const flag = entities.alarmFlag ? registry.states[entities.alarmFlag] : undefined;
    if (flag && flag.state === 'on') {
      const r = parseRinging(registry.states[entities.alarmText ?? '']?.state);
      // both buttons reject with the house's own error (the shell runs them through its command runner and says why) and send nothing while the house is away (clock-state.ts)
      const roomLabel = r ? (registry.areas.find(a => a.area_id === r.room)?.name ?? r.room) : '';
      return { id: 'alarm', text: `${t('alarm.ringing' as Key)}${r ? ` · ${roomLabel} · ${r.time}` : ''}`, sub: r ? [r.label, r.left ? t('alarm.repeatsLeft' as Key, { n: r.left }) : ''].filter(Boolean).join(' · ') : '', icon: 'bell', sound: true, stop: () => stopAlarm(host, entities.alarmFlag!), extra: host.ws ? { label: t('alarm.snooze' as Key), run: () => snoozeAlarm(host, 9) } : undefined };
    }
    const done = entities.done ? registry.states[entities.done] : undefined; if (!done || done.state !== 'on') return null;
    const ids = [entities.timer1, entities.timer2, entities.timer3].filter((x): x is string => !!x);
    const labels = parseLabels(registry.states[entities.labels ?? '']?.state);
    // the label of the timer that has just ended (it was the first slot that had any label: «Чай» for a finished «Стирка»)
    const ended = finishedTimer(registry.states, ids, done.last_changed), raw = ended ? labels[ended] : undefined, label = labelText(raw), sec = raw ? Number(raw.split('|')[1]) : NaN;
    const sub = [label, Number.isFinite(sec) && sec > 0 ? fmtDuration(sec * 1000, t('clock.min' as Key), t('clock.s' as Key)) : ''].filter(Boolean).join(' · ');
    return { id: 'timer', text: t('clock.timerDone' as Key), sub, icon: 'clock', sound: true, stop: async () => { await host.call('input_boolean', 'turn_off', { entity_id: entities.done! }); } };
  },
};
