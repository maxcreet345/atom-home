import test from 'node:test';
import assert from 'node:assert/strict';
import { dayKey, normaliseTariffs, offeredSections, tariffDeleteEffect, tariffPrice, withNewTariff, type Tariff } from '../src/model/config.ts';
import { houseDate } from '../src/runtime/zone.ts';
import { translator } from '../src/i18n/index.ts';

const ANRE: Tariff[] = [{ from: '2025-08-01', lei: 3.59 }, { from: '2026-04-02', lei: 3.56 }];

// Audit 2026-11-09, round 2 (code-review, later): `Number()` read «1e2» as 100 lei and «0x10» as 16.
test('a price is digits with a comma or a point, nothing else', () => {
  for (const bad of ['1e2', '1E2', '0x10', '0b11', '0o7', '+3', '3.', '.5', '3,5,1', '1 000', '３', '12345', '3,56789', 'Infinity', '']) assert.equal(tariffPrice(bad), null, bad);
  assert.equal(tariffPrice('3,56'), 3.56); assert.equal(tariffPrice(' 4.2 '), 4.2); assert.equal(tariffPrice('1000'), 1000); assert.equal(tariffPrice('0,01'), 0.01); assert.equal(tariffPrice('100'), 100);
  assert.equal(tariffPrice('1001'), null); assert.equal(tariffPrice('0,001'), null);
});

// «today» of the tariff editor is the house's day: a browser far to the west or east of the house is on another date for some hours.
test('the tariff editor’s today is the house’s calendar day, whatever zone the browser is in', () => {
  const at = Date.UTC(2026, 10, 10, 22, 30); // 10 Nov 22:30 UTC: already 11 Nov 00:30 in Chișinău, still 10 Nov in New York
  assert.equal(dayKey(houseDate(at, 'Europe/Chisinau')), '2026-11-11');
  assert.equal(dayKey(houseDate(at, 'America/New_York')), '2026-11-10');
  assert.equal(dayKey(houseDate(Date.UTC(2026, 0, 1, 0, 30), 'America/New_York')), '2025-12-31');
  assert.equal(dayKey(new Date(2026, 0, 5)), '2026-01-05');
});

// A pasted configuration must not bring in a price «from tomorrow» that the editor itself refuses.
test('with today given, a tariff dated after it is dropped; without it the store keeps what it kept', () => {
  const raw = [{ from: '2026-11-10', lei: 4 }, { from: '2026-11-11', lei: 5 }, { from: '2030-01-01', lei: 6 }, { from: '2025-08-01', lei: 3.59 }];
  assert.deepEqual(normaliseTariffs(raw, '2026-11-10'), [{ from: '2025-08-01', lei: 3.59 }, { from: '2026-11-10', lei: 4 }]);
  assert.equal(normaliseTariffs(raw).length, 4);
});

// «Добавить изменение тарифа» on an empty list: the past keeps the price the panel was counting by — Home Assistant's own when there is one.
test('the first own tariff starts from what the panel counted by: HA’s price when the house has one, else ANRE’s figures', () => {
  const today = '2026-11-10';
  assert.deepEqual(withNewTariff([], today, ANRE, 4.1), [{ from: today, lei: 4.1 }], 'HA price: one row, nothing of ANRE baked in — the time before the first row is counted at its price');
  assert.deepEqual(withNewTariff([], today, ANRE, null), [...ANRE, { from: today, lei: 3.56 }]);
  assert.deepEqual(withNewTariff([], today, ANRE), [...ANRE, { from: today, lei: 3.56 }]);
  for (const odd of [0, -1, NaN, 5000, Infinity]) assert.deepEqual(withNewTariff([], today, ANRE, odd), [...ANRE, { from: today, lei: 3.56 }], String(odd));
  // an own history is continued at its current price, HA's price is not looked at any more
  assert.deepEqual(withNewTariff([{ from: '2026-01-01', lei: 3 }], today, ANRE, 4.1), [{ from: '2026-01-01', lei: 3 }, { from: today, lei: 3 }]);
  const has = [{ from: today, lei: 3 }]; assert.equal(withNewTariff(has, today, ANRE, 4.1), has, 'a day that has a price gets no second row');
  // ANRE rows of today or later are not baked in under today's own row
  assert.deepEqual(withNewTariff([], '2026-04-02', ANRE), [{ from: '2025-08-01', lei: 3.59 }, { from: '2026-04-02', lei: 3.56 }]);
  assert.deepEqual(normaliseTariffs(withNewTariff([], today, ANRE, 4.123456)), [{ from: today, lei: 4.1235 }], 'what is added is what the store keeps');
});

