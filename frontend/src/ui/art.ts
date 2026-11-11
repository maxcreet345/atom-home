/** Stock pictures: a room's kind is guessed from the area's name (ru/ro/en keywords); the owner's own photo from HouseConfig takes precedence.
 * The pictures themselves are drawn (room-art.ts, 1.27.0): the photoreal night interiors of 1.18–1.26 are gone. */
import { roomArtUrl, type Theme } from './room-art.ts';
export type RoomType = 'living' | 'kitchen' | 'bedroom' | 'kids' | 'bathroom' | 'hall' | 'office' | 'storage';
const KEYWORDS: Array<[RoomType, RegExp]> = [
  // Corridors first: «Коридор у ванной» leads to the bathroom but is a hall.
  ['hall', /коридор|прихож|холл|подъезд|подьезд|corridor|hallway|coridor|\bhol\b/i],
  ['kids', /детск|ребен|ребён|child|kid|nursery|copi|copil/i],
  ['bathroom', /ванн|туалет|санузел|душ|bath|toilet|wc|baie|duș|dus/i],
  ['kitchen', /кухн|столов|kitchen|dining|bucătăr|bucatar/i],
  ['bedroom', /спальн|bedroom|dormitor/i],
  ['office', /кабинет|компьютер|компьетер|office|study|birou|work/i],
  ['storage', /склад|кладов|гардероб|чулан|storage|closet|pantry|debara|cămar|camar|depozit|magazie/i],
  ['hall', /прихож|коридор|холл|подъезд|подьезд|вход|hall|corridor|entry|entrance|hol|coridor|intrare/i],
  ['living', /гостин|зал|living|lounge|salon|sufragerie/i],
];
export function roomType(name: string): RoomType | null { for (const [type, re] of KEYWORDS) if (re.test(name)) return type; return null; }
/** The drawn picture of a room, with its ground, as an image address: what a room's photo slot shows until the owner sets his own. */
export function stockRoomArt(name: string, theme: Theme = 'light'): string { return roomArtUrl(roomType(name) ?? 'other', theme, true); }
export const stockRoomTypes: RoomType[] = ['living', 'kitchen', 'bedroom', 'kids', 'bathroom', 'hall', 'office', 'storage'];
