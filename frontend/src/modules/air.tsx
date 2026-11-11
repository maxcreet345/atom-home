import { useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks';
import type { ModuleDef } from './types.ts';
import { airSpec } from './catalog.ts';
import { errorText, num } from '../ui/format.ts';
import type { Key, T } from '../i18n/index.ts';
import type { Lang } from '../ui/format.ts';
import type { Host } from '../runtime/host.ts';
import type { Registry } from '../model/registry.ts';
import { airActions, airErrorKey, airSummary, declinable, deviceAway, inRoomRu, isHigh, toneOf, withoutEndedAlarms, type AirAction, type AirActionKind, type AirProblem, type AirRoom, type AirSummary, type AirTask, type AirTone, type Metric, type Span, type Tone } from '../model/air.ts';
type Rooms = Array<{ id: string; name: string }>;
const tk = (t: T, k: string, params?: Record<string, string | number>) => t(`module.air.${k}` as Key, params);
const inRoom = (name: string, lang: Lang, t: T) => (lang === 'ru' ? inRoomRu(name) : tk(t, 'inRoom', { room: name })).replace(' ', '\u00a0'); // the preposition stays with its room
const metricName = (m: Metric, t: T) => m === 'co2' ? 'CO₂' : m === 'pm25' ? 'PM2.5' : tk(t, m).toLocaleLowerCase();
/** The one sentence: the worst thing and where (main), and what is already being done about it (tail). No problem and no data is not good air, and neither is no connection: the numbers are the last known. */
function sentenceParts(s: AirSummary, t: T, lang: Lang, online: boolean, good = 'allGood'): { main: string; tail: string | null } {
  const p = s.problem;
  if (!p) {
    if (!online) return { main: t('ui.offline'), tail: null };
    const known = [s.temperature, s.humidity, s.co2, s.pm25].filter(x => x.total > 0).length, main = s.noData.length === known ? tk(t, 'noDataAll') : !s.noData.length ? tk(t, good) : tk(t, 'noDataFor', { list: s.noData.map(m => metricName(m, t)).join(', ') });
    return { main, tail: s.rooms.some(r => !r.excluded && r.allowed.length > 0 && r.ventOn) ? tk(t, 'ventRunning') : null }; // the registry alone says so: the tile needs no polling
  }
  const word: Record<Metric, string> = { co2: p.tone === 'bad' ? 'veryStuffy' : 'stuffy', pm25: 'dusty', humidity: p.high ? 'humid' : 'dry', temperature: p.high ? 'hot' : 'cold' };
  const main = lang === 'ru' && !declinable(p.room.name) ? `${tk(t, word[p.metric])}: ${p.room.name}` : `${tk(t, word[p.metric])} ${inRoom(p.room.name, lang, t)}`;
  if (p.room.ventOn && (p.metric === 'humidity' || (p.metric === 'pm25' && p.room.allowed.length > 0))) return { main, tail: tk(t, 'ventRunning') };
  if (p.room.windowOpen && p.metric !== 'pm25') return { main, tail: tk(t, 'airing') };
  if (p.room.purifierOn && p.metric === 'pm25') return { main, tail: tk(t, 'cleaning') };
  return { main, tail: null };
}
const joined = ({ main, tail }: { main: string; tail: string | null }) => tail ? `${main} · ${tail}` : main;
export function airSentence(s: AirSummary, t: T, lang: Lang, online = true): string { return joined(sentenceParts(s, t, lang, online)); }
/** The look follows the sentence: with no connection and no known problem, nothing can be said of the air. */
const lookOf = (s: AirSummary, online: boolean): AirTone => !online && !s.problem ? 'none' : s.tone;
const toneWord = (tone: Tone, t: T) => tone === 'ok' ? null : <span className="at-air-vh">{tk(t, tone === 'bad' ? 'toneBad' : 'toneWarn')}</span>;
/** The house's little cloud: content when the air is good, uneasy at a warning, frowning when it is bad, blank when the sensors say nothing. Same family as the feeder's cat. The words stand next to it, so it is decoration. */
function Cloud({ tone }: { tone: AirTone }) {
  return <svg className={`at-air-cloud is-${tone}`} viewBox="0 0 140 104" aria-hidden="true"><g className="at-air-breeze" fill="none" stroke="currentColor" stroke-width="4" stroke-linecap="round"><path d="M112 9h19" /><path d="M104 20h22" /></g>
    <path className="at-air-cloud-body" d="M38 90a26 26 0 0 1-4-52 34 34 0 0 1 64-9 25 25 0 0 1 8 61z" />
    {tone === 'none' ? <path d="M50 52h12M78 52h12" fill="none" stroke="#2b3a44" stroke-width="4" stroke-linecap="round" /> : tone === 'ok' ? <path d="M50 54q6-8 12 0M78 54q6-8 12 0" fill="none" stroke="#2b3a44" stroke-width="4" stroke-linecap="round" /> : <g fill="#2b3a44"><ellipse cx="56" cy="52" rx="5.5" ry="6.5" /><ellipse cx="84" cy="52" rx="5.5" ry="6.5" /><circle cx="54" cy="49.5" r="1.8" fill="#fff" /><circle cx="82" cy="49.5" r="1.8" fill="#fff" /></g>}
    {tone === 'bad' && <path d="M47 42l13-4M93 42l-13-4" stroke="#2b3a44" stroke-width="3.4" stroke-linecap="round" />}
    {tone !== 'none' && <><ellipse cx="44" cy="63" rx="7" ry="4.5" fill="#ff8f7a" opacity=".45" /><ellipse cx="96" cy="63" rx="7" ry="4.5" fill="#ff8f7a" opacity=".45" /></>}
    {tone === 'none' ? <path d="M65 68h10" stroke="#2b3a44" stroke-width="3.4" stroke-linecap="round" /> : tone === 'ok' ? <path d="M62 66q8 7 16 0" fill="none" stroke="#2b3a44" stroke-width="3.4" stroke-linecap="round" /> : tone === 'warn' ? <path d="M64 68h12" stroke="#2b3a44" stroke-width="3.4" stroke-linecap="round" /> : <path d="M62 71q8-7 16 0" fill="none" stroke="#2b3a44" stroke-width="3.4" stroke-linecap="round" />}</svg>;
}
const GLYPH: Record<string, string> = { window: 'M5 3h14v18H5zM12 3v18M5 12h14', wave: 'M3 8c3-2.5 6 2.5 9 0s6 2.5 9 0M3 14c3-2.5 6 2.5 9 0s6 2.5 9 0', drop: 'M12 3s7 7.2 7 12a7 7 0 0 1-14 0c0-4.8 7-12 7-12z', fan: 'M12 12c0-4 1-8 4-8s3 4-4 8zM12 12c4 0 8 1 8 4s-4 3-8-4zM12 12c0 4-1 8-4 8s-3-4 4-8zM12 12c-4 0-8-1-8-4s4-3 8 4z', sun: 'M12 16a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM12 2v2M12 20v2M2 12h2M20 12h2' };
const Glyph = ({ name, size = 20 }: { name: string; size?: number }) => <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d={GLYPH[name]} /></svg>;
const fmt = (v: number | null, lang: Lang, digits = 0) => v === null ? '—' : num(v, lang, digits);
const TEMP_LOCALE: Record<Lang, string> = { ru: 'ru-RU', ro: 'ro-RO', en: 'en-GB' };
/** Always one decimal, so «20,0°» stands level with «20,5°». */
const temp = (v: number | null, lang: Lang) => v === null ? '—' : (Number(v.toFixed(1)) || 0).toLocaleString(TEMP_LOCALE[lang], { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const spanNote = (s: Span, t: T) => s.used < s.total ? tk(t, 'ofRooms', { a: s.used, b: s.total }) : null;
/** The hero's and the tile's numbers: a reading only when there is a sensor at all. */
function metricsOf(s: AirSummary, t: T, lang: Lang) {
  const out: Array<{ key: string; value: string; unit: string; label: string; short: string; place: string | null; note: string | null; tone: Tone }> = [], unit = (x: Span, u: string) => x.value === null ? '' : u;
  if (s.temperature.total) out.push({ key: 'temperature', value: temp(s.temperature.value, lang), unit: unit(s.temperature, '°'), label: tk(t, 'temperature'), short: tk(t, 'tempShort'), place: null, note: spanNote(s.temperature, t), tone: 'ok' });
  if (s.humidity.total) out.push({ key: 'humidity', value: fmt(s.humidity.value, lang, 0), unit: unit(s.humidity, '%'), label: tk(t, 'humidity'), short: tk(t, 'humShort'), place: null, note: spanNote(s.humidity, t), tone: 'ok' });
  if (s.co2.total) out.push({ key: 'co2', value: fmt(s.co2.value, lang, 0), unit: unit(s.co2, 'ppm'), label: s.co2.room ? `CO₂ · ${s.co2.room}` : 'CO₂', short: 'CO₂', place: s.co2.room, note: spanNote(s.co2, t), tone: toneOf('co2', s.co2.value) });
  if (s.pm25.total) out.push({ key: 'pm25', value: fmt(s.pm25.value, lang, 0), unit: unit(s.pm25, tk(t, 'pmUnit')), label: s.pm25.room ? `PM2.5 · ${s.pm25.room}` : 'PM2.5', short: 'PM2.5', place: s.pm25.room, note: spanNote(s.pm25, t), tone: toneOf('pm25', s.pm25.value) });
  return out;
}
/** The degree is part of the number and stands close and raised; a word unit stands apart. */
const Unit = ({ unit }: { unit: string }) => !unit ? null : <i className={unit === '°' ? 'is-deg' : undefined}>{unit}</i>;
const readingText = (room: AirRoom, metric: Metric, lang: Lang) => { const r = room[metric]; if (!r || r.value === null) return null; return metric === 'temperature' ? `${temp(r.value, lang)}°` : metric === 'humidity' ? `${num(r.value, lang, 0)}%` : num(r.value, lang, 0); };
/** Everything the room says about itself, in one line of words: empty when all is well. The worst tone colours it. */
function roomHint(room: AirRoom, heard: Metric[], t: T): { text: string; tone: Tone; saysVent: boolean } | null {
  const found: Array<{ m: Metric; tone: Tone; high: boolean }> = [];
  for (const m of heard) { const v = room[m]?.value ?? null, tone = toneOf(m, v, room.scale); if (v !== null && tone !== 'ok') found.push({ m, tone, high: isHigh(m, v, room.scale) }); }
  if (!found.length) return null;
  const many = found.length > 1, ventSaid = found.some(x => x.m === 'humidity' && x.high) && room.ventOn;
  const words = found.flatMap(({ m, tone, high }) => m === 'co2' ? (many ? [tk(t, tone === 'bad' ? 'veryStuffy' : 'stuffy')] : room.windowOpen ? (tone === 'bad' ? [tk(t, 'veryStuffy'), tk(t, 'airing')] : [tk(t, 'stuffyAiring')]) : [tk(t, tone === 'bad' ? 'veryStuffyOpen' : 'stuffyOpen')]) : m === 'pm25' ? (room.purifierOn ? [tk(t, 'dustyCleaning')] : room.purifierOff ? [tk(t, 'dusty'), tk(t, 'purifierOff')] : [tk(t, 'dusty')]) : m === 'humidity' ? [tk(t, high ? (room.ventOn ? 'humidVent' : room.windowOpen && !many ? 'humidAiring' : 'humidHint') : 'dryHint')] : [tk(t, high ? 'hotHint' : 'coldHint')]);
  if (many && room.windowOpen && found.some(x => x.m === 'co2' || (x.m === 'humidity' && x.high && !room.ventOn))) words.push(tk(t, 'airing')); // said once, at the end of the line
  return { text: words.map((w, i) => i ? w.toLocaleLowerCase() : w).join(', '), tone: found.some(x => x.tone === 'bad') ? 'bad' : 'warn', saysVent: ventSaid };
}
/** The readings that speak on a row: all of them in a counted room. The storeroom stays out of the sentence and the means, and on its row says only what its vent can act on, while it has something to offer or runs (owner's table, docs/AIR.md). */
const heardOf = (room: AirRoom, actions: AirAction[]): Metric[] => !room.excluded ? ['co2', 'pm25', 'humidity', 'temperature'] : actions.length || room.ventOn ? [...(room.allowed.includes('dehumidify') ? ['humidity' as Metric] : []), ...(room.allowed.includes('purify') ? ['pm25' as Metric] : [])] : [];
export interface AirProps { registry: Registry; rooms: Rooms; host: Host; t: T; lang: Lang }
/** The tile: the sentence and four numbers, tinted by how the air is. */
function AirTile({ registry, rooms, host, t, lang, onOpen }: AirProps & { onOpen?: () => void }) {
  const s = airSummary(registry, rooms), cells = metricsOf(s, t, lang), { tasks } = useTasks(host, registry, 30000), stuck = stuckOf(tasks), { main, tail } = stuck ? { main: tk(t, 'stuckVent', { room: s.rooms.find(r => r.id === stuck.roomId)?.name ?? '' }), tail: null } : sentenceParts(s, t, lang, host.online, 'tileGood'), tone: AirTone = stuck ? 'bad' : lookOf(s, host.online);
  useEffect(() => { sweepRefusals(host, rooms, registry); }); // the button can go and come back with the sheet closed, and only the tile sees it
  return <div className={`ah-tile hm-card at-air-tile is-${tone}`} data-module-card="air"><button type="button" className="ah-tile-hit at-air-hit" onClick={onOpen} disabled={!onOpen}><span className="at-air-tile-cloud"><Cloud tone={tone} /></span><span className="at-air-tile-head"><strong>{tk(t, 'title')}</strong><small>{main}{tail && <>{'\u00a0·'} <span className="at-air-nb">{tail}</span></>}</small></span><span className="at-air-cells">{cells.map(c => <span className={`at-air-cell is-${c.tone}`}><b>{c.value}{c.key !== 'co2' && c.key !== 'pm25' && <Unit unit={c.unit} />}</b><small>{c.short}</small>{(c.note ?? c.place) && <small>{c.note ?? c.place}</small>}{toneWord(c.tone, t)}</span>)}</span></button></div>;
}
const ACTION: Record<AirActionKind, string> = { dehumidify: 'act.dehumidify', purify: 'act.purify' };
const RUNNING: Record<AirActionKind, string> = { dehumidify: 'run.dehumidify', purify: 'run.purify' };
const untilValue = (kind: AirActionKind, target: number, t: T) => kind === 'dehumidify' ? `${target}%` : `${target}\u00a0${tk(t, 'pmUnit')}`;
const FITS: Record<Metric, AirActionKind[]> = { co2: [], pm25: ['purify'], humidity: ['dehumidify'], temperature: [] };
const controlOf = (x: { roomId: string; kind: string; device: string }) => `${x.roomId}:${x.kind}:${x.device}`;
const outcomeText = (x: AirTask, t: T) => tk(t, `outcome.${x.outcome}`, { v: untilValue(x.kind, x.target, t) });
/** Commands on their way, per device. They outlive the sheet: closed and opened again during the wait, it must not offer the button as if nothing were sent. */
interface Press { kind: 'start' | 'stop'; control: string }
/** jobs: what was pressed, per device. errors: how the last press was refused, on that same button, until the next press of the device or the job it was about moves on: it outlives the sheet, and stays for someone who has turned away from a wall panel. */
interface Pending { jobs: Map<string, Press>; errors: Map<string, Press & { key: Key; /** what the house threw, when the card has no words of its own for it: said by `errorText` in the language on screen */ cause?: unknown }>; listeners: Set<() => void>; set(device: string, press: Press | null): void }
const PENDING = new WeakMap<Host, Pending>();
function pendingOf(host: Host): Pending {
  let p = PENDING.get(host);
  if (!p) { const made: Pending = { jobs: new Map(), errors: new Map(), listeners: new Set(), set(device, press) { if (press) made.jobs.set(device, press); else made.jobs.delete(device); made.listeners.forEach(f => f()); } }; PENDING.set(host, made); p = made; }
  return p;
}
/** The jobs the integration is running; looked at while the panel is open and in sight, with a connection. Null until the first answer: no job known is not «no jobs». A failed read keeps the last list; failed says the first one has not come and a read has already failed. */
/** A vent that was told to stop and still has not: the owner's red alarm, until the device itself reads off, when useTasks drops the row. */
const isStuck = (x: AirTask) => x.outcome === 'no_stop';
const stuckOf = (tasks: AirTask[] | null) => tasks?.find(isStuck) ?? null;
/** The last list anyone was told, per host: the sheet opens with what the tile knows, and a failed read keeps the alarm. */
const LAST = new WeakMap<Host, AirTask[]>();
/** The alarms that are over, per host: the tile's copy, the sheet's and the one opened from LAST all drop them. */
const OVER = new WeakMap<Host, Set<string>>();
const overOf = (host: Host) => { let over = OVER.get(host); if (!over) OVER.set(host, over = new Set()); return over; };
/** A refusal stays until it stops being about anything: the job appeared or ended, or the button is no longer offered. By the freshest list anyone has: the tile's own can be 30 s old, and would take a refused Stop for a job it has not heard of. No list known yet decides nothing. */
function sweepRefusals(host: Host, rooms: Rooms, registry: Registry) {
  const errors = pendingOf(host).errors, list = LAST.get(host); if (!errors.size || !list) return;
  const live = list.filter(x => !x.outcome), offered = new Set(airSummary(registry, rooms).rooms.flatMap(r => airActions(r, registry)).map(controlOf));
  for (const [device, e] of errors) { const job = live.some(x => x.device === device); if (e.kind === 'start' ? job || !offered.has(e.control) : !job) errors.delete(device); }
}
function useTasks(host: Host, registry: Registry, every = 5000) {
  const [tasks, setTasks] = useState<AirTask[] | null>(host.airTasks ? LAST.get(host) ?? null : []), [failed, setFailed] = useState(false), load = useRef<() => Promise<void> | undefined>(() => undefined), seen = useRef<string | null>(null);
  seen.current ??= LAST.has(host) ? JSON.stringify(LAST.get(host)) : '';
  useEffect(() => { let alive = true; load.current = () => host.airTasks?.().then(v => { if (!alive) return; if (v === null) { if (!seen.current) setFailed(true); return; } LAST.set(host, v); setFailed(false); const key = JSON.stringify(v); if (key !== seen.current) { seen.current = key; setTasks(v); } }); void load.current(); const tick = () => { if (!document.hidden && host.online) void load.current(); }, timer = setInterval(tick, every); document.addEventListener('visibilitychange', tick); return () => { alive = false; clearInterval(timer); document.removeEventListener('visibilitychange', tick); }; }, [host, every]);
  const wasOnline = useRef(host.online); useEffect(() => { if (host.online && !wasOnline.current) void load.current(); wasOnline.current = host.online; }); // back on the line: read at once
  const kept = useRef<AirTask[] | null>(null); kept.current = withoutEndedAlarms(tasks, overOf(host), registry, kept.current);
  return { tasks: kept.current, failed, refresh: () => load.current() };
}
/** A refusal in words. The card's own sentences first (device offline, busy, starting, not allowed); for anything else the house's reason as
 * every other card says it («Дом отклонил команду: …», «Нет связи с домом»), and the card's plain «Команда не прошла» only when there is none.
 * Nothing goes to the console: the line on the button is the report. */
export function refusalText(refused: { key: Key; cause?: unknown }, t: T): string {
  if (refused.cause === undefined) return t(refused.key);
  const said = errorText(refused.cause, t); return said === t('error.command') ? t(refused.key) : said;
}
function ActionButton({ action, task, ended, roomName, showRoom, registry, host, t, lang, onChange, big }: { action: AirAction | null; task: AirTask | null; /** how this vent's last job ended: said where the promise would stand, since the same promise failed */ ended?: AirTask | null; roomName: string; showRoom?: boolean; registry: Registry; host: Host; t: T; lang: Lang; onChange: () => Promise<void> | undefined; big?: boolean }) {
  const item = task ?? action; if (!item) return null;
  const device = item.device, control = controlOf(item), side = task ? 'stop' : 'start', pending = pendingOf(host), press = pending.jobs.get(device) ?? null, mine = press?.control === control && press.kind === side, refused = pending.errors.get(device), error = refused?.control === control && refused.kind === side ? refusalText(refused, t) : '';
  const run = async (kind: 'start' | 'stop', fn: () => Promise<void> | undefined, from: HTMLElement) => { if (pending.jobs.has(device)) return; /* the button stays locked until the list shows the job, so a second tap cannot send it again */ const root = from.getRootNode() as Document | ShadowRoot, reveal = () => requestAnimationFrame(() => root.querySelector(`.at-air-sheet [data-air-control="${control}"]`)?.scrollIntoView({ block: 'nearest' })); /* what the press brought must not land under the sheet's fade, wherever the job's row now stands. Only after a press: opening a sheet with a job moves nothing. The panel lives in a shadow root, so document cannot find it */ pending.errors.delete(device); if (!host.online) { pending.errors.set(device, { kind, control, key: 'ui.offline' }); pending.set(device, null); reveal(); return; } pending.set(device, { kind, control }); try { await fn(); await onChange(); } catch (e) { const key = airErrorKey(e); pending.errors.set(device, { kind, control, key: `module.air.${key}` as Key, ...(key === 'failed' ? { cause: e } : {}) }); void onChange(); /* a refused Stop leaves the job stopping: show it now */ } finally { pending.set(device, null); } reveal(); };
  const named = (label: string) => roomName ? `${label}, ${roomName}` : label, alert = <div className="at-air-error" role="alert">{error}</div>, pulse = mine && <span className="at-air-pulse" aria-hidden="true" />, lock = press ? { 'aria-disabled': true, ...(mine ? { 'aria-busy': true } : {}) } : {}; // a press on the same vent locks its other button too, which keeps its own words
  const reason = !host.online ? (big ? null : t('ui.offline')) : null; // the hero says it once, above the button
  if (task) { const away = deviceAway(registry, task.device), caption = !host.online ? reason : away ? tk(t, 'deviceOffline') : task.stopping ? tk(t, 'stillOn') : task.wasOn ? tk(t, 'staysOn') : tk(t, 'untilTime', { v: untilValue(task.kind, task.target, t), time: new Intl.DateTimeFormat(TEMP_LOCALE[lang], { hour: '2-digit', minute: '2-digit' }).format(task.startedAt + 3600000) }), stopLabel = mine && !task.wasOn ? tk(t, 'stopping') : tk(t, task.wasOn ? 'stopWatching' : 'stop'); return <div className={`at-air-task ${big ? 'is-big' : ''}`} data-air-control={control}><span className="at-air-pulse" aria-hidden="true" /><span className="at-air-task-text"><strong>{task.stopping ? tk(t, 'stopping') : tk(t, RUNNING[task.kind])}{showRoom && roomName ? ` · ${roomName}` : ''}</strong>{caption && <small>{caption}</small>}</span>{!task.stopping && <button type="button" className={`hm-pill at-air-stop ${mine ? 'is-pending' : ''}`} aria-label={named(stopLabel)} disabled={!host.online} {...lock} onClick={e => void run('stop', () => host.airStop?.(task.device), e.currentTarget)}>{pulse}{stopLabel}</button>}{alert}</div>; }
  const why = !host.online ? reason : action!.blocked ? tk(t, 'deviceOffline') : ended ? outcomeText(ended, t) : tk(t, 'untilNorm', { v: untilValue(action!.kind, action!.target, t) }), label = mine ? tk(t, 'starting') : tk(t, ACTION[action!.kind]);
  return <div className={`at-air-act ${big ? 'is-big' : ''}`} data-air-control={control}><button type="button" className={`hm-pill at-air-do ${mine ? 'is-pending' : ''}`} aria-label={named(label)} disabled={!host.online || !!action!.blocked} {...lock} onClick={e => void run('start', () => host.airStart?.({ kind: action!.kind, roomId: action!.roomId, device: action!.device, sensor: action!.sensor, target: action!.target }), e.currentTarget)}>{pulse}{label}</button>{why && (ended ? <small className="at-air-hint is-warn" data-air-outcome={ended.outcome}>{why}</small> : <small>{why}</small>)}{alert}</div>;
}
function RoomCard({ room, registry, host, t, lang, tasks, onChange, skip, shownAbove, endedAbove }: { room: AirRoom; registry: Registry; host: Host; t: T; lang: Lang; tasks: AirTask[] | null; onChange: () => Promise<void> | undefined; skip?: AirActionKind | null; shownAbove?: AirTask | null; endedAbove?: AirTask | null }) {
  const live = (tasks ?? []).filter(x => !x.outcome), ended = (tasks ?? []).filter(x => x.outcome && x.roomId === room.id && x !== endedAbove && !(x.outcome === 'no_start' && registry.states[x.device]?.state === 'on')), running = live.filter(x => x.roomId === room.id && x !== shownAbove), all = airActions(room, registry), actions = tasks ? all.filter(a => !live.some(x => x.device === a.device) && a.kind !== skip) : []; // one job at a time on one vent; none offered until the list is known
  const heard = heardOf(room, all), hint = roomHint(room, heard, t), toneIf = (m: Metric): Tone => heard.includes(m) ? toneOf(m, room[m]?.value ?? null, room.scale) : 'ok';
  const slots: Array<[Metric, string | null, Tone, string]> = [['temperature', readingText(room, 'temperature', lang), toneIf('temperature'), tk(t, 'temperature')], ['humidity', readingText(room, 'humidity', lang), toneIf('humidity'), tk(t, 'humidity')], ['co2', readingText(room, 'co2', lang), toneIf('co2'), 'CO₂'], ['pm25', readingText(room, 'pm25', lang), toneIf('pm25'), 'PM2.5']]; // the columns are these four, whatever else the room holds
  const readings = [room.temperature, room.humidity, room.co2, room.pm25].filter(r => r), dead = readings.some(r => r!.value === null), allDead = readings.length > 0 && readings.every(r => r!.value === null), tone = ended.some(isStuck) ? 'bad' : hint?.tone; // the room the red alarm names is red, whatever its air says
  return <section className={`at-air-room ${tone ? `is-${tone}` : ''} ${room.excluded ? 'is-excluded' : ''}`} data-room={room.id}><div className="at-air-room-head"><div className="at-air-room-name"><h3>{room.name}</h3>{room.windowOpen && <small className="at-air-open"><Glyph name="window" size={14} />{tk(t, 'windowOpen')}</small>}{hint && <small className={`at-air-hint is-${hint.tone}`}>{hint.text}</small>}{room.ventOn && !hint?.saysVent && <small className="at-air-hint is-muted">{tk(t, 'ventRunning')}</small>}{dead && <small className="at-air-hint is-muted">{tk(t, allDead ? 'sensorsOffline' : 'sensorOffline')}</small>}{room.excluded && !allDead && <small className="at-air-hint is-muted">{tk(t, 'notCounted')}</small>}{ended.map(x => <small className={`at-air-hint is-${isStuck(x) ? 'bad' : 'warn'}`} data-air-outcome={x.outcome}>{outcomeText(x, t)}</small>)}</div><div className="at-air-values">{slots.map(c => c[1] === null ? <span className="at-air-value is-none" /> : <span className={`at-air-value is-${c[2]}`}><b>{c[1]}</b><small className={c[0] === 'temperature' || c[0] === 'humidity' ? 'at-air-vh' : undefined}>{c[3]}</small>{toneWord(c[2], t)}</span>)}</div></div>
    {(actions.length > 0 || running.length > 0) && <div className="at-air-acts">{running.map(x => <ActionButton key={controlOf(x)} action={null} task={x} roomName={room.name} registry={registry} host={host} t={t} lang={lang} onChange={onChange} />)}{actions.map(a => <ActionButton key={controlOf(a)} action={a} task={null} roomName={room.name} registry={registry} host={host} t={t} lang={lang} onChange={onChange} />)}</div>}</section>;
}
const WEATHER: Record<string, string> = { sunny: 'sunny', 'clear-night': 'clear', partlycloudy: 'partly', cloudy: 'cloudy', rainy: 'rainy', pouring: 'rainy', snowy: 'snowy', fog: 'fog', windy: 'windy' };
/** The panel: the same numbers large, then each room with what it holds, and the devices that change the air right where they stand. */
export function AirSheet({ registry, rooms, host, t, lang, onClose }: AirProps & { onClose: () => void; wide?: boolean }) {
  const s = airSummary(registry, rooms), cells = metricsOf(s, t, lang), { tasks, failed, refresh } = useTasks(host, registry), w = registry.states['weather.forecast_home'], wT = typeof w?.attributes.temperature === 'number' ? w.attributes.temperature : null, wKey = w ? WEATHER[w.state] : undefined, counted = s.rooms.filter(r => !r.excluded), excluded = s.rooms.filter(r => r.excluded), nameOf = (id: string) => s.rooms.find(r => r.id === id)?.name ?? '', stuck = stuckOf(tasks), parts = stuck ? { main: tk(t, 'stuckVent', { room: nameOf(stuck.roomId) }), tail: null } : sentenceParts(s, t, lang, host.online), tone: AirTone = stuck ? 'bad' : lookOf(s, host.online);
  const live = (tasks ?? []).filter(x => !x.outcome), mainRoom = s.problem?.room ?? null, topTask = (mainRoom ? live.find(x => x.roomId === mainRoom.id) : live.find(x => counted.some(r => r.id === x.roomId))) ?? null, topAction = mainRoom && tasks && !topTask ? airActions(mainRoom, registry).find(a => FITS[s.problem!.metric].includes(a.kind) && !live.some(x => x.device === a.device)) ?? null : null;
  const elsewhere = (x: { roomId: string } | null) => !!stuck && x?.roomId !== stuck.roomId, mainTask = elsewhere(topTask) ? null : topTask, mainAction = elsewhere(topAction) ? null : topAction; // the alarm names one room: a control of another goes back to its own named row
  const endedAbove = mainAction && host.online && !mainAction.blocked ? (tasks ?? []).find(x => x.outcome && x.outcome !== 'no_stop' && x.device === mainAction.device && x.kind === mainAction.kind) ?? null : null; // the failure stands where the owner pressed
  const unknownJobs = tasks === null && failed && host.online && !!mainRoom && mainRoom.vents.length > 0 && mainRoom.allowed.some(k => FITS[s.problem!.metric].includes(k)); // a slow first answer shows nothing; a failed one is not the same as a room with no vent
  // a command on its way draws here, whichever sheet sent it
  const [, redraw] = useState(0), latest = useRef(refresh); latest.current = refresh;
  useEffect(() => { const p = pendingOf(host), on = () => { redraw(n => n + 1); void latest.current(); }; p.listeners.add(on); return () => { p.listeners.delete(on); }; }, [host]);
  useEffect(() => { sweepRefusals(host, rooms, registry); });
  // one place that tells a screen reader how jobs go; it exists before there is anything to say. Every line of a poll, each with its room; the no-break space that comes and goes makes a repeat a change.
  const [said, setSaid] = useState(''), before = useRef<AirTask[] | null>(null), flip = useRef(false), wasOnline = useRef(host.online), alarm = useRef<AirTask | null>(null), say = (line: string) => { flip.current = !flip.current; setSaid(flip.current ? line : `${line}\u00a0`); };
  useEffect(() => {
    const lines: string[] = [], line = (x: AirTask, text: string) => lines.push(nameOf(x.roomId) ? `${nameOf(x.roomId)}: ${text}` : text);
    if (wasOnline.current !== host.online) { lines.push(host.online ? tk(t, 'said.online') : t('ui.offline')); wasOnline.current = host.online; }
    if (tasks !== null) {
      const old = before.current, ringing = alarm.current, reading = ringing && !stuck ? registry.states[ringing.device]?.state : undefined, job = live.some(x => x.device === ringing?.device); before.current = tasks;
      alarm.current = stuck ?? (reading && reading !== 'off' && !job ? ringing : null); // the list can come before the reading: the end waits for it. Another vent taking over, or a new job on this one, is not this vent's end
      if (old) { const same = (a: AirTask, b: AirTask) => a.device === b.device && a.startedAt === b.startedAt && !a.outcome === !b.outcome; for (const x of tasks) { const was = old.find(y => same(y, x)); if (!was) line(x, x.outcome ? outcomeText(x, t) : tk(t, RUNNING[x.kind])); else if (x.stopping && !was.stopping) line(x, tk(t, 'stopping')); } for (const y of old) if (!y.outcome && !tasks.some(x => same(x, y)) && !tasks.some(x => x.outcome && x.device === y.device && x.startedAt === y.startedAt)) line(y, tk(t, 'said.ended')); if (ringing && reading === 'off' && !job) line(ringing, tk(t, 'said.alarmOver')); }
    }
    if (lines.length) say(lines.join('. '));
  }, [tasks, host.online, alarm.current && registry.states[alarm.current.device]?.state]);
  // a button the draw replaces or disables hands its focus on, to what replaces it or, with nothing there, to the sheet's own close button
  const root = useRef<HTMLDivElement>(null), activeIn = () => (root.current?.getRootNode() as Document | ShadowRoot | undefined)?.activeElement ?? null, focused = activeIn()?.closest?.('[data-air-control]')?.getAttribute('data-air-control') ?? null;
  useLayoutEffect(() => { const el = root.current, now = activeIn(); if (!focused || !el || (now && el.contains(now) && !now.matches(':disabled'))) return; const next = [...el.querySelectorAll<HTMLElement>('[data-air-control]')].find(x => x.dataset.airControl === focused)?.querySelector<HTMLButtonElement>('button:not(:disabled)') ?? el.querySelector<HTMLButtonElement>('.hm-icon-btn'); next?.focus(); });
  return <div ref={root} className={`hm-sheet-body ah-sheet at-air-sheet is-${tone}`} data-kind="air" data-module-card="air">
    <div className="at-air-vh" role="status">{said}</div>
    <div className="hm-sheet-head at-fd-head"><div><h2>{tk(t, 'title')}</h2>{w && wT !== null && <small>{tk(t, 'outside', { t: num(wT, lang, 0) })}{wKey ? ` · ${tk(t, `sky.${wKey}`)}` : ''}</small>}</div><button type="button" className="hm-icon-btn" aria-label={t('ui.closeSheet')} onClick={onClose}>×</button></div>
    <div className="at-air-hero"><div className="at-air-hero-top"><div className="at-air-hero-text"><p className="at-air-sentence">{parts.main}{parts.tail && <small className="at-air-tail"><span className="at-air-vh">, </span>{parts.tail}</small>}</p>{!host.online && (s.problem || stuck) && <small className="at-air-state">{t('ui.offline')}</small>}{unknownJobs && <small className="at-air-state">{tk(t, 'tasksUnknown')}</small>}{(mainAction || mainTask) && <ActionButton key={controlOf((mainTask ?? mainAction)!)} action={mainAction} task={mainTask} ended={endedAbove} roomName={nameOf((mainTask ?? mainAction)!.roomId)} showRoom={!!mainTask && !stuck && s.problem?.room.id !== mainTask.roomId} registry={registry} host={host} t={t} lang={lang} onChange={refresh} big />}</div><Cloud tone={tone} /></div><div className="at-air-big">{cells.map(c => <div className={`is-${c.tone}`}><b>{c.value}<Unit unit={c.unit} /></b><small>{c.label}</small>{c.note && <small className="at-air-cover">{c.note}</small>}{toneWord(c.tone, t)}</div>)}</div></div>
    <div className="at-air-rooms">{s.rooms.some(r => [r.temperature, r.humidity, r.co2, r.pm25].some(x => x && x.value !== null)) && <div className="at-air-columns" aria-hidden="true"><span /><span>{tk(t, 'tempShort')}</span><span>{tk(t, 'humShort')}</span><span>CO₂</span><span>PM2.5</span></div>}{[...counted, ...excluded].map(r => <RoomCard key={r.id} room={r} registry={registry} host={host} t={t} lang={lang} tasks={tasks} onChange={refresh} skip={r.id === mainRoom?.id ? mainAction?.kind : null} shownAbove={mainTask} endedAbove={endedAbove} />)}</div>
  </div>;
}
export const air: ModuleDef = {
  ...airSpec, sheetKey: 'air',
  Card(props) { return <AirTile registry={props.registry} rooms={props.rooms ?? []} host={props.host} t={props.t} lang={props.lang} onOpen={props.onOpen} />; },
};
export type { AirProblem };
