/* The card catalog (book/06-dashboards/platform-2026/PROMPT-CARD-CATALOG.md, 20.11.2026). Three things are kept apart:
 *  - the RENDERER: how a card is drawn (`device` — the panel's own tile and sheet; `thermostat`; `heatingRooms` — the heating screen);
 *  - the PROFILE: one model of one make, or one scheme, with the fields it binds (`PROFILES` below; a new model of a known behaviour is a profile
 *    and its fields, nothing else);
 *  - the INSTANCE in a house (`HouseConfig.profileInstances`): its own stable id, its bindings, name, room and where it is shown. Two purifiers of
 *    one model are two instances; one purifier on Home and in its room is one.
 * Pure: reads the registry and the states, never calls a service. Opening the form, the preview and saving send nothing to a device. */
import type { Registry, EntityRow, StateRow, DeviceRow } from './registry.ts';
import { domainOf, unavailable } from './registry.ts';
import { entityKind } from './kinds.ts';
import type { Kind } from './kinds.ts';
import { entityRefOf, NO_ROOM, type EntityRef, type HomeDevice } from './discover.ts';
import { MODULE_SPECS } from '../modules/catalog.ts';
import type { HouseConfig } from './config.ts';
import { APPLIANCE_PROFILES } from '../appliances/profiles.ts';

export type Category = 'air_purifier' | 'heating' | 'boiler' | 'pets' | 'kitchen' | 'cleaning' | 'cameras' | 'house' | 'humidifiers' | 'laundry' | 'tv' | 'speakers' | 'health' | 'car' | 'network' | 'meters';
export const CATEGORIES: readonly Category[] = ['air_purifier', 'humidifiers', 'heating', 'boiler', 'pets', 'kitchen', 'laundry', 'cleaning', 'tv', 'speakers', 'cameras', 'health', 'car', 'network', 'meters', 'house'];
/** `module`: the card is one of the panel's device modules (modules/catalog.ts: the feeder, the kettle, a camera…) — it draws itself where its
 * module puts it, and the instance tells it which entities are its own (`config.modules[id].entities`, over what the module found by itself).
 * `native`: the panel draws this appliance with its own card already (the robot, the fountain's room card); the instance records it. */
/** `appliance`: one card per appliance, drawn by its family (src/appliances/: a TV, a station, a washer…). Unlike a module it may stand many
 * times in a house — three TVs are three instances, each driving only the entities bound to it. */
