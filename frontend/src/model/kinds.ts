import type { EntityRow, StateRow } from './registry.ts';
import { domainOf, isNumeric } from './registry.ts';

/** Household device kinds the panel knows how to draw and control. */
export type Kind = 'light' | 'switch' | 'socket' | 'climate' | 'fan' | 'cover' | 'lock' | 'vacuum' | 'media' | 'camera' | 'weather'
  | 'environment' | 'energy' | 'leak' | 'opening' | 'motion' | 'alarm' | 'valve' | 'alarm_panel' | 'person' | 'measurement';
/** Control kinds: one card per entity (a 2-gang switch is two cards). Sensor kinds merge per HA device. */
export const CONTROL_KINDS: readonly Kind[] = ['climate', 'light', 'vacuum', 'media', 'camera', 'cover', 'lock', 'valve', 'alarm_panel', 'fan', 'switch', 'socket'];
export const SENSOR_KINDS: readonly Kind[] = ['environment', 'energy', 'leak', 'alarm', 'opening', 'motion', 'weather', 'person', 'measurement'];
/** Which kind wins when a device has several candidate entities (merged sensor cards only). */
export const KIND_PRIORITY: readonly Kind[] = [...CONTROL_KINDS, 'environment', 'energy', 'leak', 'alarm', 'opening', 'motion', 'weather', 'person', 'measurement'];

const ENV_CLASSES = new Set(['temperature', 'humidity', 'carbon_dioxide', 'pm25', 'pm10', 'pm1', 'volatile_organic_compounds', 'volatile_organic_compounds_parts', 'aqi', 'illuminance', 'atmospheric_pressure', 'pressure', 'nitrogen_dioxide', 'ozone']);
const ENERGY_CLASSES = new Set(['power', 'energy', 'voltage', 'current', 'apparent_power', 'reactive_power', 'power_factor', 'frequency', 'gas', 'water']);
const DIAG_SENSOR_CLASSES = new Set(['battery', 'signal_strength', 'timestamp', 'duration', 'data_size', 'data_rate', 'enum']);
const OPENING = new Set(['opening', 'door', 'window', 'garage_door', 'garage']);
const MOTION = new Set(['motion', 'occupancy', 'presence', 'vibration']);
const ALARM = new Set(['smoke', 'gas', 'carbon_monoxide', 'safety', 'tamper', 'sound']);
const DIAG_BINARY = new Set(['connectivity', 'running', 'battery', 'battery_charging', 'plug', 'power', 'update', 'problem', 'heat', 'cold', 'light', 'lock', 'moving']);
/** Domains that never become household cards. */
export const SERVICE_DOMAINS = new Set(['update', 'automation', 'script', 'scene', 'input_boolean', 'input_number', 'input_select', 'input_text', 'input_button', 'input_datetime', 'zone', 'sun', 'tts', 'stt', 'conversation', 'event', 'todo', 'calendar', 'notify', 'device_tracker', 'remote', 'siren', 'image', 'date', 'time', 'datetime', 'counter', 'timer', 'schedule', 'assist_satellite', 'tag']);
/** Domains that attach to their device as adjustable parameters. */
export const PARAMETER_DOMAINS = new Set(['number', 'select', 'button', 'text', 'switch']);

/** Platforms whose entities describe the person's phone or the HA installation, never the home. */
export const EXCLUDED_PLATFORMS = new Set(['mobile_app', 'hassio', 'hacs', 'backup', 'cloud', 'sun', 'time_date', 'local_ip', 'shopping_list']);
/** Class guessed from the unit when an integration declares none (Tasmota meters, templates). */
const UNIT_CLASS: Record<string, string> = { '°C': 'temperature', 'W': 'power', 'kW': 'power', 'kWh': 'energy', 'Wh': 'energy', 'V': 'voltage', 'A': 'current', 'lx': 'illuminance', 'ppm': 'carbon_dioxide', 'hPa': 'atmospheric_pressure', 'bar': 'pressure', 'VA': 'apparent_power', 'var': 'reactive_power' };
/** Kind of a single entity as a card candidate; null = never a card on its own (diagnostic, parameter or hidden). */
export function entityKind(entity: Pick<EntityRow, 'entity_id' | 'device_class'> & { unit?: string | null }, state?: StateRow): Kind | null {
  const domain = domainOf(entity.entity_id);
  const unit = entity.unit ?? (state?.attributes.unit_of_measurement as string | undefined) ?? null;
  const dc = entity.device_class ?? (state?.attributes.device_class as string | undefined) ?? (unit ? UNIT_CLASS[unit] ?? null : null);
  switch (domain) {
    case 'light': return 'light';
    case 'switch': return dc === 'outlet' ? 'socket' : 'switch';
    case 'climate': return 'climate';
    case 'fan': return 'fan';
    case 'cover': return 'cover';
    case 'lock': return 'lock';
    case 'vacuum': return 'vacuum';
    case 'media_player': return 'media';
    case 'camera': return 'camera';
    case 'weather': return 'weather';
    case 'valve': return 'valve';
    case 'alarm_control_panel': return 'alarm_panel';
    case 'person': return 'person';
    case 'sensor': {
      if (dc && ENV_CLASSES.has(dc)) return 'environment';
      if (dc && ENERGY_CLASSES.has(dc)) return 'energy';
      if (dc && DIAG_SENSOR_CLASSES.has(dc)) return null;
      if (state && !isNumeric(state.state) && state.state !== 'unavailable' && state.state !== 'unknown') return null;
      // Class-less counters and app numbers are diagnostics, not household readings.
      return dc ? 'measurement' : null;
    }
    case 'binary_sensor': {
      if (dc === 'moisture') return 'leak';
      if (dc && OPENING.has(dc)) return 'opening';
      if (dc && MOTION.has(dc)) return 'motion';
      if (dc && ALARM.has(dc)) return 'alarm';
      if (!dc || DIAG_BINARY.has(dc)) return null;
      return 'measurement';
    }
    default: return null;
  }
}
/** Where a non-card entity goes inside its device. */
export function entityCategory(entity: EntityRow, kind: Kind | null): 'primary' | 'parameter' | 'diagnostic' | 'hidden' {
  const domain = domainOf(entity.entity_id);
  if (entity.disabled_by || entity.hidden_by || EXCLUDED_PLATFORMS.has(entity.platform)) return 'hidden';
  if (entity.entity_category === 'diagnostic') return 'diagnostic';
  if (entity.entity_category === 'config') return domain === 'sensor' || domain === 'binary_sensor' ? 'diagnostic' : 'parameter';
  if (kind) return 'primary';
  if (SERVICE_DOMAINS.has(domain)) return 'hidden';
  if (PARAMETER_DOMAINS.has(domain)) return 'parameter';
  if (domain === 'sensor' || domain === 'binary_sensor') return 'diagnostic';
  return 'hidden';
}
export const SECTIONS = ['home', 'rooms', 'lights', 'climate', 'cleaning', 'energy', 'systems', 'camera', 'weather'] as const;
export type Section = typeof SECTIONS[number];
/** Which screen lists a kind by default. */
export function sectionOfKind(kind: Kind): Section | null {
  switch (kind) {
    case 'light': return 'lights';
    case 'climate': return 'climate';
    case 'vacuum': return 'cleaning';
    case 'energy': return 'energy';
    case 'camera': return 'camera';
    case 'weather': return 'weather';
    case 'person': return null;
    default: return 'systems';
  }
}
