import { useEffect, useRef, useState } from 'preact/hooks';
import type { ModuleDef } from './types.ts';
import { airSpec } from './catalog.ts';
import { num } from '../ui/format.ts';
import type { Key, T } from '../i18n/index.ts';
import type { Lang } from '../ui/format.ts';
import type { Host } from '../runtime/host.ts';
import type { Registry } from '../model/registry.ts';
import { airActions, airSummary, inRoomRu, toneOf, type AirAction, type AirActionKind, type AirProblem, type AirRoom, type AirSummary, type AirTask, type Metric, type Span, type Tone } from '../model/air.ts';
type Rooms = Array<{ id: string; name: string }>;
const tk = (t: T, k: string, params?: Record<string, string | number>) => t(`module.air.${k}` as Key, params);
const inRoom = (name: string, lang: Lang, t: T) => lang === 'ru' ? inRoomRu(name) : tk(t, 'inRoom', { room: name });
/** The one sentence: the worst thing and where, and what is already being done about it. */
export function airSentence(s: AirSummary, t: T, lang: Lang): string {
  const p = s.problem; if (!p) return tk(t, 'allGood');
  const word: Record<Metric, string> = { co2: p.tone === 'bad' ? 'veryStuffy' : 'stuffy', pm25: 'dusty', humidity: p.high ? 'humid' : 'dry', temperature: p.high ? 'hot' : 'cold' };
  const base = `${tk(t, word[p.metric])} ${inRoom(p.room.name, lang, t)}`;
  if (p.room.ventOn && p.metric === 'humidity') return `${base} · ${tk(t, 'ventRunning')}`;
  if (p.room.windowOpen && p.metric !== 'pm25') return `${base} · ${tk(t, 'airing')}`;
  if (p.room.purifierOn && p.metric === 'pm25') return `${base} · ${tk(t, 'cleaning')}`;
  return base;
}
/** The house's little cloud: content when the air is good, uneasy at a warning, frowning when it is bad. Same family as the feeder's cat. */
function Cloud({ tone, label }: { tone: Tone; label?: string }) {
  const a11y = label ? { role: 'img' as const, 'aria-label': label } : { 'aria-hidden': true };
  return <svg className={`at-air-cloud is-${tone}`} viewBox="0 0 140 104" {...a11y}><g className="at-air-breeze" fill="none" stroke="currentColor" stroke-width="4" stroke-linecap="round"><path d="M112 22q10-7 18 0" /><path d="M118 38q7-5 14 0" /></g>
    <path className="at-air-cloud-body" d="M38 90a26 26 0 0 1-4-52 34 34 0 0 1 64-9 25 25 0 0 1 8 61z" />
    {tone === 'ok' ? <path d="M50 54q6-8 12 0M78 54q6-8 12 0" fill="none" stroke="#2b3a44" stroke-width="4" stroke-linecap="round" /> : <g fill="#2b3a44"><ellipse cx="56" cy="52" rx="5.5" ry="6.5" /><ellipse cx="84" cy="52" rx="5.5" ry="6.5" /><circle cx="54" cy="49.5" r="1.8" fill="#fff" /><circle cx="82" cy="49.5" r="1.8" fill="#fff" /></g>}
    {tone === 'bad' && <path d="M47 42l13-4M93 42l-13-4" stroke="#2b3a44" stroke-width="3.4" stroke-linecap="round" />}
    <ellipse cx="44" cy="63" rx="7" ry="4.5" fill="#ff8f7a" opacity=".45" /><ellipse cx="96" cy="63" rx="7" ry="4.5" fill="#ff8f7a" opacity=".45" />
    {tone === 'ok' ? <path d="M62 66q8 7 16 0" fill="none" stroke="#2b3a44" stroke-width="3.4" stroke-linecap="round" /> : tone === 'warn' ? <path d="M64 68h12" stroke="#2b3a44" stroke-width="3.4" stroke-linecap="round" /> : <path d="M62 71q8-7 16 0" fill="none" stroke="#2b3a44" stroke-width="3.4" stroke-linecap="round" />}</svg>;
}
const GLYPH: Record<string, string> = { window: 'M5 3h14v18H5zM12 3v18M5 12h14', wave: 'M3 8c3-2.5 6 2.5 9 0s6 2.5 9 0M3 14c3-2.5 6 2.5 9 0s6 2.5 9 0', drop: 'M12 3s7 7.2 7 12a7 7 0 0 1-14 0c0-4.8 7-12 7-12z', fan: 'M12 12c0-4 1-8 4-8s3 4-4 8zM12 12c4 0 8 1 8 4s-4 3-8-4zM12 12c0 4-1 8-4 8s-3-4 4-8zM12 12c-4 0-8-1-8-4s4-3 8 4z', sun: 'M12 16a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM12 2v2M12 20v2M2 12h2M20 12h2' };
const Glyph = ({ name, size = 20 }: { name: string; size?: number }) => <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d={GLYPH[name]} /></svg>;
const fmt = (v: number | null, lang: Lang, digits = 0) => v === null ? '—' : num(v, lang, digits);
const spanNote = (s: Span, t: T) => s.used < s.total ? tk(t, 'ofRooms', { a: s.used, b: s.total }) : null;
/** The hero's and the tile's numbers: a reading only when there is a sensor at all. */
function metricsOf(s: AirSummary, t: T, lang: Lang) {
  const out: Array<{ key: string; value: string; unit: string; label: string; note: string | null; tone: Tone }> = [];
  if (s.temperature.total) out.push({ key: 'temperature', value: fmt(s.temperature.value, lang, 1), unit: '°', label: tk(t, 'temperature'), note: spanNote(s.temperature, t), tone: 'ok' });
  if (s.humidity.total) out.push({ key: 'humidity', value: fmt(s.humidity.value, lang, 0), unit: '%', label: tk(t, 'humidity'), note: spanNote(s.humidity, t), tone: 'ok' });
  if (s.co2.total) out.push({ key: 'co2', value: fmt(s.co2.value, lang, 0), unit: 'ppm', label: s.co2.room ? `CO₂ · ${s.co2.room}` : 'CO₂', note: spanNote(s.co2, t), tone: toneOf('co2', s.co2.value) });
  if (s.pm25.total) out.push({ key: 'pm25', value: fmt(s.pm25.value, lang, 0), unit: tk(t, 'pmUnit'), label: s.pm25.room ? `PM2.5 · ${s.pm25.room}` : 'PM2.5', note: spanNote(s.pm25, t), tone: toneOf('pm25', s.pm25.value) });
  return out;
}
const readingText = (room: AirRoom, metric: 'temperature' | 'humidity' | 'co2' | 'pm25' | 'voc', lang: Lang) => { const r = room[metric]; if (!r || r.value === null) return null; return metric === 'temperature' ? `${num(r.value, lang, 1)}°` : metric === 'humidity' ? `${num(r.value, lang, 0)}%` : num(r.value, lang, 0); };
/** Everything the room says about itself, in one line of words: empty when all is well. */
function roomHint(room: AirRoom, t: T): { text: string; tone: Tone } | null {
  const order: Metric[] = ['co2', 'pm25', 'humidity', 'temperature'];
  for (const m of order) { const v = room[m]?.value ?? null, tone = toneOf(m, v, room.bath); if (v === null || tone === 'ok' || room.excluded) continue; const high = m === 'humidity' ? v > (room.bath ? 75 : 60) : m === 'temperature' ? v > 25 : true; if (m === 'co2') return { text: room.windowOpen ? tk(t, 'stuffyAiring') : tk(t, 'stuffyOpen'), tone }; if (m === 'pm25') return { text: tk(t, room.purifierOn ? 'dustyCleaning' : 'dusty'), tone }; if (m === 'humidity') return { text: tk(t, high ? (room.ventOn ? 'humidVent' : room.windowOpen ? 'humidAiring' : 'humidHint') : 'dryHint'), tone }; return { text: tk(t, high ? 'hotHint' : 'coldHint'), tone }; }
  return null;
}
export interface AirProps { registry: Registry; rooms: Rooms; host: Host; t: T; lang: Lang }
/** The tile: the sentence and four numbers, tinted by how the air is. */
function AirTile({ registry, rooms, t, lang, onOpen }: AirProps & { onOpen?: () => void }) {
  const s = airSummary(registry, rooms), cells = metricsOf(s, t, lang);
  return <div className={`ah-tile hm-card at-air-tile is-${s.tone}`} data-module-card="air"><button type="button" className="ah-tile-hit at-air-hit" onClick={onOpen} disabled={!onOpen}><span className="at-air-tile-cloud"><Cloud tone={s.tone} /></span><span className="at-air-tile-head"><strong>{tk(t, 'title')}</strong><small>{s.problem ? airSentence(s, t, lang) : tk(t, 'tileGood')}</small></span><span className="at-air-cells">{cells.map(c => <span className={`at-air-cell is-${c.tone}`}><b>{c.value}{c.key !== 'co2' && c.key !== 'pm25' && <i>{c.unit}</i>}</b><small>{c.note ?? (c.key === 'temperature' ? tk(t, 'tempShort') : c.key === 'humidity' ? c.label : c.label.split(' · ')[1] ? `${c.key === 'co2' ? 'CO₂' : 'PM2.5'} · ${c.label.split(' · ')[1]}` : c.label)}</small></span>)}</span></button></div>;
}
const ACTION: Record<AirActionKind, string> = { dehumidify: 'act.dehumidify', humidify: 'act.humidify', purify: 'act.purify', ventilate: 'act.ventilate' };
const RUNNING: Record<AirActionKind, string> = { dehumidify: 'run.dehumidify', humidify: 'run.humidify', purify: 'run.purify', ventilate: 'run.ventilate' };
const UNIT: Record<AirActionKind, string> = { dehumidify: '%', humidify: '%', purify: ' мкг/м³', ventilate: ' ppm' };
const FITS: Record<Metric, AirActionKind[]> = { co2: ['ventilate'], pm25: ['purify'], humidity: ['dehumidify', 'humidify'], temperature: [] };
/** The jobs the integration is running; looked at while the panel is open. */
function useTasks(host: Host) {
  const [tasks, setTasks] = useState<AirTask[]>([]), load = useRef(() => {});
  useEffect(() => { let alive = true; load.current = () => { void host.airTasks?.().then(v => { if (alive) setTasks(v); }); }; load.current(); const timer = setInterval(() => load.current(), 5000); return () => { alive = false; clearInterval(timer); }; }, [host]);
  return { tasks, refresh: () => load.current() };
}
function ActionButton({ action, task, host, t, lang, onChange, big }: { action: AirAction | null; task: AirTask | null; host: Host; t: T; lang: Lang; onChange: () => void; big?: boolean }) {
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  const run = async (fn: () => Promise<void> | undefined) => { if (busy) return; setBusy(true); setError(''); try { await fn(); onChange(); } catch (e) { setError(`${tk(t, 'failed')}: ${e instanceof Error ? e.message : String((e as { message?: unknown })?.message ?? e)}`); } finally { setBusy(false); } };
  if (task) return <div className={`at-air-task ${big ? 'is-big' : ''}`} role="status"><span className="at-air-pulse" aria-hidden="true" /><span className="at-air-task-text"><strong>{tk(t, RUNNING[task.kind])}</strong><small>{tk(t, 'untilNorm', { v: `${task.target}${UNIT[task.kind]}` })}</small></span><button type="button" className="hm-pill at-air-stop" disabled={busy} onClick={() => void run(() => host.airStop?.(task.device))}>{tk(t, 'stop')}</button>{error && <small className="at-air-error">{error}</small>}</div>;
  if (!action) return null;
  const why = action.blocked === 'no_water' ? tk(t, 'noWater') : action.blocked === 'offline' ? tk(t, 'deviceOffline') : null;
  return <div className={`at-air-act ${big ? 'is-big' : ''}`}><button type="button" className="hm-pill at-air-do" disabled={busy || !!action.blocked} aria-busy={busy} onClick={() => void run(() => host.airStart?.({ kind: action.kind, roomId: action.roomId, device: action.device, sensor: action.sensor, target: action.target }))}>{tk(t, ACTION[action.kind])}</button><small>{why ?? tk(t, 'untilNorm', { v: `${action.target}${UNIT[action.kind]}` })}</small>{error && <small className="at-air-error">{error}</small>}</div>;
}
function RoomCard({ room, registry, host, t, lang, tasks, onChange, skip }: { room: AirRoom; registry: Registry; host: Host; t: T; lang: Lang; tasks: AirTask[]; onChange: () => void; skip?: AirActionKind | null }) {
  const hint = roomHint(room, t), last: 'pm25' | 'voc' = !room.pm25 && room.voc ? 'voc' : 'pm25', running = tasks.filter(x => x.roomId === room.id), actions = airActions(room, registry).filter(a => !running.some(x => x.device === a.device && x.kind === a.kind) && a.kind !== skip);
  const slots: Array<[string, string | null, Tone, string]> = [['temperature', readingText(room, 'temperature', lang), room.excluded ? 'ok' : toneOf('temperature', room.temperature?.value ?? null), tk(t, 'temperature')], ['humidity', readingText(room, 'humidity', lang), room.excluded ? 'ok' : toneOf('humidity', room.humidity?.value ?? null, room.bath), tk(t, 'humidity')], ['co2', readingText(room, 'co2', lang), toneOf('co2', room.co2?.value ?? null), 'CO₂'], [last, readingText(room, last, lang), last === 'pm25' ? toneOf('pm25', room.pm25?.value ?? null) : 'ok', last === 'pm25' ? 'PM2.5' : tk(t, 'voc')]];
  const dead = [room.temperature, room.humidity, room.co2, room.pm25].some(r => r && r.value === null);
  return <section className={`at-air-room ${hint ? `is-${hint.tone}` : ''} ${room.excluded ? 'is-excluded' : ''}`} data-room={room.id}><div className="at-air-room-head"><div className="at-air-room-name"><strong>{room.name}</strong>{room.windowOpen && <small className="at-air-open"><Glyph name="window" size={14} />{tk(t, 'windowOpen')}</small>}{hint && <small className={`at-air-hint is-${hint.tone}`}>{hint.text}</small>}{dead && <small className="at-air-hint is-muted">{tk(t, 'sensorOffline')}</small>}{room.excluded && <small className="at-air-hint is-muted">{tk(t, 'notCounted')}</small>}</div><div className="at-air-values">{slots.map(c => c[1] === null ? <span className="at-air-value is-none" /> : <span className={`at-air-value is-${c[2]}`} aria-label={`${c[3]}: ${c[1]}`}><b>{c[1]}</b>{c[0] !== 'temperature' && c[0] !== 'humidity' && <small>{c[3]}</small>}</span>)}</div></div>
    {(actions.length > 0 || running.length > 0) && <div className="at-air-acts">{running.map(x => <ActionButton action={null} task={x} host={host} t={t} lang={lang} onChange={onChange} />)}{actions.map(a => <ActionButton action={a} task={null} host={host} t={t} lang={lang} onChange={onChange} />)}</div>}</section>;
}
const WEATHER: Record<string, string> = { sunny: 'sunny', 'clear-night': 'clear', partlycloudy: 'partly', cloudy: 'cloudy', rainy: 'rainy', pouring: 'rainy', snowy: 'snowy', fog: 'fog', windy: 'windy' };
/** The panel: the same numbers large, then each room with what it holds, and the devices that change the air right where they stand. */
export function AirSheet({ registry, rooms, host, t, lang, onClose }: AirProps & { onClose: () => void; wide?: boolean }) {
  const s = airSummary(registry, rooms), cells = metricsOf(s, t, lang), { tasks, refresh } = useTasks(host), w = registry.states['weather.forecast_home'], wT = typeof w?.attributes.temperature === 'number' ? w.attributes.temperature : null, wKey = w ? WEATHER[w.state] : undefined, counted = s.rooms.filter(r => !r.excluded), excluded = s.rooms.filter(r => r.excluded);
  const mainRoom = s.problem?.room ?? null, mainTask = mainRoom ? tasks.find(x => x.roomId === mainRoom.id) ?? null : null, mainAction = mainRoom && !mainTask ? airActions(mainRoom, registry).find(a => FITS[s.problem!.metric].includes(a.kind)) ?? null : null;
  return <div className={`hm-sheet-body ah-sheet at-air-sheet is-${s.tone}`} data-kind="air" data-module-card="air">
    <div className="hm-sheet-head at-fd-head"><div><h2>{tk(t, 'title')}</h2>{w && wT !== null && <small>{tk(t, 'outside', { t: num(wT, lang, 0) })}{wKey ? ` · ${tk(t, `sky.${wKey}`)}` : ''}</small>}</div><button type="button" className="hm-icon-btn" aria-label={t('ui.close')} onClick={onClose}>×</button></div>
    <div className="at-air-hero"><div className="at-air-hero-top"><div className="at-air-hero-text"><p className="at-air-sentence">{airSentence(s, t, lang)}</p>{(mainAction || mainTask) && <ActionButton action={mainAction} task={mainTask} host={host} t={t} lang={lang} onChange={refresh} big />}</div><Cloud tone={s.tone} label={airSentence(s, t, lang)} /></div><div className="at-air-big">{cells.map(c => <div className={`is-${c.tone}`}><b>{c.value}<i>{c.unit}</i></b><small>{c.label}</small>{c.note && <small className="at-air-cover">{c.note}</small>}</div>)}</div></div>
    <div className="at-air-rooms"><div className="at-air-columns" aria-hidden="true"><span /><span>{tk(t, 'tempShort')}</span><span>{tk(t, 'humShort')}</span><span>CO₂</span><span>PM2.5</span></div>{[...counted, ...excluded].map(r => <RoomCard room={r} registry={registry} host={host} t={t} lang={lang} tasks={r.id === mainRoom?.id ? tasks.filter(x => x !== mainTask) : tasks} onChange={refresh} skip={r.id === mainRoom?.id ? mainAction?.kind : null} />)}</div>
  </div>;
}
export const air: ModuleDef = {
  ...airSpec, sheetKey: 'air',
  Card(props) { return <AirTile registry={props.registry} rooms={props.rooms ?? []} host={props.host} t={props.t} lang={props.lang} onOpen={props.onOpen} />; },
};
export type { AirProblem };
