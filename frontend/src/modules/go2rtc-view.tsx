import { useEffect, useRef, useState } from 'preact/hooks';
import type { ModuleOptions } from './types.ts';
import type { Host } from '../runtime/host.ts';
import type { T } from '../i18n/index.ts';
import { Icon } from '../ui/primitives.tsx';
import { mountGo2rtcPlayer, mseAvailable, type Player, type PlayerStatus } from './go2rtc-player.ts';
import { readFrame, writeFrame, posterEnabled } from './doorbell-state.ts';
/** Live MSE video from the go2rtc add-on shared by the camera modules: the last frame as a poster until the stream is up, HD/SD switch when a second stream exists, sound toggle on the stage when the stream carries audio. */
export function Go2rtcView({ options, host, t, mode, poster, live = true }: { options: ModuleOptions; host: Host; t: T; mode: 'tile' | 'stage'; poster?: string | null; /** false: no stream, only the poster (a battery doorbell is not watched all day from every tile) */ live?: boolean }) {
  const mount = useRef<HTMLDivElement>(null), hostRef = useRef(host), playerRef = useRef<Player | null>(null); hostRef.current = host;
  const [status, setStatus] = useState<PlayerStatus>('connecting'), [hd, setHd] = useState(false), [hdBroken, setHdBroken] = useState(false), [audio, setAudio] = useState(false), [sound, setSound] = useState(false);
  useEffect(() => { if (hd && status === 'error') { setHd(false); setHdBroken(true); } }, [hd, status]);
  const addon = options.addon ?? '', stream = hd && options.streamHd ? options.streamHd : options.stream;
  const [stored, setStored] = useState(() => readFrame(addon, options.stream));
  const [picBroken, setPicBroken] = useState(false);
  useEffect(() => {
    const node = mount.current; if (!node || !live) return;
    if (!hostRef.current.ws || !addon || !mseAvailable()) { setStatus('error'); return; }
    let player: Player;
    try {
      player = mountGo2rtcPlayer(node, { addon, stream, host: { ws: m => hostRef.current.ws!(m), get online() { return hostRef.current.online; } }, onStatus: setStatus, onBlack: hd ? () => { setHd(false); setHdBroken(true); } : undefined,
        onAudio: setAudio, onFrame: posterEnabled(options) ? data => { writeFrame(addon, options.stream, data); setStored({ at: Date.now(), data }); } : undefined });
      playerRef.current = player;
    } catch { setStatus('error'); return; }
    return () => { player.dispose(); playerRef.current = null; };
  }, [addon, stream, live]);
  const showPoster = status !== 'live' || !live, posterSrc = stored?.data ?? (poster && !picBroken ? poster : null);
  const toggleSound = (e: Event) => { e.stopPropagation(); const v = playerRef.current?.video; if (!v) return; v.muted = !v.muted; setSound(!v.muted); if (!v.muted) void v.play().catch(() => undefined); };
  return <>
    {showPoster && posterSrc && <img className="at-cam-poster" src={posterSrc} alt="" onError={() => { if (!stored) setPicBroken(true); }} />}
    <div className={`hm-camera-mount at-go2rtc is-${live ? status : 'idle'}`} ref={mount} data-player-status={live ? status : 'idle'} data-stream={stream ?? 'auto'} />
    {live && status !== 'live' && <div className={`hm-camera-wait ${posterSrc ? 'is-poster' : ''}`}>{posterSrc ? <i className="at-cam-spin" /> : <Icon name="camera" size={32} />}<span>{t(status === 'error' ? 'module.camera.fail' : status === 'stalled' ? 'module.camera.stalled' : 'module.camera.wait')}</span></div>}
    <span className={`hm-live ${live && status === 'live' ? 'is-live' : ''}`}><i />{live && status === 'live' ? (sound ? `LIVE · ${t('module.camera.sound')}` : 'LIVE') : !live ? (stored ? new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit' }).format(stored.at) : t('state.idle')) : status === 'error' ? t('state.unavailable') : t('state.idle')}</span>
    {mode === 'stage' && options.streamHd && <button type="button" className="hm-camera-q at-camera-q" aria-pressed={hd} disabled={hdBroken} title={hdBroken ? t('module.camera.hdUnsupported') : undefined} onClick={e => { e.stopPropagation(); setHd(!hd); }}>{hd ? 'HD' : 'SD'}</button>}
    {mode === 'stage' && live && audio && status === 'live' && <button type="button" className={`hm-camera-q at-cam-sound ${sound ? 'is-on' : ''}`} aria-pressed={sound} aria-label={t('module.camera.sound')} onClick={toggleSound}><Icon name={sound ? 'speaker' : 'media'} size={16} /></button>}
  </>;
}
