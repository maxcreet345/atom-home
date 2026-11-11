/* The stock room pictures (1.27.0, owner 11.11.2026: «картинки комнат надо перерисовать под стиль дашборда»): drawn by the same hand as the
 * panel's own drawings — the feeder's cat, the «Воздух» cloud, the robot, the radiator, DeviceArt — flat shapes, soft gradients, rounded forms,
 * a few details, calm. One scene per room kind, a day version for the light theme and an evening one for the dark (lamps lit, the sky dark).
 *
 * A scene is a vignette on a transparent ground (240×160): the tile itself carries the room's soft background (`roomArtStyle`, CSS tokens),
 * and the picture stands in its lower right, so the room's name (top left) and its readings (bottom left) lie on the calm background and keep
 * 4.5:1 in both themes (tests/room-art.test.ts measures the tokens). Pure TypeScript: the tile draws it, «Настройка» shows it as the fallback
 * of a room's photo slot, and the test runs under Node. The owner's own photo of a room always wins over the stock picture. */

export type RoomKind = 'living' | 'kitchen' | 'bedroom' | 'kids' | 'bathroom' | 'hall' | 'office' | 'storage';
export type SceneKind = RoomKind | 'other';
export type Theme = 'light' | 'dark';

/** The colours of one scene in one theme. `bg1`/`bg2` are the tile's ground (top → bottom), `ink`/`ink2` the words on it. */
export interface Palette {
  bg1: string; bg2: string; ink: string; ink2: string;
  shadow: string; wood: string; wood2: string; white: string; white2: string; metal: string; dark: string;
  sky: string; sky2: string; orb: string; night: number; plant: string; plant2: string; pot: string;
  glow: string; lit: number; bulb: string; accent: string; fab: string; fab2: string; rug: string; extra: string; extra2: string;
}
const BASE: Record<Theme, Omit<Palette, 'bg1' | 'bg2' | 'fab' | 'fab2' | 'rug' | 'extra' | 'extra2'>> = {
  light: { ink: '#16203a', ink2: '#38445a', shadow: '#1b24361a', wood: '#e6b47e', wood2: '#c98f57', white: '#ffffff', white2: '#e4eaf3', metal: '#aebacb', dark: '#2b3a55',
    sky: '#bfe4ff', sky2: '#ffffff', orb: '#ffd76a', night: 0, plant: '#6cc58a', plant2: '#45a466', pot: '#f08a5d', glow: '#ffd27a', lit: 0, bulb: '#fff6d6', accent: '#f2c279' },
  dark: { ink: '#f5f7fb', ink2: '#cbd4e2', shadow: '#00000066', wood: '#8f6747', wood2: '#6b4b33', white: '#c3cddd', white2: '#94a1b6', metal: '#6f7c92', dark: '#0f1626',
    sky: '#1b2c52', sky2: '#e9eefc', orb: '#f6e7b0', night: 1, plant: '#3f8a60', plant2: '#2e6b4a', pot: '#a65a3c', glow: '#ffcf70', lit: 1, bulb: '#ffe390', accent: '#d2a356' },
};
type Own = Pick<Palette, 'bg1' | 'bg2' | 'fab' | 'fab2' | 'rug' | 'extra' | 'extra2'>;
const OWN: Record<SceneKind, Record<Theme, Own>> = {
  living: { light: { bg1: '#fff5ea', bg2: '#ffe3c9', fab: '#7cc1b7', fab2: '#5aa79c', rug: '#f6caa5', extra: '#f6a53c', extra2: '#e48a22' }, dark: { bg1: '#382c3f', bg2: '#231c2c', fab: '#447f79', fab2: '#336561', rug: '#4c3b4c', extra: '#d88a2c', extra2: '#b06d1d' } },
  bedroom: { light: { bg1: '#f4f1ff', bg2: '#e2dbfb', fab: '#b8a7f0', fab2: '#9a86e2', rug: '#d9cdf7', extra: '#ffffff', extra2: '#e7e1fb' }, dark: { bg1: '#2a2e52', bg2: '#191c36', fab: '#62559a', fab2: '#4b4180', rug: '#363260', extra: '#b9bfd6', extra2: '#8f95b0' } },
  kids: { light: { bg1: '#fffae6', bg2: '#ffecb4', fab: '#8fd3f0', fab2: '#69bfe3', rug: '#ffd6a6', extra: '#ff9db4', extra2: '#ff7c9a' }, dark: { bg1: '#223a49', bg2: '#16252f', fab: '#3f7d97', fab2: '#30647a', rug: '#3d3c46', extra: '#b8667f', extra2: '#9a4f66' } },
  kitchen: { light: { bg1: '#eefaf2', bg2: '#d4efdd', fab: '#8fd0a6', fab2: '#6bb987', rug: '#f2e5cd', extra: '#ff8a65', extra2: '#ef6f48' }, dark: { bg1: '#223a36', bg2: '#152522', fab: '#3f7d5b', fab2: '#2f6447', rug: '#3b4039', extra: '#c4644a', extra2: '#a14f38' } },
  bathroom: { light: { bg1: '#ebf8fd', bg2: '#cdeaf8', fab: '#ff9f8f', fab2: '#f07f6e', rug: '#bde2f4', extra: '#d6eef9', extra2: '#ffd54f' }, dark: { bg1: '#1e3450', bg2: '#132237', fab: '#b3665a', fab2: '#8f4d43', rug: '#2b4763', extra: '#27425f', extra2: '#d8b545' } },
  hall: { light: { bg1: '#f8f3eb', bg2: '#ecdfcc', fab: '#e58a5f', fab2: '#c86f47', rug: '#d8c19f', extra: '#b98458', extra2: '#9c6b44' }, dark: { bg1: '#332d29', bg2: '#201d1a', fab: '#9a5b3d', fab2: '#7a462f', rug: '#4b4038', extra: '#6f4d34', extra2: '#5a3e2a' } },
  office: { light: { bg1: '#eff4fc', bg2: '#d8e2f4', fab: '#7a9be0', fab2: '#5b7ece', rug: '#d2dbee', extra: '#d8ecff', extra2: '#7fb2f0' }, dark: { bg1: '#252d43', bg2: '#171c2c', fab: '#3f5692', fab2: '#2f4274', rug: '#2d3651', extra: '#3c7ddb', extra2: '#8fc1ff' } },
  storage: { light: { bg1: '#fcf0ea', bg2: '#f2d8cb', fab: '#e8bb8c', fab2: '#d29e6b', rug: '#ecd1c2', extra: '#cfe7f5', extra2: '#ff9f6b' }, dark: { bg1: '#322d37', bg2: '#201d26', fab: '#8f6c4d', fab2: '#70533a', rug: '#3f3541', extra: '#3a5874', extra2: '#b8653f' } },
  other: { light: { bg1: '#f3f5f9', bg2: '#e1e6ef', fab: '#9fb4d8', fab2: '#7f97c4', rug: '#d9dfea', extra: '#f2c279', extra2: '#e0a94d' }, dark: { bg1: '#262d3c', bg2: '#181d29', fab: '#4b5f86', fab2: '#3b4c6d', rug: '#303849', extra: '#c99b4f', extra2: '#a77e3b' } },
};
export const SCENES: SceneKind[] = ['living', 'bedroom', 'kids', 'kitchen', 'bathroom', 'hall', 'storage', 'office', 'other'];
export function palette(kind: SceneKind, theme: Theme): Palette { return { ...BASE[theme], ...OWN[kind][theme] }; }