export type Renderer = 'device' | 'thermostat' | 'heatingRooms' | 'module' | 'native' | 'appliance';
/** The card draws itself (a module, the panel's own card): no tile is made from the instance, nothing is taken from the auto-made cards. */
export const selfDrawn = (p: Pick<Profile, 'renderer'>) => p.renderer === 'module' || p.renderer === 'native';
export type Place = 'home' | 'room';
/** One field of a card: what it is for, whether the card needs it, and what may fill it. */
export interface RoleSpec {
  id: string; labelKey: string; hintKey?: string; required: boolean;
  /** the HA domains that may fill it (a button, a switch, a number, a mode list may be a binding too) */ domains: string[];
  deviceClass?: string[]; units?: string[];
  /** the entity's own suffix in this model's integration: the first sign that it is THE field (`_pm25`, `_filter_life`) */ suffix?: RegExp;
  /** `own`: only the chosen device's entities; `prefer` (default): its own first, any other on purpose (an external sensor) */ source?: 'own' | 'prefer';
  /** never offered: a boiler's flow, a target, a set point is no room's air temperature */ exclude?: RegExp;
  /** how it stands on the card: a reading, a setting (parameter), the main control */ as?: 'primary' | 'metric' | 'parameter';
  /** the same appliance seen through a second integration (a Samsung TV's SmartThings device, a Hisense's AirPlay one): offered from devices in
   * the chosen device's room only, and the card takes every entity of that device from the auto-made tiles (no second TV beside the card) */
  sibling?: boolean;
  /** the card takes this field's own tile although it is another device's (a person's weight on the scale's router: health data stays on the card) */
  claim?: boolean;
  /** the socket the appliance is plugged into, or that socket's meter: another device's, so it is suggested only by its name — the appliance's own
   * name with `plug` or `socket` after it (`humidifier.living_humidifier` → `switch.living_humidifier_plug`) */
  plug?: boolean;
}
export interface Profile {
  id: string; version: string; category: Category; brand: string | null; titleKey: string; descKey: string;
  /** exact model codes from HA's device registry (`zhimi.airp.mb5`); empty: a scheme, not one appliance */ models: string[];
  /** the HA integration it is known through, said when the device is not found */ integration?: { platform: string; name: string };
  /** words the search finds it by, besides its title, brand and model codes */ terms: string[];
  renderer: Renderer; kind: Kind;
  /** the device module that draws it (`renderer: 'module'`), one per house */ module?: string;
  /** the appliance family that draws it (`renderer: 'appliance'`): src/appliances/<card>.tsx */ card?: string;
  /** the card's name when the installer gives none and its HA device's name would say another appliance (a reflashed Station Mini 2 is still «Яндекс Станция Мини 2» in HA) */ nameKey?: string;
  /** the glyph of its tile and the word above its sheet's name («Очиститель воздуха», not the HA domain's «Вентилятор») */ icon?: string; kindKey?: string;
  /** the entity a device is found by (the purifier's `fan`); its role id */ anchor?: string;
  roles: RoleSpec[];
  /** the fields of one room of a scheme («＋ Добавить комнату») */ roomRoles?: RoleSpec[];
  places: Place[];
}
/** Heating fields that must never be a room's air temperature (owner's acceptance: «в температуре воздуха кухни исключены уставки и показания котла»). */
const NOT_AIR = /boiler|kotel|котл|котёл|kettle|чайник|fryer|fridge|холодильн|flow|return|dhw|hwc|_target|setpoint|set_point|уставк|_set$|desired|override|manual|_hyst|trv_|_trv$|outdoor|ulic|street/i;
const PURIFIER_4: Profile = {
  id: 'xiaomi.purifier4', version: '1.0.0', category: 'air_purifier', brand: 'Xiaomi', titleKey: 'cat.p.purifier4', descKey: 'cat.p.purifier4.desc',
  models: ['zhimi.airp.mb5'], integration: { platform: 'xiaomi_miot', name: 'Xiaomi Miot' }, terms: ['purifier 4', 'air purifier 4', 'smart air purifier 4', 'mb5', 'очиститель', 'purificator'],
  renderer: 'device', kind: 'fan', icon: 'air', kindKey: 'cat.kind.purifier', anchor: 'fan', places: ['home', 'room'],
  roles: [
    { id: 'fan', labelKey: 'cat.r.fan', hintKey: 'cat.r.fan.hint', required: true, domains: ['fan'], source: 'own', as: 'primary' },
    { id: 'pm25', labelKey: 'cat.r.pm25', required: false, domains: ['sensor'], deviceClass: ['pm25'], units: ['µg/m³', 'μg/m³'], suffix: /_pm25$/, as: 'metric' },
    { id: 'filter', labelKey: 'cat.r.filter', required: false, domains: ['sensor'], units: ['%'], suffix: /_filter_life$/, source: 'own', as: 'metric' },
    { id: 'filterDays', labelKey: 'cat.r.filterDays', required: false, domains: ['sensor'], units: ['days', 'd'], suffix: /_filter_left_time$/, source: 'own', as: 'metric' },
    { id: 'temperature', labelKey: 'cat.r.temperature', required: false, domains: ['sensor'], deviceClass: ['temperature'], suffix: /_temperature$/, as: 'metric', exclude: NOT_AIR },
    { id: 'humidity', labelKey: 'cat.r.humidity', required: false, domains: ['sensor'], deviceClass: ['humidity'], suffix: /_humidity$/, as: 'metric' },
    { id: 'ionizer', labelKey: 'cat.r.ionizer', required: false, domains: ['switch'], suffix: /_(ionizer|anion)$/, source: 'own', as: 'parameter' },
    { id: 'favoriteLevel', labelKey: 'cat.r.favoriteLevel', required: false, domains: ['number'], suffix: /_favorite_level$/, source: 'own', as: 'parameter' },
    { id: 'brightness', labelKey: 'cat.r.brightness', required: false, domains: ['select'], suffix: /_led_brightness$/, source: 'own', as: 'parameter' },
    { id: 'childLock', labelKey: 'cat.r.childLock', required: false, domains: ['switch'], suffix: /_child_lock$/, source: 'own', as: 'parameter' },
    { id: 'buzzer', labelKey: 'cat.r.buzzer', required: false, domains: ['switch'], suffix: /_buzzer$/, source: 'own', as: 'parameter' },
  ],
};
const HEAT_SINGLE: Profile = {
  id: 'heating.single', version: '1.0.0', category: 'heating', brand: null, titleKey: 'cat.p.heatSingle', descKey: 'cat.p.heatSingle.desc', models: [], terms: ['thermostat', 'термостат', 'отопление', 'încălzire', 'heating'],
  renderer: 'thermostat', kind: 'climate', anchor: 'thermostat', places: ['home', 'room'],
  roles: [
    { id: 'thermostat', labelKey: 'cat.r.thermostat', hintKey: 'cat.r.thermostat.hint', required: true, domains: ['climate'], as: 'primary', exclude: /_trv$/ },
    { id: 'air', labelKey: 'cat.r.air', hintKey: 'cat.r.air.hint', required: false, domains: ['sensor'], deviceClass: ['temperature'], units: ['°C'], exclude: NOT_AIR, as: 'metric' },
  ],
};
const HEAT_ROOMS: Profile = {
  id: 'heating.rooms', version: '1.0.0', category: 'heating', brand: null, titleKey: 'cat.p.heatRooms', descKey: 'cat.p.heatRooms.desc', models: [], terms: ['thermostat', 'термостат', 'отопление', 'головк', 'trv', 'радиатор', 'încălzire', 'heating', 'rooms', 'комнат'],
  renderer: 'heatingRooms', kind: 'climate', anchor: 'central', places: ['home'],
  roles: [
    { id: 'central', labelKey: 'cat.r.central', hintKey: 'cat.r.central.hint', required: true, domains: ['climate'], as: 'primary', exclude: /_trv$/ },
    { id: 'mode', labelKey: 'cat.r.mode', hintKey: 'cat.r.mode.hint', required: false, domains: ['input_select', 'select'], suffix: /heating_mode$/ },
    { id: 'homeTemp', labelKey: 'cat.r.homeTemp', hintKey: 'cat.r.homeTemp.hint', required: false, domains: ['input_number', 'number'], suffix: /heating_home_temp$/ },
    { id: 'target', labelKey: 'cat.r.target', required: false, domains: ['sensor', 'input_number'], suffix: /heating_target_temp$/ },
    { id: 'system', labelKey: 'cat.r.system', required: false, domains: ['input_boolean', 'switch'], suffix: /heating_system$/ },
  ],
  roomRoles: [
    { id: 'trv', labelKey: 'cat.r.trv', hintKey: 'cat.r.trv.hint', required: true, domains: ['climate'] },
    { id: 'air', labelKey: 'cat.r.air', hintKey: 'cat.r.air.hint', required: false, domains: ['sensor'], deviceClass: ['temperature'], units: ['°C'], exclude: NOT_AIR },
    { id: 'timer', labelKey: 'cat.r.timer', hintKey: 'cat.r.timer.hint', required: false, domains: ['timer'], suffix: /_heating_override$/ },
    { id: 'overrideTemp', labelKey: 'cat.r.overrideTemp', required: false, domains: ['input_number'], suffix: /_heating_override_temp$/ },
    { id: 'manualTemp', labelKey: 'cat.r.manualTemp', hintKey: 'cat.r.manualTemp.hint', required: false, domains: ['input_number'], suffix: /_heating_manual_temp$/ },
  ],
};
// ---- the panel's own cards, by model (owner 21.11.2026: «добавь все готовые карточки»). Key fields only: the module finds the rest of the
// device's entities itself; a field the installer changes wins over what the module found (modules/catalog.ts activeSpecs). ----
const own = (id: string, labelKey: string, domains: string[], suffix: RegExp | undefined, required = false, extra: Partial<RoleSpec> = {}): RoleSpec => ({ id, labelKey, domains, suffix, required, source: 'own', ...extra });
const FEEDER_2: Profile = {
  id: 'xiaomi.feeder2', version: '1.0.0', category: 'pets', brand: 'Xiaomi', titleKey: 'cat.p.feeder2', descKey: 'cat.p.feeder2.desc', models: ['xiaomi.feeder.iv2001'],
  integration: { platform: 'xiaomi_miot', name: 'Xiaomi Miot' }, terms: ['feeder', 'pet food feeder 2', 'кормушка', 'hrănitor', 'iv2001'], renderer: 'module', module: 'pet_feeder', kind: 'switch', icon: 'paw', anchor: 'feed', places: [],
  roles: [own('feed', 'module.feeder.role.feed', ['button'], /_(dispense|pet_food_out)$/, true), own('stock', 'module.feeder.role.stock', ['sensor'], /_(food_level|pet_food_left_level)$/), own('plan', 'module.feeder.role.plan', ['switch'], /_schedule(_state)?$/), own('outStatus', 'module.feeder.role.outStatus', ['sensor'], /_(dispense_status|food_out_status)$/), own('desiccant', 'module.feeder.role.desiccant', ['sensor'], /_desiccant_(level|left_level)$/)],
};
const FOUNTAIN_2: Profile = {
  id: 'xiaomi.fountain2', version: '1.0.0', category: 'pets', brand: 'Xiaomi', titleKey: 'cat.p.fountain2', descKey: 'cat.p.fountain2.desc', models: ['xiaomi.pet_waterer.iv02'],
  integration: { platform: 'xiaomi_miot', name: 'Xiaomi Miot' }, terms: ['fountain', 'pet fountain 2', 'поилка', 'adăpătoare', 'iv02'], renderer: 'native', kind: 'switch', icon: 'water', anchor: 'pump', places: [],
  roles: [own('pump', 'cat.r.pump', ['switch'], /_pump$/, true), own('waterLow', 'cat.r.waterLow', ['binary_sensor'], /_water_low$/), own('filter', 'cat.r.filter', ['sensor'], /_filter_level$/), own('mode', 'cat.r.mode2', ['select'], /_mode$/)],
};
const KETTLE_2PRO: Profile = {
  id: 'xiaomi.kettle2pro', version: '1.0.0', category: 'kitchen', brand: 'Xiaomi', titleKey: 'cat.p.kettle2pro', descKey: 'cat.p.kettle2pro.desc', models: ['xiaomi.kettle.v20'],
  integration: { platform: 'xiaomi_miot', name: 'Xiaomi Miot' }, terms: ['kettle', 'smart kettle 2 pro', 'чайник', 'fierbător', 'v20'], renderer: 'module', module: 'kettle', kind: 'switch', icon: 'cup', anchor: 'heater', places: [],
  roles: [own('heater', 'module.kettle.role.heater', ['water_heater', 'switch'], /(^water_heater\..+|_power)$/, true), own('temp', 'module.kettle.role.temp', ['sensor'], /_temperature$/), own('power', 'module.kettle.role.power', ['switch'], /_power$/)],
};
const AIRFRYER_55: Profile = {
  id: 'xiaomi.airfryer55', version: '1.0.0', category: 'kitchen', brand: 'Xiaomi', titleKey: 'cat.p.airfryer55', descKey: 'cat.p.airfryer55.desc', models: ['xiaomi.fryer.maf07d'],
  integration: { platform: 'xiaomi_miot', name: 'Xiaomi Miot' }, terms: ['air fryer', 'airfryer', 'аэрогриль', 'friteuză', 'maf07d'], renderer: 'module', module: 'airfryer', kind: 'switch', icon: 'oven', anchor: 'status', places: [],
  roles: [own('status', 'module.airfryer.role.status', ['sensor'], /_status$/, true), own('temp', 'module.airfryer.role.temp', ['number'], /_target_temperature$/), own('time', 'module.airfryer.role.time', ['number'], /_target_time$/)],
};
const SAROS_Z70: Profile = {
  id: 'roborock.saros_z70', version: '1.0.0', category: 'cleaning', brand: 'Roborock', titleKey: 'cat.p.sarosZ70', descKey: 'cat.p.sarosZ70.desc', models: ['roborock.vacuum.a179'],
  integration: { platform: 'roborock', name: 'Roborock' }, terms: ['vacuum', 'saros', 'z70', 'робот', 'пылесос', 'aspirator', 'a179'], renderer: 'native', kind: 'vacuum', icon: 'vacuum', anchor: 'vacuum', places: [],
  roles: [own('vacuum', 'cat.r.vacuum', ['vacuum'], undefined, true), own('battery', 'cat.r.battery', ['sensor'], /_battery$/), own('map', 'cat.r.map', ['image'], /_map$/)],
};
const AQARA_G4: Profile = {
  id: 'aqara.g4', version: '1.0.0', category: 'cameras', brand: 'Aqara', titleKey: 'cat.p.aqaraG4', descKey: 'cat.p.aqaraG4.desc', models: ['SVD-C02'],
  integration: { platform: 'homekit_controller', name: 'HomeKit Device' }, terms: ['doorbell', 'g4', 'звонок', 'sonerie', 'svd-c02'], renderer: 'module', module: 'doorbell', kind: 'camera', icon: 'bell', anchor: 'camera', places: [],
  roles: [own('camera', 'module.camera.entity', ['camera'], undefined, true, { source: 'prefer' }), own('ring', 'module.doorbell.role.ring', ['event'], /_ring$/), own('motion', 'module.doorbell.role.motion', ['binary_sensor'], /_motion$/), own('battery', 'module.doorbell.role.battery', ['sensor'], /_battery$/)],
};
const IMOU_RANGER: Profile = {
  id: 'imou.ranger2c', version: '1.0.0', category: 'cameras', brand: 'Imou', titleKey: 'cat.p.imouRanger', descKey: 'cat.p.imouRanger.desc', models: ['IPC-K2EC-R1W'],
  integration: { platform: 'imou', name: 'Imou Life' }, terms: ['imou', 'ranger 2c', 'камера', 'cameră', 'k2ec', 'ipc-k2ec-3r1w'], renderer: 'module', module: 'camera_imou', kind: 'camera', icon: 'camera', anchor: 'camera', places: [],
  roles: [own('camera', 'module.imou.role.camera', ['camera'], /_sd$/, true, { source: 'prefer' }), own('privacy', 'module.imou.role.privacy', ['switch'], /_privacy$/)],
};
// the module plays the HD lens (`…_ptz_hd`) and keeps the ONVIF profile as its light stream: the card leaves the stream to the module
const SONOFF_C44: Profile = {
  id: 'sonoff.cam_c44he', version: '1.0.0', category: 'cameras', brand: 'SONOFF', titleKey: 'cat.p.camC44', descKey: 'cat.p.camC44.desc', models: ['CAM-C44HE'],
  integration: { platform: 'onvif', name: 'ONVIF' }, terms: ['onvif', 'cam-c44he', 'c44', 'камера', 'cameră'], renderer: 'module', module: 'camera_onvif', kind: 'camera', icon: 'camera', anchor: 'camera', places: [],
  roles: [own('camera', 'module.onvif.role.camera', ['camera'], undefined, true, { source: 'prefer' }), own('person', 'module.onvif.role.person', ['binary_sensor'], /_person_detection$/), own('motion', 'module.onvif.role.motion', ['binary_sensor'], /_motion_alarm$/)],
};
const XIAOMI_C700: Profile = {
  id: 'xiaomi.c700', version: '1.0.0', category: 'cameras', brand: 'Xiaomi', titleKey: 'cat.p.c700', descKey: 'cat.p.c700.desc', models: ['chuangmi.camera.081ae2'],
  integration: { platform: 'xiaomi_miot', name: 'Xiaomi Miot + go2rtc' }, terms: ['c700', 'xiaomi camera', 'go2rtc', 'камера', 'cameră'], renderer: 'module', module: 'camera_go2rtc', kind: 'camera', icon: 'camera', anchor: 'camera', places: [],
  roles: [own('camera', 'module.camera.entity', ['camera'], undefined, true, { source: 'prefer' }), own('power', 'module.camera.role.power', ['switch'], /_power$/), own('motion', 'module.camera.role.motion', ['switch'], /_motion_detection$/)],
};
const NITROMIX_P24: Profile = {
  id: 'demirdokum.nitromix_p24', version: '1.0.0', category: 'boiler', brand: 'Demir Döküm', titleKey: 'cat.p.nitromix', descKey: 'cat.p.nitromix.desc', models: [],
  integration: { platform: 'mqtt', name: 'eBUSd (MQTT)' }, terms: ['boiler', 'nitromix', 'p24', 'ebus', 'котёл', 'котел', 'centrală', 'demir'], renderer: 'module', module: 'boiler_ebus', kind: 'climate', icon: 'flame', anchor: 'flow', places: [],
  roles: [{ id: 'flow', labelKey: 'module.boiler.flow', required: true, domains: ['sensor'], units: ['°C'], suffix: /_flow_temp$/ }, { id: 'pressure', labelKey: 'module.boiler.pressure', required: true, domains: ['sensor'], units: ['bar'], suffix: /_pressure$/ },
    { id: 'return', labelKey: 'module.boiler.return', required: false, domains: ['sensor'], units: ['°C'], suffix: /_return_temp$/ }, { id: 'flame', labelKey: 'module.boiler.flame', required: false, domains: ['sensor', 'binary_sensor'], suffix: /_flame$/ },
    { id: 'hwc', labelKey: 'module.boiler.hwc', required: false, domains: ['sensor'], units: ['°C'], suffix: /_dhw_temp$/ }],
};
const HOUSE_AIR: Profile = {
  id: 'house.air', version: '1.0.0', category: 'house', brand: null, titleKey: 'cat.p.air', descKey: 'cat.p.air.desc', models: [], terms: ['air', 'воздух', 'aer', 'co2', 'pm2.5'], renderer: 'module', module: 'air', kind: 'environment', icon: 'air', anchor: 'sensor', places: [],
  roles: [{ id: 'sensor', labelKey: 'module.air.role.sensor', required: true, domains: ['sensor'], deviceClass: ['carbon_dioxide', 'pm25'] }],
};
const HOUSE_CLOCK: Profile = {
  id: 'house.clock', version: '1.0.0', category: 'house', brand: null, titleKey: 'cat.p.clock', descKey: 'cat.p.clock.desc', models: [], terms: ['clock', 'часы', 'ceas', 'таймер', 'будильник', 'timer'], renderer: 'module', module: 'clock', kind: 'environment', icon: 'clock', anchor: 'sun', places: [],
  roles: [{ id: 'sun', labelKey: 'module.clock.role.sun', required: true, domains: ['sun'] }, { id: 'weather', labelKey: 'module.clock.role.weather', required: false, domains: ['weather'] }, { id: 'timer1', labelKey: 'module.clock.role.timer1', required: false, domains: ['timer'] }],
};
export const PROFILES: Profile[] = [PURIFIER_4, HEAT_SINGLE, HEAT_ROOMS, NITROMIX_P24, FEEDER_2, FOUNTAIN_2, KETTLE_2PRO, AIRFRYER_55, SAROS_Z70, AQARA_G4, IMOU_RANGER, SONOFF_C44, XIAOMI_C700, HOUSE_AIR, HOUSE_CLOCK, ...APPLIANCE_PROFILES];
/** What the profile's module finds by itself in this house (its own `detect`): the catalog and the panel never disagree on «found». */
export function moduleMatch(reg: Registry, p: Profile) { const spec = p.module ? MODULE_SPECS.find(m => m.id === p.module) : undefined; try { return spec?.detect(reg) ?? null; } catch { return null; } }
/** Is this entity part of the chosen appliance (its own HA device), or may it be (one appliance of this model in the house: a camera's stream on its sibling device)? */
/** The device a module found and works with: a module drives one appliance of its kind (the first it finds), so its card may only be
 * for that one — a card for a second kettle of the same model would bind a few fields to it while stop, temperature and the rest stay on the first. */
