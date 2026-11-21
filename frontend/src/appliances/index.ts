/* Every appliance family's sheet (types.ts). */
import type { ApplianceUi } from './types.ts';
import { ui as media } from './media.tsx';
import { ui as speaker } from './speaker.tsx';
import { ui as laundry } from './laundry.tsx';
import { ui as humidifier } from './humidifier.tsx';
import { ui as scale } from './scale.tsx';
import { ui as dashcam } from './dashcam.tsx';
import { ui as nas } from './nas.tsx';
import { ui as gasmeter } from './gasmeter.tsx';
export const APPLIANCE_UI: ApplianceUi[] = [media, speaker, laundry, humidifier, scale, dashcam, nas, gasmeter];
export const applianceUi = (id: string | undefined) => APPLIANCE_UI.find(f => f.id === id) ?? null;
