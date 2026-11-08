import { useEffect, useRef, useState } from 'preact/hooks';
import type { ModuleOptions } from './types.ts';
import type { Host } from '../runtime/host.ts';
import type { T } from '../i18n/index.ts';
import { Icon } from '../ui/primitives.tsx';
import { mountGo2rtcPlayer, mseAvailable, type Player, type PlayerStatus } from './go2rtc-player.ts';
import { readFrame, writeFrame, posterEnabled } from './doorbell-state.ts';
import { mountWebrtcPlayer, webrtcAvailable, type WebrtcPlayer } from './webrtc-player.ts';
/** Live MSE video from the go2rtc add-on shared by the camera modules: the last frame as a poster until the stream is up, HD/SD switch when a second stream exists, sound toggle on the stage when the stream carries audio. */
function Go2rtcLive({ options, host, t, mode, poster, live = true, webrtcEntity, onLive }: { /** the first live frame arrived (the stage swaps from the light stream to this one) */ onLive?: () => void; options: ModuleOptions; host: Host; t: T; mode: 'tile' | 'stage'; poster?: string | null; /** false: no stream, only the poster (a battery doorbell is not watched all day from every tile) */ live?: boolean; /** HA camera with a stream: WebRTC through HA's own go2rtc for users who cannot use the add-on ingress (not admins), and as the fallback when the ingress stream fails */ webrtcEntity?: string }) {
  const mount = useRef<HTMLDivElement>(null), hostRef = useRef(host), playerRef = useRef<Player | null>(null); hostRef.current = host;
  const [status, setStatus] = useState<PlayerStatus>('connecting'), [hd, setHd] = useState(false), [hdBroken, setHdBroken] = useState(false), [audio, setAudio] = useState(false), [sound, setSound] = useState(false);
  // C2 of the audit: eight seconds without a picture is «no connection» with a retry, not an endless spinner
  const [slow, setSlow] = useState(false), [retry, setRetry] = useState(0);
  useEffect(() => { if (!live || status === 'live') { setSlow(false); return; } const id = setTimeout(() => setSlow(true), 8000); return () => clearTimeout(id); }, [status, live, retry]);
  const camState = webrtcEntity ? host.states?.()[webrtcEntity]?.state : undefined, camDown = camState === 'unavailable';
  useEffect(() => { if (hd && status === 'error') { setHd(false); setHdBroken(true); } }, [hd, status]);
  const addon = options.addon ?? '', stream = hd && options.streamHd ? options.streamHd : options.stream;
  const [stored, setStored] = useState(() => readFrame(addon, options.stream));
  const [picBroken, setPicBroken] = useState(false);
  const canIngress = !!hostRef.current.ws && !!addon && mseAvailable() && hostRef.current.admin;
  const [path, setPath] = useState<'mse' | 'webrtc'>(() => canIngress || !webrtcEntity ? 'mse' : 'webrtc');
  // The add-on ingress refused or broke (not an admin, 403, codec): try HA's own WebRTC once before giving up.
  useEffect(() => { if (path === 'mse' && status === 'error' && webrtcEntity && webrtcAvailable() && hostRef.current.subscribe) setPath('webrtc'); }, [status, path, webrtcEntity]);
  useEffect(() => {
    const node = mount.current; if (!node || !live || path !== 'webrtc' || !webrtcEntity) return;
    const h = hostRef.current; if (!h.ws || !h.subscribe || !webrtcAvailable()) { setStatus('error'); return; }
    let player: WebrtcPlayer;
    try { player = mountWebrtcPlayer(node, { entityId: webrtcEntity, host: { ws: m => hostRef.current.ws!(m), subscribe: (m, cb) => hostRef.current.subscribe!(m, cb), get online() { return hostRef.current.online; } }, onStatus: setStatus, onAudio: setAudio, onFrame: posterEnabled(options) ? data => { writeFrame(addon, options.stream, data); setStored({ at: Date.now(), data }); } : undefined }); playerRef.current = player as unknown as Player; }
    catch { setStatus('error'); return; }
    return () => { player.dispose(); playerRef.current = null; };
  }, [path, webrtcEntity, live]);
  useEffect(() => {
    const node = mount.current; if (!node || !live || path !== 'mse') return;
    if (!hostRef.current.ws || !addon || !mseAvailable()) { setStatus('error'); return; }
    let player: Player;
    try {
      player = mountGo2rtcPlayer(node, { addon, stream, host: { ws: m => hostRef.current.ws!(m), get online() { return hostRef.current.online; } }, onStatus: setStatus, onBlack: hd ? () => { setHd(false); setHdBroken(true); } : undefined,
        onAudio: setAudio, onFrame: posterEnabled(options) ? data => { writeFrame(addon, options.stream, data); setStored({ at: Date.now(), data }); } : undefined });
      playerRef.current = player;
    } catch { setStatus('error'); return; }
    return () => { player.dispose(); playerRef.current = null; };
  }, [addon, stream, live, path, retry]);
  const liveRef = useRef(onLive); liveRef.current = onLive;
  useEffect(() => { if (live && status === 'live') liveRef.current?.(); }, [status, live]);
  const showPoster = status !== 'live' || !live, posterSrc = stored?.data ?? (poster && !picBroken ? poster : null);
  const toggleSound = (e: Event) => { e.stopPropagation(); const v = playerRef.current?.video; if (!v) return; v.muted = !v.muted; setSound(!v.muted); if (!v.muted) void v.play().catch(() => undefined); };
  return <>
    {showPoster && posterSrc && <img className="at-cam-poster" src={posterSrc} alt="" onError={() => { if (!stored) setPicBroken(true); }} />}
    <div className={`hm-camera-mount at-go2rtc is-${live ? status : 'idle'}`} ref={mount} data-player-status={live ? status : 'idle'} data-stream={stream ?? 'auto'} data-path={live ? path : 'none'} />
    {live && status !== 'live' && <div className={`hm-camera-wait ${posterSrc ? 'is-poster' : ''} ${slow || camDown ? 'is-down' : ''}`}>{slow || camDown ? <Icon name="camera" size={mode === 'tile' ? 22 : 32} /> : posterSrc ? <i className="at-cam-spin" /> : <Icon name="camera" size={32} />}<span>{slow || camDown ? t('module.camera.offline') : t(status === 'error' ? 'module.camera.fail' : status === 'stalled' ? 'module.camera.stalled' : 'module.camera.wait')}</span>{(slow || camDown) && mode === 'stage' && <button type="button" className="hm-pill at-cam-retry" onClick={e => { e.stopPropagation(); setSlow(false); setRetry(r => r + 1); }}>{t('module.camera.retry')}</button>}</div>}
    <span className={`hm-live ${live && status === 'live' ? 'is-live' : ''}`}><i />{camDown ? t('state.unavailable') : live && status === 'live' ? (sound ? `LIVE · ${t('module.camera.sound')}` : 'LIVE') : !live ? (stored ? new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit' }).format(stored.at) : t('state.idle')) : status === 'error' || slow ? t('state.unavailable') : t('state.idle')}</span>
    {mode === 'stage' && options.streamHd && <button type="button" className="hm-camera-q at-camera-q" aria-pressed={hd} disabled={hdBroken} title={hdBroken ? t('module.camera.hdUnsupported') : undefined} onClick={e => { e.stopPropagation(); setHd(!hd); }}>{hd ? 'HD' : 'SD'}</button>}
    {mode === 'stage' && live && audio && status === 'live' && <button type="button" className={`hm-camera-q at-cam-sound ${sound ? 'is-on' : ''}`} aria-pressed={sound} aria-label={t('module.camera.sound')} onClick={toggleSound}><Icon name={sound ? 'speaker' : 'media'} size={16} /></button>}
  </>;
}

type ViewProps = Parameters<typeof Go2rtcLive>[0];
export function Go2rtcView(props: ViewProps) {
  const { options, host, mode, webrtcEntity, live = true, onLive } = props;
  // the preview has no go2rtc: a recorded frame of the camera stands in for the stream, drawn the way a live picture is
  const fake = host.previewFrame?.(options.stream ?? webrtcEntity ?? '') ?? (webrtcEntity ? host.previewFrame?.(webrtcEntity) : null) ?? null;
  if (fake && live) { if (onLive) queueMicrotask(onLive); return <><img className="at-cam-poster at-cam-fake" src={fake} alt="" /><div className="hm-camera-mount at-go2rtc is-live" data-player-status="live" data-stream={options.stream ?? 'auto'} data-path="preview" /><span className="hm-live is-live"><i />LIVE</span>{mode === 'stage' && options.streamHd && <button type="button" className="hm-camera-q at-camera-q" aria-pressed={false}>SD</button>}</>; }
  return <Go2rtcLive {...props} />;
}
/** A stage that opens at once on the light stream (frequent keyframes) and moves to the full-quality one as soon as its first frame is in (owner, 09.11.2026: «в карточке слабое качество, в отдельной карточке камеры максимальное»). If the full stream never comes (H.265 a phone cannot play), the light one stays. */
export function DualView({ low, high }: { low: ViewProps; high: ViewProps | null }) {
  const [hi, setHi] = useState(false);
  if (!high) return <Go2rtcView {...low} />;
  return <>
    {!hi && <div className="at-cam-layer"><Go2rtcView {...low} /></div>}
    <div className={`at-cam-layer ${hi ? '' : 'is-pending'}`} data-quality="high"><Go2rtcView {...high} onLive={() => setHi(true)} /></div>
  </>;
}
