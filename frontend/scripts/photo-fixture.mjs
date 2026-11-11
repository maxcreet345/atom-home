// Product photos for the previews, OPT-IN: `?photos=1` (whole panel: http://127.0.0.1:<port>/?photos=1#home; card preview: …&photos=1).
// Without it every preview is the house as it is today — no device photos — so the qa scripts keep checking the classic drawings and glyphs.
// The files are the owner's (private/device-photos, outside git on purpose: manufacturers' pictures are never bundled into the repository); a
// house keeps its own in Home Assistant's Atom Home photo store. Here they are served at /local/device-photos/ and put into the config's
// `devices[<key>].photo` slot by the device's model — the same slot «Настройка» writes. A machine without the folder gets no photos.
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { resolve, sep } from 'node:path';
const root = resolve(import.meta.dirname, '..');
export const PHOTOS = resolve(root, '../private/device-photos'), FRAMES = resolve(root, '../private/camera-frames');
const ROUTE = '/local/device-photos/';
/** `?photos=1`: the preview fills the photo slots (anything else, or nothing, is a house that has set none) */
export const wantsPhotos = q => q.get('photos') === '1';
/** manufacturer + model + name → the photo's id (private/device-photos/manifest.json). The «poor» ones (upscaled icons) are left out: a pictogram is better.
 * Appliances only (the owner's rule, 11.11.2026; model/photos.ts `takesPhoto`): the leak sensors, the plug, the water valve, the radiator heads and the
 * wall thermostat keep their pictograms, so their photos are not put into the slots here. */
const BY_MODEL = [
  [/xiaomi\.kettle/i, 'xiaomi.kettle.v20'], [/xiaomi\.feeder|pet food feeder/i, 'xiaomi.feeder.iv2001'], [/xiaomi\.fryer|air ?fryer|аэрогриль/i, 'xiaomi.fryer.maf07d'],
  [/zhimi\.airp|air purifier 4|очиститель/i, 'zhimi.airp.mb5'], [/deerma\.humidifier|humidifier 2|увлажнитель/i, 'deerma.humidifier.jsq2w'], [/pet_waterer|pet fountain|поилка|фонтан/i, 'xiaomi.pet_waterer.iv02'],
  [/SVD-C0|lumi\.camera\.agl|doorbell g4|звонок/i, 'aqara.SVD-C02'], [/chuangmi\.camera\.081ae2|C700/i, 'chuangmi.camera.081ae2'], [/CAM-C44HE|лестница/i, 'sonoff.CAM-C44HE'],
  [/станция лайт|station.?lite/i, 'yandex.station-lite'], [/станция макс|station.?max/i, 'yandex.station-max'], [/станция мини|station.?mini/i, 'yandex.station-mini2'],
  [/apple ?tv/i, 'apple.tv-4k-3gen'], [/washer|стиральн/i, 'lg.washer'], [/dryer|сушильн/i, 'samsung.dryer'], [/DXP2800/i, 'ugreen.DXP2800'], [/US3000/i, 'ugreen.US3000'],
];
const urlOf = id => existsSync(resolve(PHOTOS, `${id}-s.webp`)) ? `${ROUTE}${id}-s.webp` : null;
/** Fill the photo slot of every device of the snapshot whose model has a photo here; a photo the config already names is kept. Returns a new config. */
export function withPhotos(registry, config) {
  if (!existsSync(PHOTOS)) return config;
  const devices = { ...(config.devices ?? {}) };
  for (const d of registry.devices ?? []) {
    const hit = BY_MODEL.find(([re]) => re.test(`${d.manufacturer ?? ''} ${d.model ?? ''} ${d.name ?? ''}`)), url = hit && urlOf(hit[1]); if (!url) continue;
    const key = `d:${d.id}`; if (!devices[key]?.photo) devices[key] = { ...(devices[key] ?? {}), photo: url };
  }
  return { ...config, devices };
}
/** The robot's own renders (Roborock's, in the house's photo store on the real panel), by the names the vacuum card asks for. */
export function vacuumFrames() { return Object.fromEntries([['vacuum:robot', 'vacuum-robot.webp'], ['vacuum:dock', 'vacuum-dock.webp']].filter(([, f]) => existsSync(resolve(FRAMES, f))).map(([k, f]) => [k, `/frames/${f}`])); }
const TYPES = { webp: 'image/webp', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg' };
/** Serve /local/device-photos/<file> and /frames/<file> (a missing file is a 404, thrown to the caller); false when the request is neither. */
export async function servePhoto(u, res) {
  const dir = u.pathname.startsWith(ROUTE) ? [PHOTOS, ROUTE.length] : u.pathname.startsWith('/frames/') ? [FRAMES, 8] : null; if (!dir) return false;
  const f = resolve(dir[0], decodeURIComponent(u.pathname.slice(dir[1]))); if (!f.startsWith(dir[0] + sep)) throw new Error('outside');
  const body = await readFile(f); res.setHeader('content-type', TYPES[f.split('.').pop().toLowerCase()] ?? 'application/octet-stream'); res.setHeader('cache-control', 'max-age=3600'); res.end(body); return true;
}
