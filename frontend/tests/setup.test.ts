import test from 'node:test';
import assert from 'node:assert/strict';
import { memoryStore, exportConfig, importConfig, checkImport, configCounts } from '../src/runtime/store.ts';
import { defaultConfig, normaliseConfig, normaliseTariffs, tariffDayProblem, tariffPrice } from '../src/model/config.ts';
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

// Audit 2026-11-09 (setup-import-wipes-config): «Импорт JSON» used to save the factory configuration when the text was cut off or was not a
// configuration at all. The check runs before anything is saved and names the problem; only a real configuration yields one.
test('an import is checked before it may replace anything: broken, truncated and wrong-shaped text is a named problem', () => {
  const c = defaultConfig('Дом'); c.rooms.kitchen = { name: 'Кухня' }; c.devices['e:light.a'] = { enabled: false }; c.buttons.push({ id: 'b1', label: 'Ночь', service: 'light.turn_off', confirm: true });
  c.alarms.push({ id: 'a1', room: 'kitchen', time: '07:00', days: [1], enabled: true, label: '', alice: 'off', phrase: '', station: '', light: false, lightEntity: '', fadeMin: 15, push: false, repeats: 0, repeatEveryMin: 5 }); c.energy.tariffs.push({ from: '2026-01-01', lei: 3.5 });
  const text = exportConfig(c), ok = checkImport(text);
  assert.ok(ok.ok); if (ok.ok) { assert.deepEqual(ok.config, c); assert.deepEqual(configCounts(ok.config), { rooms: 1, devices: 1, buttons: 1, alarms: 1, tariffs: 1 }); }
  for (const [raw, problem] of [['', 'empty'], ['   \n', 'empty'], [text.slice(0, text.length / 2), 'not_json'], ['{not json', 'not_json'], ['x'.repeat(600 * 1024), 'too_large'],
    ['null', 'not_config'], ['[1,2]', 'not_config'], ['"text"', 'not_config'], ['{}', 'not_config'], ['{"name":"package"}', 'not_config'], ['{"schemaVersion":2,"home":{"name":"X"}}', 'not_config'],
    ['{"schemaVersion":1}', 'not_config'], ['{"schemaVersion":1,"home":{"name":"X"},"rooms":[]}', 'not_config'], ['{"schemaVersion":1,"home":{"name":"X"},"buttons":{}}', 'not_config']] as const) {
    const r = checkImport(raw); assert.equal(r.ok, false, raw.slice(0, 40)); if (!r.ok) assert.equal(r.problem, problem, raw.slice(0, 40));
  }
  // entries the store would drop are counted for the confirmation, not silently lost
  const partial = checkImport('{"schemaVersion":1,"home":{"name":"X"},"buttons":[{"id":"b","label":"L","service":"NOT A SERVICE"}]}');
  assert.ok(partial.ok); if (partial.ok) { assert.equal(partial.config.buttons.length, 0); assert.equal(partial.warnings.length, 1); }
});

// Audit 2026-11-09 (tariff-date-typing-deletes-row, tariff-invalid-values): a date being typed («0002-11-09» on the way to 2026) or a price
// out of range reached the store, failed its check, and the whole row was dropped as «Сохранено».
test('a tariff date being typed is a draft and a price out of range is refused: neither reaches the store', () => {
  const today = '2026-11-10';
  assert.equal(tariffDayProblem('', today, []), 'incomplete');
  for (const half of ['0002-11-09', '0020-11-09', '0202-11-09', '2026-02-31', '2026-13-01', '11.09.2026']) assert.equal(tariffDayProblem(half, today, []), 'incomplete', half);
  assert.equal(tariffDayProblem('1999-12-31', today, []), 'range'); assert.equal(tariffDayProblem('2026-11-11', today, []), 'range');
  assert.equal(tariffDayProblem('2026-11-09', today, ['2026-11-09']), 'taken');
  assert.equal(tariffDayProblem('2026-11-10', today, ['2026-11-09']), null); assert.equal(tariffDayProblem('2024-02-29', today, []), null);
  // what the check lets through is exactly what the store keeps: a passed value can never drop the row
  assert.deepEqual(normaliseTariffs([{ from: '2024-02-29', lei: tariffPrice('3,21') }]), [{ from: '2024-02-29', lei: 3.21 }]);
  assert.equal(normaliseTariffs([{ from: '0002-11-09', lei: 4 }]).length, 0, 'the store still drops what the configurator must not send');
  for (const bad of ['', ' ', '0', '-3', '1001', 'abc', '0,001', 'Infinity', '3,5,1']) assert.equal(tariffPrice(bad), null, bad);
  assert.equal(tariffPrice('0,01'), 0.01); assert.equal(tariffPrice('1000'), 1000); assert.equal(tariffPrice(' 4.2 '), 4.2);
});