export function moduleDevice(reg: Registry, p: Profile): string | null {
  if (!p.module || !p.models.length) return null; const m = moduleMatch(reg, p); if (!m) return null;
  const ids = new Set(devicesFor(reg, p).map(d => d.id));
  for (const e of Object.values(m.entities)) { const d = e ? reg.entities.find(x => x.entity_id === e)?.device_id : undefined; if (d && ids.has(d)) return d; }
  return null;
}
export function ofDevice(reg: Registry, p: Profile, entityId: string, deviceId: string | undefined): boolean {
  if (!p.models.length || !deviceId) return true;
  if (reg.entities.find(e => e.entity_id === entityId)?.device_id === deviceId) return true;
  return devicesFor(reg, p).length <= 1;
}
export const profileById = (id: string, list: Profile[] = PROFILES) => list.find(p => p.id === id) ?? null;

// ---- the instance a house keeps ----
export interface InstanceRoom { id: string; areaId: string; bindings: Record<string, string> }
export interface ProfileInstance {
  profileId: string; profileVersion: string; /** the HA device it was made for (an appliance); a scheme has none */ deviceId?: string;
  bindings: Record<string, string>; name?: string; roomId?: string; placement: Place[];
  /** a scheme's rooms («Центральный термостат и комнаты») */ rooms?: InstanceRoom[];
  /** the auto-made card it replaces (`e:fan.living_air_purifier`): its name, photo and «favourite» were carried over once */ legacyKey?: string;
}
const ENTITY = /^[a-z_]+\.[a-z0-9_]+$/, ID = /^(?!__proto__$|constructor$|prototype$)[A-Za-z0-9_-]{1,40}$/, ROLE = /^\w{1,32}$/;
const plain = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const binds = (v: unknown) => plain(v) ? Object.fromEntries(Object.entries(v).filter(([k, e]) => ROLE.test(k) && typeof e === 'string' && ENTITY.test(e))) as Record<string, string> : {};
/** Same rules as the integration's: a malformed instance is dropped, one of a profile this panel does not know yet is KEPT as it is (a newer
 * panel made it; this one draws nothing for it and never writes it away). */
