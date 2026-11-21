// The nas family (src/appliances/nas.*) on the live snapshot of 21.11.2026 (UGREEN DXP2800 in the Hall: two RAID1 pools, 2 HDD + 2 NVMe, two volumes)
// and on copies of it mutated into a warning, a full volume, heat, no answer, a pool of four drives and a registry without the hierarchy.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { family, readNas, sentence as sentence0, nasTileLine as tile0, sizeText as size0 } from '../src/appliances/nas.profiles.ts';
// the words keep a number with its unit on one line (no-break spaces); the assertions read them as plain spaces
const sp = (x: string) => x.replace(/\u00a0/g, ' ');
const sentence = (...a: Parameters<typeof sentence0>) => sp(sentence0(...a)), nasTileLine = (...a: Parameters<typeof tile0>) => sp(tile0(...a)), sizeText = (...a: Parameters<typeof size0>) => sp(size0(...a));
import { devicesFor, suggestBindings, instanceClaims, instanceView, type ProfileInstance } from '../src/model/card-catalog.ts';
import { translator } from '../src/i18n/index.ts';
import { words_nas } from '../src/i18n/words-nas.ts';
import type { Registry } from '../src/model/registry.ts';

const file = resolve(import.meta.dirname, '../../private/fixtures/criuleni-registry-live-20261121.json'), have = existsSync(file);
const base: Registry = have ? JSON.parse(readFileSync(file, 'utf8')) : { areas: [], devices: [], entities: [], states: {} };
const ru = translator('ru'), en = translator('en'), ro = translator('ro');
const P = family.profiles[0];
const nasDevice = (reg: Registry) => devicesFor(reg, P)[0]?.id;
function instance(reg: Registry): ProfileInstance { const deviceId = nasDevice(reg); return { profileId: P.id, profileVersion: P.version, deviceId, bindings: suggestBindings(reg, P, deviceId), placement: ['home'] }; }
const clone = () => structuredClone(base);
const set = (reg: Registry, id: string, state: string, attrs: Record<string, unknown> = {}) => { const s = reg.states[id]; assert.ok(s, `${id} exists`); reg.states[id] = { ...s, state, attributes: { ...s.attributes, ...attrs } }; };
const skip = !have && 'no 21.11 snapshot';

test('the profile finds the one DXP2800 and fills every field with its own entity by suffix', { skip }, () => {
  const devs = devicesFor(base, P); assert.equal(devs.length, 1, 'one NAS of this model'); assert.equal(devs[0].model, 'UGREEN DXP2800');
  const b = suggestBindings(base, P, devs[0].id);
  for (const r of P.roles) { assert.ok(b[r.id], `${r.id} is filled`); assert.ok(r.suffix!.test(b[r.id]), `${r.id}: ${b[r.id]} has the field's suffix`); assert.equal(base.entities.find(e => e.entity_id === b[r.id])?.device_id, devs[0].id, `${r.id}: the NAS's own entity`); }
  assert.ok(b.fanMode.startsWith('select.') && b.powerMode.startsWith('select.'), 'the modes are the selects, not their sensor twins');
  assert.ok(b.reboot.startsWith('button.') && b.shutdown.startsWith('button.'));
  assert.equal(b.cpuTemp, 'sensor.nas_cpu_temperature', 'the temperature, never its status code');
});

test('the live NAS reads «Всё в порядке»: two pools, four drives numbered across the pools, two volumes in 1024s', { skip }, () => {
  const reg = clone(), r = readNas(reg, instance(reg));
  assert.equal(r.available, true); assert.deepEqual(r.issues, [], 'a healthy NAS: CPU at 77° with its own status 0, full-looking pools, dead USB sensors and a 0° GPU are no problems');
  assert.equal(sentence(r, ru), 'Всё в порядке');
  assert.equal(r.pools.length, 2); assert.deepEqual(r.pools.map(p => [p.n, p.level, p.disks.map(d => d.n), p.volumes.map(v => v.n)]), [[1, 'raid1', [1, 2], [1]], [2, 'raid1', [3, 4], [2]]]);
  assert.deepEqual(r.disks.map(d => [d.n, d.type, d.temp]), [[1, 'hdd', 35], [2, 'hdd', reg.states['sensor.nas_pool_1_disk_2_temperature'].state === 'unavailable' ? null : Number(reg.states['sensor.nas_pool_1_disk_2_temperature'].state)], [3, 'nvme', Number(reg.states['sensor.nas_pool_2_disk_1_temperature'].state)], [4, 'nvme', 34]]);
  assert.equal(sizeText(r.volumes[0].free, ru, 'ru'), '3,3 ТБ', 'the NAS\'s own «3.32 TB»'); assert.equal(sizeText(r.volumes[1].free, ru, 'ru'), '387 ГБ');
  assert.equal(r.volumes[0].pct, 26); assert.equal(r.cpu, 29); assert.equal(r.ram, 69); assert.equal(r.uptime, 750025); assert.equal(r.fans.length, 1); assert.equal(r.fanOk, true);
  assert.deepEqual(r.actions.map(a => a.role), ['fanMode', 'powerMode', 'reboot', 'shutdown'], 'the buttons sit in «unknown» on a healthy NAS and are still there');
  assert.ok(r.actions.every(a => a.answers));
  assert.equal(nasTileLine(reg, instance(reg), ru, 'ru'), 'Свободно 3,7 ТБ · всё в порядке');
  assert.equal(nasTileLine(reg, instance(reg), en, 'en'), '3.7 TB free · all is well');
  assert.equal(nasTileLine(reg, instance(reg), ro, 'ro'), 'Liber 3,7 TB · totul e în regulă');
});

