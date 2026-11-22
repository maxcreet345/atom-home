// Audit 22.11.2026, C-1: a load the house depends on — the UPS socket, a mains input, the boiler's and the fridge's sockets — is never switched
// OFF with one touch. The question names the consequence; switching it back ON asks nothing; ordinary sockets and a socket's own settings ask nothing.
import test from 'node:test';
import assert from 'node:assert/strict';
import { actionsFor, vitalAsk } from '../src/runtime/actions.ts';
import { confirmWords } from '../src/ui/shell-logic.ts';
import { translator } from '../src/i18n/index.ts';
import type { HomeDevice } from '../src/model/discover.ts';

const dev = (id: string, name: string, state = 'on', kind: HomeDevice['kind'] = 'socket', model: string | null = null): HomeDevice => ({ key: `e:${id}`, kind, name, roomId: 'none', icon: null, photo: null, art: null, favorite: false, order: 0, enabled: true, available: true,
  primary: { id, domain: id.split('.')[0], name, state, attributes: {}, available: true } as never, controls: [], metrics: [], parameters: [], diagnostics: [], manufacturer: null, model, haDeviceId: null, section: null });
const toggle = (d: HomeDevice) => actionsFor(d).find(a => a.id === 'toggle')!;

test('vital loads: which entities ask, by their id and the installer\'s words', () => {
  assert.equal(vitalAsk('switch.hall_ups_plug', 'Розетка ИБП'), 'confirm.vital.ups');
  assert.equal(vitalAsk('switch.any_thing', 'Розетка ИБП'), 'confirm.vital.ups', 'the name alone is enough');
  assert.equal(vitalAsk('switch.entrance_spm_apt8', 'SPM-Main'), 'confirm.vital.mains'); assert.equal(vitalAsk('switch.x', 'Ввод Sonoff SPM-4Relay'), 'confirm.vital.mains');
  assert.equal(vitalAsk('switch.kitchen_boiler_plug', 'Розетка котла'), 'confirm.vital.boiler'); assert.equal(vitalAsk('switch.kitchen_boiler_dhw_enable', 'Котёл'), 'confirm.vital.boiler');
  assert.equal(vitalAsk('switch.kitchen_fridge_plug', 'Розетка холодильника'), 'confirm.vital.fridge');
  assert.equal(vitalAsk('switch.hall_nas_plug', 'Розетка NAS'), 'confirm.vital.network'); assert.equal(vitalAsk('switch.office_router_socket', 'Розетка роутера'), 'confirm.vital.network');
  // not vital: ordinary sockets, words that only contain the letters, a Zigbee «router» switch, a socket's own settings
  for (const [id, name] of [['switch.kitchen_iron_plug', 'Розетка утюга'], ['switch.living_humidifier_plug', 'Розетка увлажнителя'], ['switch.bath_washer_socket', 'Розетка стиральной машины'],
    ['switch.living_slzb_mr3_router', 'Zigbee-роутер (SLZB-MR3)'], ['switch.kids_groups', 'Группы'], ['switch.cups_light', 'Свет над чашками'], ['switch.living_dynasty', 'Dynasty'],
    ['switch.hall_ups_plug_child_lock', 'Розетка ИБП'], ['switch.hall_ups_plug_overcharge_cutoff', 'Розетка ИБП'], ['switch.kitchen_boiler_plug_led', 'Розетка котла'], ['switch.kitchen_boiler_heat_relay_detach', 'Реле отопления котла']])
    assert.equal(vitalAsk(id, name), null, `${id} «${name}»`);
});
test('vital loads: the question is asked on the way off only, names the device and the consequence, and its button says «Выключить»', () => {
  const t = translator('ru'), ups = dev('switch.hall_ups_plug', 'Розетка ИБП');
  const off = toggle(ups); assert.equal(off.confirm, true); assert.equal(off.ask, 'confirm.vital.ups'); assert.equal(off.service, 'toggle');
  const w = confirmWords(off, ups.name, t, null);
  assert.match(w.text, /Выключить «Розетка ИБП»\?/); assert.match(w.text, /включить отсюда уже не получится/); assert.equal(w.yes, 'Выключить'); assert.equal(w.leak, false);
  // back on: no question
  const on = toggle(dev('switch.hall_ups_plug', 'Розетка ИБП', 'off')); assert.equal(on.confirm, false); assert.equal(on.ask, undefined);
  // a device shown as a plain switch, and one known by its model only
  assert.equal(toggle(dev('switch.entrance_spm_apt9', 'Квартира 9', 'on', 'switch')).ask, 'confirm.vital.mains');
  assert.equal(toggle(dev('switch.relay_4', 'Реле 4', 'on', 'switch', 'Sonoff SPM-4Relay')).ask, 'confirm.vital.mains');
  // an ordinary socket goes off at once, as before
  const iron = toggle(dev('switch.kitchen_iron_plug', 'Розетка утюга')); assert.equal(iron.confirm, false); assert.equal(iron.risk, 'normal');
  // every language has every question, with the device's name in it
  for (const lang of ['ru', 'ro', 'en'] as const) for (const k of ['mains', 'ups', 'boiler', 'fridge', 'network']) { const s = translator(lang)(`confirm.vital.${k}` as never, { device: 'X' }); assert.ok(s.includes('X') && !s.startsWith('confirm.'), `${lang} ${k}: ${s}`); }
});