export function normaliseInstances(raw: unknown, warn: (w: string) => void = () => undefined): Record<string, ProfileInstance> {
  const out: Record<string, ProfileInstance> = {};
  if (!plain(raw)) return out;
  for (const [id, v] of Object.entries(raw).slice(0, 200)) {
    if (!ID.test(id) || !plain(v) || typeof v.profileId !== 'string' || !/^[\w.-]{1,64}$/.test(v.profileId)) { warn(`config: dropped card ${id.slice(0, 40)}`); continue; }
    const placement = Array.isArray(v.placement) ? [...new Set(v.placement.filter((p): p is Place => p === 'home' || p === 'room'))] : [];
    const rooms = Array.isArray(v.rooms) ? v.rooms.slice(0, 40).filter(plain).filter(r => typeof r.id === 'string' && ID.test(r.id) && typeof r.areaId === 'string' && r.areaId.length <= 128).map(r => ({ id: r.id as string, areaId: r.areaId as string, bindings: binds(r.bindings) })) : undefined;
    const str = (x: unknown, max: number) => typeof x === 'string' && x.trim() ? x.trim().slice(0, max) : undefined;
    // fields a newer panel added are carried as they are (spread first); the known ones are checked
    const extra: Record<string, unknown> = { ...v }; for (const k of ['profileId', 'profileVersion', 'bindings', 'placement', 'deviceId', 'name', 'roomId', 'legacyKey', 'rooms']) delete extra[k];
    const inst: ProfileInstance = { ...extra, profileId: v.profileId, profileVersion: typeof v.profileVersion === 'string' && /^\d+\.\d+\.\d+$/.test(v.profileVersion) ? v.profileVersion : '1.0.0', bindings: binds(v.bindings), placement };
    const deviceId = str(v.deviceId, 64), name = str(v.name, 80), roomId = str(v.roomId, 128), legacyKey = str(v.legacyKey, 200);
    if (deviceId && /^[\w-]+$/.test(deviceId)) inst.deviceId = deviceId;
    if (name) inst.name = name; if (roomId) inst.roomId = roomId; if (legacyKey) inst.legacyKey = legacyKey; if (rooms) inst.rooms = rooms;
    out[id] = inst;
  }
  return out;
}
/** A new instance id: stable from then on, never derived from a name, a room or an entity (a rename or a repair keeps it). */
export const newInstanceId = (taken: Record<string, unknown>, rnd: () => number = Math.random): string => { for (;;) { const id = `c${Date.now().toString(36)}${Math.floor(rnd() * 1e6).toString(36)}`; if (!taken[id]) return id; } };
export const INSTANCE_PREFIX = 'p:';
export const instanceKey = (id: string) => `${INSTANCE_PREFIX}${id}`;