/* ---- small parts, shared by the scenes ---- */
const glow = (p: Palette, cx: number, cy: number, rx: number, ry: number) => p.lit ? `<ellipse cx="${cx}" cy="${cy}" rx="${rx}" ry="${ry}" fill="url(#g)" opacity="${0.75 * p.lit}"/>` : '';
const plant = (p: Palette, x: number, y: number, s = 1) => `<g transform="translate(${x} ${y}) scale(${s})"><path d="M0 0c-14-6-18-22-10-30 6 8 9 18 10 30z" fill="${p.plant}"/><path d="M0 0c12-8 18-22 9-32-6 9-9 20-9 32z" fill="${p.plant2}"/><path d="M0 0c-3-14 0-28 6-36 4 12 2 26-6 36z" fill="${p.plant}"/><path d="M-9 0h18l-3 16a3 3 0 0 1-3 3h-6a3 3 0 0 1-3-3z" fill="${p.pot}"/></g>`;
const shadow = (p: Palette, cx: number, cy: number, rx: number, ry = 4) => `<ellipse cx="${cx}" cy="${cy}" rx="${rx}" ry="${ry}" fill="${p.shadow}"/>`;
/** A window on the wall: the day's sky with a cloud and the sun, or the evening's with the moon and two stars. */
const windowPane = (p: Palette, x: number, y: number, w: number, h: number) => `<rect x="${x - 3}" y="${y - 3}" width="${w + 6}" height="${h + 6}" rx="9" fill="${p.white2}"/><rect x="${x}" y="${y}" width="${w}" height="${h}" rx="7" fill="${p.sky}"/>`
  + `<circle cx="${x + w * 0.68}" cy="${y + h * 0.3}" r="${Math.min(w, h) * 0.13}" fill="${p.orb}"/>`
  + (p.night ? `<circle cx="${x + w * 0.68 + Math.min(w, h) * 0.07}" cy="${y + h * 0.3 - Math.min(w, h) * 0.04}" r="${Math.min(w, h) * 0.11}" fill="${p.sky}"/><circle cx="${x + w * 0.25}" cy="${y + h * 0.22}" r="1.2" fill="${p.sky2}"/><circle cx="${x + w * 0.4}" cy="${y + h * 0.55}" r="1" fill="${p.sky2}"/>`
    : `<path d="M${x + w * 0.18} ${y + h * 0.66}a6 6 0 0 1 9-6 8 8 0 0 1 14 2 5 5 0 0 1 1 9h-22a5 5 0 0 1-2-5z" fill="${p.sky2}"/>`)
  + `<rect x="${x + w / 2 - 1.5}" y="${y}" width="3" height="${h}" fill="${p.white2}"/>`;

