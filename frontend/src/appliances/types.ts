/* An appliance family (src/appliances/<family>.*): the cards of the catalog's `renderer: 'appliance'` profiles. Unlike a module (one per house)
 * a family draws one card PER INSTANCE: three TVs are three cards, each reading and driving only the entities bound to it (`view.instance.bindings`,
 * `view.instance.deviceId`). Two files per family, so that the model stays free of the UI:
 *  - `<family>.profiles.ts` — pure: its catalog profiles (by make and model) and the second line of its tile;
 *  - `<family>.tsx`         — its sheet (the card a tap opens).
 * Words: src/i18n/words-<family>.ts, ru = ro = en by keys. */
import type { ComponentType } from 'preact';
import type { Profile, ProfileInstance, InstanceView } from '../model/card-catalog.ts';
import type { Registry } from '../model/registry.ts';
import type { Host } from '../runtime/host.ts';
import type { T } from '../i18n/index.ts';
import type { Lang } from '../ui/format.ts';
import type { Runner } from '../ui/sheet.tsx';
/** Pure part of a family. */
export interface ApplianceFamily {
  id: string;
  /** one profile per make and model, every one with `renderer: 'appliance'` and `card: <id>` */
  profiles: Profile[];
  /** the second line of the card's tile («Идёт стирка · 42 мин», «Нетфликс · 34 %»); null: the generic state of its main field */
  tileLine?(registry: Registry, instance: ProfileInstance, t: T, lang: Lang): string | null;
}
export interface ApplianceSheetProps {
  view: InstanceView; registry: Registry; host: Host; t: T; lang: Lang; runner: Runner;
  onClose: () => void; room?: string; /** a tablet or a phone on its side: two columns */ wide: boolean;
}
/** UI part of a family. */
export interface ApplianceUi { id: string; Sheet: ComponentType<ApplianceSheetProps> }
