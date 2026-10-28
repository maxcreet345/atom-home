import type { ModuleDef, ModuleEntities } from './types.ts';
import type { Registry } from '../model/registry.ts';
import type { HouseConfig } from '../model/config.ts';
import { activeSpecs } from './catalog.ts';
import { boilerEbus } from './boiler-ebus.tsx';
export const MODULES: ModuleDef[] = [boilerEbus];
export interface ActiveModule { def: ModuleDef; entities: ModuleEntities; label: string }
export function activeModules(registry: Registry, config: HouseConfig): ActiveModule[] {
  return activeSpecs(registry, config, MODULES).map(a => ({ def: MODULES.find(m => m.id === a.spec.id)!, entities: a.entities, label: a.label }));
}
export type { ModuleDef, ModuleEntities } from './types.ts';
