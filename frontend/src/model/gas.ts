import { unavailable, type Registry } from './registry.ts';

/** The house's gas meters for «Газ» on «Энергия»: any sensor of class `gas` that only grows (state_class total / total_increasing), the kind HA's
 *  Energy dashboard takes. In Criuleni the kitchen meter read by a camera every 5 minutes (18.11.2026). Read-only. */
export interface GasMeter { id: string; name: string; value: number | null; unit: string; changed: number | null; online: boolean }

export function gasMeters(reg: Registry): GasMeter[] {
  return reg.entities.filter(e => e.entity_id.startsWith('sensor.') && !e.disabled_by && !e.hidden_by && reg.states[e.entity_id]).flatMap(e => {
    const s = reg.states[e.entity_id], a = s.attributes;
    if ((e.device_class ?? a.device_class) !== 'gas' || !/^total(_increasing)?$/.test(String(a.state_class ?? ''))) return [];
    const unit = String(a.unit_of_measurement ?? 'm³'), v = Number(s.state);
    const dev = e.device_id ? reg.devices.find(d => d.id === e.device_id)?.name ?? '' : '';
    return [{ id: e.entity_id, name: dev || String(a.friendly_name ?? e.entity_id), value: unavailable(s.state) || !Number.isFinite(v) ? null : v, unit, changed: Date.parse(s.last_changed) || null, online: !unavailable(s.state) }];
  });
}

