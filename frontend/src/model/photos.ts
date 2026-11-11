import type { Registry } from './registry.ts';
import type { HouseConfig } from './config.ts';
import { SENSOR_KINDS } from './kinds.ts';
import { kindOf, type ThingKind } from './room.ts';
/** A product photo of an appliance (docs/CONFIGURATOR.md, «Фото приборов»). One slot per device in the house's config — `devices[<key>].photo`,
 * the slot «Настройка» fills with its photo upload — read by every card that draws the appliance: its tile, its sheet, a module's own card.
 * The picture itself lives in the house (Home Assistant's Atom Home photo store); no manufacturer's image is bundled with the panel. */
/** The key of an entity's appliance in `config.devices`: its HA device, or the entity itself when it has none. */
export function photoKey(reg: Registry, entityId: string): string { const e = reg.entities.find(x => x.entity_id === entityId); return e?.device_id ? `d:${e.device_id}` : `e:${entityId}`; }
/** entity id → the photo of its appliance, or null. A device split into several cards (`d:<id>:<kind>`) shares one photo. */
export function photoIndex(reg: Registry, config: HouseConfig): (entityId?: string | null) => string | null {
  const byDevice = new Map<string, string>(), byEntity = new Map<string, string>();
  for (const [key, o] of Object.entries(config.devices)) { if (!o.photo) continue; if (key.startsWith('d:')) { const id = key.slice(2).split(':')[0]; if (!byDevice.has(id) || key === `d:${id}`) byDevice.set(id, o.photo); } else if (key.startsWith('e:')) byEntity.set(key.slice(2), o.photo); }
  if (!byDevice.size && !byEntity.size) return () => null;
  const deviceOf = new Map<string, string>(); for (const e of reg.entities) if (e.device_id && byDevice.has(e.device_id)) deviceOf.set(e.entity_id, e.device_id);
  return id => !id ? null : byEntity.get(id) ?? byDevice.get(deviceOf.get(id) ?? '') ?? null;
}

/* The owner's rule (11.11.2026): a product photo is for an APPLIANCE — a thing with functions of its own that has its own card: the robot vacuum,
 * the kettle, the pet fountain, cameras and the doorbell, a purifier, a humidifier, an air fryer, a TV, a speaker, a lamp, a boiler.
 * Sensors (leak, humidity, motion, window, gas…), relays and plugs are auxiliary: they keep their pictograms, a photo set on them is not drawn
 * and «Настройка» does not offer one. A plain switch is the appliance itself only when the appliance's own integration exposes it (an air fryer's,
 * a pet fountain's pump, a kettle's power — the room model knows them by name and model); a relay or a plug that feeds a fridge, a washer, the
 * boiler or a vent stays a relay. The pet feeder is the exception the owner asked for: it keeps its drawn cat (KEEPS_DRAWING). */
const AUX_KINDS: ReadonlySet<string> = new Set([...SENSOR_KINDS, 'switch', 'socket', 'valve', 'alarm_panel']);
const AUX_THINGS: ReadonlySet<ThingKind> = new Set<ThingKind>(['socket', 'valve', 'other']);
const SELF_SWITCHED: ReadonlySet<ThingKind> = new Set<ThingKind>(['kettle', 'fountain', 'airfryer', 'purifier', 'humidifier']);
/** The owner (11.11.2026): the pet feeder keeps its drawn cat everywhere, whatever photo is configured. */
const KEEPS_DRAWING: ReadonlySet<ThingKind> = new Set<ThingKind>(['feeder']);
/** A room's thing (model/room.ts) that may show its photo; `main` is its main entity (a thing run by a plain switch is a relay unless SELF_SWITCHED). */
export const thingTakesPhoto = (kind: ThingKind, main?: string | null): boolean => !AUX_THINGS.has(kind) && !KEEPS_DRAWING.has(kind) && (!main?.startsWith('switch.') || SELF_SWITCHED.has(kind));
/** A device that may show its photo: an appliance, not a sensor, a relay or a plug. */
export function takesPhoto(d: { kind: string; name: string; model?: string | null; primary: { id: string }; controls?: Array<{ id: string }> }): boolean {
  const thing = kindOf(d.name, [d.primary.id, ...(d.controls ?? []).map(c => c.id)], d.model ?? '');
  if (KEEPS_DRAWING.has(thing)) return false;
  if (!AUX_KINDS.has(d.kind)) return true;
  if (d.kind !== 'switch' && d.kind !== 'socket') return false;
  return SELF_SWITCHED.has(thing);
}
