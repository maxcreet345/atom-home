// The card catalog (PROMPT-CARD-CATALOG.md, 20.11.2026) on the Criuleni snapshot of 18.11: search and «category → make» lead to one profile,
// two purifiers of one model keep each its own sensors and target, a lost sensor is said and never replaced, the kitchen's air temperature
// never offers the boiler, both heating cards, and the settings of a house that never used the catalog stay exactly as they were.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import type { Registry } from '../src/model/registry.ts';
import { PROFILES, tellModule, untellModule, moduleMatch, moduleDevice, profileById, searchProfiles, brandsOf, devicesFor, foundHere, candidates, suggestBindings, suggestRoom, instanceView, instanceViews, instanceClaims, normaliseInstances, type Profile, type ProfileInstance } from '../src/model/card-catalog.ts';
import { normaliseConfig, type HouseConfig } from '../src/model/config.ts';
import { discover } from '../src/model/discover.ts';
import { readHeating } from '../src/model/heating.ts';
import { heatLayoutOf, modeWords } from '../src/model/heating-layout.ts';
import { heatingActions } from '../src/model/heating-act.ts';
import { actionsFor } from '../src/runtime/actions.ts';
import { translator } from '../src/i18n/index.ts';

const live: Registry = JSON.parse(readFileSync(new URL('../../private/fixtures/criuleni-registry-live-20261118.json', import.meta.url), 'utf8'));
const t = translator('ru'), title = (p: Profile) => t(p.titleKey as never);
const P4 = profileById('xiaomi.purifier4')!;
const LIVING_DEV = '80babb9d488a0bbd7d08db9a6ab67aa5';
/** The snapshot with a second Purifier 4 in the bedroom: its own HA device, its own entities, the same model (the acceptance's «два очистителя одной модели»). */
function twoPurifiers(): Registry {
  const reg: Registry = structuredClone(live);
  const own = reg.entities.filter(e => e.device_id === LIVING_DEV);
  reg.devices.push({ ...reg.devices.find(d => d.id === LIVING_DEV)!, id: 'bedroomPurifierDevice', name: 'Спальня · Очиститель воздуха (Xiaomi Air Purifier 4)', area_id: 'spalnia' });
  for (const e of own) {
    const id = e.entity_id.replace('living_air_purifier', 'bedroom_air_purifier');
    reg.entities.push({ ...e, entity_id: id, device_id: 'bedroomPurifierDevice', area_id: null });
    const s = structuredClone(live.states[e.entity_id]); if (typeof s.attributes.friendly_name === 'string') s.attributes.friendly_name = s.attributes.friendly_name.replace('Гостиная', 'Спальня');
    if (id.endsWith('_pm25')) s.state = '41';
    reg.states[id] = s;
  }
  return reg;
}
const inst = (over: Partial<ProfileInstance> = {}): ProfileInstance => ({ profileId: P4.id, profileVersion: P4.version, bindings: {}, placement: ['home', 'room'], ...over });
// the panel's claims are the modules' plus the cards' (modules/index.ts); under Node only the cards' part runs (the modules are .tsx)
const claimedEntities = (reg: Registry, c: HouseConfig) => instanceClaims(reg, c.profileInstances ?? {});
const config = (cards: Record<string, ProfileInstance>): HouseConfig => normaliseConfig({ schemaVersion: 1, home: { name: 'Criuleni' }, profileInstances: cards }).config;