// Audit round 2 (tariff-delete-first-row): the question promised «the previous price» for the earliest row, which has none.
test('deleting a tariff row: the only one, the earliest and any other are three different consequences, said in three texts', () => {
  const list: Tariff[] = [{ from: '2026-04-02', lei: 3.56 }, { from: '2025-08-01', lei: 3.59 }, { from: '2026-11-10', lei: 4 }];
  assert.deepEqual(tariffDeleteEffect(list, '2025-08-01'), { kind: 'first', next: { from: '2026-04-02', lei: 3.56 } });
  assert.deepEqual(tariffDeleteEffect(list, '2026-04-02'), { kind: 'other', previous: { from: '2025-08-01', lei: 3.59 } });
  assert.deepEqual(tariffDeleteEffect(list, '2026-11-10'), { kind: 'other', previous: { from: '2026-04-02', lei: 3.56 } });
  assert.deepEqual(tariffDeleteEffect([list[0]], '2026-04-02'), { kind: 'only' });
  assert.equal(tariffDeleteEffect(list, '2020-01-01'), null);
  for (const lang of ['ru', 'en', 'ro'] as const) {
    const t = translator(lang), a = { v: '3,59', d: 'D1', nv: '3,56', nd: 'D2', p: '4,10' };
    const first = t('setup.tariff.deleteAsk.first', a), only = t('setup.tariff.deleteAsk.only', a), onlyHa = t('setup.tariff.deleteAsk.onlyHa', a), other = t('setup.tariff.deleteAsk', a);
    assert.ok(first.includes('3,59') && first.includes('D1') && first.includes('3,56') && first.includes('D2'), `${lang}: ${first}`);
    assert.ok(only.includes('ANRE') && !only.includes('{'), `${lang}: ${only}`); assert.ok(onlyHa.includes('Home Assistant') && onlyHa.includes('4,10') && !onlyHa.includes('ANRE'), `${lang}: ${onlyHa}`);
    assert.equal(new Set([first, only, onlyHa, other]).size, 4, lang);
    assert.ok(t('setup.tariff.ha', { v: '4,10' }).includes('Home Assistant') && !t('setup.tariff.ha', { v: '4,10' }).includes('ANRE'), lang);
  }
});

// «Разделы» offered switches for «Камеры» and «Безопасность» in a house that has neither.
test('«Разделы» offers the sections the house has, plus any that is hidden now (its switch is the way back)', () => {
  const all = ['lights', 'climate', 'cleaning', 'energy', 'systems', 'camera', 'security'] as const;
  assert.deepEqual(offeredSections(all, ['home', 'rooms', 'lights', 'climate', 'energy', 'systems'], {}), ['lights', 'climate', 'energy', 'systems']);
  assert.deepEqual(offeredSections(all, ['lights', 'systems'], { camera: { hidden: true }, security: { hidden: false } }), ['lights', 'systems', 'camera']);
  assert.deepEqual(offeredSections(all, undefined, {}), [...all], 'not told what the house has: everything, as before');
});

// The icon list showed the codes («light», «power», «more») in every language.
test('every icon of the configurator has a name in ru, en and ro, and none is its own code', async () => {
  const src = await (await import('node:fs/promises')).readFile(new URL('../src/ui/setup.tsx', import.meta.url), 'utf8');
  const icons = /const ICONS = \[([^\]]+)\]/.exec(src)![1].split(',').map(x => x.trim().replace(/'/g, ''));
  assert.ok(icons.length >= 20);
  for (const lang of ['ru', 'en', 'ro'] as const) { const t = translator(lang); for (const i of icons) { const name = t(`setup.icon.${i}` as never); assert.ok(name && name !== `setup.icon.${i}` && (lang !== 'ru' || !/^[a-z ]+$/i.test(name)), `${lang}: ${i} → ${name}`); } }
  assert.ok(!/<option value=\{i\}>\{i\}<\/option>/.test(src), 'no option prints the code itself');
});
