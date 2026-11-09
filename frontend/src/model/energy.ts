import type { HomeDevice, EntityRef } from './discover.ts';
import type { Registry } from './registry.ts';
import type { ActiveModule } from '../modules/index.ts';
/** Electricity only (audit 04.11.2026, «Энергия 24 kW»): the gas boiler reports its thermal part-load as a `power` sensor in kW and its
 * pump as a unitless «100», so the home's «Энергия сейчас» summed 23 kW of heat. A reading counts as electric power when it is W or kW
 * and does not belong to the device the boiler module watches. */
export function boilerDeviceIds(modules: ActiveModule[], registry: Registry): Set<string> {
  const ids = modules.filter(m => m.def.id === 'boiler_ebus').flatMap(m => Object.values(m.entities)).filter((x): x is string => typeof x === 'string');
  return new Set(ids.map(id => registry.entities.find(e => e.entity_id === id)?.device_id).filter((x): x is string => !!x));
}
/** The owner's rule (04.11.2026): «Энергия сейчас» on the home face is the sum of the Sonoff SPM channels — the house feed — never the plugs
 * on top of it (they are already inside the feed). Without an SPM in the home the electric readings are summed as before. */
export const isMains = (d: HomeDevice, grid?: ReadonlySet<string>): boolean => /sonoff\s*spm|\bspm\b/i.test(`${d.model ?? ''} ${d.manufacturer ?? ''} ${d.primary.id}`)
  // a building fed through other meters (Atom + Okapi, 09.11.2026: five Tasmota POW inputs and the scooter store's own relay): HA's Energy
  // settings name the grid connections, and a device holding one of those counters is a feed
  || (!!grid?.size && [...d.metrics, ...d.parameters, ...d.diagnostics].some(m => grid.has(m.id)));
/** The house feed now (owner, 06.11.2026): the sum of every SPM channel, apartment 8, the car charger, apartment 9 and the spare one.
 * The channels live and die together, so one that says nothing means the feed is not heard: «нет связи», never the sum of the rest.
 * No SPM, no figure: the plugs are inside the feed and would add up to a number that is neither the house nor anything else. */
export function feedPower(devices: HomeDevice[], boilers: Set<string>, grid?: ReadonlySet<string>): { watts: number | null; channels: EntityRef[] } | null {
  const channels = devices.filter(d => isMains(d, grid)).flatMap(x => x.metrics.filter(m => isElectric(m, x, boilers)));
  if (!channels.length) return null;
  const values = channels.map(m => m.available ? Number(m.state) * (m.unit === 'kW' ? 1000 : 1) : NaN);
  return { watts: values.every(Number.isFinite) ? values.reduce((a, v) => a + v, 0) : null, channels };
}
/** Energy of the feed: the SPM's «today» counters summed (Tasmota resets them at midnight), and the ids of its running totals, from which HA's
 * statistics give the month. One silent counter and the day is not known: no figure rather than a part of the house. */
const feedEnergy = (devices: HomeDevice[], ending: RegExp, grid?: ReadonlySet<string>) => devices.filter(d => isMains(d, grid)).flatMap(x => x.metrics.filter(m => m.deviceClass === 'energy' && ending.test(m.id)));
export function feedToday(devices: HomeDevice[], grid?: ReadonlySet<string>): number | null {
  const today = feedEnergy(devices, /_energy_(today|day)$/, grid); if (!today.length) return null;
  const values = today.map(m => m.available ? Number(m.state) * (m.unit === 'Wh' ? 0.001 : 1) : NaN);
  return values.every(Number.isFinite) ? values.reduce((a, v) => a + v, 0) : null;
}
/** The counters the month is read from: the daily ones, whose statistics a first day or a meter restart cannot blow up (live check 09.11.2026). */
export const feedTotalIds = (devices: HomeDevice[], grid?: ReadonlySet<string>): string[] => { const daily = feedEnergy(devices, /_energy_(today|day)$/, grid); return (daily.length ? daily : feedEnergy(devices, /_energy_total$/, grid)).map(m => m.id).sort(); };
/** «7,3 kWh», «123 kWh», «1 234 kWh»: one decimal while it is small, whole numbers after. */
export const energyText = (kwh: number, fmt: (v: number, digits: number) => string): { value: string; unit: string } => ({ value: fmt(kwh, kwh < 10 ? 1 : 0), unit: 'kWh' });
/** «380 W», «2,4 kW»: watts up to a thousand, then kilowatts with one decimal (owner, 06.11.2026). */
export const powerText = (watts: number, fmt: (v: number, digits: number) => string): { value: string; unit: string } => watts >= 1000 ? { value: fmt(watts / 1000, 1), unit: 'kW' } : { value: fmt(watts, 0), unit: 'W' };
export const isElectric = (m: EntityRef, d: HomeDevice, boilers: Set<string>): boolean => m.deviceClass === 'power' && (m.unit === 'W' || m.unit === 'kW') && !(d.haDeviceId !== null && boilers.has(d.haDeviceId));
