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
export const isMains = (d: HomeDevice): boolean => /sonoff\s*spm|\bspm\b/i.test(`${d.model ?? ''} ${d.manufacturer ?? ''} ${d.primary.id}`);
export function mainsPower(devices: HomeDevice[], boilers: Set<string>): EntityRef[] {
  const mains = devices.filter(isMains).flatMap(x => x.metrics.filter(m => isElectric(m, x, boilers) && m.available && Number.isFinite(Number(m.state))));
  return mains.length ? mains : devices.flatMap(x => x.metrics.filter(m => isElectric(m, x, boilers) && m.available && Number.isFinite(Number(m.state))));
}
export const isElectric = (m: EntityRef, d: HomeDevice, boilers: Set<string>): boolean => m.deviceClass === 'power' && (m.unit === 'W' || m.unit === 'kW') && !(d.haDeviceId !== null && boilers.has(d.haDeviceId));
