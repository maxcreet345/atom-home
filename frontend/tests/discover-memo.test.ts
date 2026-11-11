// PERF-1 of the audit of 09.11.2026: the house model is not rebuilt for a state change that cannot change it, and a remembered answer is
// always the answer `discover` itself would give.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { discover, rememberDiscover } from '../src/model/discover.ts';
import { defaultConfig, normaliseConfig } from '../src/model/config.ts';
import type { Registry, StateRow } from '../src/model/registry.ts';

const fixturePath = resolve(import.meta.dirname, '../../private/fixtures/criuleni-registry.json'), ownerPath = resolve(import.meta.dirname, '../../../clients/criuleni/atom-home-config-20261028.json');
const fixture: Registry | null = existsSync(fixturePath) ? JSON.parse(readFileSync(fixturePath, 'utf8')) : null;
const config = existsSync(ownerPath) ? normaliseConfig(JSON.parse(readFileSync(ownerPath, 'utf8'))).config : defaultConfig('Дом');
const row = (state: string, attributes: Record<string, unknown> = {}): StateRow => ({ state, attributes, last_changed: '2026-11-09T10:00:00+00:00', last_updated: '2026-11-09T10:00:00+00:00' });
const small: Registry = {
  areas: [{ area_id: 'kitchen', name: 'Кухня' } as Registry['areas'][number]],
  devices: [{ id: 'd1', name: 'Датчик', model: 'M', manufacturer: 'X', area_id: 'kitchen', entry_type: null, disabled_by: null, via_device_id: null, labels: [] }],
  entities: ['light.lamp', 'sensor.t', 'sensor.h', 'update.core', 'sensor.off'].map(id => ({ entity_id: id, device_id: id.startsWith('sensor.') ? 'd1' : null, area_id: id === 'light.lamp' ? 'kitchen' : null, name: null, original_name: id, platform: 'x', entity_category: null, disabled_by: id === 'sensor.off' ? 'user' : null, hidden_by: null, icon: null, original_icon: null, device_class: id === 'sensor.t' ? 'temperature' : id === 'sensor.h' ? 'humidity' : null, unit: null, has_entity_name: false, labels: [], translation_key: null, vacuum: null })),
  states: { 'light.lamp': row('off', { friendly_name: 'Лампа' }), 'sensor.t': row('21.5', { unit_of_measurement: '°C' }), 'sensor.h': row('40', { unit_of_measurement: '%' }), 'update.core': row('off'), 'sensor.off': row('1') },
};
const withState = (reg: Registry, id: string, next: StateRow | undefined): Registry => { const states = { ...reg.states }; if (next) states[id] = next; else delete states[id]; return { ...reg, states }; };

test('an entity that stands on no card changes: the very same house comes back', () => {
  const find = rememberDiscover(), cfg = defaultConfig('Дом'), a = find(small, cfg);
  assert.equal(find(withState(small, 'update.core', row('on')), cfg), a, 'update.* is no card');
  assert.equal(find(withState(small, 'sensor.off', row('2')), cfg), a, 'a disabled entity is not even looked at');
  assert.equal(find({ ...small, states: { ...small.states, 'sun.sun': row('below_horizon') } }, cfg), a, 'a state without a registry entry');
  assert.equal(find({ ...small }, cfg), a, 'a new registry object with the same parts');
});

test('a value changes: only the card that holds it is new, and the house equals a fresh discover', () => {
  const find = rememberDiscover(), cfg = defaultConfig('Дом'), a = find(small, cfg);
  const reg = withState(small, 'sensor.t', row('22.0', { unit_of_measurement: '°C' })), b = find(reg, cfg);
  assert.notEqual(b, a); assert.deepEqual(b, discover(reg, cfg));
  const lampA = a.devices.find(d => d.key === 'e:light.lamp')!, lampB = b.devices.find(d => d.key === 'e:light.lamp')!, envA = a.devices.find(d => d.key === 'd:d1')!, envB = b.devices.find(d => d.key === 'd:d1')!;
  assert.equal(lampB, lampA, 'the lamp did not change: the same object'); assert.notEqual(envB, envA); assert.equal(envB.primary.state, '22.0'); assert.equal(envB.metrics[1], envA.metrics[1], 'humidity untouched');
  // availability of the card follows its own entities
  const gone = withState(withState(reg, 'sensor.t', row('unavailable', { unit_of_measurement: '°C' })), 'sensor.h', row('unavailable', { unit_of_measurement: '%' })), c = find(gone, cfg);
  assert.deepEqual(c, discover(gone, cfg)); assert.equal(c.devices.find(d => d.key === 'd:d1')!.available, false);
});

