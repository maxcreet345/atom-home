import type { Registry } from '../model/registry.ts';
import type { Host } from '../runtime/host.ts';
import type { T } from '../i18n/index.ts';
import type { Lang } from '../ui/format.ts';
import type { ComponentType } from 'preact';
/** A house-specific module: detects its hardware in the registry, draws its own card, reads entities it was given. */
export interface ModuleEntities { [role: string]: string | undefined }
export interface ModuleOptions { [key: string]: string | undefined }
export interface ModuleMatch { entities: ModuleEntities; label: string; options?: ModuleOptions }
export interface ModuleOptionField { key: string; labelKey: string; required: boolean; placeholder?: string }
export interface ModuleDef {
  id: string; titleKey: string; roles: Array<{ role: string; labelKey: string; required: boolean }>;
  /** Free-text settings (stream names, add-on slug…) the owner may override in the configurator. */
  options?: ModuleOptionField[];
  /** Suggest entity ids from the registry; null when the hardware is absent. */
  detect(registry: Registry): ModuleMatch | null;
  /** Where the card goes: a section screen and/or the overview status row. */
  placement: Array<'climate' | 'overview' | 'systems'>;
  Card: ComponentType<{ registry: Registry; entities: ModuleEntities; options: ModuleOptions; host: Host; t: T; lang: Lang; compact?: boolean }>;
  /** Optional live player that replaces the still image of the camera named by `entities.camera` (overview tile and the device sheet). */
  Player?: ComponentType<{ entities: ModuleEntities; options: ModuleOptions; host: Host; t: T; lang: Lang; mode: 'tile' | 'stage' }>;
}
