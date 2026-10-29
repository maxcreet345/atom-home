import type { HomeDevice, EntityRef } from '../model/discover.ts';
import type { CustomButton } from '../model/config.ts';
import type { Key } from '../i18n/index.ts';

export type Risk = 'normal' | 'water' | 'security' | 'custom';
export interface Action {
  id: string; label: Key | string; kind: 'button' | 'toggle' | 'number' | 'select';
  domain: string; service: string; entityId: string; data?: Record<string, unknown>; confirm: boolean; risk: Risk;
  /** number: range; select: options; toggle: service for the other state is derived. */
  min?: number; max?: number; step?: number; unit?: string; options?: string[]; current?: unknown;
}
const num = (v: unknown, d: number) => typeof v === 'number' && Number.isFinite(v) ? v : d;
const list = (v: unknown) => Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
const supports = (e: EntityRef, bit: number) => (num(e.attributes.supported_features, 0) & bit) === bit;

/** White-listed actions for the device's primary entity: only standard HA services that match the entity's declared features. */
export function actionsFor(device: HomeDevice): Action[] {
  const e = device.primary, id = e.id, a = e.attributes, out: Action[] = [];
  const push = (x: Omit<Action, 'entityId' | 'confirm' | 'risk'> & { confirm?: boolean; risk?: Risk }) => out.push({ entityId: id, confirm: false, risk: 'normal', ...x });
  switch (device.kind) {
    case 'light': {
      push({ id: 'toggle', label: 'action.toggle', kind: 'toggle', domain: 'light', service: 'toggle', current: e.state === 'on' });
      const modes = list(a.supported_color_modes);
      if (modes.some(m => m !== 'onoff')) push({ id: 'brightness', label: 'action.brightness', kind: 'number', domain: 'light', service: 'turn_on', min: 1, max: 100, step: 1, unit: '%', current: typeof a.brightness === 'number' ? Math.round(a.brightness / 2.55) : null });
      const effects = list(a.effect_list); if (effects.length && supports(e, 4)) push({ id: 'effect', label: 'action.effect', kind: 'select', domain: 'light', service: 'turn_on', options: effects, current: a.effect ?? null });
      if (modes.includes('color_temp')) push({ id: 'color_temp', label: 'action.color_temp', kind: 'number', domain: 'light', service: 'turn_on', min: num(a.min_color_temp_kelvin, 2000), max: num(a.max_color_temp_kelvin, 6500), step: 50, unit: 'K', current: a.color_temp_kelvin ?? null });
      break; }
    case 'switch': case 'socket': push({ id: 'toggle', label: 'action.toggle', kind: 'toggle', domain: 'switch', service: 'toggle', current: e.state === 'on' }); break;
    case 'fan': push({ id: 'toggle', label: 'action.toggle', kind: 'toggle', domain: 'fan', service: 'toggle', current: e.state === 'on' }); if (supports(e, 1)) push({ id: 'percentage', label: 'action.percentage', kind: 'number', domain: 'fan', service: 'set_percentage', min: 0, max: 100, step: num(a.percentage_step, 1), unit: '%', current: a.percentage ?? null }); break;
    case 'cover': if (supports(e, 1)) push({ id: 'open', label: 'action.open', kind: 'button', domain: 'cover', service: 'open_cover' }); if (supports(e, 2)) push({ id: 'close', label: 'action.close', kind: 'button', domain: 'cover', service: 'close_cover' }); if (supports(e, 8)) push({ id: 'stop', label: 'action.stop', kind: 'button', domain: 'cover', service: 'stop_cover' }); if (supports(e, 4)) push({ id: 'position', label: 'action.position', kind: 'number', domain: 'cover', service: 'set_cover_position', min: 0, max: 100, step: 1, unit: '%', current: a.current_position ?? null }); break;
    case 'lock': push({ id: 'lock', label: 'action.lock', kind: 'button', domain: 'lock', service: 'lock', confirm: true, risk: 'security' }); push({ id: 'unlock', label: 'action.unlock', kind: 'button', domain: 'lock', service: 'unlock', confirm: true, risk: 'security' }); break;
    case 'valve': push({ id: 'open', label: 'action.open', kind: 'button', domain: 'valve', service: 'open_valve', confirm: true, risk: 'water' }); push({ id: 'close', label: 'action.close', kind: 'button', domain: 'valve', service: 'close_valve', confirm: true, risk: 'water' }); break;
    case 'vacuum': {
      if (supports(e, 8192) && e.state !== 'cleaning') push({ id: 'start', label: 'action.start', kind: 'button', domain: 'vacuum', service: 'start' });
      if (supports(e, 4) && e.state === 'cleaning') push({ id: 'pause', label: 'action.pause', kind: 'button', domain: 'vacuum', service: 'pause' });
      if (supports(e, 8) && (e.state === 'cleaning' || e.state === 'returning')) push({ id: 'stop', label: 'action.stop', kind: 'button', domain: 'vacuum', service: 'stop' });
      if (supports(e, 16)) push({ id: 'return', label: 'action.return', kind: 'button', domain: 'vacuum', service: 'return_to_base' });
      if (supports(e, 512)) push({ id: 'locate', label: 'action.locate', kind: 'button', domain: 'vacuum', service: 'locate' });
      const speeds = list(a.fan_speed_list); if (speeds.length && supports(e, 32)) push({ id: 'fan_speed', label: 'action.fan_speed', kind: 'select', domain: 'vacuum', service: 'set_fan_speed', options: speeds, current: a.fan_speed ?? null });
      break; }
    case 'media': {
      if (supports(e, 128) || supports(e, 256)) push({ id: 'toggle', label: 'action.toggle', kind: 'toggle', domain: 'media_player', service: 'toggle', current: !['off', 'standby', 'unavailable', 'unknown'].includes(e.state) });
      if (supports(e, 16384)) push({ id: 'play', label: e.state === 'playing' ? 'action.pause' : 'action.play', kind: 'button', domain: 'media_player', service: 'media_play_pause' });
      if (supports(e, 16)) push({ id: 'previous', label: 'action.previous', kind: 'button', domain: 'media_player', service: 'media_previous_track' });
      if (supports(e, 32)) push({ id: 'next', label: 'action.next', kind: 'button', domain: 'media_player', service: 'media_next_track' });
      if (supports(e, 4)) push({ id: 'volume', label: 'action.volume', kind: 'number', domain: 'media_player', service: 'volume_set', min: 0, max: 100, step: 1, unit: '%', current: typeof a.volume_level === 'number' ? Math.round(a.volume_level * 100) : null });
      if (supports(e, 8)) push({ id: 'mute', label: 'action.mute', kind: 'toggle', domain: 'media_player', service: 'volume_mute', current: a.is_volume_muted === true });
      const sources = list(a.source_list); if (sources.length && supports(e, 2048)) push({ id: 'source', label: 'action.source', kind: 'select', domain: 'media_player', service: 'select_source', options: sources, current: a.source ?? null });
      break; }
    case 'climate': {
      const modes = list(a.hvac_modes); if (modes.length) push({ id: 'hvac_mode', label: 'action.hvac_mode', kind: 'select', domain: 'climate', service: 'set_hvac_mode', options: modes, current: e.state });
      if (supports(e, 1)) push({ id: 'temperature', label: 'action.temperature', kind: 'number', domain: 'climate', service: 'set_temperature', min: num(a.min_temp, 5), max: num(a.max_temp, 35), step: num(a.target_temp_step, 0.5), unit: '°C', current: a.temperature ?? null });
      const presets = list(a.preset_modes); if (presets.length && supports(e, 16)) push({ id: 'preset', label: 'action.preset', kind: 'select', domain: 'climate', service: 'set_preset_mode', options: presets, current: a.preset_mode ?? null });
      const fans = list(a.fan_modes); if (fans.length && supports(e, 8)) push({ id: 'fan_mode', label: 'action.fan_mode', kind: 'select', domain: 'climate', service: 'set_fan_mode', options: fans, current: a.fan_mode ?? null });
      const swings = list(a.swing_modes); if (swings.length && supports(e, 32)) push({ id: 'swing_mode', label: 'action.swing_mode', kind: 'select', domain: 'climate', service: 'set_swing_mode', options: swings, current: a.swing_mode ?? null });
      break; }
    case 'alarm_panel': if (supports(e, 2)) push({ id: 'arm_away', label: 'action.arm_away', kind: 'button', domain: 'alarm_control_panel', service: 'alarm_arm_away', confirm: true, risk: 'security' }); if (supports(e, 1)) push({ id: 'arm_home', label: 'action.arm_home', kind: 'button', domain: 'alarm_control_panel', service: 'alarm_arm_home', confirm: true, risk: 'security' }); push({ id: 'disarm', label: 'action.disarm', kind: 'button', domain: 'alarm_control_panel', service: 'alarm_disarm', confirm: true, risk: 'security' }); break;
    default: break;
  }
  return out;
}
/** Service data for an action with a user-provided value; the entity is always the device's primary entity. */
export function serviceCall(action: Action, value?: unknown): { domain: string; service: string; data: Record<string, unknown> } {
  const data: Record<string, unknown> = { entity_id: action.entityId, ...(action.data ?? {}) };
  switch (action.id) {
    case 'brightness': data.brightness_pct = value; break;
    case 'color_temp': data.color_temp_kelvin = value; break;
    case 'percentage': data.percentage = value; break;
    case 'position': data.position = value; break;
    case 'volume': data.volume_level = typeof value === 'number' ? value / 100 : value; break;
    case 'mute': data.is_volume_muted = value; break;
    case 'fan_speed': data.fan_speed = value; break;
    case 'source': data.source = value; break;
    case 'hvac_mode': data.hvac_mode = value; break;
    case 'temperature': data.temperature = value; break;
    case 'preset': data.preset_mode = value; break;
    case 'effect': data.effect = value; break;
    case 'fan_mode': data.fan_mode = value; break;
    case 'swing_mode': data.swing_mode = value; break;
    case 'value': data.value = value; break;
    case 'option': data.option = value; break;
    default: break;
  }
  return { domain: action.domain, service: action.service, data };
}
/** Owner-defined buttons: any HA service, always shown with their own confirm flag; the panel never invents data. */
export function customAction(b: CustomButton): Action {
  const [domain, service] = b.service.split('.');
  return { id: `custom:${b.id}`, label: b.label, kind: 'button', domain, service, entityId: typeof b.target?.entity_id === 'string' ? b.target.entity_id : '', data: { ...(b.target ?? {}), ...(b.data ?? {}) }, confirm: b.confirm, risk: 'custom' };
}