test('a state that changes the shape of the house (a name, a class, a unit, an entity appearing) rebuilds it', () => {
  const find = rememberDiscover(), cfg = defaultConfig('Дом'); find(small, cfg);
  for (const reg of [withState(small, 'light.lamp', row('off', { friendly_name: 'Люстра' })), withState(small, 'sensor.t', row('21.5', { unit_of_measurement: 'W' })), withState(small, 'sensor.h', undefined), withState(small, 'sensor.h', row('wet', { unit_of_measurement: '%' }))]) assert.deepEqual(find(reg, cfg), discover(reg, cfg));
  const other = { ...cfg, home: { ...cfg.home, name: 'Другой' } }; assert.equal(find(small, other).name, 'Другой', 'the settings changed');
  assert.deepEqual(find(small, cfg, new Set(['light.lamp'])), discover(small, cfg, new Set(['light.lamp'])), 'a module claimed an entity');
});

test('the real house: three hundred random state changes, the remembered house always equals a fresh one', { skip: !fixture }, () => {
  const find = rememberDiscover(); let reg = fixture!; let seed = 20261109; const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
  const ids = Object.keys(reg.states); let same = 0, patched = 0; let prev = find(reg, config);
  assert.deepEqual(prev, discover(reg, config));
  for (let i = 0; i < 300; i++) {
    const id = ids[Math.floor(rnd() * ids.length)], s = reg.states[id], pick = rnd();
    const next: StateRow = pick < 0.5 ? { ...s, state: Number.isFinite(Number(s.state)) ? String(Number(s.state) + 1) : s.state === 'on' ? 'off' : s.state === 'off' ? 'on' : s.state, last_changed: `2026-11-09T10:00:${String(i % 60).padStart(2, '0')}+00:00` }
      : pick < 0.7 ? { ...s, state: 'unavailable' } : pick < 0.85 ? { ...s, attributes: { ...s.attributes, brightness: i } } : pick < 0.93 ? { ...s, attributes: { ...s.attributes, friendly_name: `Имя ${i}` } } : { ...s, state: 'unknown' };
    reg = withState(reg, id, next);
    const home = find(reg, config);
    if (home === prev) same++; else patched++;
    if (i % 7 === 0 || i > 290) assert.deepEqual(home, discover(reg, config), `after change ${i} of ${id}`);
    prev = home;
  }
  assert.deepEqual(prev, discover(reg, config)); assert.ok(same > 0 && patched > 0, JSON.stringify({ same, patched }));
});

test('the real house: a remembered answer is at least twice cheaper than building it anew', { skip: !fixture }, () => {
  const find = rememberDiscover(); let reg = fixture!; find(reg, config);
  const id = Object.keys(reg.states).find(k => k.startsWith('sensor.') && Number.isFinite(Number(reg.states[k].state)))!;
  const step = (n: number) => { reg = withState(reg, id, { ...reg.states[id], state: String(n) }); return reg; };
  // the best of three rounds each: under a parallel test run one round can be slowed by another file's work (the ratio fell to 1.7 so; alone it is ≥ 3)
  let fresh = Infinity, kept = Infinity;
  for (let round = 0; round < 3; round++) {
    const t0 = performance.now(); for (let i = 0; i < 30; i++) discover(step(round * 1000 + i), config); fresh = Math.min(fresh, performance.now() - t0);
    const t1 = performance.now(); for (let i = 0; i < 30; i++) find(step(round * 1000 + 100 + i), config); kept = Math.min(kept, performance.now() - t1);
  }
  assert.ok(kept * 2 < fresh, JSON.stringify({ fresh: Math.round(fresh), kept: Math.round(kept) }));
});
