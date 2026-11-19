// Critique of 19.11.2026, step «harden»: starting the robot always asks; sending it home stays one tap. Each test fails on the tree before it.
import test from 'node:test';
import assert from 'node:assert/strict';
import { customAction, starts } from '../src/runtime/actions.ts';
import { confirmWords } from '../src/ui/shell-logic.ts';
import { translator } from '../src/i18n/index.ts';

const ru = translator('ru'), ro = translator('ro'), en = translator('en');
const btn = (service: string, confirm = false) => customAction({ id: 'vac', label: 'Уборка', service, target: { entity_id: 'vacuum.robot' }, confirm });

test('an owner\'s «Уборка» button asks even with «Подтверждать» off, in the vacuum\'s own words', () => {
  const a = btn('vacuum.start');
  assert.equal(a.confirm, true);
  const w = confirmWords(a, 'Уборка', ru, null);
  assert.equal(w.text, 'Начать уборку всего дома? Робот поедет сразу');
  assert.equal(w.yes, 'Начать');
});
test('«На базу», pause and stop stay one tap', () => {
  for (const s of ['vacuum.return_to_base', 'vacuum.pause', 'vacuum.stop']) assert.equal(btn(s).confirm, false, s);
  assert.equal(starts('vacuum', 'return_to_base'), false);
  assert.equal(starts('light', 'start'), false);
});
test('the start question exists in ru, ro and en, with plural forms for rooms', () => {
  for (const t of [ru, ro, en]) {
    assert.notEqual(t('module.vac.startAskAll' as never), 'module.vac.startAskAll');
    assert.notEqual(t('module.vac.startYes' as never), 'module.vac.startYes');
    assert.notEqual(t('ui.again' as never), 'ui.again');
  }
  assert.equal(ru('module.vac.startAskRooms' as never, { n: 2 }), 'Убрать 2 комнаты? Робот поедет сразу');
});

// ---- step «clarify»: one dictionary for every screen
import { buttonDoes } from '../src/runtime/actions.ts';
import { stateText } from '../src/ui/format.ts';
const tt = (k: string, p?: Record<string, string | number>) => ru(k as never, p);
test('a scene tile says what it does: lamps (with the light\'s relay), the whole home, the vacuum', () => {
  assert.equal(buttonDoes({ id: 'a', label: 'Свет выкл.', icon: 'light', service: 'homeassistant.turn_off', target: { entity_id: ['light.a', 'light.b', 'switch.svet'] } }, tt), '3 лампы');
  assert.equal(buttonDoes({ id: 'b', label: 'Уборка', service: 'vacuum.start', target: { entity_id: 'vacuum.r' } }, tt), 'Весь дом');
  assert.equal(buttonDoes({ id: 'c', label: 'На базу', service: 'vacuum.return_to_base', target: { entity_id: 'vacuum.r' } }, tt), 'Пылесос');
  assert.equal(buttonDoes({ id: 'd', label: 'X', service: 'script.turn_on', target: { entity_id: 'script.x' } }, tt), null);
});
const ent = (domain: string, state: string, attributes: Record<string, unknown> = {}, unit: string | null = null) => ({ id: `${domain}.x`, domain, state, attributes, available: state !== 'unavailable', unit, deviceClass: null, name: 'x', lastChanged: '' }) as never;
test('the same words everywhere: the vacuum waits «Ждёт команды», a camera is «На связи», 21,5° without «C»', () => {
  assert.equal(stateText(ent('vacuum', 'idle', { battery_level: 85 }), ru, 'ru'), 'Ждёт команды · 85%');
  assert.equal(stateText(ent('camera', 'idle'), ru, 'ru'), 'На связи');
  assert.equal(stateText(ent('sensor', '21.5', {}, '°C'), ru, 'ru'), '21,5°');
  assert.equal(ru('module.boiler_ebus' as never), 'Котёл');
  assert.equal(ru('sec.titleShort' as never), 'Безопасность');
});