// ---- finding: the catalog search, the devices of a profile, the candidates of a field ----
const lower = (s: string) => s.toLowerCase().replace(/ё/g, 'е');
/** The search box and the category/brand filter lead to the same profiles: a model code, a brand, a word of the title. */
export function searchProfiles(query: string, title: (p: Profile) => string, opts: { category?: Category | null; brand?: string | null } = {}, list: Profile[] = PROFILES): Profile[] {
  const q = lower(query.trim());
  return list.filter(p => (!opts.category || p.category === opts.category) && (!opts.brand || p.brand === opts.brand) && (!q || q.split(/\s+/).every(w => [title(p), p.brand ?? '', ...p.models, ...p.terms].some(s => lower(s).includes(w)))));
}
export const brandsOf = (category: Category | null, list: Profile[] = PROFILES): string[] => [...new Set(list.filter(p => !category || p.category === category).map(p => p.brand).filter((b): b is string => !!b))].sort();
const live = (reg: Registry, e: EntityRow) => !e.disabled_by && !!reg.states[e.entity_id];
const areaOf = (reg: Registry, e: EntityRow | undefined) => e ? e.area_id ?? reg.devices.find(d => d.id === e.device_id)?.area_id ?? null : null;
/** The HA devices of this house a profile fits: the model code for an appliance; any climate for a scheme (it is the installer's to say which). */
export function devicesFor(reg: Registry, p: Profile): Array<{ id: string; name: string; areaId: string | null; model: string | null }> {
  if (!p.models.length) return [];
  const anchor = p.roles.find(r => r.id === p.anchor);
  const anyEntity = selfDrawn(p); // a camera's stream may live on its sibling device (ONVIF, generic): the model is enough
  const hasAnchor = (d: { id: string }) => !anchor || reg.entities.some(e => e.device_id === d.id && live(reg, e) && anchor.domains.includes(domainOf(e.entity_id)));
  // the model code is `model`, or `model_id` where an integration leaves `model` empty (Samsung TV: null and QE50Q60TAUXUA)
  const fits = (d: DeviceRow) => [d.model, d.model_id].some(m => !!m && p.models.includes(m));
  let list = reg.devices.filter(d => !d.disabled_by && fits(d) && reg.entities.some(e => e.device_id === d.id && live(reg, e)) && (anyEntity || hasAnchor(d)));
  // one camera seen through two integrations (Sonoff's own and ONVIF) is one appliance: the device that carries the card's main entity, when one does
  if (anyEntity && list.length > 1 && list.some(hasAnchor)) list = list.filter(hasAnchor);
  // one TV seen through two integrations (Samsung TV and SmartThings, same model code): the device of the profile's own integration, when one is it
  const viaOwn = (d: { id: string }) => !!p.integration && reg.entities.some(e => e.device_id === d.id && live(reg, e) && e.platform === p.integration!.platform && (!anchor || anchor.domains.includes(domainOf(e.entity_id))));
  if (p.renderer === 'appliance' && list.length > 1 && list.some(viaOwn)) list = list.filter(viaOwn);
  return list
    .map(d => ({ id: d.id, name: (d as { name_by_user?: string | null }).name_by_user ?? d.name ?? d.model ?? d.id, areaId: d.area_id, model: d.model ?? d.model_id ?? null }));
}
/** Is the profile «found in this house»: an appliance whose model is here, a scheme whose main field has something to bind. */
export const foundHere = (reg: Registry, p: Profile): boolean => {
  // a model's card is found only where that model is: another kettle or another ONVIF camera does not make this one «found»
  if (p.models.length) return devicesFor(reg, p).length > 0;
  if (p.module) { if (moduleMatch(reg, p)) return true; const b = suggestBindings(reg, p); return p.roles.filter(r => r.required).every(r => b[r.id]); }
  return candidates(reg, p.roles.find(r => r.id === p.anchor)!, {}).length > 0;
};
export interface Candidate { id: string; name: string; areaId: string | null; value: string; unit: string | null; own: boolean; exact: boolean; score: number }
const friendly = (reg: Registry, e: EntityRow) => { const n = reg.states[e.entity_id]?.attributes.friendly_name; return typeof n === 'string' && n.trim() ? n.trim() : e.name ?? e.original_name ?? e.entity_id; };
const dcOf = (e: EntityRow, s: StateRow | undefined) => e.device_class ?? (s?.attributes.device_class as string | undefined) ?? null;
const unitOf = (e: EntityRow, s: StateRow | undefined) => e.unit ?? (s?.attributes.unit_of_measurement as string | undefined) ?? null;
/** What may fill one field, best first: by the chosen device, the domain, the class or unit and the model's own suffix. An entity that
 * belongs to the boiler or is a target/set point is never a room's air temperature. `in` = the room the card is for (a closer sensor first). */
export function candidates(reg: Registry, role: RoleSpec, ctx: { deviceId?: string; areaId?: string | null }): Candidate[] {
  const out: Candidate[] = [];
  const boilerDevices = new Set(reg.devices.filter(d => /boiler|котл|котёл|ebus|nitromix|demir/i.test(`${d.name ?? ''} ${d.model ?? ''}`)).map(d => d.id));
  for (const e of reg.entities) {
    if (!live(reg, e) || !role.domains.includes(domainOf(e.entity_id))) continue;
    const own = !!ctx.deviceId && e.device_id === ctx.deviceId;
    if (role.source === 'own' && ctx.deviceId && !own) continue;
    if (role.sibling && ctx.deviceId && !own) { const chosen = reg.devices.find(d => d.id === ctx.deviceId)?.area_id ?? null; if (!chosen || areaOf(reg, e) !== chosen) continue; }
    const s = reg.states[e.entity_id], full = friendly(reg, e), dc = dcOf(e, s), unit = unitOf(e, s);
    // «Гостиная · Очиститель воздуха (Xiaomi Air Purifier 4) PM2.5» is «PM2.5» in its own device's list: the device is said once, above
    const devName = e.device_id ? reg.devices.find(d => d.id === e.device_id)?.name ?? '' : '', rest = devName && full.startsWith(devName) ? full.slice(devName.length).trim() : '';
    const name = rest || full;
    if (role.deviceClass && !(dc && role.deviceClass.includes(dc)) && !(role.units && unit && role.units.includes(unit) && !dc)) continue;
    if (!role.deviceClass && role.units && !(unit && role.units.includes(unit))) continue;
    // a sensor of the boiler's own device is no air temperature; the boiler's thermostat («Термостат котла») is still a thermostat
    if (role.exclude && (role.exclude.test(e.entity_id) || role.exclude.test(full) || (role.exclude === NOT_AIR && e.device_id && boilerDevices.has(e.device_id)))) continue;
    if (e.entity_category === 'diagnostic' && role.as !== 'parameter') continue;
    const exact = !!role.suffix && role.suffix.test(e.entity_id), area = areaOf(reg, e);
    const score = (own ? 50 : 0) + (exact ? 30 : 0) + (ctx.areaId && area === ctx.areaId ? 10 : 0) - (e.hidden_by ? 5 : 0);
    out.push({ id: e.entity_id, name, areaId: area, value: s?.state ?? 'unavailable', unit, own, exact, score });
  }
  return out.sort((a, b) => b.score - a.score || a.name.localeCompare(b.name, 'ru'));
}
/** The field's suggestion: only when it is unambiguous — the chosen device's own entity with the model's suffix, or the single candidate of the
 * device. Two equal ones are the installer's choice (the form shows the list with nothing picked). A field that names its suffix is never
 * filled with an entity that has not got it (the scale's only sensor is its weight, not its «Импеданс»). */
export function suggestion(list: Candidate[], role: RoleSpec): string | undefined {
  const own = list.filter(c => c.own);
  const exact = own.filter(c => c.exact);
  if (exact.length === 1) return exact[0].id;
  if (exact.length > 1) return undefined;
  if (role.source === 'own' && !role.suffix && own.length === 1) return own[0].id;
  return undefined;
}
const oid = (entityId: string) => entityId.slice(entityId.indexOf('.') + 1);
/** What the appliance's entities are all called by (`bath_washer` of `sensor.bath_washer_current_status`, `switch.bath_washer_power`…): the longest
 * beginning they share that ends at a `_`; '' when they share none. */
