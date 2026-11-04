import { useEffect, useRef, useState } from 'preact/hooks';
import type { JSX } from 'preact';
import type { Host } from '../runtime/host.ts';
import type { T, Key } from '../i18n/index.ts';
import type { Lang } from '../ui/format.ts';
import { Icon } from '../ui/primitives.tsx';
import { parseHistory, mediaRoot, parseMediaDay, mergeEvents, dayFolders, when, clock, type DoorEvent, type DoorFile } from './doorbell-state.ts';
/** Events of an entrance camera: rings and motion from the recorder plus the snapshots and clips HA's automations saved under /media/<dir>/<day>/. Shared by the doorbell and the C700 sheets. */
export interface Feed {
  events: DoorEvent[] | null; merged: DoorEvent[] | null; list: DoorEvent[]; rings: number; motions: number;
  filter: 'all' | 'ring' | 'motion'; setFilter(f: 'all' | 'ring' | 'motion'): void;
  days: string[]; day: string | null; setDay(d: string | null): void; dayFiles: DoorFile[] | null;
  urls: Record<string, string>; playing: { event: DoorEvent; url: string; video: boolean } | null; setPlaying(p: { event: DoorEvent; url: string; video: boolean } | null): void; open(e: DoorEvent): void;
}
export function useEventFeed(host: Host, entities: { ring?: string; motion?: string }, mediaDir: string, ringState: string | undefined, onFail: (message: string) => void): Feed {
  const [events, setEvents] = useState<DoorEvent[] | null>(null);
  const [files, setFiles] = useState<DoorFile[]>([]), [days, setDays] = useState<string[]>([]), [day, setDay] = useState<string | null>(null), [dayFiles, setDayFiles] = useState<DoorFile[] | null>(null);
  const [urls, setUrls] = useState<Record<string, string>>({}), [playing, setPlaying] = useState<{ event: DoorEvent; url: string; video: boolean } | null>(null);
  const [filter, setFilter] = useState<'all' | 'ring' | 'motion'>('all');
  // The shell hands a fresh host object to every render: keep it in a ref so the effects depend only on the entities and the last ring.
  const hostRef = useRef(host); hostRef.current = host;
  const ring = entities.ring, motion = entities.motion;
  useEffect(() => {
    if (!hostRef.current.ws || (!ring && !motion)) { setEvents([]); return; }
    let gone = false;
    const fetchEvents = () => { const ws = hostRef.current.ws; if (!ws) return; const end = new Date(), start = new Date(end.getTime() - 7 * 86_400_000);
      ws({ type: 'history/history_during_period', start_time: start.toISOString(), end_time: end.toISOString(), entity_ids: [ring, motion].filter(Boolean), minimal_response: true, no_attributes: true, significant_changes_only: false }).then(rows => { if (!gone) setEvents(parseHistory(rows, { ring, motion }, start.getTime())); }).catch(() => { if (!gone) setEvents(e => e ?? []); }); };
    const id = setTimeout(fetchEvents, 1500); fetchEvents();
    return () => { gone = true; clearTimeout(id); };
  }, [ring, motion, ringState]);
  const browse = (id: string) => hostRef.current.ws!<{ children?: unknown }>({ type: 'media_source/browse_media', media_content_id: id }).then(r => Array.isArray(r?.children) ? r.children as Array<Record<string, unknown>> : []);
  // The last week's day folders, re-read a while after a ring (the clip needs ~15 s).
  useEffect(() => {
    if (!hostRef.current.ws) return;
    let gone = false;
    const load = async () => {
      try {
        const root = await browse(mediaRoot(mediaDir));
        const have = new Set(root.map(c => typeof c.title === 'string' ? c.title : '').filter(Boolean));
        if (!gone) setDays([...have].filter(d => /^\d{4}-\d{2}-\d{2}$/.test(d)).sort().reverse());
        const want = dayFolders(Date.now()).filter(d => have.has(d));
        const lists = await Promise.all(want.map(d => browse(`${mediaRoot(mediaDir)}/${d}`).then(ch => parseMediaDay(d, ch)).catch(() => [] as DoorFile[])));
        if (!gone) setFiles(lists.flat());
      } catch { if (!gone) setFiles([]); }
    };
    void load(); const t1 = setTimeout(load, 20000);
    return () => { gone = true; clearTimeout(t1); };
  }, [mediaDir, ringState]);
  useEffect(() => {
    if (!day || !hostRef.current.ws) { setDayFiles(null); return; }
    let gone = false; setDayFiles(null);
    browse(`${mediaRoot(mediaDir)}/${day}`).then(ch => { if (!gone) setDayFiles(parseMediaDay(day, ch)); }).catch(() => { if (!gone) setDayFiles([]); });
    return () => { gone = true; };
  }, [day, mediaDir]);
  const resolve = (id: string) => { if (urls[id] || !hostRef.current.ws) return; hostRef.current.ws<{ url?: string }>({ type: 'media_source/resolve_media', media_content_id: id }).then(r => { if (typeof r?.url === 'string') setUrls(u => u[id] ? u : { ...u, [id]: r.url! }); }).catch(() => undefined); };
  const merged = events === null ? null : mergeEvents(events, files);
  const list = (merged ?? []).filter(e => filter === 'all' || e.kind === filter).slice(0, 30);
  const rings = (merged ?? []).filter(e => e.kind === 'ring').length, motions = (merged ?? []).filter(e => e.kind === 'motion').length;
  useEffect(() => { for (const e of list) if (e.snapshot) resolve(e.snapshot); }, [list.map(e => e.snapshot).join(',')]);
  useEffect(() => { for (const f of dayFiles ?? []) if (f.type === 'jpg') resolve(f.id); }, [dayFiles]);
  const open = (e: DoorEvent) => { const id = e.clip ?? e.snapshot; if (!id) return; const go = (url: string) => setPlaying({ event: e, url, video: !!e.clip }); if (urls[id]) go(urls[id]); else hostRef.current.ws?.<{ url?: string }>({ type: 'media_source/resolve_media', media_content_id: id }).then(r => { if (typeof r?.url === 'string') { setUrls(u => ({ ...u, [id]: r.url! })); go(r.url); } }).catch(() => onFail('clipFail')); };
  return { events, merged, list, rings, motions, filter, setFilter, days, day, setDay, dayFiles, urls, playing, setPlaying, open };
}
type Tx = (k: string, p?: Record<string, string | number>) => string;
const tx = (t: T): Tx => (k, p) => t(k as Key, p);
/** What plays on the stage instead of the live picture while a clip or a snapshot is open. */
export function ClipStage({ feed, t, lang }: { feed: Feed; t: T; lang: Lang }): JSX.Element | null {
  const p = feed.playing; if (!p) return null; const x = tx(t), now = Date.now();
  return <>{p.video ? <video className="at-door-clip" src={p.url} autoPlay controls playsInline /> : <img className="at-door-clip" src={p.url} alt="" />}<div className="at-door-clip-top"><span className={`at-door-clip-kind is-${p.event.kind}`}>{x(p.event.kind === 'ring' ? 'module.doorbell.ringEvent' : 'module.doorbell.motionEvent')}</span><span>{when(p.event.at, now, x, lang)}</span><button type="button" className="hm-pill at-door-live-btn" onClick={() => feed.setPlaying(null)}>{x('module.doorbell.toLive')}</button></div></>;
}
/** The week of events with thumbnails, the filter and the archive button. */
export function FeedList({ feed, t, lang, onArchive }: { feed: Feed; t: T; lang: Lang; onArchive(): void }): JSX.Element {
  const x = tx(t), now = Date.now();
  return <div className="ah-rows at-door-events"><div className="ah-row at-cam-title"><small>{x('module.doorbell.events')}</small></div>
    <div className="at-door-seg" role="tablist">{(['all', 'ring', 'motion'] as const).map(f => <button type="button" role="tab" aria-selected={feed.filter === f} className={feed.filter === f ? 'is-on' : ''} onClick={() => feed.setFilter(f)}>{f === 'all' ? t('ui.all') : f === 'ring' ? `${x('module.doorbell.rings')} · ${feed.rings}` : `${x('module.doorbell.motions')} · ${feed.motions}`}</button>)}</div>
    {feed.events === null ? <div className="at-cam-kv"><span>{x('module.doorbell.loading')}</span></div> : feed.list.length === 0 ? <div className="at-cam-kv"><span>{x('module.doorbell.noEvents')}</span></div>
      : feed.list.map(e => { const Row = e.clip || e.snapshot ? 'button' : 'div'; return <Row type={Row === 'button' ? 'button' : undefined} className={`ah-row at-door-ev is-${e.kind} ${Row === 'button' ? 'at-door-row-btn' : ''} ${feed.playing?.event === e ? 'is-playing' : ''}`} onClick={Row === 'button' ? () => feed.open(e) : undefined}>{e.snapshot ? <span className="at-door-th">{feed.urls[e.snapshot] ? <img src={feed.urls[e.snapshot]} alt="" loading="lazy" /> : null}{e.clip && <b>{x('module.doorbell.clipLen')}</b>}</span> : <span className="ah-row-icon" style={`--tile:${e.kind === 'ring' ? '#ff3b30' : '#0a84ff'}`}><Icon name={e.kind === 'ring' ? 'bell' : 'motion'} size={18} /></span>}<span className="ah-row-text"><strong>{x(e.kind === 'ring' ? 'module.doorbell.ringEvent' : 'module.doorbell.motionEvent')}</strong><small>{e.clip ? x('module.doorbell.clipAndSnap') : e.snapshot ? x('module.doorbell.snapOnly') : x('module.doorbell.noFiles')}</small></span><small className="at-door-when">{when(e.at, now, x, lang)}</small></Row>; })}
    {feed.merged !== null && feed.merged.length > feed.list.length && <div className="at-cam-kv"><span>{x('module.doorbell.moreEvents', { n: feed.merged.length })}</span></div>}
    {feed.days.length > 0 && <button type="button" className="ah-row at-door-row-btn" onClick={() => { feed.setDay(feed.days[0]); onArchive(); }}><span className="ah-row-icon" style="--tile:#8e8e93"><Icon name="image" size={18} /></span><span className="ah-row-text"><strong>{x('module.doorbell.archive')}</strong><small>{x('module.doorbell.archiveNote', { n: feed.days.length })}</small></span><Icon name="next" size={18} /></button>}
  </div>;
}
/** The archive: a row of days and the day's grid of thumbnails. */
export function ArchiveGrid({ feed, t, lang, onPlayed }: { feed: Feed; t: T; lang: Lang; onPlayed(): void }): JSX.Element {
  const x = tx(t), now = Date.now();
  return <>
    {feed.days.length > 1 && <div className="at-door-days">{feed.days.slice(0, 14).map(d => <button type="button" className={`hm-pill ${feed.day === d ? 'is-primary' : ''}`} onClick={() => feed.setDay(d)}>{when(Date.parse(d + 'T12:00:00'), now, x, lang).replace(/\s\d\d:\d\d$/, '').replace(/,?\s*\d\d:\d\d/, '')}</button>)}</div>}
    {feed.dayFiles === null ? <p className="at-feeder-note at-cam-note">{x('module.doorbell.loading')}</p> : feed.dayFiles.length === 0 ? <p className="at-feeder-note at-cam-note">{x('module.doorbell.noEvents')}</p>
      : <div className="at-door-grid">{mergeEvents([], feed.dayFiles).filter(e => feed.filter === 'all' || e.kind === feed.filter).map(e => <button type="button" className={`at-door-cell is-${e.kind}`} onClick={() => { feed.open(e); onPlayed(); }}>{e.snapshot && feed.urls[e.snapshot] ? <img src={feed.urls[e.snapshot]} alt="" loading="lazy" /> : <span className="at-door-cell-empty"><Icon name={e.kind === 'ring' ? 'bell' : 'motion'} size={22} /></span>}<small>{clock(e.at, lang)}{e.clip ? ' · ' + x('module.doorbell.clipLen') : ''}</small></button>)}</div>}
  </>;
}
export function ArchiveHead({ feed, t, title, onBack, onClose }: { feed: Feed; t: T; title: string; onBack(): void; onClose?: () => void }): JSX.Element {
  const x = tx(t);
  return <div className="hm-sheet-head"><button type="button" className="hm-icon-btn" aria-label={t('ui.back')} onClick={onBack}><Icon name="back" size={22} /></button><div><small>{title}</small><h2>{x('module.doorbell.archive')}</h2></div><div className="at-door-seg is-head" role="tablist">{(['all', 'ring', 'motion'] as const).map(f => <button type="button" role="tab" aria-selected={feed.filter === f} className={feed.filter === f ? 'is-on' : ''} onClick={() => feed.setFilter(f)}>{f === 'all' ? t('ui.all') : f === 'ring' ? x('module.doorbell.rings') : x('module.doorbell.motions')}</button>)}</div>{onClose && <button type="button" className="hm-icon-btn" aria-label={t('ui.close')} onClick={onClose}>×</button>}</div>;
}
