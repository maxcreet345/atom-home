/** WebRTC playback of an HA camera through Home Assistant's own go2rtc (`camera/webrtc/*` WebSocket commands). Works for every signed-in user, unlike the add-on ingress (admins only); ICE servers come from HA (Nabu Casa adds TURN). Independent implementation of the public protocol documented in home-assistant/frontend ha-web-rtc-player.ts. */
import { FROZEN_MS, playVideo, retryDelay, type PlayerStatus } from './go2rtc-player.ts';
export interface WebrtcHost { ws<T = unknown>(message: Record<string, unknown>): Promise<T>; subscribe<T = unknown>(message: Record<string, unknown>, cb: (m: T) => void): Promise<() => void>; readonly online: boolean }
export interface WebrtcOptions { entityId: string; host: WebrtcHost; onStatus?(status: PlayerStatus): void; onAudio?(has: boolean): void; onFrame?(dataUrl: string): void; /** start with sound (see go2rtc-player); default muted */ sound?: boolean; /** the browser refused sound without a tap: the picture plays muted */ onMuted?(): void }
/** How long a connected stream may show no new frame before it is rebuilt (the label says «нет кадров» after FROZEN_MS already). */
export const REBUILD_MS = 45_000;
export interface WebrtcPlayer { video: HTMLVideoElement; retry(): void; hold(on: boolean, graceMs?: number): void; dispose(): void }
type Message = { type: 'session'; session_id: string } | { type: 'answer'; answer: string } | { type: 'candidate'; candidate: { candidate: string; sdp_m_line_index?: number } } | { type: 'error'; code?: string; message?: string };
export const webrtcAvailable = () => typeof RTCPeerConnection !== 'undefined';
export function mountWebrtcPlayer(container: HTMLElement, opts: WebrtcOptions): WebrtcPlayer {
  const { host, entityId } = opts;
  const video = document.createElement('video'); video.muted = !opts.sound; video.autoplay = true; video.playsInline = true; video.controls = false; container.append(video);
  let pc: RTCPeerConnection | null = null, unsub: (() => void) | null = null, session: string | null = null, disposed = false, epoch = 0, retries = 0, status: PlayerStatus = 'connecting';
  let timer: ReturnType<typeof setInterval> | undefined, retry: ReturnType<typeof setTimeout> | undefined, lastTime = 0, lastProgress = 0, lastFrameAt = 0, liveSince = 0, held = false, holdTimer: ReturnType<typeof setTimeout> | undefined, lastFrames = 0, lastFrameSeen = 0, counted = false;
  const report = (s: PlayerStatus) => { if (status !== s) { status = s; opts.onStatus?.(s); } };
  const capture = () => { try { const w = 480, h = Math.max(1, Math.round(w * video.videoHeight / video.videoWidth)); const c = document.createElement('canvas'); c.width = w; c.height = h; const ctx = c.getContext('2d'); if (!ctx) return; ctx.drawImage(video, 0, 0, w, h); opts.onFrame?.(c.toDataURL('image/jpeg', 0.6)); } catch { /* tainted */ } };
  const stop = () => {
    epoch++; if (timer) clearInterval(timer); timer = undefined; if (retry) clearTimeout(retry); retry = undefined;
    const u = unsub; unsub = null; try { void Promise.resolve(u?.()).catch(() => { /* HA forgot the subscription on reconnect: «Subscription not found» is not an error here */ }); } catch { /* closed */ }
    const p = pc; pc = null; try { p?.close(); } catch { /* closed */ }
    session = null; lastTime = 0; liveSince = 0; lastFrames = 0; counted = false; video.pause(); video.srcObject = null;
  };
  const mounted = () => !disposed && !held && container.isConnected && !document.hidden;
  const allowed = () => mounted() && host.online;
  // never gives up (see go2rtc-player): quick retries, then one a minute; while the house is off the line it looks every 2 s and starts the moment it is back
  const again = () => { retry = undefined; if (!mounted()) return; if (!host.online) { retry = setTimeout(again, 2000); return; } void start(); };
  const failed = () => { stop(); report('error'); if (mounted()) retry = setTimeout(again, host.online ? retryDelay(retries++) : 2000); };
  const start = async () => {
    stop(); if (!allowed()) { if (mounted()) { report('error'); retry = setTimeout(again, 2000); } return; } const current = epoch, active = () => allowed() && current === epoch;
    // this attempt is still the player's own (no stop() since): what an older attempt's peer or promise answers late may not touch the shared player (CODEX-013)
    const mine = () => current === epoch;
    report('connecting'); lastProgress = performance.now();
    timer = setInterval(() => {
      if (!active()) return;
      // Frames arrive in bursts over TURN and the doorbell wakes slowly: live as soon as a picture is decoded, a stall only after a long silence, and never while ICE is still negotiating.
      if (video.readyState >= 2 && video.videoWidth > 0 && !video.paused) { const now = performance.now(), frames = video.getVideoPlaybackQuality?.().totalVideoFrames;
        if (video.currentTime > lastTime) { lastTime = video.currentTime; lastProgress = now; }
        if (frames !== undefined && frames > lastFrames) { lastFrames = frames; lastFrameSeen = now; counted = true; }
        // The picture's progress is the last NEW decoded frame where the browser counts them for this stream, the media clock only where it does not:
        // an audio track keeps the clock running over a frozen picture, and by the clock the connection was never rebuilt (CODEX-012).
        // The label follows the picture, the connection gets its long patience: no new frame for 6 s is «нет кадров», not LIVE over an old frame; 45 s, a new connection.
        const seen = counted ? lastFrameSeen : lastProgress;
        retries = 0; report(now - seen > FROZEN_MS ? 'stalled' : 'live'); if (!liveSince) liveSince = performance.now(); if (opts.onFrame && performance.now() - lastFrameAt > 5000 && performance.now() - liveSince > 1500) { lastFrameAt = performance.now(); capture(); } if (now - seen > REBUILD_MS) failed(); }
      else if (video.paused && video.srcObject) void playVideo(video, opts.onMuted).catch(() => undefined);
      else if (performance.now() - lastProgress > (pc && (pc.connectionState === 'connecting' || pc.connectionState === 'new') ? 60000 : 40000)) failed();
    }, 1000);
    try {
      const cfg = await host.ws<{ configuration?: RTCConfiguration; getCandidatesUpfront?: boolean }>({ type: 'camera/webrtc/get_client_config', entity_id: entityId });
      if (!active()) return;
      const peer = new RTCPeerConnection(cfg.configuration ?? {}); pc = peer;
      peer.addTransceiver('video', { direction: 'recvonly' }); peer.addTransceiver('audio', { direction: 'recvonly' });
      peer.ontrack = ev => { if (!mine()) return; const stream = ev.streams[0] ?? new MediaStream([ev.track]); if (video.srcObject !== stream) { video.srcObject = stream; void playVideo(video, opts.onMuted).catch(() => undefined); } if (ev.track.kind === 'audio') opts.onAudio?.(true); };
      peer.onconnectionstatechange = () => { if (!active()) return; if (peer.connectionState === 'failed' || peer.connectionState === 'closed') failed(); };
      const queued: RTCIceCandidate[] = [];
      peer.onicecandidate = ev => { if (!ev.candidate || !active()) return; if (!session) { queued.push(ev.candidate); return; } void host.ws({ type: 'camera/webrtc/candidate', entity_id: entityId, session_id: session, candidate: { candidate: ev.candidate.candidate, sdp_m_line_index: ev.candidate.sdpMLineIndex ?? 0 } }).catch(() => undefined); };
      const offer = await peer.createOffer(); await peer.setLocalDescription(offer);
      if (cfg.getCandidatesUpfront) await new Promise<void>(res => { if (peer.iceGatheringState === 'complete') return res(); const t = setTimeout(res, 2500); peer.onicegatheringstatechange = () => { if (peer.iceGatheringState === 'complete') { clearTimeout(t); res(); } }; });
      if (!active()) return;
      const sdp = peer.localDescription?.sdp; if (!sdp) throw new Error('no offer');
      const off = await host.subscribe<Message>({ type: 'camera/webrtc/offer', entity_id: entityId, offer: sdp }, m => {
        if (!active()) return;
        try {
          if (m.type === 'session') { session = m.session_id; for (const c of queued.splice(0)) void host.ws({ type: 'camera/webrtc/candidate', entity_id: entityId, session_id: session, candidate: { candidate: c.candidate, sdp_m_line_index: c.sdpMLineIndex ?? 0 } }).catch(() => undefined); }
          // the answer is applied asynchronously: a retry may close this peer meanwhile, and its rejection then is not the new connection's failure (CODEX-013)
          else if (m.type === 'answer') void peer.setRemoteDescription({ type: 'answer', sdp: m.answer }).catch(() => { if (mine()) failed(); });
          else if (m.type === 'candidate') void peer.addIceCandidate(new RTCIceCandidate({ candidate: m.candidate.candidate, sdpMLineIndex: m.candidate.sdp_m_line_index ?? 0 })).catch(() => undefined);
          else if (m.type === 'error') failed();
        } catch { failed(); }
      });
      // Overtaken while HA answered (a second start(), a failure in the same frame that has already set its retry, a pause, the tab hidden): this run only
      // drops its own subscription. A stop() here would close the NEW run's connection and clear its retry timer — the player then stayed silent.
      if (current !== epoch) { try { void Promise.resolve(off()).catch(() => undefined); } catch { /* closed */ } return; }
      unsub = off; if (!active()) failed(); // the house went off the line meanwhile: an error that tries again by itself
    } catch { if (active()) failed(); }
  };
  // hidden is «paused», not «connecting»: nobody waits for a picture in a hidden tab, and the eight seconds of «нет связи» start anew when it is shown again
  const visibility = () => { if (held) return; if (document.hidden) { stop(); report('paused'); } else void start(); };
  document.addEventListener('visibilitychange', visibility); void start();
  return { video,
    retry() { if (disposed || held || status === 'live') return; retries = 0; void start(); },
    hold(on, graceMs = 0) {
      if (holdTimer) { clearTimeout(holdTimer); holdTimer = undefined; }
      if (disposed) return;
      if (on) { if (held) return; const go = () => { holdTimer = undefined; held = true; stop(); report('paused'); }; if (graceMs > 0) holdTimer = setTimeout(go, graceMs); else go(); }
      else if (held) { held = false; retries = 0; void start(); }
    },
    dispose() { disposed = true; if (holdTimer) clearTimeout(holdTimer); document.removeEventListener('visibilitychange', visibility); stop(); video.remove(); } };
}
