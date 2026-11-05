// The Criuleni feeder as HA shows it (renamed entities) and its journal as Xiaomi's cloud gives it, around a fixed morning. Shared by the QA and the preview server.
export const FEEDER_DEVICE = 'b0affd68765f7885f0b8924a8860c235';
const P = 'kitchen_cat_feeder_';
export function addFeeder(fx, over = {}) {
  const area = fx.areas.find(a => /кух/i.test(a.name))?.area_id ?? fx.areas[0]?.area_id ?? null;
  fx.devices.push({ id: FEEDER_DEVICE, name: 'Кухня · Кормушка кошки (Xiaomi Smart Pet Food Feeder 2)', model: 'xiaomi.feeder.iv2001', manufacturer: 'Xiaomi', area_id: area, entry_type: null });
  const add = (id, state, attributes = {}) => { fx.entities.push({ entity_id: id, device_id: FEEDER_DEVICE, area_id: null, name: null, original_name: id, platform: 'xiaomi_miot', entity_category: null, disabled_by: null, hidden_by: null, icon: null, original_icon: null, device_class: null, unit: null, has_entity_name: false }); fx.states[id] = { state: over[id] ?? state, attributes: { friendly_name: id, ...attributes }, last_changed: '2026-11-05T05:00:00Z', last_updated: '2026-11-05T05:00:00Z' }; };
  for (const [d, n, s, a] of [['button', 'dispense', 'unknown'], ['button', 'info', 'unknown', { 'feeder_schedule-5-1': '[1,08000101,11000101,15000101,19000101]' }], ['button', 'calibrate', 'unknown'], ['button', 'reset_desiccant', 'unknown'], ['switch', 'schedule', 'on'], ['switch', 'compensate', 'on'], ['switch', 'prevent_accumulation', 'off'], ['switch', 'add_meal_reminder', 'off'], ['switch', 'low_intake_alert', 'off'], ['switch', 'child_lock', 'off'], ['sensor', 'food_level', 'normal'], ['sensor', 'dispense_status', 'normal'], ['sensor', 'food_stuck', 'normal'], ['sensor', 'desiccant_level', '0'], ['sensor', 'eaten_p22', '0', { 'eaten_food_measure-2-22': 0 }], ['sensor', 'bowl_percent', '25'], ['sensor', 'busy', 'idle'], ['binary_sensor', 'battery_low', 'off'], ['select', 'screen', 'Left-gram-display', { options: ['Left-gram-display', 'Eaten-gram-display', 'Percentage-display'] }], ['number', 'low_intake_threshold', '10'], ['sensor', 'power_est', '1.2']]) add(`${d}.${P}${n}`, s, a ?? {});
  return fx;
}
export const feederEntity = (domain, name) => `${domain}.${P}${name}`;
/** A week of real-looking meals ending this morning: today's plan at 07:00, then two small meals. `now`: the fixed clock of the test. */
export function feederLog(now = new Date()) {
  const day = (back, h, m) => Math.floor(new Date(now.getFullYear(), now.getMonth(), now.getDate() - back, h, m).getTime() / 1000);
  const events = [[0, 7, 0, 'plan', 10], [0, 7, 3, 'ate', 4], [0, 7, 5, 'ate', 4], [1, 7, 0, 'plan', 10], [1, 7, 4, 'ate', 6], [1, 10, 0, 'plan', 10], [1, 10, 5, 'ate', 9], [1, 14, 0, 'plan', 10], [1, 14, 8, 'ate', 10], [1, 18, 0, 'plan', 10], [1, 18, 5, 'ate', 9], [1, 20, 27, 'manual', 10], [1, 20, 32, 'ate', 9], [2, 7, 0, 'plan', 10], [2, 7, 9, 'ate', 10], [2, 14, 0, 'plan', 20], [2, 14, 4, 'ate', 14], [2, 18, 0, 'plan', 10], [2, 18, 7, 'ate', 10], [3, 7, 2, 'ate', 10], [6, 7, 5, 'ate', 12], [6, 18, 5, 'ate', 26]].map(([b, h, m, kind, grams]) => ({ at: day(b, h, m), kind, grams }));
  return { tz: 10800, desiccant: { level: 93, days: 28 }, events };
}
