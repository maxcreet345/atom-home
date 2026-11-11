import type { StateRow } from '../model/registry.ts';
import type { ModuleEntities, TileState } from './types.ts';
import { CAMERA_CONTROL_ROLES } from './catalog.ts';
/** Pure helpers of the camera module (testable under Node): which entities it claims and what the tile says. */
export const cameraClaims = (entities: ModuleEntities): string[] => CAMERA_CONTROL_ROLES.map(r => entities[r.role]).filter((id): id is string => !!id);
/** One line for the tile: closed lens first, then what the camera is doing by itself, then sound; a badge while it turns on its own. */
export function cameraTileState(states: Record<string, StateRow>, entities: ModuleEntities, t: (key: string) => string): TileState {
  const s = (role: string) => { const id = entities[role]; return id ? states[id] : undefined; };
  const on = (role: string) => s(role)?.state === 'on';
  const closed = s('power')?.state === 'off';
  const moving = !closed && (on('cruise') || on('tracking') || on('petTracking'));
  const line = closed ? t('module.camera.closed') : on('cruise') ? t('module.camera.cruise') : on('tracking') ? t('module.camera.tracking') : on('petTracking') ? t('module.camera.petTracking') : on('mute') ? t('module.camera.muted') : s('night')?.state === 'On' ? t('module.camera.night.always') : null;
  return { line, closed, icon: moving ? 'motion' : null };
}
/** Readable words for the MIoT memory-card status the integration reports. */
export function sdStatusLabel(state: string | undefined, t: (key: string) => string): string {
  const v = (state ?? '').toLowerCase();
  if (!v || v === 'unknown' || v === 'unavailable') return '—';
  if (v === 'normal') return t('module.camera.sd.normal');
  if (v === 'non existent' || v === 'non-existent') return t('module.camera.sd.none');
  if (v === 'full' || v === 'not enough space') return t('module.camera.sd.full');
  return t('module.camera.sd.problem');
}
/** Is HD «not supported here»? Only when the SD stream played in this sheet and the HD one failed before its first frame: an error after HD played is a reconnect
 * like any other, and an error while nothing plays (no link) says nothing about HD. A black HD picture is reported apart (the player's onBlack). */
export const hdUnsupported = (hd: boolean, status: string, hdWasLive: boolean, sdWasLive: boolean): boolean => hd && status === 'error' && !hdWasLive && sdWasLive;
/** Has a tile's player lost the picture? Yes after eight seconds without one (`slow`), and it stays so until a frame arrives: a tile that is paused
 * (off the screen, behind a sheet, the tab hidden) keeps what it last knew — the Cameras summary counts every camera, not only the tiles in sight —
 * and a tile that is trying again is still without a picture. */
export const pictureLost = (was: boolean, status: string, slow: boolean): boolean => status === 'live' ? false : status === 'paused' ? was : was || slow;
/** Is the add-on's stream itself broken (then HA's own WebRTC is tried)? An «error» while the house is off the line says nothing about the add-on. */
export const mseBroken = (status: string, online: boolean): boolean => status === 'error' && online;
/** «Во весь экран» of a camera sheet's stage (the doorbell's and CameraSheet's; studio ST-08). The shell lets the first Escape leave the full screen only
 * (ui/app.tsx); this side puts the sheet back as it stood and gives the keyboard back to the button that opened it, once THIS stage has left the full
 * screen — a frame later, without scrolling, and only while that button is still on the page. Whose full screen it is goes by the stage's own root (a shadow root's fullscreenElement is
 * the stage, the document's would be the host). A refused request moves nothing and leaves no unhandled rejection; a browser without Element Fullscreen
 * (an iPhone) plays the video's own, as before. One watch per sheet: a second «Во весь экран» replaces the first, `stop()` on unmount ends both the
 * listener and a focus still waiting for its frame. */