test('a drive\'s warning is said by its number, on pool 1 and on pool 2 alike', { skip }, () => {
  let reg = clone(); set(reg, 'sensor.nas_pool_1_disk_2_status', 'Warning');
  let r = readNas(reg, instance(reg)); assert.equal(sentence(r, ru), 'Диск 2: внимание'); assert.equal(nasTileLine(reg, instance(reg), ru, 'ru'), 'Диск 2: внимание');
  reg = clone(); set(reg, 'sensor.nas_pool_2_disk_1_status', 'Warning');
  r = readNas(reg, instance(reg)); assert.equal(sentence(r, ru), 'Диск 3: внимание', 'pool 2\'s first drive is the NAS\'s third, never «Диск 1»');
  reg = clone(); set(reg, 'sensor.nas_pool_1_disk_1_status', 'unavailable');
  r = readNas(reg, instance(reg)); assert.equal(sentence(r, ru), 'Диск 1 не отвечает'); assert.equal(r.issues[0].level, 'alert');
  reg = clone(); set(reg, 'sensor.nas_pool_1_status', 'Degraded'); set(reg, 'sensor.nas_pool_1_disk_2_status', 'Damaged');
  r = readNas(reg, instance(reg)); assert.equal(sentence(r, ru), 'Пул 1: внимание · и ещё 1', 'the worst first and how many more');
});

test('a volume over 90 % is almost full; a pool that is «full» by allocation is not', { skip }, () => {
  const reg = clone(), total = Number(reg.states['sensor.nas_pool_2_volume_1_total_size_raw'].state);
  set(reg, 'sensor.nas_pool_2_volume_1_used_size_raw', String(Math.round(total * 0.95))); set(reg, 'sensor.nas_pool_2_volume_1_available_size_raw', String(Math.round(total * 0.05)));
  const r = readNas(reg, instance(reg)); assert.equal(sentence(r, ru), 'Том 2 почти заполнен: 95 %');
  set(reg, 'sensor.nas_pool_2_volume_1_used_size_raw', String(Math.round(total * 0.9))); set(reg, 'sensor.nas_pool_2_volume_1_available_size_raw', String(Math.round(total * 0.1)));
  assert.equal(readNas(reg, instance(reg)).issues.length, 0, '90 % is not yet «almost full»');
});

test('heat: the NAS\'s own temperature code, a hot drive by its type, a CPU only past 95°', { skip }, () => {
  let reg = clone(); set(reg, 'sensor.nas_temperature_status_code', '1');
  assert.equal(sentence(readNas(reg, instance(reg)), ru), 'NAS перегревается');
  reg = clone(); set(reg, 'sensor.nas_pool_1_disk_1_temperature', '60');
  assert.equal(sentence(readNas(reg, instance(reg)), ru), 'Диск 1 горячий: 60°');
  reg = clone(); set(reg, 'sensor.nas_pool_2_disk_2_temperature', '60');
  assert.equal(readNas(reg, instance(reg)).issues.length, 0, 'an NVMe at 60° is fine');
  reg = clone(); set(reg, 'sensor.nas_cpu_temperature', '90');
  assert.equal(readNas(reg, instance(reg)).issues.length, 0, '90° on an N100 with the NAS saying normal is no alarm');
  set(reg, 'sensor.nas_cpu_temperature', '97'); assert.equal(sentence(readNas(reg, instance(reg)), ru), 'Процессор горячий: 97°');
  reg = clone(); set(reg, 'sensor.nas_server_status', 'Abnormal'); assert.equal(sentence(readNas(reg, instance(reg)), ru), 'NAS сообщает о сбое');
  reg = clone(); set(reg, 'sensor.nas_fan_status_overall', 'Abnormal'); assert.equal(sentence(readNas(reg, instance(reg)), ru), 'Вентилятор: внимание');
});

