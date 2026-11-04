/** WebRTC playback of an HA camera through Home Assistant's own go2rtc (`camera/webrtc/*` WebSocket commands). Works for every signed-in user, unlike the add-on ingress (admins only); ICE servers come from HA (Nabu Casa adds TURN). Independent implementation of the public protocol documented in home-assistant/frontend ha-web-rtc-player.ts. */
import type { PlayerStatus } from './go2rtc-player.ts';
export interface WebrtcHost { ws<T = unknown>(message: Record<string, unknown>): Promise<T>; subscribe<T = unknown>(message: Record<string, unknown>, cb: (m: T) => void): Promise<() => void>; readonly online: boolean }
export interface WebrtcOptions { entityId: string; host: WebrtcHost; onStatus?(status: PlayerStatus): void; onAudio?(has: boolean): void; onFrame?(dataUrl: string): void }
export interface WebrtcPlayer { video: HTMLVideoElement; dispose(): void }
type Message = { type: 'session'; session_id: string } | { type: 'answer'; answer: string } | { type: 'candidate'; candidate: { candidate: string; sdp_m_line_index?: number } } | { type: 'error'; code?: string; message?: string };
export const webrtcAvailable = () => typeof RTCPeerConnection !== 'undefined';
export function mountWebrtcPlayer(container: HTMLElement, opts: WebrtcOptions): WebrtcPlayer {
  const { host, entityId } = opts;
  const video = document.createElement('video'); video.muted = true; video.autoplay = true; video.playsInline = true; video.controls = false; container.append(video);
  let pc: RTCPeerConnection | null = null, unsub: (() => void) | null = null, session: string | null = null, disposed = false, epoch = 0, retries = 0, status: PlayerStatus = 'connecting';
  let timer: ReturnType<typeof setInterval> | undefined, retry: ReturnType<typeof setTimeout> | undefined, lastTime = 0, lastProgress = 0, lastFrameAt = 0, liveSince = 0;
  const report = (s: PlayerStatus) => { if (status !== s) { status = s; opts.onStatus?.(s); } };
  const capture = () => { try { const w = 480, h = Math.max(1, Math.round(w * video.videoHeight / video.videoWidth)); const c = document.createElement('canvas'); c.width = w; c.height = h; const ctx = c.getContext('2d'); if (!ctx) return; ctx.drawImage(video, 0, 0, w, h); opts.onFrame?.(c.toDataURL('image/jpeg', 0.6)); } catch { /* tainted */ } };
  const stop = () => {
    epoch++; if (timer) clearInterval(timer); timer = undefined; if (retry) clearTimeout(retry); retry = undefined;
    const u = unsub; unsub = null; try { u?.(); } catch { /* closed */ }
    const p = pc; pc = null; try { p?.close(); } catch { /* closed */ }
    session = null; lastTime = 0; liveSince = 0; video.pause(); video.srcObject = null;
  };
  const allowed = () => !disposed && container.isConnected && !document.hidden && host.online;
  const failed = () => { stop(); report('error'); if (allowed() && retries < 4) { const delay = 3000 * 2 ** retries++; retry = setTimeout(() => { retry = undefined; void start(); }, delay); } };
  const start = async () => {
    stop(); if (!allowed()) return; const current = epoch, active = () => allowed() && current === epoch;
    report('connecting'); lastProgress = performance.now();
    timer = setInterval(() => {
      if (!active()) return;
      // Frames arrive in bursts over TURN and the doorbell wakes slowly: live as soon as a picture is decoded, a stall only after a long silence, and never while ICE is still negotiating.
      if (video.readyState >= 2 && video.videoWidth > 0 && !video.paused) { if (video.currentTime > lastTime) { lastTime = video.currentTime; lastProgress = performance.now(); } retries = 0; report('live'); if (!liveSince) liveSince = performance.now(); if (opts.onFrame && performance.now() - lastFrameAt > 5000 && performance.now() - liveSince > 1500) { lastFrameAt = performance.now(); capture(); } if (performance.now() - lastProgress > 45000) failed(); }
      else if (video.paused && video.srcObject) void video.play().catch(() => undefined);
      else if (performance.now() - lastProgress > (pc && (pc.connectionState === 'connecting' || pc.connectionState === 'new') ? 60000 : 40000)) failed();
    }, 1000);
    try {
      const cfg = await host.ws<{ configuration?: RTCConfiguration; getCandidatesUpfront?: boolean }>({ type: 'camera/webrtc/get_client_config', entity_id: entityId });
      if (!active()) return;
      const peer = new RTCPeerConnection(cfg.configuration ?? {}); pc = peer;
      peer.addTransceiver('video', { direction: 'recvonly' }); peer.addTransceiver('audio', { direction: 'recvonly' });
      peer.ontrack = ev => { const stream = ev.streams[0] ?? new MediaStream([ev.track]); if (video.srcObject !== stream) { video.srcObject = stream; void video.play().catch(() => undefined); } if (ev.track.kind === 'audio') opts.onAudio?.(true); };
      peer.onconnectionstatechange = () => { if (!active()) return; if (peer.connectionState === 'failed' || peer.connectionState === 'closed') failed(); };
      const queued: RTCIceCandidate[] = [];
      peer.onicecandidate = ev => { if (!ev.candidate || !active()) return; if (!session) { queued.push(ev.candidate); return; } void host.ws({ type: 'camera/webrtc/candidate', entity_id: entityId, session_id: session, candidate: { candidate: ev.candidate.candidate, sdp_m_line_index: ev.candidate.sdpMLineIndex ?? 0 } }).catch(() => undefined); };
      const offer = await peer.createOffer(); await peer.setLocalDescription(offer);
      if (cfg.getCandidatesUpfront) await new Promise<void>(res => { if (peer.iceGatheringState === 'complete') return res(); const t = setTimeout(res, 2500); peer.onicegatheringstatechange = () => { if (peer.iceGatheringState === 'complete') { clearTimeout(t); res(); } }; });
      if (!active()) return;
      const sdp = peer.localDescription?.sdp; if (!sdp) throw new Error('no offer');
      unsub = await host.subscribe<Message>({ type: 'camera/webrtc/offer', entity_id: entityId, offer: sdp }, m => {
        if (!active()) return;
        try {
          if (m.type === 'session') { session = m.session_id; for (const c of queued.splice(0)) void host.ws({ type: 'camera/webrtc/candidate', entity_id: entityId, session_id: session, candidate: { candidate: c.candidate, sdp_m_line_index: c.sdpMLineIndex ?? 0 } }).catch(() => undefined); }
          else if (m.type === 'answer') void peer.setRemoteDescription({ type: 'answer', sdp: m.answer }).catch(() => failed());
          else if (m.type === 'candidate') void peer.addIceCandidate(new RTCIceCandidate({ candidate: m.candidate.candidate, sdpMLineIndex: m.candidate.sdp_m_line_index ?? 0 })).catch(() => undefined);
          else if (m.type === 'error') failed();
        } catch { failed(); }
      });
      if (!active()) { stop(); }
    } catch { if (active()) failed(); }
  };
  const visibility = () => { if (document.hidden) { stop(); report('connecting'); } else void start(); };
  document.addEventListener('visibilitychange', visibility); void start();
  return { video, dispose() { disposed = true; document.removeEventListener('visibilitychange', visibility); stop(); video.remove(); } };
}
