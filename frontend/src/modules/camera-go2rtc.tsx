import { useEffect, useRef, useState } from 'preact/hooks';
import type { ComponentChildren } from 'preact';
import type { ModuleDef, ModuleSheetProps } from './types.ts';
import { cameraGo2rtcSpec, CAMERA_CONTROL_ROLES } from './catalog.ts';
import { cameraClaims, cameraTileState, sdStatusLabel } from './camera-state.ts';
import { Icon } from '../ui/primitives.tsx';
import { Switch } from '../ui/cards.tsx';
import { SettingRow, SliderRow, type Runner } from '../ui/sheet.tsx';
import { entityActions, type Action } from '../runtime/actions.ts';
import type { EntityRef, HomeDevice } from '../model/discover.ts';
import { domainOf, type Registry } from '../model/registry.ts';
import type { T, Key } from '../i18n/index.ts';
import { num, type Lang } from '../ui/format.ts';
import { mountGo2rtcPlayer, mseAvailable, type Player, type PlayerStatus } from './go2rtc-player.ts';

/** A module entity as the sheet rows expect it (name from HA, no kind). */
function refOf(registry: Registry, id: string | undefined): EntityRef | null {
  if (!id) return null; const s = registry.states[id]; if (!s) return null;
  const a = s.attributes;
  return { id, domain: domainOf(id), deviceClass: typeof a.device_class === 'string' ? a.device_class : null, name: typeof a.friendly_name === 'string' ? a.friendly_name : id, kind: null, state: s.state, attributes: a, unit: typeof a.unit_of_measurement === 'string' ? a.unit_of_measurement : null, available: s.state !== 'unavailable', lastChanged: s.last_changed };
}
const stamp = () => { const d = new Date(), p = (n: number) => String(n).padStart(2, '0'); return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`; };

/** Settings-style select row with the module's own option labels. */
function SelectRow({ action, labels, device, runner, disabled, icon, color }: { action: Action; labels: (o: string) => string; device: HomeDevice; runner: Runner; disabled: boolean; icon: string; color: string }) {
  const name = String(action.label);
  return <div className="ah-row hm-setting"><span className="ah-row-icon" style={`--tile:${color}`}><Icon name={icon} size={18} /></span><span className="ah-row-text"><strong>{name}</strong></span>
    <select value={String(action.current ?? '')} disabled={disabled} aria-label={name} onChange={e => void runner.run(device, action, (e.target as HTMLSelectElement).value)}>{!(action.options ?? []).includes(String(action.current ?? '')) && <option value="">—</option>}{(action.options ?? []).map(o => <option value={o}>{labels(o)}</option>)}</select></div>;
}
const Title = ({ children }: { children: ComponentChildren }) => <div className="ah-row at-cam-title"><small>{children}</small></div>;
const KV = ({ k, v }: { k: string; v: ComponentChildren }) => <div className="at-cam-kv"><span>{k}</span><small>{v}</small></div>;

function CameraSheet({ device, registry, entities, options, t, lang, runner, onClose, room, stage, wide }: ModuleSheetProps) {
  const [page, setPage] = useState<'main' | 'settings'>('main');
  const [note, setNote] = useState('');
  const stageRef = useRef<HTMLDivElement>(null);
  const tx = (k: string) => t(k as Key);
  const ref = (role: string) => refOf(registry, entities[role]);
  const act = (role: string, label: string): Action | null => {
    const r = ref(role); if (!r) return null;
    const a = entityActions(r)[0] ?? (r.domain === 'light' ? ({ id: 'toggle', label, kind: 'toggle', domain: 'light', service: 'toggle', entityId: r.id, confirm: false, risk: 'normal', current: r.state === 'on' } satisfies Action) : null);
    return a ? { ...a, label } : null;
  };
  const busy = runner.busy.has(device.key);
  const power = ref('power'), closed = !!power && power.state === 'off', off = !power || !power.available;
  const roomShown = room && !device.name.trim().toLowerCase().endsWith(room.trim().toLowerCase()) ? room : '';
  const hasControls = CAMERA_CONTROL_ROLES.some(r => entities[r.role]);
  const night = act('night', tx('module.camera.night')), hdr = act('hdr', tx('module.camera.hdr'));
  const nightLabel = (o: string) => ({ on: tx('module.camera.night.always'), off: tx('module.camera.night.never'), auto: tx('module.camera.night.auto') } as Record<string, string>)[o.toLowerCase()] ?? o;
  const onOffAuto = (o: string) => ({ 'выкл': t('mode.off'), off: t('mode.off'), 'вкл': t('state.on'), on: t('state.on'), 'авто': t('mode.auto'), auto: t('mode.auto') } as Record<string, string>)[o.toLowerCase()] ?? o;
  const sens = (o: string) => ({ low: tx('module.camera.sens.low'), middle: tx('module.camera.sens.middle'), medium: tx('module.camera.sens.middle'), high: tx('module.camera.sens.high') } as Record<string, string>)[o.toLowerCase()] ?? o;
  const rec = (o: string) => ({ 'no record': tx('module.camera.rec.none'), 'motion record': tx('module.camera.rec.motion'), 'all record': tx('module.camera.rec.all') } as Record<string, string>)[o.toLowerCase()] ?? o;
  const powerAction: Action | null = power ? { id: 'toggle', label: closed ? tx('module.camera.openLens') : tx('module.camera.closeLens'), kind: 'toggle', domain: 'switch', service: closed ? 'turn_on' : 'turn_off', entityId: power.id, confirm: !closed, risk: 'security' } : null;
  const pic = typeof device.primary.attributes.entity_picture === 'string' ? device.primary.attributes.entity_picture : null;
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
  const toggleRow = (role: string, label: string, icon: string, color: string, sub?: string) => { const a = act(role, label); return a ? <SettingRow device={device} action={a} runner={runner} t={t} lang={lang} icon={icon} color={color} /> : null; };
  const selectRow = (role: string, label: string, labels: (o: string) => string, icon = 'more') => { const a = act(role, label); return a && a.kind === 'select' ? <SelectRow action={a} labels={labels} device={device} runner={runner} disabled={busy || off} icon={icon} color="#8e8e93" /> : null; };
  const sliderRow = (role: string, label: string, unit?: string) => { const a = act(role, label); return a && a.kind === 'number' ? <SliderRow device={device} action={unit ? { ...a, unit } : a} runner={runner} t={t} lang={lang} /> : null; };
  const rotation = ref('rotation'), flipped = !!rotation && Number(rotation.state) >= 90;
  const flipAction: Action | null = rotation ? { id: 'value', label: tx('module.camera.flip'), kind: 'number', domain: 'number', service: 'set_value', entityId: rotation.id, confirm: false, risk: 'normal' } : null;
  const info = ref('info')?.attributes ?? {}, funcDev = registry.devices.find(d => d.id === registry.entities.find(e => e.entity_id === entities.power)?.device_id);
  const codec = info['p2p_stream.video_codec'] === 1 ? 'H.265' : info['p2p_stream.video_codec'] === 0 ? 'H.264' : null, audio = ({ 0: 'G711A', 1: 'AAC', 2: 'OPUS', 3: 'PCM' } as Record<number, string>)[Number(info['p2p_stream.audio_codec'])], res = ({ 1: '480p', 3: '1080p', 9: '4K' } as Record<number, string>)[Number(info['p2p_stream.resolution_types'])];
  const sd = ref('sdStatus'), sdFree = ref('sdFree'), sdUsed = ref('sdUsed'), hasCard = !!sd && sd.state.toLowerCase() === 'normal';
  const mb = (r: EntityRef | null) => r && Number.isFinite(Number(r.state)) && Number(r.state) > 0 ? `${num(Number(r.state) / 1024, lang, 1)} GB` : '—';

  const headBtns = <div className="at-cam-head-btns">{page === 'settings' && wide && <button type="button" className="hm-icon-btn" aria-label={t('ui.back')} onClick={() => setPage('main')}><Icon name="back" size={22} /></button>}{hasControls && page === 'main' && <button type="button" className="hm-icon-btn at-cam-gear" aria-label={tx('module.camera.settings')} onClick={() => setPage('settings')}><Icon name="gear" size={20} /></button>}<button type="button" className="hm-icon-btn" aria-label={t('ui.close')} onClick={onClose}>×</button></div>;
  const head = page === 'main' || wide
    ? <div className="hm-sheet-head"><span className="hm-sheet-photo"><Icon name="camera" size={30} /></span><div><small>{t('kind.camera')}{roomShown ? ` · ${roomShown}` : ''}</small><h2>{device.name}</h2></div>{!wide && headBtns}</div>
    : <div className="hm-sheet-head"><button type="button" className="hm-icon-btn" aria-label={t('ui.back')} onClick={() => setPage('main')}><Icon name="back" size={22} /></button><div><small>{device.name}</small><h2>{tx('module.camera.settings')}</h2></div>{headBtns}</div>;
  const cycle = (a: Action) => { const opts = a.options ?? []; const i = opts.indexOf(String(a.current ?? '')); return opts[(i + 1) % opts.length]; };
  const nightNowLabel = night && night.kind === 'select' && night.current ? nightLabel(String(night.current)) : null, hdrNowLabel = hdr && hdr.kind === 'select' && hdr.current ? onOffAuto(String(hdr.current)) : null;
  const video = <>
    <div className="hm-camera-frame at-camera-stage at-cam-stage" ref={stageRef}>{stage ?? <div className="hm-camera-wait"><Icon name="camera" size={32} /><span>{device.primary.available ? t('state.idle') : tx('module.camera.noLink')}</span></div>}</div>
    <div className="at-cam-tools">
      <button type="button" className="at-cam-tool at-cam-snapshot" disabled={!pic || closed} onClick={() => void snapshot()}><b><Icon name="camera" size={22} /></b>{tx('module.camera.tool.snapshot')}</button>
      <button type="button" className="at-cam-tool" disabled title={tx('module.camera.tool.talkLater')}><b><Icon name="sensor" size={22} /></b>{tx('module.camera.tool.talk')}</button>
      <button type="button" className="at-cam-tool at-cam-full" disabled={!stage} onClick={fullscreen}><b><Icon name="panel" size={22} /></b>{tx('module.camera.tool.fullscreen')}</button>
      {powerAction && <button type="button" className={`at-cam-tool at-cam-lens ${closed ? '' : 'is-on'}`} disabled={busy || off} onClick={() => void runner.run(device, powerAction)}><b><Icon name="power" size={22} /></b>{String(powerAction.label)}</button>}
      {night && night.kind === 'select' && <button type="button" className={`at-cam-tool at-cam-night ${String(night.current).toLowerCase() !== 'off' ? 'is-on' : ''}`} disabled={busy || off} title={tx('module.camera.tool.cycle')} onClick={() => void runner.run(device, night, cycle(night))}><b><Icon name="motion" size={22} /></b>{tx('module.camera.night')}<small>{nightNowLabel}</small></button>}
      {hdr && hdr.kind === 'select' && <button type="button" className={`at-cam-tool at-cam-hdr ${/^(выкл|off)$/i.test(String(hdr.current)) ? '' : 'is-on'}`} disabled={busy || off} title={tx('module.camera.tool.cycle')} onClick={() => void runner.run(device, hdr, cycle(hdr))}><b>HDR</b><small>{hdrNowLabel}</small></button>}
    </div>
    {note && <p className="at-feeder-note at-cam-note" role="status">{note}</p>}
  </>;
  const main = <>
    {(entities.tracking || entities.petTracking || entities.cruise) && <div className="ah-rows"><Title>{tx('module.camera.group.ptz')}</Title>{toggleRow('tracking', tx('module.camera.tracking'), 'person', '#0a84ff')}{toggleRow('petTracking', tx('module.camera.petTracking'), 'paw', '#0a84ff')}{toggleRow('cruise', tx('module.camera.cruise'), 'vacuum', '#0a84ff')}</div>}
    {(entities.motion || entities.aiHuman) && <div className="ah-rows"><Title>{tx('module.camera.group.detection')}</Title>{toggleRow('motion', tx('module.camera.motion'), 'motion', '#30d158')}{selectRow('motionSens', tx('module.camera.motionSens'), sens)}{sliderRow('alarmInterval', tx('module.camera.alarmInterval'), tx('module.camera.min'))}
      {entities.aiHuman && <Title>{tx('module.camera.group.ai')}</Title>}{toggleRow('aiHuman', tx('module.camera.ai.human'), 'person', '#30d158')}{toggleRow('aiMotion', tx('module.camera.ai.motion'), 'motion', '#30d158')}{selectRow('moveSens', tx('module.camera.moveSens'), sens)}{toggleRow('aiPet', tx('module.camera.ai.pet'), 'paw', '#30d158')}{toggleRow('aiFace', tx('module.camera.ai.face'), 'person', '#30d158')}{toggleRow('aiBabycry', tx('module.camera.ai.babycry'), 'sensor', '#30d158')}{toggleRow('aiSound', tx('module.camera.ai.sound'), 'media', '#30d158')}{selectRow('soundSens', tx('module.camera.soundSens'), sens)}</div>}
    {(entities.volume || entities.mute) && <div className="ah-rows"><Title>{tx('module.camera.group.sound')}</Title>{sliderRow('volume', tx('module.camera.volume'), '%')}{toggleRow('mute', tx('module.camera.mute'), 'media', '#30d158')}</div>}
  </>;
  const settings = <>
    {(entities.watermark || entities.distortion || entities.rotation || entities.colorNight || entities.indicator) && <div className="ah-rows"><Title>{tx('module.camera.group.image')}</Title>{toggleRow('watermark', tx('module.camera.watermark'), 'more', '#7b74d8')}{toggleRow('distortion', tx('module.camera.distortion'), 'settings', '#7b74d8')}
      {rotation && flipAction && <div className="ah-row hm-setting"><span className="ah-row-icon" style="--tile:#7b74d8"><Icon name="rooms" size={18} /></span><span className="ah-row-text"><strong>{tx('module.camera.flip')}</strong></span><Switch on={flipped} pending={busy} disabled={off} label={tx('module.camera.flip')} onToggle={() => void runner.run(device, flipAction, flipped ? 0 : 180)} /></div>}
      {toggleRow('colorNight', tx('module.camera.colorNight'), 'light', '#7b74d8')}{toggleRow('indicator', tx('module.camera.indicator'), 'light', '#7b74d8')}</div>}
    {(entities.recording || entities.sdStatus) && <div className="ah-rows"><Title>{tx('module.camera.group.storage')}</Title>{selectRow('recording', tx('module.camera.recording'), rec, 'settings')}{sd && <KV k={tx('module.camera.sdCard')} v={sdStatusLabel(sd.state, tx)} />}{(sdFree || sdUsed) && <KV k={tx('module.camera.sdSpace')} v={hasCard ? `${mb(sdFree)} / ${mb(sdUsed)}` : '— / —'} />}</div>}
    <div className="ah-rows"><Title>{t('ui.diagnostics')}</Title>
      {(funcDev?.model || device.model) && <KV k={t('ui.model')} v={[funcDev?.manufacturer ?? device.manufacturer, funcDev?.model ?? device.model].filter(Boolean).join(' · ')} />}
      {typeof info.lan_ip === 'string' && <KV k={tx('module.camera.diag.ip')} v={info.lan_ip} />}
      {typeof info.mac === 'string' && <KV k="MAC" v={info.mac} />}
      {(codec || audio || res) && <KV k={tx('module.camera.diag.codec')} v={[codec, res, audio].filter(Boolean).join(' · ')} />}
      <KV k={tx('module.camera.diag.stream')} v={`${options.stream ?? 'auto'}${options.streamHd ? ` · HD ${options.streamHd}` : ''}`} />
    </div>
  </>;
  if (wide) return <div className="hm-sheet-body ah-sheet at-cam is-split" data-kind="camera" data-page={page}>
    <div className="at-cam-left">{head}{video}</div>
    <div className="at-cam-right">{headBtns}{page === 'main' ? main : <><h3 className="at-cam-h3">{tx('module.camera.settings')}</h3>{settings}</>}</div>
  </div>;
  return <div className="hm-sheet-body ah-sheet at-cam" data-kind="camera" data-page={page}>{head}{page === 'main' ? <>{video}{main}</> : settings}</div>;
}

/** Live MSE video from the go2rtc add-on in place of the camera's still image; HD/SD switch when a second stream is configured. The sheet draws the camera's functions (Xiaomi MIoT roles). */
export const cameraGo2rtc: ModuleDef = {
  ...cameraGo2rtcSpec,
  Card: () => null,
  claims: cameraClaims,
  tileState: (registry, entities, t) => cameraTileState(registry.states, entities, k => t(k as Key)),
  Sheet: CameraSheet,
  Player({ options, host, t, mode }) {
    const mount = useRef<HTMLDivElement>(null), hostRef = useRef(host); hostRef.current = host;
    const [status, setStatus] = useState<PlayerStatus>('connecting'), [hd, setHd] = useState(false), [hdBroken, setHdBroken] = useState(false);
    // The HD stream is often H.265, which not every browser can decode through MSE: on the first failure fall back to SD and grey the switch out.
    useEffect(() => { if (hd && status === 'error') { setHd(false); setHdBroken(true); } }, [hd, status]);
    const addon = options.addon ?? '', stream = hd && options.streamHd ? options.streamHd : options.stream;
    useEffect(() => {
      const node = mount.current; if (!node) return;
      if (!hostRef.current.ws || !addon || !mseAvailable()) { setStatus('error'); return; }
      let player: Player;
      try { player = mountGo2rtcPlayer(node, { addon, stream, host: { ws: m => hostRef.current.ws!(m), get online() { return hostRef.current.online; } }, onStatus: setStatus, onBlack: hd ? () => { setHd(false); setHdBroken(true); } : undefined }); }
      catch { setStatus('error'); return; }
      return () => player.dispose();
    }, [addon, stream]);
    return <>
      <div className={`hm-camera-mount at-go2rtc is-${status}`} ref={mount} data-player-status={status} data-stream={stream ?? 'auto'} />
      {status !== 'live' && <div className="hm-camera-wait"><Icon name="camera" size={32} /><span>{t(status === 'error' ? 'module.camera.fail' : status === 'stalled' ? 'module.camera.stalled' : 'module.camera.wait')}</span></div>}
      <span className={`hm-live ${status === 'live' ? 'is-live' : ''}`}><i />{status === 'live' ? 'LIVE' : status === 'error' ? t('state.unavailable') : t('state.idle')}</span>
      {mode === 'stage' && options.streamHd && <button type="button" className="hm-camera-q at-camera-q" aria-pressed={hd} disabled={hdBroken} title={hdBroken ? t('module.camera.hdUnsupported') : undefined} onClick={e => { e.stopPropagation(); setHd(!hd); }}>{hd ? 'HD' : 'SD'}</button>}
    </>;
  },
};