test('«Purifier 4», «Xiaomi», the model code and «Очистители воздуха → Xiaomi» lead to the same profile', () => {
  assert.ok(searchProfiles('Xiaomi', title).map(p => p.id).includes('xiaomi.purifier4'), 'the make lists the purifier among its cards');
  for (const q of ['Purifier 4', 'purifier 4', 'zhimi.airp.mb5', 'mb5', 'очиститель']) assert.deepEqual(searchProfiles(q, title).map(p => p.id), ['xiaomi.purifier4'], q);
  assert.deepEqual(searchProfiles('', title, { category: 'air_purifier', brand: 'Xiaomi' }).map(p => p.id), ['xiaomi.purifier4']);
  assert.deepEqual(brandsOf('air_purifier'), ['Xiaomi']);
  // both heating cards stand side by side in «Отопление», neither is a question of the first run
  assert.deepEqual(searchProfiles('', title, { category: 'heating' }).map(p => p.id), ['heating.single', 'heating.rooms']);
});
test('another make of purifier joins the same category and the brand filter keeps them apart (test data)', () => {
  const other: Profile = { ...P4, id: 'test.coway', brand: 'Coway', titleKey: 'cat.p.purifier4', models: ['coway.ap1512'], terms: ['airmega'] };
  const list = [...PROFILES, other];
  assert.deepEqual(brandsOf('air_purifier', list), ['Coway', 'Xiaomi']);
  assert.deepEqual(searchProfiles('', title, { category: 'air_purifier' }, list).map(p => p.id), ['xiaomi.purifier4', 'test.coway']);
  assert.deepEqual(searchProfiles('', title, { category: 'air_purifier', brand: 'Coway' }, list).map(p => p.id), ['test.coway']);
  assert.deepEqual(searchProfiles('airmega', title, {}, list).map(p => p.id), ['test.coway']);
  assert.equal(foundHere(live, other), false, 'listed in «Все карточки», not found here');
  assert.equal(foundHere(live, P4), true);
});
test('two purifiers of one model: each card keeps its own device, fan and sensors; an external PM2.5 chosen on purpose stays external', () => {
  const reg = twoPurifiers();
  const devs = devicesFor(reg, P4).map(d => d.id).sort();
  assert.deepEqual(devs, ['80babb9d488a0bbd7d08db9a6ab67aa5', 'bedroomPurifierDevice'].sort());
  const a = suggestBindings(reg, P4, LIVING_DEV), b = suggestBindings(reg, P4, 'bedroomPurifierDevice');
  assert.equal(a.fan, 'fan.living_air_purifier'); assert.equal(a.pm25, 'sensor.living_air_purifier_pm25'); assert.equal(a.filter, 'sensor.living_air_purifier_filter_life');
  assert.equal(b.fan, 'fan.bedroom_air_purifier'); assert.equal(b.pm25, 'sensor.bedroom_air_purifier_pm25'); assert.equal(b.filter, 'sensor.bedroom_air_purifier_filter_life');
  for (const [k, v] of Object.entries(b)) assert.ok(v.includes('bedroom_air_purifier'), `${k}: ${v} is the bedroom purifier's own`);
  // the bedroom's card reads the PM2.5 of the living room's purifier on purpose: an explicit external sensor
  const pmList = candidates(reg, P4.roles.find(r => r.id === 'pm25')!, { deviceId: 'bedroomPurifierDevice', areaId: 'spalnia' });
  assert.equal(pmList[0].id, 'sensor.bedroom_air_purifier_pm25', 'its own first');
  assert.ok(pmList.some(c => c.id === 'sensor.living_air_purifier_pm25' && !c.own), 'another device may be chosen and says so');
  const cfg = config({ cA: inst({ deviceId: LIVING_DEV, bindings: a, roomId: 'gostinaia' }), cB: inst({ deviceId: 'bedroomPurifierDevice', bindings: { ...b, pm25: 'sensor.living_air_purifier_pm25' }, roomId: 'spalnia' }) });
  const [vA, vB] = instanceViews(reg, cfg.profileInstances!);
  assert.equal(vA.device.primary.id, 'fan.living_air_purifier'); assert.equal(vB.device.primary.id, 'fan.bedroom_air_purifier');
  assert.equal(vA.device.key, 'p:cA'); assert.equal(vB.device.key, 'p:cB');
  assert.equal(vA.device.roomId, 'gostinaia'); assert.equal(vB.device.roomId, 'spalnia');
  assert.deepEqual(vB.device.metrics.map(m => m.id).slice(0, 2), ['sensor.living_air_purifier_pm25', 'sensor.bedroom_air_purifier_filter_life']);
  // the power action of each card goes to its own fan
  assert.equal(actionsFor(vA.device).find(x => x.id === 'toggle')!.entityId, 'fan.living_air_purifier');
  assert.equal(actionsFor(vB.device).find(x => x.id === 'toggle')!.entityId, 'fan.bedroom_air_purifier');
  // modes and speed come from what the device reports
  const modes = actionsFor(vB.device).find(x => x.id === 'preset')!;
  assert.deepEqual(modes.options, ['Auto', 'Sleep', 'Favorite', 'Manual']); assert.equal(modes.service, 'set_preset_mode');
  assert.equal(actionsFor(vB.device).find(x => x.id === 'percentage')!.step, 33.333333333333336);
  // saved and read back (a reload): the bindings are the same
  const again = normaliseConfig(JSON.parse(JSON.stringify(cfg))).config;
  assert.deepEqual(again.profileInstances, cfg.profileInstances);
});
test('a card that represents an appliance takes its old auto-made tile away: no duplicate, and the external sensor stays where it was', () => {
  const reg = twoPurifiers();
  const before = discover(reg, normaliseConfig({ schemaVersion: 1, home: { name: 'x' } }).config, claimedEntities(reg, normaliseConfig({ schemaVersion: 1, home: { name: 'x' } }).config));
  assert.ok(before.devices.some(d => d.primary.id === 'fan.living_air_purifier'), 'the old tile exists without a card');
  const cfg = config({ cA: inst({ deviceId: LIVING_DEV, bindings: suggestBindings(reg, P4, LIVING_DEV) }) });
  const claimed = claimedEntities(reg, cfg), after = discover(reg, cfg, claimed);
  assert.ok(!after.devices.some(d => d.primary.id === 'fan.living_air_purifier' || d.haDeviceId === LIVING_DEV), 'no tile of the living room purifier besides its card');
  assert.ok(after.devices.some(d => d.primary.id === 'fan.bedroom_air_purifier'), 'the second purifier, which has no card, is untouched');
  const ext = config({ cB: inst({ deviceId: 'bedroomPurifierDevice', bindings: { fan: 'fan.bedroom_air_purifier', pm25: 'sensor.living_air_purifier_pm25' } }) });
  assert.ok(!instanceClaims(reg, ext.profileInstances!).has('sensor.living_air_purifier_pm25'), 'an external sensor is not taken from its own card');
});
test('a missing optional field hides its function; a lost bound sensor is said, and never replaced by the first look-alike', () => {
  const reg: Registry = structuredClone(live);
  const minimal = instanceView(reg, 'c1', inst({ deviceId: LIVING_DEV, bindings: { fan: 'fan.living_air_purifier' } }))!;
  assert.deepEqual(minimal.device.metrics, [], 'no PM2.5, no filter: the card does not have them');
  assert.deepEqual(minimal.lost, []); assert.deepEqual(minimal.incomplete, []);
  delete reg.states['sensor.living_air_purifier_pm25'];
  const v = instanceView(reg, 'c1', inst({ deviceId: LIVING_DEV, bindings: { fan: 'fan.living_air_purifier', pm25: 'sensor.living_air_purifier_pm25' } }))!;
  assert.deepEqual(v.lost, ['pm25']);
  assert.ok(!v.device.metrics.some(m => m.deviceClass === 'pm25' && m.id !== 'sensor.living_air_purifier_pm25'), 'no other PM2.5 sensor stands in');
  const none = instanceView(reg, 'c2', inst({ bindings: {} }))!;
  assert.deepEqual(none.incomplete, ['fan'], 'without its main control the card is incomplete and is not drawn');
});
test('the kitchen\'s air temperature never offers a set point, the boiler, the kettle or a radiator head', () => {
  const air = profileById('heating.rooms')!.roomRoles!.find(r => r.id === 'air')!;
  const ids = candidates(live, air, { areaId: 'kukhnia' }).map(c => c.id);
  assert.ok(ids.includes('sensor.kitchen_climate_temperature'));
  for (const id of ids) assert.doesNotMatch(id, /boiler|target|setpoint|_trv|kettle|heating_/, id);
  assert.equal(suggestRoom(live, profileById('heating.rooms')!, 'kukhnia').air, 'sensor.kitchen_climate_temperature');
  const single = profileById('heating.single')!.roles.find(r => r.id === 'air')!;
  for (const id of candidates(live, single, { areaId: 'kukhnia' }).map(c => c.id)) assert.doesNotMatch(id, /boiler|target|_trv|kettle/, id);
});
test('«Один центральный термостат»: the thermostat\'s own target and modes, the chosen air sensor shown as the temperature', () => {
  const p = profileById('heating.single')!;
  const v = instanceView(live, 'h1', { profileId: p.id, profileVersion: p.version, bindings: { thermostat: 'climate.living_thermostat', air: 'sensor.kitchen_climate_temperature' }, placement: ['home'] })!;
  assert.deepEqual(v.incomplete, []); assert.equal(v.device.kind, 'climate'); assert.equal(v.device.primary.id, 'climate.living_thermostat');
  assert.equal(v.device.metrics[0].id, 'sensor.kitchen_climate_temperature');
  const acts = actionsFor(v.device).map(a => a.id);
  assert.ok(acts.includes('temperature') && acts.includes('hvac_mode'), acts.join(','));
  assert.ok(!candidates(live, p.roles[0], {}).some(c => /_trv$/.test(c.id)), 'a radiator head is not a central thermostat');
  assert.ok(candidates(live, p.roles[0], {}).some(c => c.id === 'climate.living_thermostat'), 'the boiler\'s thermostat («Термостат котла») is offered');
  assert.ok(candidates(live, profileById('heating.rooms')!.roles[0], {}).some(c => c.id === 'climate.living_thermostat'));
});
test('«Центральный термостат и комнаты»: the house\'s common target, each room\'s actual temperature, its own target, the temporary change and the way back', async () => {
  const p = profileById('heating.rooms')!, NOW = Date.now();
  const reg: Registry = structuredClone(live);
  reg.states['timer.kitchen_heating_override'] = { state: 'active', attributes: { finishes_at: new Date(NOW + 2 * 3600e3).toISOString() }, last_changed: '', last_updated: '' };
  reg.states['input_number.kitchen_heating_override_temp'] = { ...reg.states['input_number.kitchen_heating_override_temp'], state: '23' };
  const rooms = ['kukhnia', 'spalnia'].map((a, i) => ({ id: `r${i}`, areaId: a, bindings: suggestRoom(reg, p, a) }));
  assert.equal(rooms[0].bindings.trv, 'climate.kitchen_trv'); assert.equal(rooms[0].bindings.timer, 'timer.kitchen_heating_override');
  const card: ProfileInstance = { profileId: p.id, profileVersion: p.version, bindings: { central: 'climate.living_thermostat', mode: 'input_select.heating_mode', homeTemp: 'input_number.heating_home_temp' }, placement: ['home'], rooms };
  const h = readHeating(reg, NOW, heatLayoutOf(card))!;
  assert.equal(h.rooms.length, 2, 'the installer\'s two rooms, not the house\'s five');
  assert.equal(h.rooms[0].name, 'Кухня'); assert.equal(h.rooms[0].sensor, 'room');
  assert.equal(h.rooms[0].current, Number(reg.states['sensor.kitchen_climate_temperature'].state), 'the actual temperature is the room\'s air sensor');
  assert.equal(h.rooms[0].override?.temp, 23); assert.ok(h.rooms[0].override!.until > NOW);
  assert.deepEqual(h.parts, { boiler: false, scenarios: false, mode: true });
  const calls: Array<[string, string, Record<string, unknown>]> = [];
  const act = heatingActions(h, { call: async (d, s, data) => { calls.push([d, s, data]); } });
  void act.house(21); void act.back(h.rooms[0]); void act.room(h.rooms[1], 19); void act.mode('manual');
  assert.deepEqual(calls, [
    ['input_number', 'set_value', { entity_id: 'input_number.heating_home_temp', value: 21 }],
    ['timer', 'cancel', { entity_id: 'timer.kitchen_heating_override' }],
    ['climate', 'set_temperature', { entity_id: 'climate.bedroom_trv', temperature: 19 }],
    ['input_select', 'select_option', { entity_id: 'input_select.heating_mode', option: 'Ручной' }],
  ]);
  // «Ручной»: each room shows its own target, the common − / + writes every bound room's manual temperature
  reg.states['input_select.heating_mode'] = { ...reg.states['input_select.heating_mode'], state: 'Ручной' };
  const m = readHeating(reg, NOW, heatLayoutOf(card))!; assert.equal(m.mode, 'manual');
  calls.length = 0; void heatingActions(m, { call: async (d, s, data) => { calls.push([d, s, data]); } }).house(20);
  assert.deepEqual(calls.map(c => c[2].entity_id), ['input_number.kitchen_heating_manual_temp', 'input_number.bedroom_heating_manual_temp']);
  // a room without a timer has no temporary change and no «Вернуть к общей»
  const bare = readHeating(reg, NOW, heatLayoutOf({ ...card, rooms: [{ id: 'r9', areaId: 'kukhnia', bindings: { trv: 'climate.kitchen_trv' } }] }))!;
  assert.equal(bare.rooms[0].override, null); assert.equal(bare.rooms[0].sensor, 'head');
  // a bound on/off that is gone is unknown, not read from the thermostat; manual without any room's manual helper refuses instead of «succeeding»
  const lostSys = readHeating(reg, NOW, heatLayoutOf({ ...card, bindings: { ...card.bindings, system: 'input_boolean.gone' } }))!;
  assert.equal(lostSys.systemKnown, false);
  const noManual = readHeating(reg, NOW, heatLayoutOf({ ...card, rooms: [{ id: 'r9', areaId: 'kukhnia', bindings: { trv: 'climate.kitchen_trv' } }] }))!;
  await assert.rejects(heatingActions(noManual, { call: async () => undefined }).house(20) as Promise<unknown>);
  assert.equal(modeWords(['off', 'heat', 'auto']), null, 'a list without «manual» is no mode list');
  // the house without any card reads its heating as before (Criuleni's own helpers)
  const legacy = readHeating(live, NOW)!; assert.equal(legacy.rooms.length, 5); assert.equal(legacy.ids?.legacy, true);
});
test('the settings of a house that never used the catalog are kept exactly; normalising twice gives the same; unknown profiles are kept', () => {
  for (const file of ['atom-home-config-20261028.json', 'atom-home-config-20261118.json']) {
    const raw = JSON.parse(readFileSync(new URL(`../../../clients/criuleni/${file}`, import.meta.url), 'utf8'));
    const once = normaliseConfig(raw).config, twice = normaliseConfig(JSON.parse(JSON.stringify(once))).config;
    assert.deepEqual(twice, once, `${file}: a second pass changes nothing`);
    assert.equal('profileInstances' in once, false, `${file}: no new key in a house without cards`);
    const cards = discover(live, once, claimedEntities(live, once)).devices.filter(d => d.enabled).map(d => [d.key, d.name, d.roomId, d.favorite, d.order]);
    const withNothing = discover(live, normaliseConfig({ ...raw, profileInstances: {} }).config, claimedEntities(live, normaliseConfig({ ...raw, profileInstances: {} }).config)).devices.filter(d => d.enabled).map(d => [d.key, d.name, d.roomId, d.favorite, d.order]);
    assert.deepEqual(withNothing, cards, `${file}: the visible cards, their names, rooms and order are the same`);
  }
  const future = normaliseInstances({ cX: { profileId: 'acme.future9', profileVersion: '1.0.0', bindings: { feed: 'button.x_feed' }, placement: ['home'], extra: 1 }, 'bad id!': { profileId: 'x' } });
  assert.deepEqual(Object.keys(future), ['cX'], 'a newer panel\'s card is kept, a malformed one dropped');
  assert.equal((future.cX as unknown as { extra: number }).extra, 1, 'with the fields this panel does not know');
  assert.deepEqual(Object.keys(normaliseInstances(JSON.parse('{"__proto__":{"profileId":"x"}}'))), []);
  assert.deepEqual(instanceViews(live, future), [], 'and this panel draws nothing for it');
});

