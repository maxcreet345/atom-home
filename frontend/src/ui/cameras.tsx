import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import type { JSX } from 'preact';
import { Icon } from './primitives.tsx';
import type { HomeDevice } from '../model/discover.ts';
import type { Host } from '../runtime/host.ts';
import type { T, Key } from '../i18n/index.ts';
import { locales, type Lang } from './format.ts';
import type { TileState } from '../modules/types.ts';
import { ago, historyEvents, TONE, topEvent, type CamEvent, type CamEventKind, type CamSensor } from '../model/cameras.ts';
/** One camera of the house as the Cameras card and panel see it: its card, a short name, what it reports now, the sensors behind it. */
export interface CamView { device: HomeDevice; name: string; state: TileState | null; events: CamEvent[]; sensors: CamSensor[]; online: boolean }
type Player = (dev: HomeDevice, mode: 'tile' | 'stage') => JSX.Element | null;
const ICON: Record<CamEventKind, string> = { ring: 'bell', person: 'person', vehicle: 'car', pet: 'paw', motion: 'motion' };
const clock = (at: number, lang: Lang) => new Intl.DateTimeFormat(locales[lang], { hour: '2-digit', minute: '2-digit' }).format(at);
/** «сейчас» / «5 мин назад» / «23:41»: a ring reads as its time, a detection as how long ago (it is still going on or just ended). */
function whenText(e: CamEvent, now: number, t: T, lang: Lang) {
  if (e.active) return t('cams.now');
  if (e.kind === 'ring') return clock(e.at, lang);
  const a = ago(e.at, now); return a.unit === 'now' ? t('cams.justNow') : a.unit === 'min' ? t('cams.agoMin', { n: a.n }) : clock(e.at, lang);
}
const kindText = (k: CamEventKind, t: T) => t(`cams.kind.${k}` as Key);
/** The card's second line: the worst fresh event, else cameras without a link, else «Тихо · 4 камеры». */
export function camerasLine(views: CamView[], now: number, t: T, lang: Lang): { text: string; tone: 'danger' | 'warning' | 'active' | 'muted' | null; top: CamEvent | null } {
  const top = topEvent(views.flatMap(v => v.events), now);
  if (top) { const v = views.find(x => x.device.key === top.camera); return { text: `${kindText(top.kind, t)} · ${v?.name ?? ''} · ${whenText(top, now, t, lang)}`, tone: TONE[top.kind], top }; }
  const off = views.filter(v => !v.online).length;
  if (off) return { text: t('cams.offline', { n: off }), tone: 'muted', top: null };
  return { text: `${t('cams.quiet')} · ${t('cams.count', { n: views.length })}`, tone: null, top: null };
}
/** A frame that stays fresh without a stream: the camera's HA still, re-read every 10 s while the screen is shown. */
function Still({ device, host }: { device: HomeDevice; host: Host }) {
  const pic = typeof device.primary.attributes.entity_picture === 'string' ? device.primary.attributes.entity_picture : null;
  const fake = host.previewFrame?.(device.primary.id) ?? null;
  const [n, setN] = useState(0), [broken, setBroken] = useState(false);
  useEffect(() => { if (fake || !pic) return; const i = setInterval(() => { if (!document.hidden) setN(x => x + 1); }, 10_000); return () => clearInterval(i); }, [pic, fake]);
  const src = fake ?? (pic ? pic + (n ? `${pic.includes('?') ? '&' : '?'}r=${n}` : '') : null);
  return src && !broken ? <img className="at-cams-still" src={src} alt="" loading="lazy" onError={() => setBroken(true)} /> : <span className="at-cams-none"><Icon name="camera" size={18} /></span>;
}
/** Home card (owner, 09.11.2026: «карточка и панель камеры»): one camera big — the one where something is happening, else the doorbell — the others small, every one live on its light stream; the worst event in words. */
export function CamerasTile({ views, focus, player, host, now, t, lang, onPanel, onCamera }: { views: CamView[]; focus: CamView; player: Player; host: Host; now: number; t: T; lang: Lang; onPanel: () => void; onCamera: (key: string) => void }) {
  const line = camerasLine(views, now, t, lang), others = views.filter(v => v !== focus);
  const hot = (v: CamView) => topEvent(v.events, now);
  const closed = focus.state?.closed === true;
  return <div className={`ah-tile hm-card at-cams-tile ${line.tone ? `is-${line.tone}` : ''}`} data-focus={focus.device.key}>
    <button type="button" className="at-cams-main" onClick={() => onCamera(focus.device.key)}>
      <span className="hm-camera-frame">{closed ? <span className="hm-camera-wait"><Icon name="camera" size={28} /><span>{t('module.camera.closed')}</span></span> : player(focus.device, 'tile') ?? <Still device={focus.device} host={host} />}</span>
      <span className="at-cams-name"><b>{focus.name}</b>{hot(focus) && <i className={`tone-${TONE[hot(focus)!.kind]}`}><Icon name={ICON[hot(focus)!.kind]} size={14} />{kindText(hot(focus)!.kind, t)}</i>}</span>
    </button>
    {others.length > 0 && <div className="at-cams-strip" style={`--n:${others.length}`}>{others.map(v => { const e = hot(v); return <button type="button" className={`at-cams-thumb ${v.online ? '' : 'is-off'} ${e ? `tone-${TONE[e.kind]}` : ''}`} aria-label={`${v.name}${e ? ` · ${kindText(e.kind, t)}` : ''}`} onClick={() => onCamera(v.device.key)}>
      <span className="hm-camera-frame">{v.state?.closed ? <span className="at-cams-none"><Icon name="camera" size={18} /></span> : player(v.device, 'tile') ?? <Still device={v.device} host={host} />}</span>{e && <i className="at-cams-dot"><Icon name={ICON[e.kind]} size={12} /></i>}<small>{v.name}</small></button>; })}</div>}
    <button type="button" className="at-cams-caption" onClick={onPanel}><Icon name="camera" size={18} /><span><strong>{t('cams.title')}</strong><small>{line.text}</small></span><Icon name="next" size={18} /></button>
  </div>;
}
type Filter = 'all' | 'ring' | 'person' | 'motion';
const IN_FILTER: Record<Filter, (k: CamEventKind) => boolean> = { all: () => true, ring: k => k === 'ring', person: k => k === 'person' || k === 'vehicle' || k === 'pet', motion: k => k === 'motion' };
/** The Cameras panel: every camera live in one grid, what each reports on it, and one list of rings and detections of the last day from HA's recorder. */
export function CamerasPanel({ views, player, host, now, t, lang, wide, onCamera }: { views: CamView[]; player: Player; host: Host; now: number; t: T; lang: Lang; wide: boolean; onCamera: (key: string) => void }) {
  const line = camerasLine(views, now, t, lang), online = views.filter(v => v.online).length;
  const [filter, setFilter] = useState<Filter>('all'), [events, setEvents] = useState<CamEvent[] | null>(null);
  const sensors = useMemo(() => views.flatMap(v => v.sensors.map(s => ({ ...s, camera: v.device.key }))), [views.map(v => v.sensors.map(s => s.id).join()).join('|')]);
  const hostRef = useRef(host); hostRef.current = host;
  const pulse = views.map(v => v.events.map(e => `${e.kind}${e.at}${e.active}`).join()).join('|'); // a new ring or detection re-reads the list
  useEffect(() => {
    const ws = hostRef.current.ws; if (!ws || !sensors.length) { setEvents([]); return; }
    let gone = false; const end = new Date(), start = new Date(end.getTime() - 24 * 3_600_000);
    ws({ type: 'history/history_during_period', start_time: start.toISOString(), end_time: end.toISOString(), entity_ids: sensors.map(s => s.id), minimal_response: true, no_attributes: true, significant_changes_only: false })
      .then(raw => { if (!gone) setEvents(historyEvents(raw, sensors, start.getTime())); }).catch(() => { if (!gone) setEvents(e => e ?? []); });
    return () => { gone = true; };
  }, [sensors, pulse]);
  const counts = (f: Filter) => (events ?? []).filter(e => IN_FILTER[f](e.kind)).length;
  const list = (events ?? []).filter(e => IN_FILTER[filter](e.kind)).slice(0, 60);
  const nameOf = (key: string) => views.find(v => v.device.key === key)?.name ?? '';
  const today = new Date(now).toDateString();
  return <div className={`at-cams ${wide ? 'is-wide' : ''}`} data-cameras={views.length}>
    <div className={`at-cams-summary ${line.tone ? `is-${line.tone}` : ''}`} role="status"><span className="at-cams-state">{line.top ? <Icon name={ICON[line.top.kind]} size={18} /> : <Icon name="check" size={18} />}{line.text}</span><small>{online === views.length ? t('cams.allOnline', { n: views.length }) : t('cams.someOnline', { n: online, all: views.length })}</small></div>
    <div className="at-cams-grid" style={`--n:${views.length}`}>{views.map(v => { const e = topEvent(v.events, now), closed = v.state?.closed === true; return <div className={`at-cams-cell hm-card ${e ? `tone-${TONE[e.kind]}` : ''} ${v.online ? '' : 'is-off'}`} data-device-key={v.device.key}>
      <button type="button" className="at-cams-hit" aria-label={`${t('ui.open')}: ${v.name}`} onClick={() => onCamera(v.device.key)} />
      <div className="hm-camera-frame">{closed ? <div className="hm-camera-wait"><Icon name="camera" size={28} /><span>{t('module.camera.closed')}</span></div> : player(v.device, 'tile') ?? <Still device={v.device} host={host} />}</div>
      <div className="at-cams-cap"><strong>{v.name}</strong><small>{e ? `${kindText(e.kind, t)} · ${whenText(e, now, t, lang)}` : !v.online ? t('module.camera.offline') : v.state?.line ?? t('cams.quiet')}</small></div>
      {e && <span className={`at-cams-flag tone-${TONE[e.kind]}`}><Icon name={ICON[e.kind]} size={14} />{kindText(e.kind, t)}</span>}
    </div>; })}</div>
    <section className="at-cams-events hm-card" aria-label={t('cams.events')}>
      <header><h2>{t('cams.events')}</h2><small>{t('cams.lastDay')}</small></header>
      <div className="ah-segments at-cams-filter" role="tablist">{(['all', 'ring', 'person', 'motion'] as Filter[]).map(f => <button type="button" role="tab" aria-selected={filter === f} className={filter === f ? 'is-active' : ''} onClick={() => setFilter(f)}>{t(`cams.filter.${f}` as Key)}{events && <b>{counts(f)}</b>}</button>)}</div>
      {events === null ? <p className="at-cams-empty">{t('cams.loading')}</p> : !list.length ? <p className="at-cams-empty">{t(filter === 'all' ? 'cams.noEvents' : 'cams.noEventsKind')}</p> : <ol className="at-cams-list">{list.map((e, i) => { const day = new Date(e.at).toDateString(), head = i === 0 || new Date(list[i - 1].at).toDateString() !== day;
        return <>{head && <li className="at-cams-day" aria-hidden="true">{day === today ? t('cams.today') : t('cams.yesterday')}</li>}<li><button type="button" className={`at-cams-ev tone-${TONE[e.kind]}`} onClick={() => onCamera(e.camera)}><span className="at-cams-ev-icon"><Icon name={ICON[e.kind]} size={16} /></span><span className="at-cams-ev-text"><strong>{kindText(e.kind, t)}</strong><small>{nameOf(e.camera)}</small></span><time>{clock(e.at, lang)}</time></button></li></>; })}</ol>}
    </section>
  </div>;
}
