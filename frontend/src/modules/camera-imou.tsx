import type { ModuleDef, TileState } from './types.ts';
import { cameraImouSpec, IMOU_ROLES } from './catalog.ts';
import { Go2rtcView, DualView } from './go2rtc-view.tsx';
import { CameraSheet } from './camera-go2rtc.tsx';
import type { Key } from '../i18n/index.ts';
/** Imou Ranger 2C, the C700's way (owner, 09.11.2026: «один в один как C700, только видео наши локальные ONVIF и Generic»): tiles play the ONVIF 352p H.264 profile through HA's WebRTC,
 * the sheet opens on it and moves to the HD RTSP (H.265) once that plays; the shutter is «Закрыть объектив», the cloud's arrows turn it. */
export const cameraImou: ModuleDef = {
  ...cameraImouSpec,
  Card: () => null,
  claims: e => IMOU_ROLES.map(r => r.role).filter(r => r !== 'camera').map(r => e[r]).filter((x): x is string => !!x),
  sensors: e => [e.motionEvent].filter((x): x is string => !!x),
  tileState: (registry, e, t): TileState => {
    const on = (role: string) => !!e[role] && registry.states[e[role]!]?.state === 'on';
    const closed = on('privacy');
    return { line: closed ? t('module.camera.closed' as Key) : on('motionTracking') ? t('module.imou.motionTracking' as Key) : null, closed, icon: !closed && on('motionTracking') ? 'motion' : null };
  },
  Sheet: CameraSheet,
  Player: ({ entities, host, t, mode, poster }) => { const low = { options: {}, host, t, mode, poster, webrtcEntity: entities.camera };
    return mode === 'tile' || !entities.hd ? <Go2rtcView {...low} /> : <DualView low={low} high={{ ...low, webrtcEntity: entities.hd }} />; },
};
