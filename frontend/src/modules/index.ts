import type { ModuleDef, ModuleEntities, ModuleOptions } from './types.ts';
import type { Registry } from '../model/registry.ts';
import type { HouseConfig } from '../model/config.ts';
import { activeSpecs } from './catalog.ts';
import { rememberByShape } from '../runtime/remember-modules.ts';
import { boilerEbus } from './boiler-ebus.tsx';
import { cameraGo2rtc } from './camera-go2rtc.tsx';
import { petFeeder } from './pet-feeder.tsx';
import { air } from './air.tsx';
import { doorbell } from './doorbell.tsx';
import { clock } from './clock.tsx';
import { cameraOnvif } from './camera-onvif.tsx';
import { cameraImou } from './camera-imou.tsx';
import { kettle } from './kettle.tsx';
export const MODULES: ModuleDef[] = [boilerEbus, doorbell, cameraGo2rtc, cameraOnvif, cameraImou, petFeeder, air, clock, kettle] // the doorbell first: it is the main camera of the Cameras card (owner, 09.11.2026);
export interface ActiveModule { def: ModuleDef; entities: ModuleEntities; label: string; options: ModuleOptions }
export function activeModules(registry: Registry, config: HouseConfig): ActiveModule[] {
  return activeSpecs(registry, config, MODULES).map(a => ({ def: MODULES.find(m => m.id === a.spec.id)!, entities: a.entities, label: a.label, options: a.options }));
}
/** `activeModules` with a memory (audit 2026-11-09, round 2, PERF-1: a quarter of every redraw went into finding the same modules again).
 *  One per panel; the same array comes back until the modules themselves change (runtime/remember-modules.ts). */
export const rememberModules = (): ((registry: Registry, config: HouseConfig) => ActiveModule[]) => rememberByShape(activeModules, list => JSON.stringify(list.map(m => [m.def.id, m.label, m.entities, m.options])));
/** Entity ids that active modules draw inside their own cards. */
export function claimedEntities(registry: Registry, config: HouseConfig, modules: ActiveModule[] = activeModules(registry, config)): Set<string> {
  return new Set(modules.flatMap(m => m.def.claims?.(m.entities) ?? []));
}
export type { ModuleDef, ModuleEntities, ModuleOptions, ModuleSheetProps, TileState, AutoClose } from './types.ts';
