import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readOsecEvents } from '../src/model/office-security.ts';
const M = 'alarm_control_panel.master', people = [{ user: 'u1', name: 'Ararat Melconean' }, { user: 'u2', name: 'Madan' }];
test('arming by a person and armed a minute later is one line «armed by …»', () => {
  const ev = readOsecEvents([{ when: 100, entity_id: M, state: 'arming', context_user_id: 'u2' }, { when: 160, entity_id: M, state: 'armed_away' }], M, people);
  assert.deepEqual(ev, [{ when: 160000, kind: 'armed', by: 'Madan', via: 'user', mode: 'armed_away' }]); // the mode names it in the house's feed («Не дома», «Отпуск»)
});
test('a disarm by the Ajax → Alarmo sync says «from Ajax», newest first', () => {
  const ev = readOsecEvents([{ when: 50, entity_id: M, state: 'disarmed', context_entity_id: 'automation.ajax_alarmo_sinkhronizatsiia_okhrany', context_domain: 'automation' }, { when: 10, entity_id: M, state: 'arming', context_user_id: 'u1' }, { when: 20, entity_id: M, state: 'armed_away' }], M, people);
  assert.equal(ev[0].kind, 'disarmed'); assert.equal(ev[0].via, 'ajax'); assert.equal(ev[1].by, 'Ararat Melconean');
});
test('other panels and a triggered alarm', () => {
  const ev = readOsecEvents([{ when: 5, entity_id: 'alarm_control_panel.servis', state: 'armed_away' }, { when: 9, entity_id: M, state: 'triggered' }], M, people);
  assert.deepEqual(ev.map(e => e.kind), ['triggered']);
});