// ---- the panel's own cards in the catalog (owner 21.11.2026: «добавь все готовые карточки») ----
test('every ready card is in the catalog with words in ru, ro and en, and each of Criuleni’s is «found in this house»', () => {
  const ro = translator('ro'), en = translator('en');
  for (const p of PROFILES) for (const tr of [t, ro, en]) { assert.notEqual(tr(p.titleKey as never), p.titleKey, `${p.id} title`); assert.notEqual(tr(p.descKey as never), p.descKey, `${p.id} desc`); for (const r of p.roles) assert.notEqual(tr(r.labelKey as never), r.labelKey, `${p.id}.${r.id}`); }
  const here = PROFILES.filter(p => foundHere(live, p)).map(p => p.id).sort();
  for (const id of ['xiaomi.feeder2', 'xiaomi.fountain2', 'xiaomi.kettle2pro', 'xiaomi.airfryer55', 'roborock.saros_z70', 'aqara.g4', 'demirdokum.nitromix_p24', 'house.air', 'house.clock']) assert.ok(here.includes(id), `${id} found on Criuleni (${here.join(', ')})`);
});
test('a model card is found only where that model is: another kettle does not make «Kettle 2 Pro» found', () => {
  const reg: Registry = structuredClone(live), k = reg.devices.find(d => /^xiaomi\.kettle\./.test(d.model ?? ''));
  if (!k) return; k.model = 'xiaomi.kettle.v99';
  assert.equal(foundHere(reg, profileById('xiaomi.kettle2pro')!), false);
});
test('a module card takes the module’s own finding for its fields; the boiler is found by its fields where the module alone misses it', () => {
  const feeder = profileById('xiaomi.feeder2')!, dev = devicesFor(live, feeder)[0];
  assert.ok(dev, 'the feeder is a device of this house');
  assert.match(suggestBindings(live, feeder, dev.id).feed ?? '', /^button\..+_(dispense|pet_food_out)$/);
  const kp = profileById('xiaomi.kettle2pro')!; assert.ok(suggestBindings(live, kp, devicesFor(live, kp)[0]?.id).heater, 'the kettle’s heater');
  const boiler = suggestBindings(live, profileById('demirdokum.nitromix_p24')!);
  assert.match(boiler.flow ?? '', /_flow_temp$/); assert.match(boiler.pressure ?? '', /_pressure$/);
  // the ONVIF camera keeps the module's HD lens: the card does not pick the light ONVIF profile itself
  const c44 = profileById('sonoff.cam_c44he')!, cam = suggestBindings(live, c44, devicesFor(live, c44)[0]?.id).camera;
  if (cam) assert.equal(cam, moduleMatch(live, c44)?.entities.camera);
});
test('a card that draws itself is never a second tile and takes nothing from the auto-made cards', () => {
  const feeder = profileById('xiaomi.feeder2')!, dev = devicesFor(live, feeder)[0];
  const all = normaliseInstances({ c1: { profileId: feeder.id, profileVersion: '1.0.0', deviceId: dev.id, bindings: suggestBindings(live, feeder, dev.id), placement: [] } });
  assert.equal(instanceClaims(live, all).size, 0);
  assert.ok(instanceViews(live, all)[0]?.incomplete.length === 0, 'the feeder card is complete');
});
test('the module settings: a card writes only what it changes, removing puts back exactly that, a hand-set entity and a later change stay', () => {
  const found = { entities: { feed: 'button.a_dispense', stock: 'sensor.a_food_level' }, options: { portionGrams: '10' } };
  // the house set «plan» by hand before the card; the card keeps the module's own feed, changes stock, sets grams
  const c = { modules: { pet_feeder: { entities: { plan: 'switch.hand_set' } } } } as unknown as HouseConfig;
  const binds = { feed: 'button.a_dispense', stock: 'sensor.b_level', plan: 'switch.hand_set' };
  const undo = tellModule(c, 'pet_feeder', ['feed', 'stock', 'plan'], binds, ['portionGrams'], { portionGrams: '12' }, found);
  assert.deepEqual(c.modules.pet_feeder.entities, { plan: 'switch.hand_set', stock: 'sensor.b_level' }, 'the module’s own finding is not pinned');
  assert.deepEqual(undo.entities, { stock: null });
  // later the house changes stock itself; removing the card leaves that, and the hand-set plan
  c.modules.pet_feeder.entities!.stock = 'sensor.c_newer';
  untellModule(c, 'pet_feeder', { bindings: binds, moduleUndo: undo });
  assert.deepEqual(c.modules.pet_feeder.entities, { plan: 'switch.hand_set', stock: 'sensor.c_newer' });
  assert.equal((c.modules.pet_feeder.options ?? {}).portionGrams, undefined, 'its grams go back');
  // a module the house had switched off is switched off again
  const d = { modules: { kettle: { enabled: false } } } as unknown as HouseConfig;
  const u2 = tellModule(d, 'kettle', ['heater'], { heater: 'water_heater.k' }, [], {}, null);
  assert.equal(d.modules.kettle.enabled, true); untellModule(d, 'kettle', { bindings: { heater: 'water_heater.k' }, moduleUndo: u2 });
  assert.equal(d.modules.kettle.enabled, false); assert.equal(d.modules.kettle.entities, undefined);
});