export interface StageFullscreen { open(stage: HTMLElement, opener: HTMLElement | null): void; stop(): void }
type WebkitVideo = HTMLVideoElement & { webkitEnterFullscreen?: () => void };
export function stageFullscreen(): StageFullscreen {
  let off: (() => void) | null = null;
  const stop = () => { const f = off; off = null; f?.(); };
  const native = (stage: HTMLElement) => { try { (stage.querySelector('video') as WebkitVideo | null)?.webkitEnterFullscreen?.(); } catch { /* the video cannot go full screen now: nothing moves */ } };
  return { stop, open(stage, opener) {
    stop();
    if (!stage.requestFullscreen) { native(stage); return; }
    const doc = stage.ownerDocument, root = stage.getRootNode() as Document | ShadowRoot, win = doc.defaultView;
    // while the stage is full screen it leaves the sheet's flow, the sheet gets shorter and the browser clamps its scroll (a phone on its side came back
    // to the top of the sheet): where each scrolled column stood is put back as the stage returns
    const scrolled: Array<[Element, number, number]> = [];
    for (let el: Element | null = stage.parentElement ?? null; el; el = el.parentElement ?? ((el.parentNode as ShadowRoot | null)?.host ?? null)) if (el.scrollTop || el.scrollLeft) scrolled.push([el, el.scrollTop, el.scrollLeft]);
    let inside = false, frame = 0;
    const change = () => {
      if (root.fullscreenElement === stage) { inside = true; return; }
      if (!inside) return; // somebody else's full screen came and went
      doc.removeEventListener('fullscreenchange', change); // one full screen, one way back
      const back = () => { frame = 0; if (stage.isConnected) for (const [el, top, left] of scrolled) { el.scrollTop = top; el.scrollLeft = left; } if (opener?.isConnected) opener.focus({ preventScroll: true }); };
      if (win) frame = win.requestAnimationFrame(back); else back();
    };
    doc.addEventListener('fullscreenchange', change);
    const mine = () => { doc.removeEventListener('fullscreenchange', change); if (frame) win?.cancelAnimationFrame(frame); frame = 0; };
    off = mine;
    let asked: Promise<void> | undefined;
    try { asked = stage.requestFullscreen(); } catch (e) { asked = Promise.reject(e); }
    // refused (no tap behind it, a frame that does not allow it): the listener goes — not a newer «Во весь экран»'s — and the video's own full screen is tried
    void Promise.resolve(asked).catch(() => { if (!inside && off === mine) stop(); native(stage); });
  } };
}
/** Cameras whose tile cannot show a picture right now (the player gave «нет связи» or the camera is away), by the camera's entity id.
 * The players write it, the Cameras card and panel read it: the summary and the caption say what the frame shows. */
const down = new Set<string>(), watchers = new Set<() => void>(), left = new Map<string, number>();
/** How long a tile that went away without a picture is remembered: the moment its camera's sheet takes its place. */
export const LEFT_DOWN_MS = 5000;
export const playerDown = {
  has: (camera: string) => down.has(camera),
  set(camera: string, on: boolean) { left.delete(camera); if (down.has(camera) === on) return; if (on) down.add(camera); else down.delete(camera); for (const f of [...watchers]) f(); },
  /** The tile is gone (its camera's sheet opened over the card, the page was left): it counts for nothing any more, but what it knew is kept for a moment. */
  leave(camera: string, now = Date.now()) { const was = down.has(camera); this.set(camera, false); if (was) left.set(camera, now); },
  /** Was this camera's tile without a picture when it was last seen (now, or a moment ago when it made way for the sheet)? The sheet then opens on «Нет связи с камерой» with «Повторить» at once. */
  gaveUp: (camera: string, now = Date.now()) => down.has(camera) || now - (left.get(camera) ?? -Infinity) < LEFT_DOWN_MS,
  subscribe(fn: () => void) { watchers.add(fn); return () => { watchers.delete(fn); }; },
};
