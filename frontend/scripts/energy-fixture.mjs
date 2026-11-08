// The house feed as it is since 01.11.2026: one Sonoff SPM on Tasmota, four channels. The 28.10 snapshot still has the old eWeLink SPM.
const CHANNELS = [['apt8', 'Квартира 8 (ввод)'], ['ev', 'Зарядка авто'], ['apt9', 'Квартира 9 (ввод)'], ['ch4', 'Канал 4 (пусто)']];
export function addEnergy(base, power = {}, today = {}) {
  const fx = JSON.parse(JSON.stringify(base)), old = new Set(fx.devices.filter(d => /spm/i.test(`${d.model ?? ''} ${d.name ?? ''}`)).map(d => d.id));
  fx.devices = fx.devices.filter(d => !old.has(d.id)); const gone = new Set(fx.entities.filter(e => old.has(e.device_id)).map(e => e.entity_id)); fx.entities = fx.entities.filter(e => !gone.has(e.entity_id)); for (const id of gone) delete fx.states[id];
  fx.devices.push({ id: 'spm-main', name: 'Подъезд · SPM-Main (вводы кв. 8/9, зарядка авто)', model: 'Sonoff SPM', manufacturer: 'Tasmota', area_id: 'podezd', entry_type: null });
  const ent = (eid, cls, unit, state, original, stateClass = 'measurement') => { fx.entities.push({ entity_id: eid, device_id: 'spm-main', area_id: null, disabled_by: null, hidden_by: null, entity_category: null, platform: 'tasmota', device_class: cls, name: null, original_name: original }); fx.states[eid] = { state, attributes: { device_class: cls, unit_of_measurement: unit, state_class: stateClass, friendly_name: `Подъезд · ${original}` }, last_changed: '', last_updated: '' }; };
  for (const [key, name] of CHANNELS) {
    const off = power[key] === 'unavailable', v = x => off ? 'unavailable' : x;
    ent(`sensor.entrance_spm_${key}_voltage`, 'voltage', 'V', v(key === 'apt8' ? '228.7' : '229.4'), `${name} · напряжение`);
    if (key === 'ch4') continue; // the spare channel has only its voltage enabled in HA (book/03-devices/entrance-spm.md)
    ent(`sensor.entrance_spm_${key}_power`, 'power', 'W', power[key] ?? '0.0', `${name} · мощность`);
    ent(`sensor.entrance_spm_${key}_energy_today`, 'energy', 'kWh', today[key] ?? (off ? 'unavailable' : '0.0'), `${name} · энергия today`, 'total_increasing');
    ent(`sensor.entrance_spm_${key}_energy_total`, 'energy', 'kWh', v('100.0'), `${name} · энергия total`, 'total_increasing');
    ent(`sensor.entrance_spm_${key}_current`, 'current', 'A', v(String(Math.round(Number(power[key] ?? 0) / 229 * 100) / 100)), `${name} · ток`);
    ent(`sensor.entrance_spm_${key}_power_factor`, 'power_factor', '', v(key === 'apt8' ? '0.82' : key === 'ev' ? '0.99' : '0.94'), `${name} · коэффициент мощности`);
  }
  return fx;
}
