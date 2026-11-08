import type { ModuleDef, ModuleEntities, ModuleOptions } from './types.ts';
import type { Registry } from '../model/registry.ts';
import type { HouseConfig } from '../model/config.ts';
import { activeSpecs } from './catalog.ts';
import { boilerEbus } from './boiler-ebus.tsx';
import { cameraGo2rtc } from './camera-go2rtc.tsx';
import { petFeeder } from './pet-feeder.tsx';
import { air } from './air.tsx';
import { doorbell } from './doorbell.tsx';
import { clock } from './clock.tsx';
import { cameraOnvif } from './camera-onvif.tsx';
export const MODULES: ModuleDef[] = [boilerEbus, doorbell, cameraGo2rtc, cameraOnvif, petFeeder, air, clock] // the doorbell first: it is the main camera of the Cameras card (owner, 09.11.2026);
export interface ActiveModule { def: ModuleDef; entities: ModuleEntities; label: string; options: ModuleOptions }
export function activeModules(registry: Registry, config: HouseConfig): ActiveModule[] {
  return activeSpecs(registry, config, MODULES).map(a => ({ def: MODULES.find(m => m.id === a.spec.id)!, entities: a.entities, label: a.label, options: a.options }));
}
/** Entity ids that active modules draw inside their own cards. */
export function claimedEntities(registry: Registry, config: HouseConfig, modules: ActiveModule[] = activeModules(registry, config)): Set<string> {
  return new Set(modules.flatMap(m => m.def.claims?.(m.entities) ?? []));
}
export type { ModuleDef, ModuleEntities, ModuleOptions, ModuleSheetProps, TileState, AutoClose } from './types.ts';
