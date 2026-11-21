/* Every appliance family's pure part (types.ts). The catalog's profiles and the tiles read it; the UI is in index.ts. */
import type { ApplianceFamily } from './types.ts';
import { family as media } from './media.profiles.ts';
import { family as speaker } from './speaker.profiles.ts';
import { family as laundry } from './laundry.profiles.ts';
import { family as humidifier } from './humidifier.profiles.ts';
import { family as scale } from './scale.profiles.ts';
import { family as dashcam } from './dashcam.profiles.ts';
import { family as nas } from './nas.profiles.ts';
import { family as gasmeter } from './gasmeter.profiles.ts';
export const FAMILIES: ApplianceFamily[] = [media, speaker, laundry, humidifier, scale, dashcam, nas, gasmeter];
export const APPLIANCE_PROFILES = FAMILIES.flatMap(f => f.profiles);
export const familyOf = (id: string | undefined) => FAMILIES.find(f => f.id === id) ?? null;
