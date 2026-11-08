import type { ModuleDef } from './types.ts';
import { cameraOnvifSpec } from './catalog.ts';
import { Go2rtcView, DualView } from './go2rtc-view.tsx';
/** Two-lens ONVIF camera: each lens is a card of its own; tiles and the panel play the lens's H.264 profile through HA's WebRTC (the HD stream is H.265, which phones do not decode). */
const lensOf = (entities: Record<string, string | undefined>, camera?: string) => camera && camera === entities.camera2 ? { hd: entities.camera2, sd: entities.sd2 } : { hd: entities.camera, sd: entities.sd };
export const cameraOnvif: ModuleDef = {
  ...cameraOnvifSpec,
  Card: () => null,
  cameras: e => [e.camera, e.camera2].filter((x): x is string => !!x),
  // the ONVIF events are the device's, not a lens's: they light up the first lens only, so one person is one event
  sensors: (e, camera) => camera === e.camera ? [e.person, e.vehicle, e.pet, e.motion, e.motionCell].filter((x): x is string => !!x) : [],
  claims: e => [e.camera !== e.sd ? e.sd : undefined, e.camera2 !== e.sd2 ? e.sd2 : undefined, e.person, e.pet, e.vehicle, e.motion, e.motionCell, e.reboot, e.setTime].filter((x): x is string => !!x),
  // tiles: the lens's 360p H.264 profile; the sheet opens on it and moves to the HD stream once that plays (H.265: a phone that cannot decode it keeps 360p)
  Player: ({ entities, host, t, mode, poster, camera }) => { const l = lensOf(entities, camera), low = { options: {}, host, t, mode, poster, webrtcEntity: l.sd ?? l.hd };
    return mode === 'tile' || !l.sd || !l.hd || l.sd === l.hd ? <Go2rtcView {...low} /> : <DualView low={low} high={{ ...low, webrtcEntity: l.hd }} />; },
};
