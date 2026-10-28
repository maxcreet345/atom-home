import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { roomType } from '../src/ui/art.ts';
import { normaliseConfig, defaultConfig } from '../src/model/config.ts';
import { activeSpecs as activeModules, MODULE_SPECS as MODULES } from '../src/modules/catalog.ts';
import type { Registry } from '../src/model/registry.ts';

const fixturePath = resolve(import.meta.dirname, '../../private/fixtures/criuleni-registry.json');
const fixture: Registry | null = existsSync(fixturePath) ? JSON.parse(readFileSync(fixturePath, 'utf8')) : null;

test('room type is guessed from Russian, Romanian and English area names', () => {
  for (const [name, type] of [['Ванная', 'bathroom'], ['Главная спальня', 'bedroom'], ['Детская', 'kids'], ['Компьетерная', 'office'], ['Кладовка', 'storage'], ['Подьезд', 'hall'], ['Гостиная', 'living'], ['Kitchen', 'kitchen'], ['Bucătărie', 'kitchen'], ['Dormitor copii', 'kids'], ['Living room', 'living'], ['Garage', null]] as const)
    assert.equal(roomType(name), type, name);
});

test('config keeps only safe photo URLs and well-formed module overrides', () => {
  const { config } = normaliseConfig({ schemaVersion: 1, rooms: { k: { photo: '/atom_home_photos/0123456789abcdef.jpg' }, b: { photo: 'javascript:alert(1)' }, c: { photo: 'data:image/jpeg;base64,/9j/4AAQ' } }, devices: { 'e:light.a': { photo: 'https://example.com/a.png' } }, modules: { boiler_ebus: { enabled: false, entities: { flow: 'sensor.flow', bad: 'rm -rf', 'x y': 'sensor.z' } }, 'evil key': {} } });
  assert.equal(config.rooms.k.photo, '/atom_home_photos/0123456789abcdef.jpg'); assert.equal(config.rooms.b.photo, undefined); assert.equal(config.rooms.c.photo, 'data:image/jpeg;base64,/9j/4AAQ');
  assert.equal(config.devices['e:light.a'].photo, 'https://example.com/a.png');
  assert.deepEqual(config.modules.boiler_ebus, { enabled: false, entities: { flow: 'sensor.flow' } }); assert.equal(config.modules['evil key'], undefined);
});

test('modules: detection, disable and entity override', { skip: !fixture }, () => {
  const def = MODULES.find(m => m.id === 'boiler_ebus')!;
  const match = def.detect(fixture!); assert.ok(match, 'Criuleni ebusd boiler detected');
  assert.equal(match!.entities.flow, 'sensor.heating_ebusd_criuleni_bai_flowtemp_temp'); assert.equal(match!.entities.pressure, 'sensor.heating_ebusd_criuleni_bai_waterpressure_press');
  assert.equal(activeModules(fixture!, defaultConfig()).length, 1);
  const off = defaultConfig(); off.modules.boiler_ebus = { enabled: false }; assert.equal(activeModules(fixture!, off).length, 0);
  const over = defaultConfig(); over.modules.boiler_ebus = { entities: { pressure: 'sensor.does_not_exist' } }; assert.equal(activeModules(fixture!, over).length, 0, 'a required role pointing at a missing entity disables the module');
  const empty: Registry = { areas: [], devices: [], entities: [], states: {} }; assert.equal(activeModules(empty, defaultConfig()).length, 0);
});

test('withRoom does not double a room already in the card name', async () => {
  const { withRoom } = await import('../src/ui/format.ts');
  assert.equal(withRoom('Термометр · Кухня', 'Кухня'), 'Термометр · Кухня');
  assert.equal(withRoom('Термометр', 'Кухня'), 'Термометр · Кухня');
  assert.equal(withRoom('Кран ванной', ''), 'Кран ванной');
});
