import { useEffect, useRef, useState } from 'preact/hooks';
import type { ComponentChildren } from 'preact';
import type { ModuleDef, ModuleSheetProps } from './types.ts';
import { doorbellSpec } from './catalog.ts';
import { doorbellClaims, doorbellTileState, autoOpenSeconds, posterEnabled, when, clock, readFrame, AUTO_OPEN_CHOICES } from './doorbell-state.ts';
import { useEventFeed, ClipStage, FeedList, ArchiveGrid, ArchiveHead } from './event-feed.tsx';
import { SettingRow } from '../ui/sheet.tsx';
import { Go2rtcView } from './go2rtc-view.tsx';
import { Icon } from '../ui/primitives.tsx';
import { Switch } from '../ui/cards.tsx';
import { entityActions, type Action } from '../runtime/actions.ts';
import type { EntityRef } from '../model/discover.ts';
import { domainOf, type Registry } from '../model/registry.ts';
import type { Key } from '../i18n/index.ts';

function refOf(registry: Registry, id: string | undefined): EntityRef | null {
  if (!id) return null; const s = registry.states[id]; if (!s) return null;
  const a = s.attributes;
  return { id, domain: domainOf(id), deviceClass: typeof a.device_class === 'string' ? a.device_class : null, name: typeof a.friendly_name === 'string' ? a.friendly_name : id, kind: null, state: s.state, attributes: a, unit: typeof a.unit_of_measurement === 'string' ? a.unit_of_measurement : null, available: s.state !== 'unavailable', lastChanged: s.last_changed };
}
const stamp = () => { const d = new Date(), p = (n: number) => String(n).padStart(2, '0'); return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`; };
const Title = ({ children }: { children: ComponentChildren }) => <div className="ah-row at-cam-title"><small>{children}</small></div>;
const KV = ({ k, v }: { k: string; v: ComponentChildren }) => <div className="at-cam-kv"><span>{k}</span><small>{v}</small></div>;
const fmt = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;

/** The doorbell sheet: live video with sound, six tools, the last week of rings and motion from HA's logbook, battery and identify; settings page with auto-open and diagnostics. */
function DoorbellSheet({ device, registry, entities, options, host, t, lang, runner, onClose, room, stage, wide, setOption, autoClose }: ModuleSheetProps) {
  const [page, setPage] = useState<'main' | 'settings' | 'archive'>('main');
  const [note, setNote] = useState('');
  const mediaDir = options.mediaDir && /^[\w-]{1,40}$/.test(options.mediaDir) ? options.mediaDir : 'doorbell';
  const stageRef = useRef<HTMLDivElement>(null);
  const tx = (k: string, p?: Record<string, string | number>) => t(k as Key, p);
  const ref = (role: string) => refOf(registry, entities[role]);
  const busy = runner.busy.has(device.key);
  const roomShown = room && !device.name.trim().toLowerCase().endsWith(room.trim().toLowerCase()) ? room : '';
  const pic = typeof device.primary.attributes.entity_picture === 'string' ? device.primary.attributes.entity_picture : null;
  const ring = ref('ring'), motion = ref('motion'), battery = ref('battery'), identify = ref('identify');
  const now = Date.now();
  const snapshot = async () => {
    if (!pic) return; setNote('');
    try {
      const r = await fetch(pic + (pic.includes('?') ? '&' : '?') + 't=' + Date.now(), { cache: 'no-store' }); if (!r.ok) throw new Error(String(r.status));
      const url = URL.createObjectURL(await r.blob()); const a = document.createElement('a'); a.href = url; a.download = `${device.name.replace(/[^\p{L}\p{N}]+/gu, '-')}-${stamp()}.jpg`; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 10000);
      setNote(tx('module.camera.snapshotSaved'));
    } catch { setNote(tx('module.camera.snapshotFail')); }
  };
  const fullscreen = () => { const el = stageRef.current; if (!el) return; const v = el.querySelector('video') as (HTMLVideoElement & { webkitEnterFullscreen?: () => void }) | null; if (el.requestFullscreen) el.requestFullscreen().catch(() => v?.webkitEnterFullscreen?.()); else v?.webkitEnterFullscreen?.(); };
  useEffect(() => { if (!note) return; const id = setTimeout(() => setNote(''), 4000); return () => clearTimeout(id); }, [note]);
  // The week of rings and motion from HA's recorder (history, the same call the energy sparklines use); refreshed a moment after a new ring arrives.
  const ringState = ring?.state;
  const feed = useEventFeed(host, { ring: entities.ring, motion: entities.motion }, mediaDir, ringState, () => setNote(tx('module.doorbell.clipFail')));
  const playing = feed.playing;
  useEffect(() => { feed.setPlaying(null); }, [autoClose?.left === undefined]);
  /** Mute switches of HomeKit: «on» = muted, so the tool lights up when the thing is audible. */
  const muteTool = (role: string, label: string, icon: string) => {
    const r = ref(role); if (!r) return null; const a = entityActions(r)[0]; if (!a) return null; const audible = r.state !== 'on';
    return <button type="button" className={`at-cam-tool at-door-${role} ${audible ? 'is-on' : ''}`} disabled={busy || !r.available} aria-pressed={audible} onClick={() => void runner.run(device, { ...a, label }, !a.current)}><b><Icon name={icon} size={22} /></b>{label}<small>{audible ? t('state.on') : t('mode.off')}</small></button>;
  };
  const press: Action | null = identify ? { id: 'press', label: tx('module.doorbell.identify'), kind: 'button', domain: 'button', service: 'press', entityId: identify.id, confirm: false, risk: 'normal' } : null;
  const bat = battery && Number.isFinite(Number(battery.state)) ? Number(battery.state) : null;
  const batColor = bat === null ? '#8e8e93' : bat < 20 ? '#ff3b30' : bat < 50 ? '#ff9f0a' : '#30d158';
  const secs = autoOpenSeconds(options), frame = readFrame(options.addon ?? '', options.stream);

  const alarm = !!autoClose; // opened by the ring: one column, video and tools across the whole sheet, nothing else
  const headBtns = <div className="at-cam-head-btns">{page === 'settings' && wide && <button type="button" className="hm-icon-btn" aria-label={t('ui.back')} onClick={() => setPage('main')}><Icon name="back" size={22} /></button>}{page === 'main' && !alarm && <button type="button" className="hm-icon-btn at-cam-gear" aria-label={tx('module.doorbell.settings')} onClick={() => setPage('settings')}><Icon name="gear" size={20} /></button>}<button type="button" className="hm-icon-btn" aria-label={t('ui.close')} onClick={onClose}>×</button></div>;
  const head = page === 'main' || wide
    ? <div className="hm-sheet-head"><span className="hm-sheet-photo"><Icon name="bell" size={30} /></span><div><small>{tx('module.doorbell.kind')}{roomShown ? ` · ${roomShown}` : ''}</small><h2>{device.name}</h2></div>{!wide && headBtns}</div>
    : <div className="hm-sheet-head"><button type="button" className="hm-icon-btn" aria-label={t('ui.back')} onClick={() => setPage('main')}><Icon name="back" size={22} /></button><div><small>{device.name}</small><h2>{tx('module.doorbell.settings')}</h2></div>{headBtns}</div>;
  const banner = autoClose && <div className="at-door-banner" role="status"><Icon name="bell" size={22} /><div><b>{tx('module.doorbell.ringing')}</b><small>{tx('module.doorbell.autoCloseNote')}</small></div><button type="button" className="at-door-stay" onClick={autoClose.keep}>{tx('module.doorbell.keep')}</button><span className="at-door-cnt">{fmt(Math.max(0, autoClose.left))}</span><i className="at-door-bar" style={`--p:${secs ? Math.max(0, Math.min(1, autoClose.left / secs)) : 0}`} /></div>;
  const video = <>
    {banner}
    <div className={`hm-camera-frame at-camera-stage at-cam-stage at-door-stage ${playing ? 'is-clip' : ''}`} ref={stageRef}>{playing
      ? <ClipStage feed={feed} t={t} lang={lang} />
      : stage ?? <div className="hm-camera-wait"><Icon name="bell" size={32} /><span>{device.primary.available ? t('state.idle') : tx('module.camera.noLink')}</span></div>}</div>
    <div className="at-cam-tools">
      <button type="button" className="at-cam-tool at-cam-snapshot" disabled={!pic} onClick={() => void snapshot()}><b><Icon name="camera" size={22} /></b>{tx('module.camera.tool.snapshot')}</button>
      <button type="button" className="at-cam-tool" disabled title={tx('module.doorbell.talkAqara')}><b><Icon name="mic" size={22} /></b>{tx('module.camera.tool.talk')}<small>{tx('module.doorbell.inAqara')}</small></button>
      <button type="button" className="at-cam-tool at-cam-full" disabled={!stage} onClick={fullscreen}><b><Icon name="panel" size={22} /></b>{tx('module.camera.tool.fullscreen')}</button>
      {muteTool('chime', tx('module.doorbell.chime'), 'bell')}{muteTool('mic', tx('module.doorbell.mic'), 'mic')}{muteTool('speaker', tx('module.doorbell.speaker'), 'speaker')}
    </div>
    {note && <p className="at-feeder-note at-cam-note" role="status">{note}</p>}
  </>;
  const main = <>
    {(entities.ring || entities.motion) && <FeedList feed={feed} t={t} lang={lang} onArchive={() => setPage('archive')} />}
    <div className="ah-rows">
      {battery && <div className="ah-row"><span className="ah-row-icon" style={`--tile:${batColor}`}><Icon name="battery" size={18} /></span><span className="ah-row-text"><strong>{tx('module.doorbell.battery')}</strong><small>{bat !== null && bat < 20 ? tx('module.doorbell.charge') : tx('module.doorbell.batteryOk')}</small></span><small className="at-door-when">{bat === null ? '—' : `${bat} %`}</small></div>}
      {press && <button type="button" className="ah-row at-door-row-btn" disabled={busy || !identify?.available} onClick={() => void runner.run(device, press)}><span className="ah-row-icon" style="--tile:#0a84ff"><Icon name="bolt" size={18} /></span><span className="ah-row-text"><strong>{tx('module.doorbell.identify')}</strong><small>{tx('module.doorbell.identifyNote')}</small></span><Icon name="next" size={18} /></button>}
    </div>
  </>;
  const boolRow = (role: string, label: string, icon: string, color: string, sub?: string) => { const r = ref(role); if (!r) return null; const a = entityActions(r)[0]; return a ? <SettingRow device={device} action={{ ...a, label }} runner={runner} t={t} lang={lang} icon={icon} color={color} /> : null; };
  const hasHouse = entities.recordMotion || entities.notifyPhones || entities.notifyStation || entities.hallLight;
  const settings = <>
    {hasHouse && <div className="ah-rows"><Title>{tx('module.doorbell.group.notify')}</Title>{boolRow('notifyPhones', tx('module.doorbell.notifyPhones'), 'phone', '#0a84ff')}{boolRow('notifyStation', tx('module.doorbell.notifyStation'), 'speaker', '#0a84ff')}{boolRow('hallLight', tx('module.doorbell.hallLight'), 'light', '#ff9f0a')}
      <Title>{tx('module.doorbell.group.record')}</Title>{boolRow('recordMotion', tx('module.doorbell.recordMotion'), 'motion', '#30d158')}<KV k={tx('module.doorbell.recordRing')} v={tx('module.doorbell.recordAlways')} /><KV k={tx('module.doorbell.recordWhere')} v={`/media/${mediaDir}`} />{!entities.video && <p className="at-feeder-note at-cam-note">{tx('module.doorbell.noVideoCam')}</p>}</div>}
    <div className="ah-rows"><Title>{tx('module.doorbell.group.autoOpen')}</Title>
      <div className="ah-row hm-setting"><span className="ah-row-icon" style="--tile:#ff3b30"><Icon name="bell" size={18} /></span><span className="ah-row-text"><strong>{tx('module.doorbell.autoOpenRow')}</strong><small>{tx('module.doorbell.autoOpenNote')}</small></span><Switch on={secs > 0} disabled={!setOption} label={tx('module.doorbell.autoOpenRow')} onToggle={() => setOption?.('autoOpen', secs > 0 ? 'off' : 'on')} /></div>
      <div className="at-door-pills">{AUTO_OPEN_CHOICES.map(n => <button type="button" className={`hm-pill ${secs === n ? 'is-primary' : ''}`} disabled={!setOption || secs === 0} aria-pressed={secs === n} onClick={() => setOption?.('autoOpenSec', String(n))}>{n} {tx('module.doorbell.sec')}</button>)}</div>
      <div className="ah-row hm-setting"><span className="ah-row-icon" style="--tile:#7b74d8"><Icon name="image" size={18} /></span><span className="ah-row-text"><strong>{tx('module.doorbell.posterRow')}</strong><small>{tx('module.doorbell.posterNote')}</small></span><Switch on={posterEnabled(options)} disabled={!setOption} label={tx('module.doorbell.posterRow')} onToggle={() => setOption?.('poster', posterEnabled(options) ? 'off' : undefined)} /></div>
      {!setOption && <p className="at-feeder-note at-cam-note">{tx('module.doorbell.adminOnly')}</p>}
    </div>
    <div className="ah-rows"><Title>{t('ui.diagnostics')}</Title>
      {(device.manufacturer || device.model) && <KV k={t('ui.model')} v={[device.manufacturer, device.model].filter(Boolean).join(' · ')} />}
      {battery && <KV k={tx('module.doorbell.battery')} v={bat === null ? '—' : `${bat} %`} />}
      {ring && <KV k={tx('module.doorbell.lastRing')} v={Number.isFinite(Date.parse(ring.state)) ? when(Date.parse(ring.state), now, tx, lang) : '—'} />}
      {motion && <KV k={tx('module.doorbell.lastMotion')} v={Number.isFinite(Date.parse(motion.lastChanged)) ? when(Date.parse(motion.lastChanged), now, tx, lang) : '—'} />}
      <KV k={tx('module.camera.diag.stream')} v={`${options.stream ?? 'auto'} · go2rtc`} />
      <KV k={tx('module.doorbell.lastFrame')} v={frame ? clock(frame.at, lang) : '—'} />
      <p className="at-feeder-note at-cam-note">{tx('module.doorbell.aqaraNote')}</p>
    </div>
  </>;
  const archive = <ArchiveGrid feed={feed} t={t} lang={lang} onPlayed={() => { if (!wide) setPage('main'); }} />;
  const archiveHead = <ArchiveHead feed={feed} t={t} title={device.name} onBack={() => setPage('main')} onClose={wide ? undefined : onClose} />;
  if (alarm) return <div className="hm-sheet-body ah-sheet at-cam at-door is-alarm" data-kind="camera" data-page="alarm"><div className="hm-sheet-head"><span className="hm-sheet-photo"><Icon name="bell" size={30} /></span><div><small>{tx('module.doorbell.kind')}{roomShown ? ` · ${roomShown}` : ''}</small><h2>{device.name}</h2></div>{headBtns}</div>{video}</div>;
  if (wide) return <div className="hm-sheet-body ah-sheet at-cam at-door is-split" data-kind="camera" data-page={page}>
    <div className="at-cam-left">{head}{video}</div>
    <div className="at-cam-right">{page === 'archive' ? <>{archiveHead}{archive}</> : <>{headBtns}{page === 'main' ? main : <><h3 className="at-cam-h3">{tx('module.doorbell.settings')}</h3>{settings}</>}</>}</div>
  </div>;
  if (page === 'archive') return <div className="hm-sheet-body ah-sheet at-cam at-door" data-kind="camera" data-page="archive">{archiveHead}{archive}</div>;
  return <div className="hm-sheet-body ah-sheet at-cam at-door" data-kind="camera" data-page={page}>{head}{page === 'main' ? <>{video}{main}</> : settings}</div>;
}

/** Video doorbell (Aqara G4: RTSP from the repeater through go2rtc, events over HomeKit): live video + sound, rings open the sheet on every device. */
export const doorbell: ModuleDef = {
  ...doorbellSpec,
  Card: () => null,
  claims: doorbellClaims,
  tileState: (registry, entities, t, lang) => doorbellTileState(registry.states, entities, (k, p) => t(k as Key, p), lang),
  alarm: (entities, options) => entities.ring ? { entityId: entities.ring, seconds: autoOpenSeconds(options) } : null,
  Sheet: DoorbellSheet,
  // the G4 runs on mains since 08.11.2026: the tile and the Cameras panel stream it like any camera (it no longer drains a battery)
  sensors: e => [e.ring, e.motion].filter((x): x is string => !!x),
  Player: ({ entities, options, host, t, mode, poster }) => <Go2rtcView options={options} host={host} t={t} mode={mode} poster={poster} webrtcEntity={entities.video} />,
};
