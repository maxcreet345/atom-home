import { unavailable, type Registry, type StateRow } from './registry.ts';

/** The house's thermometers for «Климат» (owner, 18.11.2026: «добавь ещё внешние датчики температуры»): the street first, then every room.
 *  A room's thermometer is the one HA's area settings name (Settings → Areas → «Датчик температуры» / «Датчик влажности») — the same one HA's
 *  own area card shows, so the panel never picks a kettle or a NAS disk. The street is a temperature sensor outside every area whose device or
 *  name says so («Улица · Климат · Теневая сторона», `sensor.outdoor_*`). Read-only. */
export interface ClimateReading { key: string; name: string; place: string; temp: number | null; hum: number | null; online: boolean; tempId: string }
export interface ClimateSensors { outdoor: ClimateReading[]; rooms: ClimateReading[] }

const OUTSIDE = /(^|[_\s.·-])(outdoor|outside|exterior|street)([_\s.·-]|$)|улиц|снаружи|exterior|afară|exterior/i;
const value = (s: StateRow | undefined): number | null => s && !unavailable(s.state) && s.state.trim() !== '' && Number.isFinite(Number(s.state)) ? Number(s.state) : null;
const classOf = (reg: Registry, id: string): string | null => reg.entities.find(e => e.entity_id === id)?.device_class ?? (reg.states[id]?.attributes.device_class as string | undefined) ?? null;

/** «Улица · Климат · Солнечная сторона» → «Солнечная сторона»: the last part that is not the street or the kind of device. */
export function streetName(raw: string): string {
  const parts = raw.split(/\s*·\s*/).map(p => p.trim()).filter(p => p && !/^(улица|outdoor|outside|street|afară|климат|climate|climă|датчик( климата| температуры)?|sensor|температура|temperature)$/i.test(p));
  return parts.at(-1) ?? raw;
}

export function climateSensors(reg: Registry, order: string[] = []): ClimateSensors {
  const S = reg.states, used = new Set<string>();
  const rank = (id: string) => { const i = order.indexOf(id); return i < 0 ? order.length : i; };
  const rooms: ClimateReading[] = reg.areas.filter(a => a.temperature_entity_id && S[a.temperature_entity_id])
    .sort((a, b) => rank(a.area_id) - rank(b.area_id))
    .map(a => { const id = a.temperature_entity_id!, h = a.humidity_entity_id ?? null; used.add(id); return { key: a.area_id, name: a.name, place: a.name, temp: value(S[id]), hum: h ? value(S[h]) : null, online: !unavailable(S[id]?.state), tempId: id }; });
  const devName = (deviceId: string | null) => deviceId ? reg.devices.find(d => d.id === deviceId)?.name ?? '' : '';
  const outdoor: Array<ClimateReading & { device?: string | null }> = [];
  for (const e of reg.entities) {
    const id = e.entity_id;
    if (!id.startsWith('sensor.') || used.has(id) || e.disabled_by || e.hidden_by || e.entity_category || !S[id]) continue;
    if (classOf(reg, id) !== 'temperature' || e.area_id) continue;
    const dev = e.device_id ? reg.devices.find(d => d.id === e.device_id) : undefined;
    if (dev?.area_id) continue; // a thermometer in a room is that room's, not the street's
    const label = `${devName(e.device_id)} ${e.name ?? ''} ${e.original_name ?? ''} ${String(S[id].attributes.friendly_name ?? '')} ${id}`;
    if (!OUTSIDE.test(label) || /weather|openweather|forecast|прогноз|feels|dew|рос[аы]|apparent|heat_?index/i.test(label)) continue; // the dew point is «temperature» to HA too (live 18.11: 10,8° beside 16,5°)
    if (e.device_id && outdoor.some(o => o.device === e.device_id)) continue; // one thermometer a device
    // its humidity: the same device's humidity sensor
    const hum = e.device_id ? reg.entities.find(x => x.device_id === e.device_id && x.entity_id.startsWith('sensor.') && classOf(reg, x.entity_id) === 'humidity' && !x.disabled_by) : undefined;
    const raw = devName(e.device_id) || String(S[id].attributes.friendly_name ?? id);
    outdoor.push({ key: id, device: e.device_id, name: streetName(raw), place: '', temp: value(S[id]), hum: hum ? value(S[hum.entity_id]) : null, online: !unavailable(S[id].state), tempId: id });
  }
  outdoor.sort((a, b) => a.name.localeCompare(b.name));
  return { outdoor, rooms };
}