test('an edit of a module card: a value the house set by hand stays the house’s, a cleared field goes back, a switch-off since is undone on removal, a broken record never fails', () => {
  // the card set heater; the house then set it by hand; the card is opened and saved unchanged; removal keeps the hand-set heater
  const c = { modules: { kettle: { entities: { heater: 'water_heater.orig' } } } } as unknown as HouseConfig;
  const u1 = tellModule(c, 'kettle', ['heater'], { heater: 'water_heater.card' }, [], {}, null);
  c.modules.kettle.entities!.heater = 'water_heater.hand';
  const u2 = tellModule(c, 'kettle', ['heater'], { heater: 'water_heater.hand' }, [], {}, null, u1);
  untellModule(c, 'kettle', { bindings: { heater: 'water_heater.hand' }, moduleUndo: u2 });
  assert.equal(c.modules.kettle.entities!.heater, 'water_heater.hand');
  // an optional field set and then cleared in an edit: the module stops using it, and a module the card made is gone after removal
  const d = { modules: {} } as unknown as HouseConfig;
  const v1 = tellModule(d, 'kettle', ['heater', 'temp'], { heater: 'water_heater.k', temp: 'sensor.card_t' }, [], {}, { entities: { heater: 'water_heater.k' } });
  const v2 = tellModule(d, 'kettle', ['heater', 'temp'], { heater: 'water_heater.k' }, [], {}, { entities: { heater: 'water_heater.k' } }, v1);
  assert.equal(d.modules.kettle?.entities?.temp, undefined);
  untellModule(d, 'kettle', { bindings: { heater: 'water_heater.k' }, moduleUndo: v2 });
  assert.equal(d.modules.kettle, undefined);
  // switched off by the house after the card: an edit turns it on, the removal off again
  const e = { modules: {} } as unknown as HouseConfig;
  const w1 = tellModule(e, 'kettle', ['heater'], { heater: 'water_heater.x' }, [], {}, null);
  e.modules.kettle.enabled = false;
  const w2 = tellModule(e, 'kettle', ['heater'], { heater: 'water_heater.x' }, [], {}, null, w1);
  assert.equal(e.modules.kettle.enabled, true);
  untellModule(e, 'kettle', { bindings: { heater: 'water_heater.x' }, moduleUndo: w2 });
  assert.equal(e.modules.kettle.enabled, false);
  // a hand-edited record
  const f = { modules: { kettle: { entities: { heater: 'water_heater.y' } } } } as unknown as HouseConfig;
  assert.doesNotThrow(() => untellModule(f, 'kettle', { bindings: {}, moduleUndo: { entities: null, options: 7 } as never }));
});

test('a module drives the appliance it found: with two of the same model the card is only for that one', () => {
  const kettle = profileById('xiaomi.kettle2pro')!;
  const one = moduleDevice(live, kettle); assert.ok(one, 'Criuleni’s kettle is the module’s');
  const reg: Registry = structuredClone(live), copy = 'kettle-copy-device';
  const base = reg.devices.find(d => d.id === one)!; reg.devices.push({ ...base, id: copy });
  for (const e of live.entities.filter(x => x.device_id === one)) { const id = e.entity_id.replace(/^(\w+)\./, '$1.zz_copy_'); reg.entities.push({ ...e, entity_id: id, device_id: copy }); reg.states[id] = structuredClone(live.states[e.entity_id]); }
  assert.equal(devicesFor(reg, kettle).length, 2);
  assert.equal(moduleDevice(reg, kettle), one);
});
