// Clock audit of 19.11.2026: the clock's settings are read once and kept until a write.
import test from 'node:test';
import assert from 'node:assert/strict';
const store = new Map<string, string>();
(globalThis as unknown as { localStorage: Storage }).localStorage = { getItem: k => store.get(k) ?? null, setItem: (k, v) => { store.set(k, String(v)); }, removeItem: k => { store.delete(k); }, clear: () => store.clear(), key: () => null, length: 0 } as Storage;
const { readClockSettings, writeClockSettings, CLOCK_KEY } = await import('../src/modules/clock-state.ts');

test('the clock\'s settings are parsed once; a write is seen at once', () => {
  const first = readClockSettings();
  store.set(CLOCK_KEY, JSON.stringify({ style: 'digital' })); // changed behind its back (another tab): the cache stays until the storage event
  assert.equal(readClockSettings(), first);
  writeClockSettings({ ...first, style: 'digital' }); assert.equal(readClockSettings().style, 'digital');
});

// ---- heating audit 20.11.2026: the boiler's name comes from HA
import { boilerName } from '../src/model/heating.ts';
const regOf = (name: string | null, manufacturer: string | null = null, model: string | null = null) => ({ areas: [], devices: [{ id: 'd', name, manufacturer, model, area_id: null }], entities: [{ entity_id: 'sensor.kitchen_boiler_flow_temp', device_id: 'd', area_id: null, name: null, original_name: null, platform: 'esphome', entity_category: null, disabled_by: null, hidden_by: null }], states: {} }) as never;
test('the boiler is named as HA names it: the model in brackets, else the name without its room; a bus gateway is no name', () => {
  assert.equal(boilerName(regOf('Кухня · Котёл (Demir Döküm Nitromix P24)')), 'Demir Döküm Nitromix P24');
  assert.equal(boilerName(regOf('Кухня · Vaillant ecoTEC')), 'Vaillant ecoTEC');
  assert.equal(boilerName(regOf('esp-ebus', 'Espressif', 'esp32')), null);
  assert.equal(boilerName(regOf('esp-ebus', 'Baxi', 'Luna 3')), 'Baxi Luna 3');
});
