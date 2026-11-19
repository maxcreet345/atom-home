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
