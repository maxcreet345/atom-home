// The laundry family (src/appliances/laundry.*) on the Criuleni snapshot of 21.11.2026: the LG washer (LG ThinQ) and the Samsung DV8400D
// dryer (LocalThings, plus its SmartThings cloud copy). Found by model, fields filled by suffix, the cloud copy never a second dryer, the
// tile's line in every state, the commands each action is, and nothing offered that the machine would refuse.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import type { Registry, StateRow } from '../src/model/registry.ts';
import { devicesFor, suggestBindings, candidates, instanceClaims, instanceView, foundHere, type ProfileInstance } from '../src/model/card-catalog.ts';
import { family, LG_WASHER, SAMSUNG_DRYER, readLaundry, lineOf, callFor, actsFor, minutesText, cycleName, DRYER_CYCLES, DONE_KEEP_MS } from '../src/appliances/laundry.profiles.ts';
import { translator } from '../src/i18n/index.ts';
import { words_laundry } from '../src/i18n/words-laundry.ts';

const live: Registry = JSON.parse(readFileSync(new URL('../../private/fixtures/criuleni-registry-live-20261121.json', import.meta.url), 'utf8'));
const t = translator('ru'), tro = translator('ro'), ten = translator('en');
const NOW = Date.parse('2026-11-21T12:30:00Z');
const washerDev = () => devicesFor(live, LG_WASHER)[0], dryerDev = () => devicesFor(live, SAMSUNG_DRYER)[0];
const washerInst = (): ProfileInstance => ({ profileId: LG_WASHER.id, profileVersion: '1.0.0', deviceId: washerDev().id, bindings: suggestBindings(live, LG_WASHER, washerDev().id), placement: ['home', 'room'] });
const dryerInst = (): ProfileInstance => ({ profileId: SAMSUNG_DRYER.id, profileVersion: '1.0.0', deviceId: dryerDev().id, bindings: suggestBindings(live, SAMSUNG_DRYER, dryerDev().id), placement: ['home', 'room'] });
/** the snapshot with some states (and attributes) changed */
function withStates(over: Record<string, Partial<StateRow> & { state?: string }>, base: Registry = live): Registry {
  const reg = structuredClone(base);
  for (const [id, s] of Object.entries(over)) reg.states[id] = { ...reg.states[id], ...s, attributes: { ...(reg.states[id]?.attributes ?? {}), ...(s.attributes ?? {}) } } as StateRow;
  return reg;
}
const iso = (ms: number) => new Date(ms).toISOString();
const line = (reg: Registry, inst: ProfileInstance, now = NOW) => lineOf(readLaundry(reg, inst, t, now)!, t, 'ru');

