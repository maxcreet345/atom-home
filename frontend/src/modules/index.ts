import type { ModuleDef, ModuleEntities, ModuleOptions } from './types.ts';
import type { Registry } from '../model/registry.ts';
import type { HouseConfig } from '../model/config.ts';
import { activeSpecs } from './catalog.ts';
import { boilerEbus } from './boiler-ebus.tsx';
import { cameraGo2rtc } from './camera-go2rtc.tsx';
import { petFeeder } from './pet-feeder.tsx';
export const MODULES: ModuleDef[] = [boilerEbus, cameraGo2rtc, petFeeder];
export interface ActiveModule { def: ModuleDef; entities: ModuleEntities; label: string; options: ModuleOptions }
export function activeModules(registry: Registry, config: HouseConfig): ActiveModule[] {
  return activeSpecs(registry, config, MODULES).map(a => ({ def: MODULES.find(m => m.id === a.spec.id)!, entities: a.entities, label: a.label, options: a.options }));
}
export type { ModuleDef, ModuleEntities, ModuleOptions } from './types.ts';
