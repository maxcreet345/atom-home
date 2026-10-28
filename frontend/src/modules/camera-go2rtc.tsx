import { useEffect, useRef, useState } from 'preact/hooks';
import type { ModuleDef } from './types.ts';
import { cameraGo2rtcSpec } from './catalog.ts';
import { Icon } from '../ui/primitives.tsx';
import { mountGo2rtcPlayer, mseAvailable, type Player, type PlayerStatus } from './go2rtc-player.ts';
/** Live MSE video from the go2rtc add-on in place of the camera's still image; HD/SD switch when a second stream is configured. View only. */
export const cameraGo2rtc: ModuleDef = {
  ...cameraGo2rtcSpec,
  Card: () => null,
  Player({ options, host, t, mode }) {
    const mount = useRef<HTMLDivElement>(null), hostRef = useRef(host); hostRef.current = host;
    const [status, setStatus] = useState<PlayerStatus>('connecting'), [hd, setHd] = useState(false);
    const addon = options.addon ?? '', stream = hd && options.streamHd ? options.streamHd : options.stream;
    useEffect(() => {
      const node = mount.current; if (!node) return;
      if (!hostRef.current.ws || !addon || !mseAvailable()) { setStatus('error'); return; }
      let player: Player;
      try { player = mountGo2rtcPlayer(node, { addon, stream, host: { ws: m => hostRef.current.ws!(m), get online() { return hostRef.current.online; } }, onStatus: setStatus }); }
      catch { setStatus('error'); return; }
      return () => player.dispose();
    }, [addon, stream]);
    return <>
      <div className={`hm-camera-mount at-go2rtc is-${status}`} ref={mount} data-player-status={status} data-stream={stream ?? 'auto'} />
      {status !== 'live' && <div className="hm-camera-wait"><Icon name="camera" size={32} /><span>{t(status === 'error' ? 'module.camera.fail' : status === 'stalled' ? 'module.camera.stalled' : 'module.camera.wait')}</span></div>}
      <span className={`hm-live ${status === 'live' ? 'is-live' : ''}`}><i />{status === 'live' ? 'LIVE' : status === 'error' ? t('state.unavailable') : t('state.idle')}</span>
      {mode === 'stage' && options.streamHd && <button type="button" className="hm-camera-q at-camera-q" aria-pressed={hd} onClick={e => { e.stopPropagation(); setHd(!hd); }}>{hd ? 'HD' : 'SD'}</button>}
    </>;
  },
};
