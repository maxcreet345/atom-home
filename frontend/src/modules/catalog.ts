import type { Registry } from '../model/registry.ts';
import type { HouseConfig } from '../model/config.ts';
import type { ModuleEntities, ModuleMatch, ModuleOptionField, ModuleOptions } from './types.ts';
import { addonFromEntity } from './go2rtc-protocol.ts';
/** Plain-TypeScript part of every module (no UI), so detection is testable under Node. */
export interface ModuleSpec { id: string; titleKey: string; roles: Array<{ role: string; labelKey: string; required: boolean }>; options?: ModuleOptionField[]; placement: Array<'climate' | 'overview' | 'systems'>; detect(registry: Registry): ModuleMatch | null }
const find = (reg: Registry, re: RegExp) => reg.entities.find(e => re.test(e.entity_id) && reg.states[e.entity_id] && reg.states[e.entity_id].state !== 'unavailable')?.entity_id;
export const boilerEbusSpec: ModuleSpec = {
  id: 'boiler_ebus', titleKey: 'module.boiler_ebus', placement: ['climate', 'overview'],
  roles: [
    { role: 'flow', labelKey: 'module.boiler.flow', required: true }, { role: 'return', labelKey: 'module.boiler.return', required: false },
    { role: 'pressure', labelKey: 'module.boiler.pressure', required: true }, { role: 'flame', labelKey: 'module.boiler.flame', required: false },
    { role: 'hwc', labelKey: 'module.boiler.hwc', required: false }, { role: 'flowSet', labelKey: 'module.boiler.flowSet', required: false }, { role: 'hwcSet', labelKey: 'module.boiler.hwcSet', required: false },
  ],
  detect(reg) {
    const flow = find(reg, /ebusd?.*flowtemp|flow_temp|flowtemp_temp/i), pressure = find(reg, /ebusd?.*(waterpressure|pressure_press|water_pressure)/i);
    if (!flow || !pressure) return null;
    const dev = reg.devices.find(d => d.id === reg.entities.find(e => e.entity_id === flow)?.device_id);
    return { label: dev?.name ?? 'eBUS', entities: { flow, pressure, return: find(reg, /ebusd?.*returntemp/i), flame: find(reg, /ebusd?.*flame$/i), hwc: find(reg, /ebusd?.*hwctemp_temp$/i), flowSet: find(reg, /number\..*(podachi|flow).*ustanovka|number\..*flow_temp/i), hwcSet: find(reg, /number\..*(gvs|hwc).*ustanovka|number\..*hwc_temp/i) } };
  },
};
/** Live video from the go2rtc add-on through its ingress (MSE). Detected by the Supervisor-named generic camera `camera.<slug>_go2rtc`. */
export const cameraGo2rtcSpec: ModuleSpec = {
  id: 'camera_go2rtc', titleKey: 'module.camera_go2rtc', placement: [],
  roles: [{ role: 'camera', labelKey: 'module.camera.entity', required: true }],
  options: [{ key: 'addon', labelKey: 'module.camera.addon', required: true, placeholder: 'a1b2c3d4_go2rtc' }, { key: 'stream', labelKey: 'module.camera.stream', required: false, placeholder: 'auto' }, { key: 'streamHd', labelKey: 'module.camera.streamHd', required: false }],
  detect(reg) {
    const cam = reg.entities.find(e => addonFromEntity(e.entity_id) && !e.disabled_by && reg.states[e.entity_id]);
    if (!cam) return null;
    const dev = reg.devices.find(d => d.id === cam.device_id);
    const friendly = reg.states[cam.entity_id]?.attributes.friendly_name;
    return { label: dev?.name ?? (typeof friendly === 'string' ? friendly : 'go2rtc'), entities: { camera: cam.entity_id }, options: { addon: addonFromEntity(cam.entity_id)! } };
  },
};
export const MODULE_SPECS: ModuleSpec[] = [boilerEbusSpec, cameraGo2rtcSpec];
export interface ActiveSpec { spec: ModuleSpec; entities: ModuleEntities; label: string; options: ModuleOptions }
/** Modules whose hardware is present (or that the owner configured by hand) and that are not disabled. */
export function activeSpecs(registry: Registry, config: HouseConfig, specs: ModuleSpec[] = MODULE_SPECS): ActiveSpec[] {
  const out: ActiveSpec[] = [];
  for (const spec of specs) {
    const cfg = config.modules[spec.id];
    if (cfg?.enabled === false) continue;
    const match = spec.detect(registry);
    const entities: ModuleEntities = { ...(match?.entities ?? {}), ...(cfg?.entities ?? {}) };
    const options: ModuleOptions = { ...(match?.options ?? {}), ...(cfg?.options ?? {}) };
    if (!spec.roles.filter(r => r.required).every(r => entities[r.role] && registry.states[entities[r.role]!])) continue;
    if (!(spec.options ?? []).filter(o => o.required).every(o => options[o.key])) continue;
    out.push({ spec, entities, label: match?.label ?? spec.id, options });
  }
  return out;
}
