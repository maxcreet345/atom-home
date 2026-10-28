/** Stock illustrations: a room type is guessed from the area name (ru/ro/en keywords); own photos from HouseConfig take precedence. */
// Vite inlines the glob at build time; under the Node test runner `import.meta.glob` does not exist, so fall back to an empty map.
let files: Record<string, string> = {};
try { files = import.meta.glob('../art/room-*.webp', { eager: true, query: '?url', import: 'default' }) as Record<string, string>; } catch { files = {}; }
const art = (name: string) => files[`../art/room-${name}.webp`];
export type RoomType = 'living' | 'kitchen' | 'bedroom' | 'kids' | 'bathroom' | 'hall' | 'office' | 'storage';
const KEYWORDS: Array<[RoomType, RegExp]> = [
  ['kids', /детск|ребен|ребён|child|kid|nursery|copi|copil/i],
  ['bathroom', /ванн|туалет|санузел|душ|bath|toilet|wc|baie|duș|dus/i],
  ['kitchen', /кухн|столов|kitchen|dining|bucătăr|bucatar/i],
  ['bedroom', /спальн|bedroom|dormitor/i],
  ['office', /кабинет|компьютер|компьетер|office|study|birou|work/i],
  ['storage', /кладов|гардероб|чулан|storage|closet|pantry|debara|cămar|camar/i],
  ['hall', /прихож|коридор|холл|подъезд|подьезд|вход|hall|corridor|entry|entrance|hol|coridor|intrare/i],
  ['living', /гостин|зал|living|lounge|salon|sufragerie/i],
];
export function roomType(name: string): RoomType | null { for (const [type, re] of KEYWORDS) if (re.test(name)) return type; return null; }
export function stockRoomArt(name: string): string | null { const type = roomType(name); return type ? art(type) ?? null : null; }
export const stockRoomTypes: RoomType[] = ['living', 'kitchen', 'bedroom', 'kids', 'bathroom', 'hall', 'office', 'storage'];
export const stockArtOfType = (type: RoomType) => art(type) ?? null;
