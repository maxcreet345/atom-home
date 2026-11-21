// The humidifier family (src/appliances/humidifier.*): Xiaomi Smart Humidifier 2 found in the house's snapshot of 21.11.2026 by its model code,
// its fields filled from its own entities, what the card reads in every state, and the tile's line («52 % → 60 %», «Нет воды», off, no connection).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { devicesFor, suggestBindings, instanceView, instanceClaims, searchProfiles, PROFILES } from '../src/model/card-catalog.ts'; // first: the catalog loads every family
import { family, readHumidifier, humidifierLine, levelOf, statusText } from '../src/appliances/humidifier.profiles.ts';
import { translator } from '../src/i18n/index.ts';
import { words_humidifier } from '../src/i18n/words-humidifier.ts';
import type { Registry } from '../src/model/registry.ts';

const path = resolve(import.meta.dirname, '../../private/fixtures/criuleni-registry-live-20261121.json');
const have = existsSync(path);
const base = (): Registry => JSON.parse(readFileSync(path, 'utf8'));
const P = family.profiles[0];
const ru = translator('ru'), ro = translator('ro'), en = translator('en');
/** the house's humidifier and its fields as the catalog suggests them */
function setup() {
  const reg = base(), dev = devicesFor(reg, P)[0];
  return { reg, dev, bindings: suggestBindings(reg, P, dev.id) };
}
/** a state variant: the humidifier on (or as given), with its readings */
function alive(reg: Registry, b: Record<string, string>, over: { state?: string; hum?: string; target?: number; level?: string; mode?: string; water?: string; tank?: string; fault?: string } = {}) {
  const r = structuredClone(reg), set = (id: string | undefined, state: string, attrs: Record<string, unknown> = {}) => { if (id) r.states[id] = { ...r.states[id], state, attributes: { ...r.states[id].attributes, ...attrs } }; };
  set(b.humidifier, over.state ?? 'on', { humidity: over.target ?? 60, current_humidity: 50, mode: over.mode ?? 'None' });
  set(b.humidity, over.hum ?? '52'); set(b.temperature, '22.4'); set(b.waterShortage, over.water ?? 'off'); set(b.tankLifted, over.tank ?? 'off');
  set(b.fault, over.fault ?? 'No Faults'); set(b.fanLevel, over.level ?? 'Level2'); set(b.buzzer, 'on'); set(b.indicator, 'off');
  return r;
}

test('the catalog: one profile in «Увлажнители», found by the model code, every word in three languages', () => {
  assert.equal(P.renderer, 'appliance'); assert.equal(P.card, 'humidifier'); assert.equal(P.category, 'humidifiers');
  assert.ok(PROFILES.some(p => p.id === P.id));
  assert.deepEqual(searchProfiles('jsq2w', p => ru(p.titleKey as never)).map(p => p.id), [P.id]);
  assert.deepEqual(searchProfiles('', p => ru(p.titleKey as never), { category: 'humidifiers' }).map(p => p.id), [P.id]);
  assert.deepEqual(Object.keys(words_humidifier.ro).sort(), Object.keys(words_humidifier.ru).sort());
  assert.deepEqual(Object.keys(words_humidifier.en).sort(), Object.keys(words_humidifier.ru).sort());
  for (const t of [ru, ro, en]) for (const k of [P.titleKey, P.descKey, P.kindKey!, ...P.roles.flatMap(r => [r.labelKey, ...(r.hintKey ? [r.hintKey] : [])])]) assert.notEqual(t(k as never), k, k);
});

test('the house: the humidifier of the Living room, every own field filled, the socket named after it found (1.36.1), the room sensor left to the installer', { skip: !have }, () => {
  const { reg, dev, bindings } = setup();
  assert.equal(devicesFor(reg, P).length, 1); assert.equal(dev.areaId, 'gostinaia');
  assert.deepEqual(bindings, {
    humidifier: 'humidifier.living_humidifier', humidity: 'sensor.living_humidifier_humidity', waterShortage: 'binary_sensor.living_humidifier_water_shortage',
    tankLifted: 'binary_sensor.living_humidifier_tank_installed', fault: 'sensor.living_humidifier_fault', fanLevel: 'select.living_humidifier_fan_level',
    temperature: 'sensor.living_humidifier_temperature', indicator: 'light.living_humidifier_indicator_light', buzzer: 'switch.living_humidifier_buzzer',
    plugPower: 'sensor.living_humidifier_plug_power', plug: 'switch.living_humidifier_plug',
  });
  // the plug is the house's own socket: it stays its own tile; the humidifier's entities leave the auto-made cards
  const claims = instanceClaims(reg, { a: { profileId: P.id, profileVersion: '1.0.0', deviceId: dev.id, bindings: { ...bindings, plug: 'switch.living_humidifier_plug', plugPower: 'sensor.living_humidifier_plug_power' }, placement: ['room'] } });
  assert.ok(claims.has('button.living_humidifier_info') && claims.has('humidifier.living_humidifier'));
  const v = instanceView(reg, 'a', { profileId: P.id, profileVersion: '1.0.0', deviceId: dev.id, bindings, placement: ['room'] }, () => 'Гостиная', undefined, k => ru(k as never))!;
  assert.equal(v.incomplete.length, 0); assert.equal(v.device.name, 'Увлажнитель воздуха');
});

