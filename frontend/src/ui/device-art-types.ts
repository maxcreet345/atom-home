/** Stock device illustrations — types and the guess from kind/name (pure TypeScript, testable under Node). */
import type { Kind } from '../model/kinds.ts';
export type DeviceArtType = 'thermostat' | 'radiator' | 'light' | 'chandelier' | 'vacuum' | 'camera' | 'socket' | 'valve' | 'leak' | 'thermometer' | 'media' | 'panel' | 'boiler' | 'feeder';
export const DEVICE_ART_TYPES: DeviceArtType[] = ['thermostat', 'radiator', 'light', 'chandelier', 'vacuum', 'camera', 'socket', 'valve', 'leak', 'thermometer', 'media', 'panel', 'boiler', 'feeder'];
/** Guess the illustration from the card kind and name (ru/ro/en keywords); null when no stock picture fits. */
export function deviceArtType(kind: Kind | string, name = '', model = ''): DeviceArtType | null {
  const s = `${name} ${model}`;
  switch (kind) {
    case 'climate': return /термоголов|радиатор|radiator|valve|trv|calorifer|robinet/i.test(s) ? 'radiator' : 'thermostat';
    case 'light': return /люстр|chandelier|candelabr|lustr/i.test(s) ? 'chandelier' : 'light';
    case 'vacuum': return 'vacuum';
    case 'camera': return 'camera';
    case 'socket': return 'socket';
    case 'switch': return /розетк|socket|priz|plug|outlet/i.test(s) ? 'socket' : null;
    case 'valve': return 'valve';
    case 'leak': return 'leak';
    case 'environment': return 'thermometer';
    case 'media': return 'media';
    case 'energy': return /щит|panel|tablou|distribut|meter|счётчик|счетчик/i.test(s) ? 'panel' : null;
    default: return /котёл|котел|boiler|cazan|centrala/i.test(s) ? 'boiler' : /кормушк|feeder|hrănitor|hranitor/i.test(s) ? 'feeder' : null;
  }
}