test('no answer: the NAS, or the house — and nothing else is said then', { skip }, () => {
  const reg = clone(), inst = instance(reg); set(reg, 'sensor.nas_server_status', 'unavailable'); set(reg, 'sensor.nas_pool_1_disk_2_status', 'Warning');
  const r = readNas(reg, inst); assert.equal(r.available, false); assert.equal(sentence(r, ru), 'Нет связи с NAS'); assert.equal(r.issues.length, 1);
  assert.equal(nasTileLine(reg, inst, ru, 'ru'), 'Нет связи с NAS');
  const h = readNas(clone(), inst, false); assert.equal(h.available, false); assert.equal(sentence(h, ru), 'Нет связи с домом');
  delete reg.states['sensor.nas_server_status']; assert.equal(sentence(readNas(reg, inst), ru), 'Нет связи с NAS', 'a status sensor gone from HA');
});

/** a copy of pool 1 with two more drives hung under it: a four-bay pool */
function fourDisks(): Registry {
  const reg = clone(), pool1 = base.devices.find(d => d.via_device_id && base.entities.some(e => e.device_id === d.id && /_pool_1_level$/.test(e.entity_id)))!;
  const tmpl = base.devices.find(d => d.via_device_id === pool1.id && base.entities.some(e => e.device_id === d.id && /_pool_1_disk_1_temperature$/.test(e.entity_id)))!;
  for (const k of [3, 4]) {
    const id = `fake-disk-${k}`; reg.devices.push({ ...tmpl, id, name: `Disk ${k}` });
    for (const e of base.entities.filter(x => x.device_id === tmpl.id)) { const eid = e.entity_id.replace('_pool_1_disk_1_', `_pool_1_disk_${k}_`); reg.entities.push({ ...e, entity_id: eid, device_id: id }); reg.states[eid] = structuredClone(base.states[e.entity_id]); }
  }
  return reg;
}
test('a pool of four drives: found by the hierarchy, numbered on, the next pool after it', { skip }, () => {
  const reg = fourDisks(); set(reg, 'sensor.nas_pool_1_disk_4_status', 'Warning');
  const r = readNas(reg, instance(reg));
  assert.equal(r.disks.length, 6); assert.deepEqual(r.pools.map(p => p.disks.map(d => d.n)), [[1, 2, 3, 4], [5, 6]]);
  assert.equal(sentence(r, ru), 'Диск 4: внимание');
});

test('without the device hierarchy the parts are found by the integration\'s ids under the NAS\'s own prefix', { skip }, () => {
  const reg = clone(); for (const d of reg.devices) d.via_device_id = null;
  const r = readNas(reg, instance(reg));
  assert.equal(r.disks.length, 4); assert.equal(r.volumes.length, 2); assert.equal(r.pools.length, 2); assert.deepEqual(r.pools[1].disks.map(d => d.n), [3, 4]);
  assert.equal(sentence(r, ru), 'Всё в порядке'); assert.equal(sizeText(r.freeTotal, ru, 'ru'), '3,7 ТБ');
});

test('the card is an appliance card of the network category, never claims another device, and its words are complete', { skip }, () => {
  assert.equal(P.renderer, 'appliance'); assert.equal(P.card, 'nas'); assert.equal(P.category, 'network');
  const reg = clone(), inst = instance(reg), v = instanceView(reg, 'x', inst)!; assert.deepEqual(v.incomplete, []); assert.deepEqual(v.lost, []);
  const claims = instanceClaims(reg, { x: inst }), nas = new Set([inst.deviceId, ...reg.devices.filter(d => d.via_device_id === inst.deviceId).map(d => d.id), ...reg.devices.filter(d => reg.devices.some(p => p.via_device_id === inst.deviceId && p.id === d.via_device_id)).map(d => d.id)]);
  for (const id of claims) assert.ok(nas.has(reg.entities.find(e => e.entity_id === id)?.device_id ?? ''), `${id} belongs to the NAS`);
  for (const lang of ['ru', 'ro', 'en'] as const) for (const [k, s] of Object.entries(words_nas[lang])) assert.ok(s.trim(), `${lang}:${k}`);
  for (const k of [P.titleKey, P.descKey, P.kindKey!, ...P.roles.map(r => r.labelKey)]) assert.ok(k in words_nas.ru, k);
});
