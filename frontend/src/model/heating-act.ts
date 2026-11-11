/* What the heating panel can do (docs/HEATING.md §D): every command is one HA service the automations already understand. Pure: tested under Node. */
import { NO_RETURN_DAY, type Heating, type HeatRoom } from './heating.ts';
type Call = (domain: string, service: string, data: Record<string, unknown>) => Promise<unknown>;
export function heatingActions(h: Heating, host: { call: Call }) {
  const call: Call = (d, s, data) => host.call(d, s, data);
  return {
    /** «Авто»: the common temperature — in «Дома» it is the «Дома» temperature, in another scenario a change until the scenario ends (as on the thermostat).
     * «Ручной»: every room gets it at once. */
    house: (v: number): Promise<unknown> => h.mode === 'manual' ? Promise.all(h.rooms.map(r => call('input_number', 'set_value', { entity_id: `input_number.${r.key}_heating_manual_temp`, value: v }))) :
      h.scenario === 'home' ? call('input_number', 'set_value', { entity_id: 'input_number.heating_home_temp', value: v }) :
      Promise.all([call('input_number', 'set_value', { entity_id: 'input_number.heating_scenario_override_temp', value: v }), call('input_boolean', 'turn_on', { entity_id: 'input_boolean.heating_scenario_override' })]),
    mode: (m: 'auto' | 'manual') => call('input_select', 'select_option', { entity_id: 'input_select.heating_mode', option: m === 'manual' ? 'Ручной' : 'Авто' }),
    power: (on: boolean) => call('climate', 'set_hvac_mode', { entity_id: h.thermostat, hvac_mode: on ? 'heat' : 'off' }),
    /** the head itself: in «Авто» the automation keeps it three hours, in «Ручной» it becomes the room's temperature */
    room: (r: HeatRoom, v: number) => call('climate', 'set_temperature', { entity_id: r.trv, temperature: v }),
    back: (r: HeatRoom) => call('timer', 'cancel', { entity_id: `timer.${r.key}_heating_override` }),
    /** the heads' hysteresis for the whole house: the helpers only, the heating automation puts it on every head */
    hyst: (k: 'down' | 'up', v: number) => call('input_number', 'set_value', { entity_id: `input_number.heating_hyst_${k}`, value: v }),
    /** «Отпуск» is the house's: with the security's own «Отпуск» it arms or disarms that, and the heating follows (heating_security).
     * Switching on writes the return date first (the heating warms the house for that day) — and without one, the house's «no date»
     * (`NO_RETURN_DAY`, CODEX-011): a date left from an earlier plan never stays in force behind a «no date». A refused write leaves «Отпуск» off. */
    vacation: async (on: boolean, back?: string | null): Promise<unknown> => {
      if (on && h.vacationReturnId) await call('input_datetime', 'set_datetime', { entity_id: h.vacationReturnId, datetime: `${back || NO_RETURN_DAY} 00:00:00` });
      return h.security?.vacation ? (on ? call('alarm_control_panel', 'alarm_arm_vacation', { entity_id: h.security.id }) : vacationDisarms(h) ? call('alarm_control_panel', 'alarm_disarm', { entity_id: h.security.id }) : call('input_boolean', 'turn_off', { entity_id: 'input_boolean.heating_vacation' })) : call('input_boolean', on ? 'turn_on' : 'turn_off', { entity_id: 'input_boolean.heating_vacation' });
    },
    flag: (k: 'eco' | 'guests' | 'vacation', on: boolean) => call('input_boolean', on ? 'turn_on' : 'turn_off', { entity_id: `input_boolean.heating_${k}` }),
  };
}
/** Switching «Отпуск» off takes the house off guard when the guard stands in «Отпуск»: the question says so. */
export const vacationDisarms = (h: Heating): boolean => !!h.security?.vacation && (h.security.state === 'armed_vacation' || h.security.mode === 'armed_vacation');