/* ---- the scenes: 240×160, the floor's shadow near y 150, the picture's weight to the right ---- */
const SCENE: Record<SceneKind, (p: Palette) => string> = {
  living: p => shadow(p, 140, 150, 98) + `<ellipse cx="140" cy="148" rx="88" ry="9" fill="${p.rug}"/>`
    // a picture on the wall, the floor lamp, the sofa with a cushion and the house cat asleep on it, a plant
    + `<rect x="104" y="22" width="52" height="34" rx="6" fill="${p.white}"/><rect x="108" y="26" width="44" height="26" rx="4" fill="${p.sky}"/><path d="M108 48l12-11 9 8 7-6 16 11v2h-44z" fill="${p.plant2}"/><circle cx="142" cy="33" r="4" fill="${p.orb}"/>`
    + glow(p, 40, 70, 34, 40) + `<ellipse cx="40" cy="147" rx="11" ry="3" fill="${p.wood2}"/><rect x="38.5" y="58" width="3" height="88" rx="1.5" fill="${p.metal}"/><path d="M27 38h26l7 22H20z" fill="${p.accent}"/><ellipse cx="40" cy="60" rx="20" ry="3" fill="${p.lit ? p.bulb : p.accent}"/>`
    + `<rect x="76" y="140" width="5" height="9" rx="2" fill="${p.wood2}"/><rect x="199" y="140" width="5" height="9" rx="2" fill="${p.wood2}"/>`
    + `<rect x="80" y="82" width="120" height="40" rx="16" fill="${p.fab2}"/><rect x="70" y="104" width="140" height="38" rx="14" fill="${p.fab}"/><rect x="64" y="96" width="22" height="46" rx="11" fill="${p.fab2}"/><rect x="194" y="96" width="22" height="46" rx="11" fill="${p.fab2}"/>`
    + `<rect x="92" y="88" width="30" height="24" rx="9" fill="${p.accent}" transform="rotate(-8 107 100)"/>`
    + `<g><ellipse cx="166" cy="102" rx="17" ry="10" fill="${p.extra}"/><path d="M152 104c-8 2-10-6-4-8" fill="none" stroke="${p.extra}" stroke-width="5" stroke-linecap="round"/><circle cx="178" cy="98" r="8" fill="${p.extra}"/><path d="M173 92l1-7 5 5zM181 91l4-6 1 7z" fill="${p.extra2}"/><path d="M175 99q2 2 4 0M180 99q2 2 4 0" fill="none" stroke="#2b3a44" stroke-width="1.3" stroke-linecap="round"/><path d="M160 96q5-3 10 0" fill="none" stroke="${p.extra2}" stroke-width="2" stroke-linecap="round"/></g>`
    + plant(p, 226, 128, 0.9),
  bedroom: p => shadow(p, 140, 150, 96) + `<ellipse cx="136" cy="148" rx="82" ry="8" fill="${p.rug}"/>`
    + windowPane(p, 18, 26, 40, 46)
    // the headboard, the bed with two pillows and a folded blanket, the bedside table with its lamp
    + `<rect x="70" y="62" width="122" height="58" rx="18" fill="${p.wood}"/><rect x="78" y="70" width="106" height="40" rx="12" fill="${p.wood2}" opacity=".35"/>`
    + `<rect x="74" y="138" width="6" height="10" rx="2" fill="${p.wood2}"/><rect x="182" y="138" width="6" height="10" rx="2" fill="${p.wood2}"/>`
    + `<rect x="66" y="104" width="130" height="38" rx="12" fill="${p.white2}"/><rect x="82" y="92" width="44" height="20" rx="9" fill="${p.extra}"/><rect x="134" y="92" width="44" height="20" rx="9" fill="${p.extra}"/>`
    + `<path d="M66 116h130v14a12 12 0 0 1-12 12H78a12 12 0 0 1-12-12z" fill="${p.fab}"/><path d="M66 116h130v8H66z" fill="${p.fab2}"/>`
    + glow(p, 214, 96, 26, 28) + `<rect x="200" y="114" width="30" height="34" rx="6" fill="${p.wood}"/><rect x="204" y="126" width="22" height="3" rx="1.5" fill="${p.wood2}"/><rect x="213" y="100" width="4" height="14" rx="2" fill="${p.metal}"/><path d="M205 86h20l4 16h-28z" fill="${p.accent}"/><ellipse cx="215" cy="102" rx="14" ry="2.4" fill="${p.lit ? p.bulb : p.accent}"/>`,
  kids: p => shadow(p, 140, 150, 98) + `<ellipse cx="140" cy="148" rx="86" ry="9" fill="${p.rug}"/>`
    // a garland of flags, a little bed with a star blanket, the blocks and a ball
    + `<path d="M22 22q90 26 200 0" fill="none" stroke="${p.metal}" stroke-width="1.5"/>` + [[40, p.extra], [70, p.orb], [100, p.fab], [130, p.extra], [160, p.plant], [190, p.orb]].map(([x, c], i) => { const y = 22 + Math.sin(Math.PI * ((x as number) - 22) / 200) * 13; return `<path d="M${(x as number) - 7} ${y}h14l-7 13z" fill="${c}" transform="rotate(${i % 2 ? 4 : -4} ${x} ${y})"/>`; }).join('')
    + `<path d="M120 84a24 24 0 0 1 48 0v34h-48z" fill="${p.extra}"/><circle cx="144" cy="80" r="7" fill="${p.white}" opacity=".7"/>`
    + `<rect x="122" y="138" width="5" height="10" rx="2" fill="${p.wood2}"/><rect x="211" y="138" width="5" height="10" rx="2" fill="${p.wood2}"/>`
    + `<rect x="118" y="108" width="102" height="34" rx="12" fill="${p.white2}"/><rect x="126" y="98" width="32" height="16" rx="7" fill="${p.white}"/>`
    + `<path d="M140 118h80v12a12 12 0 0 1-12 12h-68z" fill="${p.fab}"/>` + [[160, 128], [184, 124], [204, 133]].map(([x, y]) => `<path d="M${x} ${y - 4}l1.3 2.6 2.9.4-2.1 2 .5 2.9-2.6-1.4-2.6 1.4.5-2.9-2.1-2 2.9-.4z" fill="${p.white}"/>`).join('')
    + `<rect x="64" y="124" width="22" height="22" rx="4" fill="${p.fab2}"/><rect x="88" y="124" width="22" height="22" rx="4" fill="${p.extra2}"/><rect x="76" y="102" width="22" height="22" rx="4" fill="${p.orb}"/>`
    + `<circle cx="75" cy="135" r="4" fill="${p.white}" opacity=".6"/><circle cx="99" cy="135" r="4" fill="${p.white}" opacity=".6"/><circle cx="87" cy="113" r="4" fill="${p.white}" opacity=".6"/>`
    + `<circle cx="226" cy="139" r="8" fill="${p.plant}"/><path d="M218 139h16M226 131q5 8 0 16" fill="none" stroke="${p.white}" stroke-width="1.6" opacity=".8"/>`,
  kitchen: p => shadow(p, 142, 150, 92)
    // the upper cupboards, the pendant lamp, the counter with the oven, the kettle steaming, a plant
    + `<rect x="128" y="22" width="96" height="34" rx="6" fill="${p.fab}"/><path d="M176 26v26" stroke="${p.fab2}" stroke-width="2"/><rect x="168" y="36" width="3" height="10" rx="1.5" fill="${p.white}"/><rect x="181" y="36" width="3" height="10" rx="1.5" fill="${p.white}"/>`
    + glow(p, 86, 74, 30, 34) + `<path d="M86 0v42" stroke="${p.metal}" stroke-width="2"/><path d="M70 58a16 16 0 0 1 32 0z" fill="${p.accent}"/><ellipse cx="86" cy="58" rx="16" ry="2.6" fill="${p.lit ? p.bulb : p.accent}"/>`
    + `<rect x="54" y="104" width="170" height="44" rx="6" fill="${p.fab}"/><rect x="50" y="98" width="178" height="9" rx="4" fill="${p.white}"/>`
    + `<rect x="62" y="112" width="30" height="30" rx="4" fill="${p.fab2}"/><rect x="72" y="116" width="10" height="3" rx="1.5" fill="${p.white}"/><rect x="176" y="112" width="40" height="30" rx="4" fill="${p.fab2}"/><rect x="192" y="116" width="10" height="3" rx="1.5" fill="${p.white}"/>`
    + `<rect x="98" y="110" width="68" height="34" rx="5" fill="${p.metal}"/><rect x="104" y="120" width="56" height="20" rx="4" fill="${p.dark}"/><rect x="112" y="114" width="40" height="3" rx="1.5" fill="${p.white}"/>${p.lit ? `<rect x="106" y="122" width="52" height="16" rx="3" fill="${p.glow}" opacity=".25"/>` : ''}`
    + `<path d="M120 98c0-14 6-20 15-20s15 6 15 20z" fill="${p.extra}"/><path d="M150 86c6 0 9-4 10-8" fill="none" stroke="${p.extra2}" stroke-width="3" stroke-linecap="round"/><path d="M122 84q-8 2-6 10" fill="none" stroke="${p.extra2}" stroke-width="3" stroke-linecap="round"/><rect x="130" y="74" width="10" height="4" rx="2" fill="${p.extra2}"/>`
    + `<path d="M132 68q-4-6 0-12M140 66q-4-6 0-12" fill="none" stroke="${p.white2}" stroke-width="2" stroke-linecap="round" opacity=".9"/>`
    + `<rect x="168" y="84" width="22" height="14" rx="3" fill="${p.wood}"/>` + plant(p, 206, 80, 0.62),
  bathroom: p => shadow(p, 134, 150, 96) + `<ellipse cx="128" cy="148" rx="74" ry="8" fill="${p.rug}"/>`
    // the tiled wall, the round mirror, the bath with bubbles and a duck, the towel on its rail
    + `<rect x="62" y="40" width="142" height="70" rx="10" fill="${p.extra}"/>` + [0, 1, 2].map(r => [0, 1, 2, 3, 4].map(c => `<rect x="${68 + c * 27}" y="${46 + r * 21}" width="23" height="17" rx="4" fill="${p.sky2}" opacity="${p.night ? 0.06 : 0.55}"/>`).join('')).join('')
    + `<circle cx="34" cy="52" r="20" fill="${p.white2}"/><circle cx="34" cy="52" r="16" fill="${p.sky}"/><path d="M26 46l8-6M30 56l12-9" stroke="${p.sky2}" stroke-width="2" stroke-linecap="round" opacity=".7"/><rect x="18" y="80" width="32" height="5" rx="2.5" fill="${p.white}"/><rect x="24" y="72" width="6" height="8" rx="2" fill="${p.fab}"/><rect x="34" y="70" width="5" height="10" rx="2" fill="${p.plant}"/>`
    + `<circle cx="96" cy="100" r="9" fill="${p.white}"/><circle cx="110" cy="96" r="11" fill="${p.white}"/><circle cx="126" cy="99" r="8" fill="${p.white}"/><circle cx="168" cy="99" r="7" fill="${p.white}"/>`
    + `<rect x="80" y="139" width="6" height="10" rx="3" fill="${p.metal}"/><rect x="176" y="139" width="6" height="10" rx="3" fill="${p.metal}"/>`
    + `<path d="M70 102h122v14a26 26 0 0 1-26 26h-70a26 26 0 0 1-26-26z" fill="${p.white}"/><rect x="66" y="98" width="130" height="8" rx="4" fill="${p.white2}"/>`
    + `<path d="M142 92c0-6 4-9 9-9s8 3 8 8c4 0 7 2 7 6s-4 6-9 6h-13c-4 0-6-3-6-6 0-3 2-5 4-5z" fill="${p.extra2}"/><circle cx="154" cy="86" r="1.6" fill="#2b3a44"/><path d="M158 89l6 1-6 2z" fill="${p.fab2}"/>`
    + `<rect x="208" y="56" width="22" height="4" rx="2" fill="${p.metal}"/><path d="M210 58h18v40a4 4 0 0 1-4 4h-10a4 4 0 0 1-4-4z" fill="${p.fab}"/><path d="M210 88h18" stroke="${p.fab2}" stroke-width="3"/>`
    + plant(p, 218, 130, 0.65),
  hall: p => shadow(p, 140, 150, 96) + `<rect x="114" y="138" width="56" height="10" rx="4" fill="${p.rug}"/>`
    // the front door with its little window, the hooks with a coat and a scarf, the bench with shoes, an umbrella stand
    + `<rect x="116" y="24" width="52" height="116" rx="8" fill="${p.extra}"/><rect x="122" y="30" width="40" height="104" rx="5" fill="${p.extra2}" opacity=".35"/><rect x="128" y="38" width="28" height="22" rx="4" fill="${p.sky}"/>${p.night ? `<circle cx="150" cy="44" r="1.2" fill="${p.sky2}"/>` : ''}<circle cx="158" cy="88" r="3.6" fill="${p.accent}"/><rect x="150" y="86" width="10" height="3.4" rx="1.7" fill="${p.accent}"/>`
    + glow(p, 142, 18, 40, 18) + `<rect x="128" y="12" width="28" height="6" rx="3" fill="${p.lit ? p.bulb : p.white2}"/>`
    + `<g transform="translate(16 21) scale(.86)">`
    + `<rect x="34" y="38" width="64" height="7" rx="3.5" fill="${p.wood}"/><circle cx="48" cy="48" r="3" fill="${p.metal}"/><circle cx="66" cy="48" r="3" fill="${p.metal}"/><circle cx="84" cy="48" r="3" fill="${p.metal}"/>`
    + `<path d="M48 48c-6 4-10 10-10 20v28a6 6 0 0 0 6 6h10a6 6 0 0 0 6-6V68c0-10-4-16-12-20z" fill="${p.fab}"/><path d="M48 50v50" stroke="${p.fab2}" stroke-width="2"/>`
    + `<path d="M84 48c-4 0-6 4-6 10v34h5V62h6v26h5V58c0-6-4-10-10-10z" fill="${p.plant}"/>`
    + `<rect x="30" y="118" width="74" height="8" rx="4" fill="${p.wood}"/><rect x="34" y="126" width="5" height="22" rx="2" fill="${p.wood2}"/><rect x="95" y="126" width="5" height="22" rx="2" fill="${p.wood2}"/>`
    + `<path d="M46 148v-7a5 5 0 0 1 5-5h4v6h7a4 4 0 0 1 4 4v2z" fill="${p.dark}"/><path d="M70 148v-7a5 5 0 0 1 5-5h4v6h7a4 4 0 0 1 4 4v2z" fill="${p.fab2}"/>`
    + `</g>`
    + `<rect x="190" y="112" width="20" height="36" rx="6" fill="${p.white2}"/><path d="M196 112V70a6 6 0 0 1 12 0" fill="none" stroke="${p.extra2}" stroke-width="3" stroke-linecap="round"/><path d="M202 112V82" stroke="${p.dark}" stroke-width="2.4" stroke-linecap="round"/><path d="M192 84q10-14 20 0z" fill="${p.fab}"/>`,
  storage: p => shadow(p, 136, 150, 98)
    // a ladder, the shelves with boxes, jars and a basket
    + `<path d="M30 148l14-110M52 148l8-110" stroke="${p.wood2}" stroke-width="4" stroke-linecap="round"/>` + [56, 80, 104, 128].map(y => `<path d="M${30 + (148 - y) * 14 / 110 + 1} ${y}h${22 - (148 - y) * 6 / 110 - 2}" stroke="${p.wood2}" stroke-width="3" stroke-linecap="round"/>`).join('')
    + `<rect x="74" y="22" width="132" height="126" rx="8" fill="${p.wood}"/><rect x="80" y="28" width="120" height="114" rx="5" fill="${p.wood2}" opacity=".45"/>`
    + [58, 96, 134].map(y => `<rect x="76" y="${y}" width="128" height="6" rx="3" fill="${p.wood}"/>`).join('')
    + `<rect x="86" y="34" width="34" height="24" rx="4" fill="${p.fab}"/><path d="M86 42h34" stroke="${p.fab2}" stroke-width="2"/><rect x="126" y="38" width="28" height="20" rx="4" fill="${p.fab2}"/>`
    + [160, 176, 192].map((x, i) => `<rect x="${x - 6}" y="${40 - i * 2}" width="12" height="${18 + i * 2}" rx="4" fill="${p.extra}"/><rect x="${x - 6}" y="${36 - i * 2}" width="12" height="5" rx="2" fill="${p.extra2}"/>`).join('')
    + `<path d="M86 96l4-22h44l4 22z" fill="${p.accent}"/><path d="M92 82h40M90 89h44" stroke="${p.wood2}" stroke-width="1.6" opacity=".6"/><rect x="146" y="70" width="48" height="26" rx="4" fill="${p.fab}"/><rect x="162" y="78" width="16" height="6" rx="2" fill="${p.white}" opacity=".7"/>`
    + `<rect x="86" y="108" width="52" height="26" rx="4" fill="${p.fab2}"/><path d="M86 116h52" stroke="${p.fab}" stroke-width="2"/><circle cx="160" cy="124" r="10" fill="${p.white2}"/><circle cx="182" cy="126" r="8" fill="${p.plant}"/>`
    + glow(p, 140, 24, 50, 16),
  office: p => shadow(p, 140, 150, 98) + `<ellipse cx="146" cy="148" rx="80" ry="8" fill="${p.rug}"/>`
    // a shelf with books, the desk with the monitor and its lamp, the chair, a plant
    + `<rect x="40" y="36" width="56" height="5" rx="2.5" fill="${p.wood}"/><rect x="46" y="20" width="7" height="16" rx="1.5" fill="${p.fab}"/><rect x="55" y="22" width="6" height="14" rx="1.5" fill="${p.accent}"/><rect x="63" y="18" width="7" height="18" rx="1.5" fill="${p.fab2}"/><rect x="74" y="24" width="14" height="12" rx="3" fill="${p.plant}"/>`
    + `<rect x="54" y="100" width="148" height="8" rx="4" fill="${p.wood}"/><rect x="60" y="108" width="6" height="40" rx="2" fill="${p.wood2}"/><rect x="164" y="108" width="34" height="40" rx="4" fill="${p.wood2}"/><rect x="176" y="118" width="10" height="3" rx="1.5" fill="${p.wood}"/><rect x="176" y="132" width="10" height="3" rx="1.5" fill="${p.wood}"/>`
    + `${p.lit ? `<ellipse cx="128" cy="76" rx="44" ry="30" fill="${p.extra}" opacity=".22"/>` : ''}<rect x="96" y="46" width="66" height="44" rx="6" fill="${p.dark}"/><rect x="100" y="50" width="58" height="34" rx="3" fill="${p.extra}"/><path d="M106 76l10-9 8 5 12-12 14 9" fill="none" stroke="${p.extra2}" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/><rect x="125" y="90" width="8" height="8" fill="${p.metal}"/><rect x="114" y="96" width="30" height="4" rx="2" fill="${p.metal}"/>`
    + glow(p, 82, 92, 22, 14) + `<path d="M70 100v-3h16v3z" fill="${p.metal}"/><path d="M78 97l-8-22 16-10" fill="none" stroke="${p.metal}" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/><path d="M80 60l14 6-7 12z" fill="${p.accent}"/><circle cx="89" cy="74" r="2.6" fill="${p.lit ? p.bulb : p.accent}"/>`
    + `<rect x="104" y="95" width="40" height="4" rx="2" fill="${p.white2}"/>`
    + `<rect x="196" y="80" width="30" height="40" rx="12" fill="${p.fab}"/><rect x="192" y="116" width="38" height="10" rx="5" fill="${p.fab2}"/><path d="M211 126v14M200 146l11-6 11 6" fill="none" stroke="${p.metal}" stroke-width="3" stroke-linecap="round"/>`
    + plant(p, 66, 100, 0.5),
  other: p => shadow(p, 140, 150, 90) + `<ellipse cx="140" cy="148" rx="76" ry="8" fill="${p.rug}"/>`
    + windowPane(p, 110, 24, 56, 64) + `<path d="M100 20h76" stroke="${p.metal}" stroke-width="3" stroke-linecap="round"/><path d="M102 22c6 30 2 56-4 76h14c2-26 2-52-2-76z" fill="${p.fab}"/><path d="M174 22c-6 30-2 56 4 76h-14c-2-26-2-52 2-76z" fill="${p.fab}"/>`
    + `<rect x="120" y="112" width="44" height="6" rx="3" fill="${p.wood}"/><path d="M126 118l-4 30M158 118l4 30" stroke="${p.wood2}" stroke-width="4" stroke-linecap="round"/>`
    + glow(p, 146, 92, 20, 18) + `<rect x="144" y="98" width="4" height="14" rx="2" fill="${p.metal}"/><path d="M137 84h18l4 14h-26z" fill="${p.extra}"/>`
    + plant(p, 204, 130, 0.95),
};
/** Each scene's own extent in the 240×160 drawing, its lamps' glow included (measured once from the drawing): a tile draws exactly this much,
 * scaled into the space its words leave, so no drawn shape reaches beyond the picture's own box (qa-nav measures every shape against the words). */