/** Actions for a secondary entity of the device (settings: switch / number / select / button and their input_* twins). Read-only domains yield nothing. */
export function entityActions(e: EntityRef): Action[] {
  const a = e.attributes, id = e.id;
  switch (e.domain) {
    case 'switch': case 'input_boolean': return [{ id: 'toggle', label: e.name, kind: 'toggle', domain: e.domain, service: 'toggle', entityId: id, confirm: false, risk: 'normal', current: e.state === 'on' }];
    case 'number': case 'input_number': return [{ id: 'value', label: e.name, kind: 'number', domain: e.domain, service: 'set_value', entityId: id, confirm: false, risk: 'normal', min: num(a.min, 0), max: num(a.max, 100), step: num(a.step, 1), unit: typeof a.unit_of_measurement === 'string' ? a.unit_of_measurement : undefined, current: Number.isFinite(Number(e.state)) ? Number(e.state) : null }];
    case 'select': case 'input_select': { const options = list(a.options); return options.length ? [{ id: 'option', label: e.name, kind: 'select', domain: e.domain, service: 'select_option', entityId: id, confirm: false, risk: 'normal', options, current: options.includes(e.state) ? e.state : null }] : []; }
    case 'button': case 'input_button': return [{ id: 'press', label: e.name, kind: 'button', domain: e.domain, service: 'press', entityId: id, confirm: false, risk: 'normal' }];
    default: return [];
  }
}
