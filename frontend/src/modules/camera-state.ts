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