export function stemOf(objectIds: string[]): string {
  if (!objectIds.length) return '';
  let pre = `${objectIds[0]}_`;
  for (const x of objectIds) { const y = `${x}_`; let i = 0; while (i < pre.length && i < y.length && pre[i] === y[i]) i++; pre = pre.slice(0, i); }
  return pre.slice(0, Math.max(0, pre.lastIndexOf('_')));
}
/** The first bindings of a new card on a chosen device: every unambiguous field; nothing else. The main field is settled first, then the
 * required ones, then the rest in their order — and one entity is one field's: what a field took is never suggested for another. */
export function suggestBindings(reg: Registry, p: Profile, deviceId?: string): Record<string, string> {
  const dev = deviceId ? reg.devices.find(d => d.id === deviceId) : undefined, out: Record<string, string> = {}, taken = new Set<string>();
  const put = (r: RoleSpec, id: string | undefined) => { if (id && !out[r.id] && !taken.has(id)) { out[r.id] = id; taken.add(id); } };
  const devOf = (id: string) => reg.entities.find(e => e.entity_id === id)?.device_id ?? null;
  const one = (l: Candidate[]) => l.length === 1 ? l[0].id : undefined;
  const rank = (r: RoleSpec) => r.id === p.anchor ? 0 : r.required ? 1 : 2;
  // a card with no device to choose: a module of the whole house (the boiler on eBUS), an appliance with no model (the dashcam, the gas meter)
  const deviceless = !deviceId && (p.renderer === 'module' || (p.renderer === 'appliance' && !p.models.length));
  // the same appliance through a second integration: another device of its room with the same make and model (the dryer in SmartThings)
  const twins = new Set(dev?.area_id && dev.manufacturer && dev.model ? reg.devices.filter(d => d.id !== dev.id && d.area_id === dev.area_id && d.manufacturer === dev.manufacturer && d.model === dev.model).map(d => d.id) : []);
  const stem = dev ? stemOf(reg.entities.filter(e => e.device_id === dev.id && live(reg, e)).map(e => oid(e.entity_id))) : '';
  for (const r of p.roles.map((r, i) => ({ r, i })).sort((a, b) => rank(a.r) - rank(b.r) || a.i - b.i).map(x => x.r)) {
    const list = candidates(reg, r, { deviceId, areaId: dev?.area_id ?? null });
    let s = suggestion(list, r);
    const main = out[p.anchor ?? ''], named = (c: Candidate, by: string) => oid(c.id).startsWith(`${by}_`);
    // the one entity with the field's own suffix is it; two or more are the installer's choice; a field with no suffix is never guessed.
    // Where the house has several (every socket and drive has a «firmware», every NAS reading a «…_raw»), the one that is the main field's own:
    // of its HA device, or named after it (`sensor.kitchen_gas_meter` → `input_text.kitchen_gas_meter_raw`)
    if (!s && deviceless) { const exact = list.filter(c => c.exact), md = main ? devOf(main) : null;
      s = one(exact) ?? (p.renderer === 'appliance' && main ? one(exact.filter(c => named(c, oid(main)) || (!!md && devOf(c.id) === md))) : undefined); }
    // what is another device's must agree with the field's own suffix, where it has one
    const others = deviceId ? list.filter(c => !c.own && (!r.suffix || c.exact)) : [];
    // a second integration's copy: named after the card's main entity (`media_player.kids_tv` → `media_player.kids_tv_airplay`), or the twin device's
    if (!s && r.sibling) s = one(others.filter(c => (!!main && named(c, oid(main))) || twins.has(devOf(c.id) ?? '')));
    // the appliance's socket: named after the appliance (`…_washer_socket_power`); a socket called otherwise is the installer's choice.
    // The socket's own settings (`…_plug_led`, `…_plug_auto_off`) are not the socket
    if (!s && r.plug) s = one(others.filter(c => /plug|socket/.test(oid(c.id)) && [stem, main ? oid(main) : ''].some(by => !!by && named(c, by)) && !reg.entities.find(e => e.entity_id === c.id)?.entity_category));
    put(r, s);
  }
  // what the module finds by itself fills the fields still open — only with entities of the chosen appliance (two feeders never mix)
  const m = moduleMatch(reg, p);
  if (m) for (const r of p.roles) { const e = m.entities[r.id]; if (e && reg.states[e] && r.domains.includes(domainOf(e)) && ofDevice(reg, p, e, deviceId)) put(r, e); }
  return out;
}
/** The room bindings a scheme suggests for one area: the area's own head and its air sensor; the timer and the temperatures by the head's name. */
export function suggestRoom(reg: Registry, p: Profile, areaId: string): Record<string, string> {
  const out: Record<string, string> = {}, roles = p.roomRoles ?? [];
  const heads = candidates(reg, roles.find(r => r.id === 'trv')!, { areaId }).filter(c => c.areaId === areaId && /_trv$|trv|головк|radiator/i.test(`${c.id} ${c.name}`));
  if (heads.length !== 1) return out;
  out.trv = heads[0].id; const key = heads[0].id.slice('climate.'.length).replace(/_trv$/, '');
  const air = candidates(reg, roles.find(r => r.id === 'air')!, { areaId }).filter(c => c.areaId === areaId);
  const preferred = air.filter(c => /_climate_temperature$|_co2_temperature$/.test(c.id));
  if (preferred.length === 1) out.air = preferred[0].id; else if (air.length === 1) out.air = air[0].id;
  for (const [role, id] of [['timer', `timer.${key}_heating_override`], ['overrideTemp', `input_number.${key}_heating_override_temp`], ['manualTemp', `input_number.${key}_heating_manual_temp`]] as const) if (reg.states[id]) out[role] = id;
  return out;
}

// ---- what the house shows: an instance as a card ----
export interface InstanceView { id: string; instance: ProfileInstance; profile: Profile; device: HomeDevice;
  /** bound fields whose entity is gone or silent: the card says so and offers a replacement, it never takes another sensor in their place */ lost: string[];
  /** the required fields that have no binding: the card is not drawn for the residents */ incomplete: string[] }
const kindOf = (reg: Registry, id: string): Kind | null => { const e = reg.entities.find(x => x.entity_id === id); return e ? entityKind(e, reg.states[id]) : null; };
const refOf = (reg: Registry, id: string): EntityRef | null => { const e = reg.entities.find(x => x.entity_id === id); if (!e) return null; return entityRefOf(e, reg.states[id], kindOf(reg, id)); };
/** The card a profile instance draws, as a household device of the panel: its main control, then the readings and the settings that were
 * bound — and only those. A field left empty is a function the card does not have. */