test('read: on, holding a humidity, its level, the readings', { skip: !have }, () => {
  const { reg, bindings: b } = setup();
  let h = readHumidifier(alive(reg, b), b);
  assert.equal(h.phase, 'on'); assert.equal(h.current, 52); assert.equal(h.target, 60); assert.equal(h.level, 2); assert.equal(h.min, 40); assert.equal(h.max, 70);
  assert.deepEqual(h.levels.map(l => l.level), [1, 2, 3, 'auto']); assert.equal(h.temperature, 22.4); assert.equal(h.buzzer, true); assert.equal(h.light, false);
  assert.equal(humidifierLine(h, ru, 'ru'), '52 % · Средне');
  h = readHumidifier(alive(reg, b, { level: 'Level4' }), b); assert.equal(h.level, 'auto');
  assert.equal(humidifierLine(h, ru, 'ru'), '52 % → 60 %'); assert.equal(statusText(h, ru, 'ru'), 'Держит 60 %');
  h = readHumidifier(alive(reg, b, { mode: 'Constant Humidity', level: 'Level1' }), b); assert.equal(h.level, 'auto', 'the humidifier\'s own mode says constant humidity');
  // the room's humidity from the device's own sensor first; without it, the humidifier's attribute
  h = readHumidifier(alive(reg, b), { ...b, humidity: '' }); assert.equal(h.current, 50);
});

test('«Нет воды» and «Бак снят»: from their sensors or from the fault, said on the tile before anything else', { skip: !have }, () => {
  const { reg, bindings: b } = setup();
  let h = readHumidifier(alive(reg, b, { water: 'on' }), b);
  assert.ok(h.noWater && !h.tankOut); assert.equal(humidifierLine(h, ru, 'ru'), 'Нет воды'); assert.equal(humidifierLine(h, ro, 'ro'), 'Fără apă');
  h = readHumidifier(alive(reg, b, { state: 'off', water: 'on' }), b); assert.equal(humidifierLine(h, ru, 'ru'), 'Нет воды', 'off with an empty tank still says so');
  h = readHumidifier(alive(reg, b, { fault: 'Insufficient Water' }), b); assert.ok(h.noWater);
  h = readHumidifier(alive(reg, b, { tank: 'on', water: 'on' }), b); assert.ok(h.tankOut && !h.noWater); assert.equal(humidifierLine(h, ru, 'ru'), 'Бак снят');
  h = readHumidifier(alive(reg, b, { fault: 'Water Tank Separated' }), b); assert.ok(h.tankOut);
  h = readHumidifier(alive(reg, b, { fault: 'Humidity Sensor Fault' }), b); assert.equal(h.fault, 'Humidity Sensor Fault'); assert.equal(humidifierLine(h, ru, 'ru'), 'Неисправность');
  h = readHumidifier(alive(reg, b, { fault: '0' }), b); assert.equal(h.fault, null);
});

test('off, no connection, the plug off, the house unreachable: nothing «now» from a silent humidifier', { skip: !have }, () => {
  // first the card without its socket (the form suggests it since 1.36.1; the installer may leave it out)
  const { reg, bindings: { plug: _plug, plugPower: _plugPower, ...b } } = setup(); void _plug; void _plugPower;
  let h = readHumidifier(alive(reg, b, { state: 'off' }), b);
  assert.equal(h.phase, 'off'); assert.equal(humidifierLine(h, ru, 'ru'), 'Выключен · 52 %');
  // the snapshot as it is: everything unavailable (its plug is off)
  h = readHumidifier(reg, b); assert.equal(h.phase, 'offline'); assert.equal(h.current, null); assert.equal(h.target, null); assert.equal(h.noWater, false);
  assert.equal(humidifierLine(h, ru, 'ru'), 'Нет связи'); assert.equal(family.tileLine!(reg, { profileId: P.id, profileVersion: '1.0.0', bindings: b, placement: [] }, ru, 'ru'), 'Нет связи');
  const withPlug = { ...b, plug: 'switch.living_humidifier_plug', plugPower: 'sensor.living_humidifier_plug_power' };
  h = readHumidifier(reg, withPlug); assert.equal(h.phase, 'plugOff'); assert.equal(h.watts, 0); assert.equal(humidifierLine(h, ru, 'ru'), 'Розетка выключена'); assert.equal(statusText(h, ru, 'ru'), 'Розетка увлажнителя выключена');
  // the room's humidity from another sensor of the room is still the room's while the humidifier is silent; not when the house is unreachable
  h = readHumidifier(reg, { ...b, humidity: 'sensor.living_co2_humidity' }); assert.equal(h.current, 62.7);
  h = readHumidifier(alive(reg, b), b, false); assert.equal(h.phase, 'house'); assert.equal(h.current, null); assert.equal(h.watts, null); assert.equal(h.target, null);
  h = readHumidifier(alive(reg, b, { state: 'unknown' }), b); assert.equal(h.phase, 'unknown'); assert.equal(humidifierLine(h, ru, 'ru'), ru('state.unknown'));
});

test('levels: Level1…Level3 are strengths, the 4th is constant humidity', () => {
  assert.equal(levelOf('Level1', 4), 1); assert.equal(levelOf('Level3', 4), 3); assert.equal(levelOf('Level4', 4), 'auto'); assert.equal(levelOf('Constant Humidity', 2), 'auto'); assert.equal(levelOf('weird', 4), null);
});
