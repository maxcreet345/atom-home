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
export interface TileState { line: string | null; closed: boolean; icon: string | null; /** colour the line (a ring in the last minute, a low battery) */ tone?: 'danger' | 'warning' }
/** The sheet was opened by the house itself (a doorbell ring) and closes on its own: seconds left and a way to keep it. */
export interface AutoClose { left: number; keep(): void }
export interface ModuleSheetProps { device: HomeDevice; registry: Registry; entities: ModuleEntities; options: ModuleOptions; host: Host; t: T; lang: Lang; runner: Runner; onClose: () => void; room?: string; stage?: ComponentChildren; wide: boolean; /** admins may change the module's options from the sheet (auto-open, poster) */ setOption?(key: string, value: string | undefined): void; autoClose?: AutoClose | null }
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
  Player?: ComponentType<{ entities: ModuleEntities; options: ModuleOptions; host: Host; t: T; lang: Lang; mode: 'tile' | 'stage'; /** the camera's HA still (entity_picture) as a fallback poster */ poster?: string | null }>;
  /** Entity whose state change should open this module's sheet on every device (a doorbell ring); the sheet closes itself after `autoCloseSeconds`. */
  alarm?(entities: ModuleEntities, options: ModuleOptions): { entityId: string; seconds: number } | null;
  /** Entities the module shows inside its own card: they stop being cards of their own (the camera's switches are not fourteen tiles in «Systems»). */
  claims?(entities: ModuleEntities): string[];
  /** false: the Player only streams inside the sheet; the home tile shows the last frame (a battery doorbell). The large home tile goes to a camera that streams on the tile. */
  tileStreams?: boolean;
  /** Optional sheet that replaces the generic DeviceSheet for the card whose primary entity is `entities.camera`. */
  Sheet?: ComponentType<ModuleSheetProps>;
  /** Optional state for the camera tile (second line, closed lens, badge). */
  tileState?(registry: Registry, entities: ModuleEntities, t: T, lang: Lang): TileState;
}
