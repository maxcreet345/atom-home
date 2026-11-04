/** Pure rules for the light card: which `light.*` entities are lamps of a room, what a lamp can do, and the colours the sheet draws. No UI. */
const num = (v: unknown, d: number) => typeof v === 'number' && Number.isFinite(v) ? v : d;
const modes = (a: Record<string, unknown>) => Array.isArray(a.supported_color_modes) ? a.supported_color_modes.filter((m): m is string => typeof m === 'string') : [];
/** Kinds of a device whose light is its indicator (camera LED, speaker ring), never a lamp of the room. */
export const APPLIANCE_KINDS: readonly string[] = ['camera', 'media', 'vacuum', 'climate', 'fan'];
/** A lamp's second light: ambient ring, backlight, night light. Lives inside the lamp's card. */
export const isAmbientLight = (id: string, name: string) => /ambient|backlight|night_?light|подсвет|ночник/i.test(`${id} ${name}`);
/** A status light of a hub, plug or camera: the owner never switches it like a lamp («лампочка хаба нахуй не нужна»). */
export const isIndicatorLight = (id: string, name: string) => /indicator|индикатор|status_?light|(^|[_\s])led([_\s]|$)|светодиод/i.test(`${id} ${name}`);
export const isDimmable = (a: Record<string, unknown>) => modes(a).some(m => m !== 'onoff');
export const hasColorTemp = (a: Record<string, unknown>) => modes(a).includes('color_temp');
export const hasColor = (a: Record<string, unknown>) => modes(a).some(m => ['rgb', 'rgbw', 'rgbww', 'hs', 'xy'].includes(m));
export const brightnessPct = (a: Record<string, unknown>): number | null => typeof a.brightness === 'number' ? Math.max(1, Math.round(a.brightness / 2.55)) : null;
export const kelvinOf = (a: Record<string, unknown>): number | null => typeof a.color_temp_kelvin === 'number' ? a.color_temp_kelvin : null;
export const kelvinRange = (a: Record<string, unknown>) => ({ min: num(a.min_color_temp_kelvin, 2000), max: num(a.max_color_temp_kelvin, 6500) });
/** 0–1 glow of a lit lamp on its tile: full for a relay, by brightness for a dimmer. */
export const glowOf = (a: Record<string, unknown>) => { const b = brightnessPct(a); return b === null ? 1 : Math.max(0.15, b / 100); };
const WHITE: Array<[number, [number, number, number]]> = [[1700, [255, 147, 41]], [2700, [255, 178, 87]], [3500, [255, 211, 155]], [4000, [255, 233, 199]], [5000, [255, 246, 234]], [5500, [255, 255, 255]], [6500, [223, 238, 255]]];
export const rgbHex = (rgb: readonly number[]) => '#' + rgb.slice(0, 3).map(v => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('');
/** Approximate colour of white light at a colour temperature (the slider fill). */
export function kelvinColor(k: number): string {
  if (k <= WHITE[0][0]) return rgbHex(WHITE[0][1]);
  for (let i = 1; i < WHITE.length; i++) { const [k1, c1] = WHITE[i]; if (k <= k1) { const [k0, c0] = WHITE[i - 1], f = (k - k0) / (k1 - k0); return rgbHex(c0.map((v, j) => v + (c1[j] - v) * f)); } }
  return rgbHex(WHITE[WHITE.length - 1][1]);
}
/** Quick brightness levels; 1 % is the night light. */
export const LEVELS: readonly number[] = [1, 30, 60, 100];
export const TEMP_PRESETS: ReadonlyArray<{ key: string; k: number }> = [{ key: 'warm', k: 2700 }, { key: 'cozy', k: 3500 }, { key: 'neutral', k: 4000 }, { key: 'day', k: 5500 }];
export const AMBIENT_COLORS: ReadonlyArray<{ key: string; rgb: [number, number, number] }> = [{ key: 'amber', rgb: [255, 178, 87] }, { key: 'peach', rgb: [255, 154, 122] }, { key: 'rose', rgb: [255, 126, 182] }, { key: 'lavender', rgb: [185, 166, 255] }, { key: 'mint', rgb: [95, 214, 200] }, { key: 'sky', rgb: [124, 196, 255] }];
/** The named colour closest to the light's current rgb (within a tolerance), else null. */
export function nearestColor(rgb: unknown): string | null {
  if (!Array.isArray(rgb) || rgb.length < 3 || rgb.some(v => typeof v !== 'number')) return null;
  let best: { key: string; d: number } | null = null;
  for (const c of AMBIENT_COLORS) { const d = Math.hypot(c.rgb[0] - rgb[0], c.rgb[1] - rgb[1], c.rgb[2] - rgb[2]); if (!best || d < best.d) best = { key: c.key, d }; }
  return best && best.d <= 60 ? best.key : null;
}
/** Colour of the ambient light as the tile's dot: its rgb, else its white tone, else rose. */
export function ambientHex(a: Record<string, unknown>): string {
  const rgb = a.rgb_color; if (Array.isArray(rgb) && rgb.length >= 3 && rgb.every(v => typeof v === 'number')) return rgbHex(rgb as number[]);
  const k = kelvinOf(a); return k !== null ? kelvinColor(k) : '#ff7eb6';
}
export const clampKelvin = (k: number, min: number, max: number) => Math.max(min, Math.min(max, Math.round(k / 50) * 50));
/** «Выключить через» choices, minutes. */
export const SLEEP_MINUTES: readonly number[] = [15, 30, 60];
/** The integration mirrors pending switch-offs into `input_text.atom_light_sleep` as «light.x|17:40;light.y|18:05». */
export function parseSleep(text: unknown): Record<string, string> {
  const out: Record<string, string> = {};
  if (typeof text !== 'string') return out;
  for (const part of text.split(';')) { const [id, at] = part.split('|'); if (id && /^(light|switch|input_boolean|fan)\.[a-z0-9_]+$/.test(id) && at && /^\d\d:\d\d$/.test(at)) out[id] = at; }
  return out;
}
export const SLEEP_MIRROR = 'input_text.atom_light_sleep';