export function instanceView(reg: Registry, id: string, inst: ProfileInstance, roomName: (areaId: string) => string | null = () => null, list: Profile[] = PROFILES, label?: (key: string) => string): InstanceView | null {
  const profile = profileById(inst.profileId, list); if (!profile) return null;
  const lost: string[] = [], incomplete: string[] = [];
  // an appliance that is only out of reach (a TV unplugged, a station offline) says «Нет связи» in its own card: its fields are not «lost»,
  // only those gone from HA or switched off there are
  const appliance = profile.renderer === 'appliance';
  const isLost = (eid: string) => { const s = reg.states[eid]; return (!appliance && (!s || s.state === 'unavailable')) || !reg.entities.some(e => e.entity_id === eid && !e.disabled_by); };
  for (const r of profile.roles) { const b = inst.bindings[r.id]; if (!b) { if (r.required) incomplete.push(r.id); continue; } if (isLost(b)) lost.push(r.id); }
  for (const room of inst.rooms ?? []) for (const r of profile.roomRoles ?? []) { const b = room.bindings[r.id]; if (!b) { if (r.required) incomplete.push(`${room.id}.${r.id}`); continue; } if (isLost(b)) lost.push(`${room.id}.${r.id}`); }
  const anchorId = inst.bindings[profile.anchor ?? ''];
  const primary = anchorId ? refOf(reg, anchorId) : null;
  const ghost: EntityRef = { id: anchorId ?? `${profile.kind}.none`, domain: anchorId ? domainOf(anchorId) : profile.kind, deviceClass: null, name: '', kind: profile.kind, state: 'unavailable', attributes: {}, unit: null, available: false, lastChanged: '' };
  const p = primary ?? ghost;
  // a reading is called by its field («Ресурс фильтра»), not by the integration's name («Filter Filter Life Level»)
  const pick = (as: RoleSpec['as']) => profile.roles.filter(r => r.as === as && inst.bindings[r.id]).map(r => { const x = refOf(reg, inst.bindings[r.id]); return x && label ? { ...x, name: label(r.labelKey) } : x; }).filter((x): x is EntityRef => !!x);
  const dev = inst.deviceId ? reg.devices.find(d => d.id === inst.deviceId) : (anchorId ? reg.devices.find(d => d.id === reg.entities.find(e => e.entity_id === anchorId)?.device_id) : undefined);
  const roomId = cardRoom(reg, inst, profile) ?? NO_ROOM;
  // an appliance is called by its own HA device («Ванная · Сушильная машина (Samsung DV8400D)» → «Сушильная машина»), never by its anchor entity
  // («Сушилка · Работает»): the room stands beside it, the model is the sheet's
  const devName = profile.renderer === 'appliance' && dev ? stripRoom(((dev as { name_by_user?: string | null }).name_by_user ?? dev.name ?? '').replace(/\s*\([^)]*\)/g, '').trim(), roomName(roomId)) || null : null;
  const name = inst.name ?? (profile.nameKey && label ? label(profile.nameKey) : null) ?? devName ?? (typeof p.attributes.friendly_name === 'string' ? stripRoom(p.attributes.friendly_name, roomName(roomId)) : null) ?? dev?.name ?? id;
  const device: HomeDevice = {
    key: instanceKey(id), kind: profile.kind, name, roomId, icon: profile.icon ?? null, photo: null, art: null, favorite: inst.placement.includes('home'), order: 0, enabled: true,
    available: !!primary && primary.available, primary: { ...p, name }, controls: primary ? [{ ...p, name }] : [], metrics: pick('metric'), parameters: pick('parameter'), diagnostics: [],
    manufacturer: dev?.manufacturer ?? null, model: dev?.model ?? null, haDeviceId: dev?.id ?? null, section: profile.kind === 'climate' ? 'climate' : 'systems',
  };
  return { id, instance: inst, profile, device, lost, incomplete };
}
/** The room a card is in: the one the installer gave it, else its device's, else its main field's own. */
export function cardRoom(reg: Registry, inst: Pick<ProfileInstance, 'roomId' | 'deviceId' | 'bindings'>, profile: Pick<Profile, 'anchor'>): string | null {
  const main = inst.bindings[profile.anchor ?? ''], ent = main ? reg.entities.find(e => e.entity_id === main) : undefined;
  const dev = inst.deviceId ? reg.devices.find(d => d.id === inst.deviceId) : ent ? reg.devices.find(d => d.id === ent.device_id) : undefined;
  return inst.roomId ?? dev?.area_id ?? areaOf(reg, ent) ?? null;
}
/** Where a new card goes while the installer has not said: in its room, when it has one and the card may stand in a room (opened from Home,
 * every card went «На главной» and none was in its room — 21.11.2026); else the card's first place. */
export const defaultPlacement = (p: Pick<Profile, 'places'>, roomId: string | null | undefined): Place[] => roomId && roomId !== NO_ROOM && p.places.includes('room') ? ['room'] : p.places.slice(0, 1);
/** «Гостиная · Очиститель воздуха» on the Living room's card is «Очиститель воздуха»: the room stands beside it. */
const stripRoom = (n: string, room: string | null) => { const parts = n.split(' · '); return parts.length > 1 && (!room || parts[0].trim() === room) ? parts.slice(1).join(' · ').trim() : n; };
/** Every instance of the house this panel can draw, with the problems of each. Unknown profiles (a newer panel's) are skipped, not lost. */
export function instanceViews(reg: Registry, all: Record<string, ProfileInstance>, roomName?: (areaId: string) => string | null, list: Profile[] = PROFILES, label?: (key: string) => string): InstanceView[] {
  return Object.entries(all).map(([id, inst]) => instanceView(reg, id, inst, roomName, list, label)).filter((v): v is InstanceView => !!v);
}
/** The HA device a card stands for: the chosen one; for an appliance card with no model (a gas meter read by a camera) the device of its main field. */
export function cardDevice(reg: Registry, inst: ProfileInstance, profile: Profile | null = profileById(inst.profileId)): string | null {
  if (inst.deviceId) return inst.deviceId;
  const main = profile?.renderer === 'appliance' ? inst.bindings[profile.anchor ?? ''] : undefined;
  return main ? reg.entities.find(e => e.entity_id === main)?.device_id ?? null : null;
}
/** The entities an instance takes from the auto-made cards, so that a profile that already represents an appliance never stands beside its old
 * tile: every entity of its own HA device and its bound ones of that device. An external sensor bound on purpose stays where it was. */
export function instanceClaims(reg: Registry, all: Record<string, ProfileInstance>, list: Profile[] = PROFILES): Set<string> {
  const out = new Set<string>();
  for (const inst of Object.values(all)) {
    const profile = profileById(inst.profileId, list); if (!profile) continue;
    if (selfDrawn(profile)) continue; // it draws itself: the module claims its own entities
    if (inst.deviceId) for (const e of reg.entities) if (e.device_id === inst.deviceId) out.add(e.entity_id);
    if (profile.renderer === 'appliance') {
      // every field it draws, and every entity of the same appliance seen through a second integration
      // an external sensor or plug bound on purpose (the bedroom's humidity, the station's plug, a POW meter) keeps its own tile and its place in «Энергия»
      // its own device: the chosen one, or for a card with no model (a gas meter read by a camera) the device of its main field
      const ownDev = cardDevice(reg, inst, profile);
      if (!inst.deviceId && ownDev) for (const e of reg.entities) if (e.device_id === ownDev) out.add(e.entity_id);
      for (const r of profile.roles) { const b = inst.bindings[r.id]; if (!b) continue; const dev = reg.entities.find(e => e.entity_id === b)?.device_id ?? null;
        if (r.sibling && dev) { for (const e of reg.entities) if (e.device_id === dev) out.add(e.entity_id); } else if (r.claim || !dev || dev === ownDev) out.add(b); }
    } else if (profile.renderer !== 'device') { const a = inst.bindings[profile.anchor ?? '']; if (a) out.add(a); for (const r of inst.rooms ?? []) if (r.bindings.trv) out.add(r.bindings.trv); }
  }
  return out;
}
/** The HA devices that are the same appliance as the card's own, seen through a second integration (its `sibling` fields). */
export function siblingDevices(reg: Registry, inst: ProfileInstance, list: Profile[] = PROFILES): Set<string> {
  const out = new Set<string>(), profile = profileById(inst.profileId, list); if (!profile) return out;
  for (const r of profile.roles) { const b = r.sibling ? inst.bindings[r.id] : undefined; const d = b ? reg.entities.find(e => e.entity_id === b)?.device_id : null; if (d && d !== inst.deviceId) out.add(d); }
  return out;
}
/** A card the installer put «В комнате» is drawn on that room's page: complete, and not the heating scheme (it has its own block there). */
export const shownInRoom = (v: InstanceView, roomId: string) => v.instance.placement.includes('room') && !v.incomplete.length && v.profile.renderer !== 'heatingRooms' && v.device.roomId === roomId;
/** The catalog's cards on one room's page. `things` are the devices the room draws (their HA device id as the key, their entities).
 *  - `own`: the device's tile is its card's — the card itself where it is shown in this room, `false` where the card stands for the device
 *    elsewhere (on Home only, in another room) or the device is the card's second integration: no tile of its own then;
 *  - `extra`: the cards of this room that no device of the room draws (a NAS whose device is none of the room's «things», a card moved here
 *    from another room, a card with no device at all).
 * Every card shown in this room is in exactly one of the two, once. */
