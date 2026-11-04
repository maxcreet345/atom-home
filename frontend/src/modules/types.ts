import type { Registry } from '../model/registry.ts';
import type { Host } from '../runtime/host.ts';
import type { T } from '../i18n/index.ts';
import type { Lang } from '../ui/format.ts';
import type { HomeDevice } from '../model/discover.ts';
import type { Runner } from '../ui/sheet.tsx';
import type { ComponentChildren, ComponentType } from 'preact';
/** A house-specific module: detects its hardware in the registry, draws its own card, reads entities it was given. */
export interface ModuleEntities { [role: string]: string | undefined }
export interface ModuleOptions { [key: string]: string | undefined }
export interface ModuleMatch { entities: ModuleEntities; label: string; options?: ModuleOptions }
export interface ModuleOptionField { key: string; labelKey: string; required: boolean; placeholder?: string }
/** What a module tells the camera tile about the device it serves: a one-line state, whether the lens is closed, an optional badge icon. */
export interface TileState { line: string | null; closed: boolean; icon: string | null }
export interface ModuleSheetProps { device: HomeDevice; registry: Registry; entities: ModuleEntities; options: ModuleOptions; host: Host; t: T; lang: Lang; runner: Runner; onClose: () => void; room?: string; stage?: ComponentChildren; wide: boolean }
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
  /** Entities the module shows inside its own card: they stop being cards of their own (the camera's switches are not fourteen tiles in «Systems»). */
  claims?(entities: ModuleEntities): string[];
  /** Optional sheet that replaces the generic DeviceSheet for the card whose primary entity is `entities.camera`. */
  Sheet?: ComponentType<ModuleSheetProps>;
  /** Optional state for the camera tile (second line, closed lens, badge). */
  tileState?(registry: Registry, entities: ModuleEntities, t: T): TileState;
}
