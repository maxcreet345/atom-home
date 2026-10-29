import { ADDON_SLUG, AUDIO_CODECS, VIDEO_CODECS, STREAM_NAME, acceptMime, ingressPath, pickStream, validSession } from './go2rtc-protocol.ts';
/** Live MSE player over the go2rtc add-on's ingress WebSocket (`api/ws?src=<stream>`). Muted, autoplay, reconnects with back-off, stops when hidden. */
export interface PlayerHost { ws<T = unknown>(message: Record<string, unknown>): Promise<T>; readonly online: boolean }
export interface PlayerOptions { addon: string; stream?: string; host: PlayerHost; onStatus?(status: PlayerStatus): void; /** called once when the stream reports live but renders only black for ~3 s (an H.265 stream the device cannot really decode) */ onBlack?(): void }
export type PlayerStatus = 'connecting' | 'live' | 'stalled' | 'error';
export interface Player { video: HTMLVideoElement; setStream(stream: string | undefined): void; dispose(): void }
const MAX_PENDING = 4 * 1024 * 1024, MAX_PENDING_CHUNKS = 512;
const MSE = (): typeof MediaSource | undefined => (globalThis as unknown as { ManagedMediaSource?: typeof MediaSource }).ManagedMediaSource ?? (typeof MediaSource !== 'undefined' ? MediaSource : undefined);
const managed = () => !!(globalThis as unknown as { ManagedMediaSource?: unknown }).ManagedMediaSource;
export const mseAvailable = () => !!MSE();
export function mountGo2rtcPlayer(container: HTMLElement, opts: PlayerOptions): Player {
  if (!ADDON_SLUG.test(opts.addon)) throw new Error('bad add-on slug');
  const { host } = opts;
  let stream = opts.stream, disposed = false, epoch = 0, retries = 0, status: PlayerStatus = 'connecting';
  let socket: WebSocket | null = null, buffer: SourceBuffer | null = null, objectUrl: string | null = null;
  let pending: Uint8Array<ArrayBuffer>[] = [], pendingBytes = 0, timer: ReturnType<typeof setInterval> | undefined, retry: ReturnType<typeof setTimeout> | undefined;
  let lastFrames = 0, lastTime = 0, lastProgress = 0, detach: Array<() => void> = [];
  let liveSince = 0, blackChecked = false;
  const looksBlack = () => { try { const c = document.createElement('canvas'); c.width = 32; c.height = 18; const ctx = c.getContext('2d', { willReadFrequently: true }); if (!ctx) return false; ctx.drawImage(video, 0, 0, 32, 18); const d = ctx.getImageData(0, 0, 32, 18).data; let max = 0; for (let i = 0; i < d.length; i += 4) { const v = Math.max(d[i], d[i + 1], d[i + 2]); if (v > max) max = v; } return max < 12; } catch { return false; } };
  const video = document.createElement('video'); video.muted = true; video.autoplay = true; video.playsInline = true; video.controls = false; container.append(video);
  const report = (s: PlayerStatus) => { if (status !== s) { status = s; opts.onStatus?.(s); } };
  const stop = () => {
    epoch++; if (timer) clearInterval(timer); timer = undefined; if (retry) clearTimeout(retry); retry = undefined;
    for (const d of detach) d(); detach = [];
    const ws = socket; socket = null; try { ws?.close(); } catch { /* closed */ }
    const sb = buffer; buffer = null; try { if (sb?.updating) sb.abort(); } catch { /* detached */ }
    pending = []; pendingBytes = 0; lastFrames = 0; lastTime = 0; liveSince = 0; blackChecked = false;
    video.pause(); video.removeAttribute('src'); video.srcObject = null; video.load();
    if (objectUrl) { URL.revokeObjectURL(objectUrl); objectUrl = null; }
  };
  const allowed = () => !disposed && container.isConnected && !document.hidden && host.online;
  const failed = (why: PlayerStatus = 'error') => {
    stop(); report(why);
    if (allowed() && retries < 4) { const delay = 3000 * 2 ** retries++; retry = setTimeout(() => { retry = undefined; void start(); }, delay); }
  };
  const start = async () => {
    stop(); if (!allowed()) return; const current = epoch, active = () => allowed() && current === epoch;
    report('connecting'); lastProgress = performance.now();
    timer = setInterval(() => {
      if (disposed || current !== epoch) return;
      if (!container.isConnected) { stop(); return; }
      if (!allowed()) return;
      const frames = video.getVideoPlaybackQuality?.().totalVideoFrames;
      const advanced = frames === undefined ? video.currentTime > lastTime : frames > lastFrames;
      if (video.readyState >= 2 && video.videoWidth > 0 && !video.paused && video.currentTime > lastTime && advanced) { lastProgress = performance.now(); lastTime = video.currentTime; if (frames !== undefined) lastFrames = frames; retries = 0; report('live'); if (!liveSince) liveSince = performance.now(); if (opts.onBlack && !blackChecked && performance.now() - liveSince > 3000) { blackChecked = true; if (looksBlack()) opts.onBlack(); } }
      else if (performance.now() - lastProgress > 15000) failed('stalled');
    }, 1000);
    try {
      const Source = MSE(); if (!Source) throw new Error('MSE unavailable');
      const codecs = [...VIDEO_CODECS.filter(c => Source.isTypeSupported(`video/mp4; codecs="${c}"`)), ...AUDIO_CODECS.filter(c => Source.isTypeSupported(`audio/mp4; codecs="${c}"`))];
      if (!codecs.length) throw new Error('no MSE codecs');
      const raw = await host.ws<{ data?: Record<string, unknown> } & Record<string, unknown>>({ type: 'supervisor/api', endpoint: `/addons/${opts.addon}/info`, method: 'get' });
      if (!active()) return;
      const path = ingressPath((raw.data ?? raw) as Record<string, unknown>, opts.addon); if (!path) throw new Error('ingress unavailable');
      const ingress = new URL(path, location.origin); if (ingress.origin !== location.origin) throw new Error('cross-origin ingress');
      const auth = await host.ws<{ session?: unknown }>({ type: 'supervisor/api', endpoint: '/ingress/session', method: 'post' });
      if (!active()) return; if (!validSession(auth.session)) throw new Error('bad ingress session');
      // Same cookie scope as Home Assistant's own frontend uses for ingress.
      document.cookie = `ingress_session=${auth.session};path=/api/hassio_ingress/;SameSite=Strict${location.protocol === 'https:' ? ';Secure' : ''}`;
      if (!stream) {
        const list = await fetch(new URL('api/streams', ingress).href, { credentials: 'same-origin' }).then(r => r.ok ? r.json() : {}).catch(() => ({})) as Record<string, unknown>;
        if (!active()) return;
        stream = pickStream(Object.keys(list && typeof list === 'object' ? list : {})) ?? undefined;
        if (!stream) throw new Error('no streams');
      }
      if (!STREAM_NAME.test(stream)) throw new Error('bad stream name');
      const ms = new Source();
      if (managed()) { video.disableRemotePlayback = true; (video as HTMLVideoElement & { srcObject: unknown }).srcObject = ms; } else { objectUrl = URL.createObjectURL(ms); video.src = objectUrl; }
      let opened = false, negotiated = false, requested = false;
      const wsUrl = new URL('api/ws', ingress); wsUrl.protocol = location.protocol === 'https:' ? 'wss:' : 'ws:'; wsUrl.searchParams.set('src', stream);
      const ws = new WebSocket(wsUrl.href); socket = ws; ws.binaryType = 'arraybuffer';
      const play = () => { void video.play().catch(() => { if (active()) failed(); }); };
      const request = () => { if (active() && opened && !requested && ms.readyState === 'open') { requested = true; try { ws.send(JSON.stringify({ type: 'mse', value: codecs.join(',') })); } catch { if (active()) failed(); } } };
      const on = <K extends keyof MediaSourceEventMap>(target: MediaSource, type: K, fn: () => void) => { target.addEventListener(type, fn); detach.push(() => target.removeEventListener(type, fn)); };
      on(ms, 'sourceopen', request);
      const drain = () => {
        if (!active() || !buffer || buffer.updating) return;
        try {
          if (pending.length) { const next = pending.shift()!; pendingBytes -= next.byteLength; buffer.appendBuffer(next); return; }
          const ranges = buffer.buffered;
          if (ranges.length) {
            const end = ranges.end(ranges.length - 1), startAt = ranges.start(0), cut = end - 5;
            if (video.currentTime < end - 3) video.currentTime = Math.max(startAt, end - .3);
            if (cut > startAt + .5) { buffer.remove(startAt, cut); return; }
            if (ms.readyState === 'open') ms.setLiveSeekableRange(Math.max(startAt, end - 5), end);
          }
        } catch { if (active()) failed(); }
      };
      const wsOpen = () => { opened = true; request(); };
      const wsMessage = (event: MessageEvent) => {
        if (!active()) return;
        try {
          if (typeof event.data === 'string') {
            if (event.data.length > 4096) throw new Error('oversized message');
            const message = JSON.parse(event.data) as { type?: string; value?: unknown };
            if (message.type === 'error') throw new Error('stream rejected');
            if (message.type !== 'mse' || negotiated) return;
            const mime = acceptMime(message.value, m => Source.isTypeSupported(m)); if (!mime || ms.readyState !== 'open') throw new Error('unsupported MIME');
            negotiated = true; buffer = ms.addSourceBuffer(mime); buffer.mode = 'segments';
            const sb = buffer, upd = () => drain(), err = () => { if (active()) failed(); };
            sb.addEventListener('updateend', upd); sb.addEventListener('error', err); detach.push(() => { sb.removeEventListener('updateend', upd); sb.removeEventListener('error', err); });
            play(); return;
          }
          if (!(event.data instanceof ArrayBuffer) || !negotiated || !buffer) throw new Error('unexpected payload');
          if (event.data.byteLength === 0 || event.data.byteLength > MAX_PENDING || pendingBytes + event.data.byteLength > MAX_PENDING || pending.length >= MAX_PENDING_CHUNKS) throw new Error('queue limit');
          pending.push(new Uint8Array(event.data)); pendingBytes += event.data.byteLength; drain();
        } catch { if (active()) failed(); }
      };
      const wsFail = () => { if (active()) failed(); };
      ws.addEventListener('open', wsOpen); ws.addEventListener('message', wsMessage); ws.addEventListener('close', wsFail); ws.addEventListener('error', wsFail);
      detach.push(() => { ws.removeEventListener('open', wsOpen); ws.removeEventListener('message', wsMessage); ws.removeEventListener('close', wsFail); ws.removeEventListener('error', wsFail); });
      play();
    } catch { if (active()) failed(); }
  };
  const visibility = () => { if (document.hidden) { stop(); report('connecting'); } else void start(); };
  const mediaError = () => { if (allowed() && socket) failed(); };
  document.addEventListener('visibilitychange', visibility); video.addEventListener('error', mediaError); void start();
  return {
    video,
    setStream(next) { if (next === stream) return; stream = next; retries = 0; void start(); },
    dispose() { disposed = true; document.removeEventListener('visibilitychange', visibility); video.removeEventListener('error', mediaError); stop(); video.remove(); },
  };
}