export function roomCards(reg: Registry, cards: InstanceView[], roomId: string, things: Array<{ key: string; ids?: string[] }>, list: Profile[] = PROFILES): { own: Map<string, InstanceView | false>; extra: InstanceView[] } {
  const own = new Map<string, InstanceView | false>(), drawn = new Set<string>();
  const devOf = new Map(reg.entities.map(e => [e.entity_id, e.device_id ?? null]));
  const of = cards.map(v => ({ v, dev: cardDevice(reg, v.instance, v.profile), twins: siblingDevices(reg, v.instance, list) }));
  for (const th of things) {
    // two HA devices of one name are one tile (model/room.ts): it is the card's when either of them is
    const devs = new Set<string>([th.key, ...(th.ids ?? []).map(id => devOf.get(id)).filter((d): d is string => !!d)]);
    const mine = of.filter(c => c.dev && devs.has(c.dev));
    const card = mine.find(c => shownInRoom(c.v, roomId) && !drawn.has(c.v.id));
    if (card) { own.set(th.key, card.v); drawn.add(card.v.id); }
    else if (mine.length || of.some(c => [...c.twins].some(d => devs.has(d)))) own.set(th.key, false);
  }
  return { own, extra: cards.filter(v => shownInRoom(v, roomId) && !drawn.has(v.id)) };
}
/** The value a candidate shows in the form: its state with its unit, words for on/off. */
export const candidateValue = (c: Pick<Candidate, 'value' | 'unit'>) => unavailable(c.value) ? '' : `${c.value}${c.unit ? ` ${c.unit}` : ''}`;

// ---- a module card in the module's settings: what it changed, and putting exactly that back ----
/** What a module card changed in its module's settings, to put back on removal: the value each key had before (null: none) and whether it was switched off. */
export interface ModuleUndo { entities: Record<string, string | null>; options: Record<string, string | null>; /** the entities the card itself wrote (an edit that keeps a value the house set by hand does not make it the card's) */ wrote?: Record<string, string>; /** the settings as the card left them */ set?: Record<string, string>; enabled?: false; /** the module had no settings at all before the card */ fresh?: true }
const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const strMap = <T,>(v: unknown, ok: (x: unknown) => x is T): Record<string, T> => isObj(v) ? Object.fromEntries(Object.entries(v).filter((x): x is [string, T] => ok(x[1]))) : {};
const isStr = (x: unknown): x is string => typeof x === 'string', isStrOrNull = (x: unknown): x is string | null => x === null || typeof x === 'string';
/** A stored record read back as it should be: a hand-edited or broken one never makes a removal fail. */
function sane(u: unknown): ModuleUndo | undefined {
  if (!isObj(u)) return undefined;
  return { entities: strMap(u.entities, isStrOrNull), options: strMap(u.options, isStrOrNull), ...(u.wrote !== undefined ? { wrote: strMap(u.wrote, isStr) } : {}), set: strMap(u.set, isStr), ...(u.enabled === false ? { enabled: false as const } : {}), ...(u.fresh === true ? { fresh: true as const } : {}) };
}
type Found = { entities: Record<string, string | undefined>; options?: Record<string, string | undefined> } | null;
/** Tell the module the card's entities and settings: only what differs from what the module uses now (its settings over its own finding),
 * remembering the value each key had before — kept from the first save of the card, so a later edit never forgets what the house had. */
export function tellModule(c: HouseConfig, moduleId: string, roles: string[], bindings: Record<string, string>, optionKeys: string[], opts: Record<string, string>, found: Found, prev?: ModuleUndo): ModuleUndo {
  const p = sane(prev), was = c.modules[moduleId] ?? {}, undo: ModuleUndo = { entities: { ...(p?.entities ?? {}) }, options: { ...(p?.options ?? {}) }, wrote: { ...(p?.wrote ?? {}) }, set: { ...(p?.set ?? {}) }, ...(p?.enabled === false ? { enabled: false as const } : {}), ...(p ? (p.fresh ? { fresh: true as const } : {}) : !c.modules[moduleId] ? { fresh: true as const } : {}) };
  const ents: Record<string, string> = { ...(was.entities ?? {}) }, o: Record<string, string> = { ...((was.options ?? {}) as Record<string, string>) };
  for (const k of roles) {
    const v = bindings[k], now = ents[k] ?? found?.entities[k];
    if (v && v !== now) { if (!(k in undo.entities)) undo.entities[k] = ents[k] ?? null; ents[k] = v; undo.wrote![k] = v; }
    // a field cleared in an edit: the card's own value goes, what the house had before comes back
    else if (!v && k in undo.entities) { if (ents[k] === undo.wrote?.[k]) { const b = undo.entities[k]; if (b === null) delete ents[k]; else ents[k] = b; } delete undo.entities[k]; delete undo.wrote![k]; }
  }
  for (const k of optionKeys) { const v = opts[k]?.trim(), now = o[k] ?? found?.options?.[k]; if (v && v !== now) { if (!(k in undo.options)) undo.options[k] = o[k] ?? null; o[k] = v; undo.set![k] = v; } }
  // switched off by the house (before the card, or since): the card turns it on, and its removal turns it off again
  if (was.enabled === false) undo.enabled = false;
  const { entities: _e, options: _o, ...rest } = was; void _e; void _o;
  const next = { ...rest, ...(was.enabled === false ? { enabled: true } : {}), ...(Object.keys(ents).length ? { entities: ents } : {}), ...(Object.keys(o).length ? { options: o } : {}) };
  if (c.modules[moduleId] || Object.keys(next).length) c.modules[moduleId] = next; // nothing to tell: no empty settings are made
  return undo;
}
/** Put back what the card changed — only where the setting still holds the card's value (a change the house made since stays). */
export function untellModule(c: HouseConfig, moduleId: string, inst: { bindings: Record<string, string>; moduleUndo?: ModuleUndo }) {
  const u = sane(inst.moduleUndo), was = c.modules[moduleId]; if (!u || !was) return;
  const ents: Record<string, string> = { ...(was.entities ?? {}) }, o: Record<string, string> = { ...((was.options ?? {}) as Record<string, string>) };
  for (const [k, before] of Object.entries(u.entities)) if (ents[k] === (u.wrote ? u.wrote[k] : inst.bindings[k])) { if (before === null) delete ents[k]; else ents[k] = before; }
  for (const [k, before] of Object.entries(u.options)) if (o[k] === u.set?.[k]) { if (before === null) delete o[k]; else o[k] = before; }
  const next: Record<string, unknown> = { ...was, entities: ents, options: o }; if (u.enabled === false) next.enabled = false;
  if (!Object.keys(ents).length) delete next.entities; if (!Object.keys(o).length) delete next.options;
  if (u.fresh && !Object.keys(next).length) { delete c.modules[moduleId]; return; } // the module had no settings before the card: none again
  c.modules[moduleId] = next as typeof was;
}