test('each machine is found once by its model; the SmartThings copy of the dryer is never a second dryer', () => {
  assert.equal(devicesFor(live, LG_WASHER).length, 1);
  const dryers = devicesFor(live, SAMSUNG_DRYER);
  assert.equal(dryers.length, 1, JSON.stringify(dryers));
  assert.match(dryers[0].name, /Samsung DV8400D/);
  assert.ok(foundHere(live, LG_WASHER) && foundHere(live, SAMSUNG_DRYER));
  assert.ok(family.profiles.every(p => p.renderer === 'appliance' && p.card === 'laundry' && p.category === 'laundry'));
});
test('the washer\'s fields are filled from its own entities by their suffixes', () => {
  const b = washerInst().bindings;
  for (const [role, suffix] of Object.entries({ status: '_current_status', endsAt: '_remaining_time', total: '_total_time', remote: '_remote_start', operation: '_operation', error: '_error', notify: '_notification', delayEnd: '_delayed_end', delayEndAt: '_delayed_end', cycles: '_cycles' }))
    assert.ok(b[role]?.endsWith(suffix), `${role}: ${b[role]}`);
  assert.equal(b.delayEnd.split('.')[0], 'number'); assert.equal(b.delayEndAt.split('.')[0], 'sensor');
  assert.equal(b.plugPower, undefined, 'another device\'s plug is the installer\'s choice');
});
test('the dryer\'s fields are filled, the diagnostic alarm code included; the template switch and the cloud copy are not taken', () => {
  const b = dryerInst().bindings;
  for (const role of ['running', 'machine', 'stage', 'progress', 'left', 'finishAt', 'alarm', 'remote', 'childLock', 'power', 'cycle', 'dryLevel', 'dryTime', 'delay', 'finishBy', 'start', 'pause', 'stop', 'wrinkle', 'wrinkleActive', 'damp', 'drumClean', 'light', 'buzzer', 'finishSound', 'energy'])
    assert.ok(b[role], `${role} is bound`);
  assert.ok(b.alarm.endsWith('_alarm_code'));
  assert.ok(b.wrinkle.startsWith('switch.') && b.wrinkleActive.startsWith('binary_sensor.'));
  assert.ok(!Object.values(b).includes('switch.bath_dryer_run'));
  const own = new Set(live.entities.filter(e => e.device_id === dryerDev().id).map(e => e.entity_id));
  assert.ok(!b.cloud || !own.has(b.cloud), 'the sibling field never holds the dryer\'s own entity');
  // the installer may pick the cloud copy: it is offered (same room)
  const cloud = candidates(live, SAMSUNG_DRYER.roles.find(r => r.id === 'cloud')!, { deviceId: dryerDev().id, areaId: 'vannaia' });
  assert.ok(cloud.some(c => /smartthings/.test(c.id)));
});
test('a card claims its machine, the cloud copy it is bound to, and the plug readings bound on purpose', () => {
  const cloudId = live.entities.find(e => /smartthings.*progress$/.test(e.entity_id))!.entity_id;
  const d = dryerInst(); d.bindings.cloud = cloudId; d.bindings.plugPower = 'sensor.bath_dryer_socket_power';
  const claims = instanceClaims(live, { a: washerInst(), b: d });
  for (const id of ['sensor.bath_washer_current_status', 'switch.bath_washer_power', 'sensor.bath_dryer_stage', 'switch.bath_dryer_run', cloudId, 'sensor.bath_dryer_socket_power']) assert.ok(claims.has(id), id);
  assert.ok(!claims.has('switch.bath_dryer_socket'), 'the plug stays a plug');
});
test('the snapshot: the washer runs (status «running», though its «Питание» switch says off), the dryer is off, Smart Control off, child lock off', () => {
  const w = readLaundry(live, washerInst(), t, NOW)!;
  assert.equal(w.phase, 'running'); assert.equal(w.step, 'wash');
  assert.equal(w.left, 47); // ends 13:16:20Z, now 12:30
  assert.equal(w.total, 82); assert.ok(w.progress! > 0.4 && w.progress! < 0.45);
  assert.equal(line(live, washerInst()), 'Стирка · осталось 47 мин');
  const d = readLaundry(live, dryerInst(), t, NOW)!;
  assert.equal(d.machine, 'dryer'); assert.equal(d.phase, 'off'); assert.equal(d.remote, false);
  assert.equal(d.childLock, false, 'LocalThings: on = unlocked (HA lock class)');
  assert.equal(d.program, 'Эко хлопок'); assert.equal(d.left, null, 'an idle dryer\'s «remaining» is the program\'s length, not a countdown'); assert.equal(d.total, 270);
});
test('the washer\'s tile line in every state', () => {
  const w = washerInst(), b = w.bindings, end = iso(NOW + 42 * 60_000);
  const at = (status: string, more: Record<string, Partial<StateRow>> = {}) => line(withStates({ [b.status]: { state: status, last_changed: iso(NOW - 60_000) }, [b.endsAt]: { state: end }, ...more }), w);
  assert.equal(at('running'), 'Стирка · осталось 42 мин');
  assert.equal(at('rinsing'), 'Полоскание · осталось 42 мин');
  assert.equal(at('spinning'), 'Отжим · осталось 42 мин');
  assert.equal(at('pause'), 'Пауза · осталось 42 мин');
  assert.equal(at('rinse_hold'), 'Пауза после полоскания');
  assert.equal(at('running', { [b.endsAt]: { state: iso(NOW + 82 * 60_000) } }), 'Стирка · осталось 1 ч 22 мин');
  assert.equal(at('running', { [b.endsAt]: { state: iso(NOW - 5 * 60_000) } }), 'Стирка · осталось 0 мин', 'never negative');
  assert.equal(at('end'), 'Готово');
  assert.equal(at('initial'), 'Ожидание');
  assert.equal(at('power_off', { [b.notify]: { state: 'unknown' } }), 'Выключена');
  assert.equal(at('error', { [b.error]: { state: iso(NOW), attributes: { event_type: 'water_drain_error' } } }), 'Ошибка: вода не сливается');
  assert.equal(at('error', { [b.error]: { state: 'unknown', attributes: { event_type: null } } }), 'Ошибка: машина сообщила об ошибке');
  assert.equal(at('reserved', { [b.delayEndAt]: { state: '2026-11-21T18:30:00Z' } }).startsWith('Отложено · закончит в'), true);
  assert.equal(at('unavailable'), null, 'the tile says «Недоступно» itself');
  // the generic tile of a primary that is not there: the instance's own device is unavailable
  const v = instanceView(withStates({ [b.status]: { state: 'unavailable' } }), 'x', w)!; assert.equal(v.device.available, false);
});
test('«Готово» stays after the LG washer switched itself off — until it is switched on again or 12 hours pass', () => {
  const w = washerInst(), b = w.bindings, doneAt = NOW - 20 * 60_000;
  const off = (now: number, changed = NOW - 15 * 60_000) => line(withStates({ [b.status]: { state: 'power_off', last_changed: iso(changed) }, [b.notify]: { state: iso(doneAt), attributes: { event_type: 'washing_is_complete' } } }), w, now);
  assert.equal(off(NOW), 'Готово');
  assert.equal(off(doneAt + DONE_KEEP_MS + 1), 'Выключена');
  // switched on again after it finished: someone is at the machine
  assert.equal(line(withStates({ [b.status]: { state: 'initial', last_changed: iso(NOW - 60_000) }, [b.notify]: { state: iso(doneAt), attributes: { event_type: 'washing_is_complete' } } }), w), 'Ожидание');
  // an old «complete» before another run does not make a later power-off «done»
  assert.equal(off(NOW, doneAt + 3 * 3_600_000), 'Готово', 'went off after the note: still that wash');
  assert.equal(line(withStates({ [b.status]: { state: 'power_off', last_changed: iso(NOW) }, [b.notify]: { state: iso(NOW - 5 * 3_600_000), attributes: { event_type: 'error_during_washing' } } }), w), 'Выключена');
});
test('the dryer\'s tile line in every state', () => {
  const d = dryerInst(), b = d.bindings, fin = iso(NOW + 42 * 60_000);
  const at = (machine: string, stage: string, more: Record<string, Partial<StateRow>> = {}) => line(withStates({ [b.machine]: { state: machine }, [b.stage]: { state: stage }, [b.finishAt]: { state: fin }, [b.running]: { state: machine === 'active' ? 'on' : 'off' }, [b.power]: { state: 'on' }, ...more }), d);
  assert.equal(at('active', 'drying'), 'Сушка · осталось 42 мин');
  assert.equal(at('active', 'cooling'), 'Охлаждение · осталось 42 мин');
  assert.equal(at('active', 'weightsensing'), 'Взвешивание · осталось 42 мин');
  assert.equal(at('active', 'drying', { [b.finishAt]: { state: 'unknown' }, [b.left]: { state: '95' } }), 'Сушка · осталось 1 ч 35 мин');
  assert.equal(at('pause', 'drying'), 'Пауза · осталось 42 мин');
  assert.equal(at('idle', 'finish'), 'Готово');
  assert.equal(at('idle', 'idle', { [b.wrinkleActive]: { state: 'on' } }), 'Готово · защита от сминания');
  assert.equal(at('idle', 'idle'), 'Ожидание');
  assert.equal(at('idle', 'idle', { [b.power]: { state: 'off' } }), 'Выключена');
  assert.equal(at('idle', 'idle', { [b.alarm]: { state: 'dE' } }), 'Ошибка: дверца не закрыта');
  assert.equal(at('idle', 'idle', { [b.alarm]: { state: 'XY7' } }), 'Ошибка: код XY7');
  assert.equal(at('active', 'delaywash', { [b.running]: { state: 'off' } }).startsWith('Отложено · закончит в'), true);
  assert.equal(line(withStates({ [b.running]: { state: 'unavailable' } }), d), null);
});
test('start, pause and stop are the machine\'s own controls; only what the machine has is offered; nothing while remote control is off', () => {
  const w = washerInst(), d = dryerInst();
  assert.deepEqual(callFor(live, w, 'start'), ['select', 'select_option', { entity_id: w.bindings.operation, option: 'start' }]);
  assert.deepEqual(callFor(live, w, 'pause'), ['select', 'select_option', { entity_id: w.bindings.operation, option: 'stop' }]);
  assert.deepEqual(callFor(live, w, 'powerOff'), ['select', 'select_option', { entity_id: w.bindings.operation, option: 'power_off' }]);
  assert.equal(callFor(withStates({ [w.bindings.operation]: { attributes: { options: ['wake_up'] } } }), w, 'start'), null, 'an option the machine does not list is never sent');
  assert.deepEqual(callFor(live, d, 'start'), ['button', 'press', { entity_id: d.bindings.start }]);
  assert.deepEqual(callFor(live, d, 'resume'), ['button', 'press', { entity_id: d.bindings.start }]);
  assert.deepEqual(callFor(live, d, 'pause'), ['button', 'press', { entity_id: d.bindings.pause }]);
  assert.deepEqual(callFor(live, d, 'stop'), ['button', 'press', { entity_id: d.bindings.stop }]);
  // what each state offers
  const wl = readLaundry(live, w, t, NOW)!; assert.deepEqual(actsFor(wl, live, w), ['pause']);
  const run = withStates({ [d.bindings.machine]: { state: 'active' }, [d.bindings.running]: { state: 'on' }, [d.bindings.stage]: { state: 'drying' } });
  assert.deepEqual(actsFor(readLaundry(run, d, t, NOW)!, run, d), ['pause', 'stop']);
  const paused = withStates({ [d.bindings.machine]: { state: 'pause' } });
  assert.deepEqual(actsFor(readLaundry(paused, d, t, NOW)!, paused, d), ['resume', 'stop']);
  const idle = withStates({ [d.bindings.power]: { state: 'on' } });
  assert.deepEqual(actsFor(readLaundry(idle, d, t, NOW)!, idle, d), ['start']);
  assert.deepEqual(actsFor(readLaundry(live, d, t, NOW)!, live, d), [], 'a dryer that is off is started at the machine');
});
test('words: every program has a name in three languages; an unknown code is said as a code; durations', () => {
  for (const code of ['51', '53', '23', '17', '18', '19', '1d', '1b', '1c', '21', '1a', '1e', '22', '20', '27', '25', '24', '4e', '4c']) {
    assert.ok(DRYER_CYCLES[code], code);
    for (const tr of [t, tro, ten]) assert.ok(!/laundry\./.test(cycleName(code, tr)!), code);
  }
  assert.equal(cycleName('7f', t), 'Программа 7f');
  assert.equal(minutesText(42, t), '42 мин'); assert.equal(minutesText(60, t), '1 ч'); assert.equal(minutesText(95, t), '1 ч 35 мин');
  assert.deepEqual(Object.keys(words_laundry.ro).sort(), Object.keys(words_laundry.ru).sort());
  assert.deepEqual(Object.keys(words_laundry.en).sort(), Object.keys(words_laundry.ru).sort());
  for (const p of family.profiles) for (const k of [p.titleKey, p.descKey, p.kindKey!, ...p.roles.map(r => r.labelKey)]) assert.ok(k in words_laundry.ru, k);
  assert.equal(lineOf(readLaundry(live, washerInst(), tro, NOW)!, tro, 'ro'), 'Spălare · au rămas 47 min');
});
