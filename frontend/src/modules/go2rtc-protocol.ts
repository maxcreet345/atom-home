/* go2rtc MSE protocol helpers (pure TypeScript, testable under Node). Independent implementation of the
 * public protocol: AlexxIT/go2rtc www/video-rtc.js (MIT) and home-assistant/frontend ingress.ts (Apache-2.0).
 * No player code is copied; credentials come from the authenticated HA session at runtime and are never stored. */
export const ADDON_SLUG = /^[a-z0-9]{8}_go2rtc$/;
export const STREAM_NAME = /^[A-Za-z0-9_.\-]{1,64}$/;
/** `camera.<addon slug>` → slug, the way the Supervisor names a generic camera fed by the go2rtc add-on. */
export function addonFromEntity(entityId: string): string | null { const m = /^camera\.([a-z0-9]{8}_go2rtc)$/.exec(entityId); return m ? m[1] : null; }
/** Accept only this add-on's same-origin ingress path. */
export function ingressPath(info: { slug?: unknown; ingress?: unknown; ingress_url?: unknown }, slug: string): string | null {
  if (info.slug !== slug || info.ingress !== true || typeof info.ingress_url !== 'string') return null;
  if (!/^\/api\/hassio_ingress\/[A-Za-z0-9_-]+\/?$/.test(info.ingress_url)) return null;
  return info.ingress_url.endsWith('/') ? info.ingress_url : info.ingress_url + '/';
}
export const validSession = (s: unknown): s is string => typeof s === 'string' && /^[A-Za-z0-9._~-]{16,512}$/.test(s);
/** Codecs we may ask go2rtc for; the browser's MediaSource decides which of them it can play. */
export const VIDEO_CODECS = ['avc1.640029', 'avc1.64002A', 'avc1.640033', 'avc1.42E01F', 'avc1.42001F', 'avc1.4D001F', 'hvc1.1.6.L153.B0', 'hev1.1.6.L153.B0'];
export const AUDIO_CODECS = ['opus', 'mp4a.40.2', 'flac'];
/** The MIME go2rtc answers with: `video/mp4; codecs="avc1.…[,opus]"`, nothing else. */
export function acceptMime(value: unknown, supported: (mime: string) => boolean): string | null {
  if (typeof value !== 'string' || value.length > 200) return null;
  const m = /^video\/mp4;\s*codecs="?([A-Za-z0-9.]+(?:,[A-Za-z0-9.]+)?)"?$/i.exec(value);
  if (!m) return null;
  const [video, audio] = m[1].split(',');
  if (!/^(avc1\.[0-9a-f]{6}|hvc1\.[0-9A-Za-z.]{1,24}|hev1\.[0-9A-Za-z.]{1,24})$/i.test(video)) return null;
  if (audio !== undefined && !AUDIO_CODECS.includes(audio.toLowerCase())) return null;
  return supported(value) ? value : null;
}
/** Pick a stream from go2rtc's `api/streams` listing: the configured one, else the first H.264-looking name, else the first. */
export function pickStream(names: string[], wanted?: string): string | null {
  const ok = names.filter(n => STREAM_NAME.test(n));
  if (wanted && STREAM_NAME.test(wanted)) return wanted;
  return ok.find(n => /h264|sd|sub/i.test(n)) ?? ok[0] ?? null;
}