export const SCENE_VIEW: Record<SceneKind, readonly [number, number, number, number]> = {
  living: [4, 20, 236, 139], bedroom: [13, 21, 229, 137], kids: [20, 20, 220, 139], kitchen: [48, 0, 188, 156], bathroom: [12, 30, 220, 128],
  hall: [40, 0, 198, 156], storage: [28, 6, 208, 150], office: [38, 16, 202, 142], other: [48, 18, 184, 140],
};
/** The scene as a whole SVG document. `ground`: the whole 240×160 drawing with the room's background behind it (a picture on its own,
 * «Настройка»'s fallback); without it, the scene alone in its own extent (`SCENE_VIEW`), standing at the right and the bottom of whatever box it
 * is given. `uid` keeps the gradients of several pictures on one page apart. */
export function roomArtSvg(kind: SceneKind, theme: Theme, ground = false, uid = ''): string {
  const p = palette(kind, theme), id = (x: string) => `ra-${x}${uid ? `-${uid.replace(/[^A-Za-z0-9_-]/g, '')}` : ''}`;
  const defs = `<defs><radialGradient id="${id('g')}"><stop offset="0" stop-color="${p.glow}" stop-opacity=".85"/><stop offset="1" stop-color="${p.glow}" stop-opacity="0"/></radialGradient><linearGradient id="${id('b')}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${p.bg1}"/><stop offset="1" stop-color="${p.bg2}"/></linearGradient></defs>`;
  const body = SCENE[kind](p).replace(/url\(#g\)/g, `url(#${id('g')})`);
  if (ground) return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 240 160" width="240" height="160">${defs}<rect width="240" height="160" fill="url(#${id('b')})"/>${body}</svg>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${SCENE_VIEW[kind].join(' ')}" preserveAspectRatio="xMaxYMax meet" focusable="false" aria-hidden="true">${defs}${body}</svg>`;
}
const urls = new Map<string, string>();
/** The scene as an image address (made once per kind and theme). */
export function roomArtUrl(kind: SceneKind, theme: Theme, ground = false): string {
  const key = `${kind}:${theme}:${ground ? 1 : 0}`;
  let u = urls.get(key); if (!u) { u = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(roomArtSvg(kind, theme, ground))}`; urls.set(key, u); }
  return u;
}
/** The tile's own tokens: its background and its words (`--ra-*`, apple.css «room pictures»). */
export function roomArtStyle(kind: SceneKind, theme: Theme): string {
  const p = palette(kind, theme);
  return `--ra-bg1:${p.bg1};--ra-bg2:${p.bg2};--ra-ink:${p.ink};--ra-ink2:${p.ink2}`;
}
