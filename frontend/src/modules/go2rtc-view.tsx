import { useEffect, useRef, useState } from 'preact/hooks';
import type { ModuleOptions } from './types.ts';
import type { Host } from '../runtime/host.ts';
import type { T } from '../i18n/index.ts';
import { Icon } from '../ui/primitives.tsx';
import { mountGo2rtcPlayer, mseAvailable, playVideo, type Player, type PlayerStatus } from './go2rtc-player.ts';
import { readFrame, writeFrame, posterEnabled } from './doorbell-state.ts';
import { mountWebrtcPlayer, webrtcAvailable, type WebrtcPlayer } from './webrtc-player.ts';
import { hdUnsupported, mseBroken, pictureLost, playerDown } from './camera-state.ts';
/** How long a tile's stream is kept after it went behind a sheet or off the screen: a short look at a lamp's sheet reconnects nothing. */
const HOLD_SHEET_MS = 20_000, HOLD_OFFSCREEN_MS = 10_000;
/** Live MSE video from the go2rtc add-on shared by the camera modules: the last frame as a poster until the stream is up, HD/SD switch when a second stream exists, sound toggle on the stage when the stream carries audio. */
function Go2rtcLive({ options, host, t, mode, poster, live = true, webrtcEntity, onLive, camera, paused, soundWish, behind = false }: { /** the camera's HA entity: the Cameras card asks by it whether the picture is there */ camera?: string; /** behind a sheet: the stream pauses (after a moment) and resumes */ paused?: boolean; /** the first live frame arrived (the stage swaps from the light stream to this one) */ onLive?: () => void; options: ModuleOptions; host: Host; t: T; mode: 'tile' | 'stage'; poster?: string | null; /** false: no stream, only the poster (a battery doorbell is not watched all day from every tile) */ live?: boolean; /** HA camera with a stream: WebRTC through HA's own go2rtc for users who cannot use the add-on ingress (not admins), and as the fallback when the ingress stream fails */ webrtcEntity?: string; /** the family's sound choice, shared by the two layers of a DualView (the full-quality one takes over with it) */ soundWish?: { current: boolean }; /** a DualView layer still unseen behind the other one: it stays muted until it is shown */ behind?: boolean }) {
  const mount = useRef<HTMLDivElement>(null), hostRef = useRef(host), playerRef = useRef<Player | null>(null); hostRef.current = host;
  const [status, setStatus] = useState<PlayerStatus>('connecting'), [hd, setHd] = useState(false), [hdBroken, setHdBroken] = useState(false), [audio, setAudio] = useState(false), [sound, setSound] = useState(false);
  // CODEX-015: the sound the family turned on is a wish that outlives the player — SD↔HD, «Повторить», the add-on's stream ↔ WebRTC each build a new
  // video, which starts with it (muted while the layer waits unseen); a browser that refuses sound without a tap mutes the picture and the wish resets.
  // What the button and the chip say is read off the element itself (`volumechange`), so «Звук» is never shown over a silent video.
  const ownWish = useRef(false), wish = soundWish ?? ownWish, behindRef = useRef(behind); behindRef.current = behind;
  const refused = () => { wish.current = false; };
  const heard = (v: HTMLVideoElement) => { const sync = () => setSound(!v.muted); v.addEventListener('volumechange', sync); sync(); return () => v.removeEventListener('volumechange', sync); };
  // C2 of the audit: eight seconds without a picture is «no connection» with a retry, not an endless spinner
  // a sheet opened on a camera whose tile has already given up starts with «Нет связи с камерой» and «Повторить», not with eight more seconds of waiting
  const [slow, setSlow] = useState(() => mode === 'stage' && !!camera && playerDown.gaveUp(camera)), [retry, setRetry] = useState(0);
  // eight seconds from when the picture went, not from the last flip between «connecting» and «error» (the player keeps trying for good)
  const waiting = live && status !== 'live' && status !== 'paused';
  useEffect(() => { if (!waiting) { setSlow(false); return; } const id = setTimeout(() => setSlow(true), 8000); return () => clearTimeout(id); }, [waiting, retry]);
  const camState = webrtcEntity ? host.states?.()[webrtcEntity]?.state : undefined, camDown = camState === 'unavailable';
  const sdLive = useRef(false); if (!hd && status === 'live') sdLive.current = true;
  const addon = options.addon ?? '', stream = hd && options.streamHd ? options.streamHd : options.stream;
  const [stored, setStored] = useState(() => readFrame(addon, options.stream));
  const [picBroken, setPicBroken] = useState(false);
  const canIngress = !!hostRef.current.ws && !!addon && mseAvailable() && hostRef.current.admin;
  const [path, setPath] = useState<'mse' | 'webrtc'>(() => canIngress || !webrtcEntity ? 'mse' : 'webrtc');
  // The add-on ingress refused or broke (not an admin, 403, codec): try HA's own WebRTC before giving up. An error while the house is off the line is not the
  // add-on's (the player says «error» when it is started without a link): the tile stays on its own stream and waits for the house.
  const fellBack = useRef(false);
  useEffect(() => { if (path === 'mse' && mseBroken(status, hostRef.current.online) && webrtcEntity && webrtcAvailable() && hostRef.current.subscribe) { fellBack.current = true; setPath('webrtc'); } }, [status, path, webrtcEntity]);
  // Off the screen or behind a sheet nobody watches the tile: its stream is held after a moment and comes back at once (a sheet opened and closed reconnects nothing).
  const [seen, setSeen] = useState(true), hold = !!paused || (mode === 'tile' && !seen) /* a sheet's stage is in sight for as long as the sheet is open */, holdRef = useRef(hold); holdRef.current = hold;
  useEffect(() => { const node = mount.current; if (!node || typeof IntersectionObserver === 'undefined') return; const io = new IntersectionObserver(rows => { const last = rows[rows.length - 1]; if (last) setSeen(last.isIntersecting); }); io.observe(node); return () => io.disconnect(); }, []);
  useEffect(() => { playerRef.current?.hold(hold, paused ? HOLD_SHEET_MS : HOLD_OFFSCREEN_MS); }, [hold]);
  // The house is back on the line, or the camera itself is: try at once instead of waiting out the back-off.
  const online = host.online, wasOnline = useRef(online), wasDown = useRef(camDown);
  useEffect(() => {
    // the house is back: a tile that left its own stream for WebRTC tries the stream again (the error may have been the link going down a moment before the panel knew)
    if (online && !wasOnline.current && fellBack.current && canIngress) { fellBack.current = false; setPath('mse'); }
    else if ((online && !wasOnline.current) || (!camDown && wasDown.current)) playerRef.current?.retry();
    wasOnline.current = online; wasDown.current = camDown;
  }, [online, camDown]);
  useEffect(() => {
    const node = mount.current; if (!node || !live || path !== 'webrtc' || !webrtcEntity) return;
    setStatus('connecting');
    const h = hostRef.current; if (!h.ws || !h.subscribe || !webrtcAvailable()) { setStatus('error'); return; }
    let player: WebrtcPlayer;
    try { player = mountWebrtcPlayer(node, { entityId: webrtcEntity, host: { ws: m => hostRef.current.ws!(m), subscribe: (m, cb) => hostRef.current.subscribe!(m, cb), get online() { return hostRef.current.online; } }, onStatus: setStatus, onAudio: setAudio, onFrame: posterEnabled(options) ? data => { writeFrame(addon, options.stream, data); setStored({ at: Date.now(), data }); } : undefined, sound: wish.current && !behindRef.current, onMuted: refused }); playerRef.current = player as unknown as Player; if (holdRef.current) player.hold(true); }
    catch { setStatus('error'); return; }
    const unheard = heard(player.video);
    return () => { unheard(); player.dispose(); playerRef.current = null; };
  }, [path, webrtcEntity, live, retry]);
  useEffect(() => {
    const node = mount.current; if (!node || !live || path !== 'mse') return;
    if (!hostRef.current.ws || !addon || !mseAvailable()) { setStatus('error'); return; }
    setStatus('connecting'); // a new stream starts clean: the SD stream's last error says nothing about HD
    let player: Player, wasLive = false;
    // HD is «not supported here» only when SD played and HD never did (black, or refused before its first frame); an error after it played is a reconnect like any other
    const onStatus = (s: PlayerStatus) => { if (s === 'live') wasLive = true; setStatus(s); if (hdUnsupported(hd, s, wasLive, sdLive.current)) { setHd(false); setHdBroken(true); } };
    try {
      player = mountGo2rtcPlayer(node, { addon, stream, host: { ws: m => hostRef.current.ws!(m), get online() { return hostRef.current.online; } }, onStatus, onBlack: hd ? () => { setHd(false); setHdBroken(true); } : undefined,
        onAudio: setAudio, onFrame: posterEnabled(options) ? data => { writeFrame(addon, options.stream, data); setStored({ at: Date.now(), data }); } : undefined, sound: wish.current && !behindRef.current, onMuted: refused });
      playerRef.current = player; if (holdRef.current) player.hold(true);
    } catch { setStatus('error'); return; }
    const unheard = heard(player.video);
    return () => { unheard(); player.dispose(); playerRef.current = null; };
  }, [addon, stream, live, path, retry]);
  // a DualView layer that has just been shown takes the family's sound (it waited muted behind the other one)
  useEffect(() => { const v = playerRef.current?.video; if (behind || !v || !wish.current || !v.muted) return; v.muted = false; void playVideo(v, refused).catch(() => undefined); }, [behind]);
  const liveRef = useRef(onLive); liveRef.current = onLive;
  useEffect(() => { if (live && status === 'live') liveRef.current?.(); }, [status, live]);
  // What the Cameras card says of this tile: no picture for 8 s (or the camera itself gone) is a camera without a link, whatever its entity says.
  // A paused tile (off the screen, behind a sheet, the tab hidden) keeps what it last knew until a frame arrives: the summary counts every camera, not the tiles in sight.
  const lost = useRef(false); lost.current = live && pictureLost(lost.current, status, slow);
  const down = live && mode === 'tile' && (camDown || lost.current);
  useEffect(() => { if (!camera) return; playerDown.set(camera, down); return () => playerDown.leave(camera); }, [camera, down]);
  const showPoster = status !== 'live' || !live, posterSrc = stored?.data ?? (poster && !picBroken ? poster : null);
  const toggleSound = (e: Event) => { e.stopPropagation(); const v = playerRef.current?.video; if (!v) return; v.muted = !v.muted; wish.current = !v.muted; setSound(!v.muted); if (!v.muted) void playVideo(v, refused).catch(() => undefined); };
  return <>
    {showPoster && posterSrc && <img className="at-cam-poster" src={posterSrc} alt="" onError={() => { if (!stored) setPicBroken(true); }} />}
    <div className={`hm-camera-mount at-go2rtc is-${live ? status : 'idle'}`} ref={mount} data-player-status={live ? status : 'idle'} data-stream={stream ?? 'auto'} data-path={live ? path : 'none'} />
    {live && status !== 'live' && status !== 'paused' && <div className={`hm-camera-wait ${posterSrc ? 'is-poster' : ''} ${slow || camDown ? 'is-down' : ''}`}>{slow || camDown ? <Icon name="camera" size={mode === 'tile' ? 22 : 32} /> : posterSrc ? <i className="at-cam-spin" /> : <Icon name="camera" size={32} />}<span>{slow || camDown ? t('module.camera.offline') : t(status === 'error' ? 'module.camera.fail' : status === 'stalled' ? 'module.camera.stalled' : 'module.camera.wait')}</span>{slow && !camDown && <button type="button" className="hm-pill at-cam-retry" onClick={e => { e.stopPropagation(); setSlow(false); setRetry(r => r + 1); }}>{t('module.camera.retry')}</button>}</div>}
    <span className={`hm-live ${live && status === 'live' ? 'is-live' : ''}`} aria-hidden={live && status !== 'live' && status !== 'paused' && (slow || camDown) ? true : undefined /* the frame already says «Нет связи с камерой»: not twice for a screen reader */}><i />{camDown ? t('state.unavailable') : live && status === 'live' ? (sound ? `LIVE · ${t('module.camera.sound')}` : 'LIVE') : !live ? (stored ? new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit' }).format(stored.at) : t('state.idle')) : status === 'error' || slow ? t('state.unavailable') : t('state.idle')}</span>
    {mode === 'stage' && options.streamHd && path === 'mse' && <button type="button" className="hm-camera-q at-camera-q" aria-label={`${t('module.camera.quality')}: ${hd ? 'HD' : 'SD'}` /* the name carries the state: «Качество видео: SD» */} disabled={hdBroken} title={hdBroken ? t('module.camera.hdUnsupported') : undefined} onClick={e => { e.stopPropagation(); setHd(!hd); }}>{hd ? 'HD' : 'SD'}</button>}
    {mode === 'stage' && live && audio && status === 'live' && <button type="button" className={`hm-camera-q at-cam-sound ${sound ? 'is-on' : ''}`} aria-pressed={sound} aria-label={t('module.camera.sound')} onClick={toggleSound}><Icon name={sound ? 'speaker' : 'media'} size={16} /></button>}
  </>;
}

type ViewProps = Parameters<typeof Go2rtcLive>[0];
export function Go2rtcView(props: ViewProps) {
  const [fakeBroken, setFakeBroken] = useState(false); // the recorded frame did not load: no LIVE over an empty frame
  const { options, host, mode, webrtcEntity, live = true, onLive, t } = props, gone = !!webrtcEntity && host.states?.()[webrtcEntity]?.state === 'unavailable'; // a camera that is away shows «нет связи» in the preview too, not a recorded frame under LIVE
  // the preview has no go2rtc: a recorded frame of the camera stands in for the stream, drawn the way a live picture is
  const fake = host.previewFrame?.(options.stream ?? webrtcEntity ?? '') ?? (webrtcEntity ? host.previewFrame?.(webrtcEntity) : null) ?? null;
  if (fake && live && !gone && !fakeBroken) { if (onLive) queueMicrotask(onLive); return <><img className="at-cam-poster at-cam-fake" src={fake} alt="" onError={() => setFakeBroken(true)} /><div className="hm-camera-mount at-go2rtc is-live" data-player-status="live" data-stream={options.stream ?? 'auto'} data-path="preview" /><span className="hm-live is-live"><i />LIVE</span>{mode === 'stage' && options.streamHd && <button type="button" className="hm-camera-q at-camera-q" aria-label={`${t('module.camera.quality')}: SD`}>SD</button>}</>; }
  return <Go2rtcLive {...props} />;
}
/** A stage that opens at once on the light stream (frequent keyframes) and moves to the full-quality one as soon as its first frame is in (owner, 09.11.2026: «в карточке слабое качество, в отдельной карточке камеры максимальное»). If the full stream never comes (H.265 a phone cannot play), the light one stays. */
export function DualView({ low, high }: { low: ViewProps; high: ViewProps | null }) {
  const [hi, setHi] = useState(false), sound = useRef(false); // the sound turned on over the light stream goes on with the full one
  if (!high) return <Go2rtcView {...low} />;
  return <>
    {!hi && <div className="at-cam-layer"><Go2rtcView {...low} soundWish={sound} /></div>}
    {/* CODEX-016: until its first frame the full-quality layer is unseen — it may keep trying in the background, but its «Повторить» and its words
        reach neither the keyboard nor a screen reader (the working light stream in front of it is the one that speaks) */}
    <div className={`at-cam-layer ${hi ? '' : 'is-pending'}`} data-quality="high" inert={!hi} aria-hidden={hi ? undefined : 'true'}><Go2rtcView {...high} soundWish={sound} behind={!hi} onLive={() => setHi(true)} /></div>
  </>;
}
