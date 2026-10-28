import test from 'node:test';
import assert from 'node:assert/strict';
import { memoryStore, exportConfig, importConfig } from '../src/runtime/store.ts';
import { defaultConfig, normaliseConfig } from '../src/model/config.ts';
import { customAction, serviceCall } from '../src/runtime/actions.ts';

test('store round-trips a configuration and normalises on save', async () => {
  const s = memoryStore(); const c = defaultConfig('Casa'); c.devices['e:light.a'] = { enabled: false }; c.buttons.push({ id: 'b1', label: 'Night', service: 'script.turn_on', target: { entity_id: 'script.night' }, confirm: true });
  await s.save({ ...c, devices: { ...c.devices, 'evil key': { enabled: false } } } as never);
  const { config, warnings } = await s.load();
  assert.equal(config.devices['e:light.a'].enabled, false); assert.equal(config.devices['evil key'], undefined); assert.equal(config.buttons.length, 1); assert.equal(warnings.length, 0);
});

test('export/import is lossless for valid configs and never throws on garbage', () => {
  const c = defaultConfig('X'); c.rooms.kitchen = { name: 'Кухня', order: 1 }; c.sections.energy = { hidden: true }; c.home.language = 'en';
  const back = importConfig(exportConfig(c)); assert.deepEqual(back.config, c); assert.equal(back.warnings.length, 0);
  const bad = importConfig('{not json'); assert.equal(bad.config.schemaVersion, 1); assert.ok(bad.warnings[0].startsWith('import:'));
  const huge = importConfig('x'.repeat(600 * 1024)); assert.ok(huge.warnings[0].includes('512'));
});

test('a custom button calls exactly the configured service with its target and data', () => {
  const b = normaliseConfig({ schemaVersion: 1, buttons: [{ id: 'b1', label: 'Dim', service: 'light.turn_on', target: { entity_id: 'light.k' }, data: { brightness_pct: 30 }, confirm: false }] }).config.buttons[0];
  const a = customAction(b); assert.equal(a.confirm, false); assert.equal(a.risk, 'custom');
  assert.deepEqual(serviceCall(a), { domain: 'light', service: 'turn_on', data: { entity_id: 'light.k', brightness_pct: 30 } });
  const c = normaliseConfig({ schemaVersion: 1, buttons: [{ id: 'b2', label: 'Reboot', service: 'homeassistant.restart' }] }).config.buttons[0];
  assert.equal(c.confirm, true, 'confirm defaults to true');
});
