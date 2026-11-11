import { dateFormat, houseDate, zoneOption } from '../runtime/zone.ts';
/** The header's and the rail's time, date and greeting by the HOUSE's clock (CODEX-014): a house in Chisinau opened in a browser set to another
 *  zone says the house's 00:30 and Wednesday, as the clock tile and its sheet do, never the browser's 17:30 and Tuesday. */
export function headWords(now: Date, locale: string): { time: string; date: string; greeting: 'overview.greeting.night' | 'overview.greeting.morning' | 'overview.greeting.day' | 'overview.greeting.evening' } {
  const zone = zoneOption(), h = houseDate(now.getTime()).getHours();
  return { time: dateFormat(locale, { hour: '2-digit', minute: '2-digit', ...zone }).format(now), date: dateFormat(locale, { weekday: 'long', day: 'numeric', month: 'long', ...zone }).format(now),
    greeting: h < 6 ? 'overview.greeting.night' : h < 12 ? 'overview.greeting.morning' : h < 18 ? 'overview.greeting.day' : 'overview.greeting.evening' };
}
