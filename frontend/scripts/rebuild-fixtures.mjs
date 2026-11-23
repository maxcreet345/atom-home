// Rebuilds the private fixtures the unit tests and the qa scripts read, from the one house snapshot that survives
// (private/fixtures/criuleni-registry-live-20261121.json). The files of 28.10, 04.11 and 09.11 were captures of Home Assistant on
// those days; they were lost with the old project folder on 21.11.2026 and were never in git (the repository is public). What this
// writes under their names is NOT those captures: it is the 21.11 house cut to the same shape, every registry file says so in
// `_rebuilt`, and REBUILT.txt beside them lists what was written. This file holds patterns and integration keys only — no names,
// hosts or values of the house; everything it writes stays outside git (private/, and the owner's settings beside the checkout).
//
// usage: node scripts/rebuild-fixtures.mjs
//   A file that exists and is not what this script wrote (REBUILT.txt keeps the hash) is a real capture: it is left alone and reported.
// Not rebuilt, because the snapshot cannot give them (the scripts and tests that need them say «fixture missing» and skip):
//   criuleni-registry.json, criuleni-registry-live-20261028.json    the registries of 28.10 (the first under the ids HA had before the house
//                             was moved and renamed, 31.10–02.11): the qa scripts get the two `criuleni-house-*-rebuilt.json` instead, the tests wait
//   traian-registry.json      another house
//   okapi-*-20261109.json     another building (Atom + Okapi)
import { readFileSync, writeFileSync, existsSync, mkdirSync, renameSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
const root = resolve(import.meta.dirname, '..'), out = resolve(root, '../private/fixtures'), clients = resolve(root, '../../clients/criuleni');
const SOURCE = 'criuleni-registry-live-20261121.json', CONFIG = 'criuleni-config-20261121.json';
for (const f of [SOURCE, CONFIG]) if (!existsSync(resolve(out, f))) { console.log(`SKIP rebuild-fixtures: fixture missing: private/fixtures/${f} (the house snapshot everything is cut from)`); process.exit(77); }
const house = JSON.parse(readFileSync(resolve(out, SOURCE), 'utf8'));

// ---- cutting ----
const dom = id => id.slice(0, id.indexOf('.'));
const devById = new Map(house.devices.map(d => [d.id, d]));
/** A device as the panel reads it (model/registry.ts DeviceRow; the name is the user's own where there is one, as runtime/host.ts gives it): no addresses, serials or config entries. */
const device = d => ({ id: d.id, name: d.name_by_user ?? d.name ?? null, name_by_user: d.name_by_user ?? null, model: d.model ?? null, model_id: d.model_id ?? null, manufacturer: d.manufacturer ?? null, area_id: d.area_id ?? null, entry_type: d.entry_type ?? null, disabled_by: d.disabled_by ?? null, via_device_id: d.via_device_id ?? null });
const areaOf = e => e.area_id ?? devById.get(e.device_id)?.area_id ?? null;
/** The entities `keep` chooses, their devices, their states and (asked for) the areas they stand in. */
function cut(keep, { areas = false, wholeDevices = false } = {}) {
  let entities = house.entities.filter(keep);
  if (wholeDevices) { const ids = new Set(entities.map(e => e.device_id).filter(Boolean)); entities = house.entities.filter(e => keep(e) || ids.has(e.device_id)); }
  const devIds = new Set(entities.map(e => e.device_id).filter(Boolean)), devices = house.devices.filter(d => devIds.has(d.id)).map(device);
  const states = Object.fromEntries(entities.filter(e => house.states[e.entity_id]).map(e => [e.entity_id, structuredClone(house.states[e.entity_id])]));
  const used = new Set([...entities.map(areaOf), ...devices.map(d => d.area_id)]);
  return { ...(areas ? { areas: house.areas.filter(a => used.has(a.area_id)).map(a => structuredClone(a)) } : {}), devices, entities: entities.map(e => ({ ...e })), states };
}
const written = [], kept = [], warned = [];
const warn = what => { warned.push(what); console.error(`WARN rebuild-fixtures: ${what}`); };
// A file is this script's own, and may be written over, only while it is still what the script wrote: a registry file by its `_rebuilt` mark,
// any file by the hash kept beside its name in REBUILT.txt (name, sha256, note — tab-separated). Anything else under that name is a capture
// somebody put there (a recovered backup, say) and is never touched. The list is written first and every file through a rename, so a run
// that is cut short leaves no rebuilt file that looks like a capture.
const BY = 'frontend/scripts/rebuild-fixtures.mjs', sha = text => createHash('sha256').update(text).digest('hex');
const listed = dir => { const p = resolve(dir, 'REBUILT.txt'); return new Map(existsSync(p) ? readFileSync(p, 'utf8').split('\n').filter(l => l && !l.startsWith('#')).map(l => { const [name, hash, ...note] = l.split('\t'); return [name, { hash, note: note.join(' ') }]; }) : []); };
const atomic = (path, text) => { writeFileSync(path + '.tmp', text); renameSync(path + '.tmp', path); };
const marked = text => { try { return JSON.parse(text)._rebuilt?.by === BY; } catch { return false; } };
function put(dir, name, note, text, count) {
  const path = resolve(dir, name), list = listed(dir), now = existsSync(path) ? readFileSync(path, 'utf8') : null;
  if (now !== null && !(list.get(name)?.hash === sha(now) || marked(now))) { kept.push(name); return false; }
  mkdirSync(dir, { recursive: true }); list.set(name, { hash: sha(text), note: note.replace(/[\t\n\r]+/g, ' ') });
  atomic(resolve(dir, 'REBUILT.txt'), `# Written by atom-home/${BY} from ${SOURCE}: NOT the captures of the dates in their names.\n# name, sha256 of what was written, what it is (tab-separated). A file whose content no longer matches is left alone by the next run.\n` + [...list].map(([n, x]) => `${n}\t${x.hash}\t${x.note}`).join('\n') + '\n');
  atomic(path, text); written.push(`${name}${count ? ': ' + count : ''}`); return true;
}
function write(name, note, data) {
  if (!data.entities.length) { warn(`${name}: the cut is empty — the snapshot has none of what it is made of; not written`); return false; }
  return put(out, name, note, JSON.stringify({ _rebuilt: { from: SOURCE, by: BY, note }, ...scrub(data) }), `${data.entities.length} entities, ${data.devices.length} devices`);
}
const createdBy = (d, day) => d.created_at == null || d.created_at * 1000 < Date.parse(day + 'T22:00:00Z'); // the end of that day in the house (UTC+2)
const deviceOf = e => devById.get(e.device_id);
/** An access token is nobody's to keep: the attribute goes, and a picture's address keeps its place with the token blanked (`?token=x`, as camera-fixture.mjs writes its own). Every file passes here. */
const scrub = data => { for (const s of Object.values(data.states)) for (const [k, v] of Object.entries(s.attributes ?? {})) { if (/token/i.test(k)) delete s.attributes[k]; else if (typeof v === 'string' && /[?&]token=/.test(v)) s.attributes[k] = v.replace(/([?&]token=)[^&#]*/g, '$1x'); } return data; };
/** No Home Assistant stands behind the preview: a room's or a person's picture HA would serve (/api/image/…) is a 404 on every page there. */
const noHaPictures = data => { for (const a of data.areas ?? []) if (typeof a.picture === 'string' && a.picture.startsWith('/api/')) a.picture = null;
  for (const s of Object.values(data.states)) for (const [k, v] of Object.entries(s.attributes ?? {})) if (k === 'entity_picture' && typeof v === 'string' && v.startsWith('/api/image/')) delete s.attributes[k]; return data; };
/** The moment a capture was taken at, where the tests and cards written over it name it: these states only, each with its source beside it. A state the snapshot has not got is said aloud. */
const moment = (data, states) => { for (const [id, state] of Object.entries(states)) { if (data.states[id]) data.states[id] = { ...data.states[id], state }; else warn(`the moment's ${id} is not in the snapshot`); } };

// ---- the heating (tests/heating, classic-climate, round2-heatvac; scripts/cards/heating.mjs) ----
// What model/heating.ts reads: the heads and the wall thermostat, the heating's helpers, timers and template sensors, the boiler,
// the windows' contacts, the rooms' own temperature sensors, the weather. No security panel: the tests add theirs.
const HEATING = /^(climate\.|input_[a-z]+\.([a-z]+_)?heating_|timer\.[a-z]+_heating_|sensor\.heating_|sensor\.[a-z]+_heating_desired$|[a-z_]+\.kitchen_boiler_|[a-z_]+\.[a-z]+_trv_|binary_sensor\.[a-z]+_window(_[a-z]+)?_contact$|sensor\.[a-z]+_(climate|co2)_temperature$|weather\.)/;
// Three things the 21.11 house has that the morning of 09.11 had not; without them undone the file is not «the heating of 09.11» the tests name:
//   1. the hysteresis helpers were made later that day with 1.21.1 (book/06-dashboards/ATOM-HOME-TASKS.md; scripts/cards/heating.mjs adds its own);
//   2. the kitchen's third window contact (a BLE sensor named later): tests/heating.test.ts records two for the kitchen of that morning;
//   3. the boiler's two pressure thresholds are written «off»: the cards and tests of that morning start from a boiler with no pressure alarm
//      (an inference from their baselines, not a recorded value).
const LATER = /^(input_number\.heating_hyst_|binary_sensor\.kitchen_window_left_)/, QUIET = /^binary_sensor\.kitchen_boiler_pressure_(low|high)$/;
const quietBoiler = data => { for (const id of Object.keys(data.states)) if (QUIET.test(id)) data.states[id] = { ...data.states[id], state: 'off' }; return data; };
// The cards and their scripts were written over the house of 28.10–09.11: a device HA got after 09.11 is in none of them (an inference from their checks).
const by0911 = e => !deviceOf(e) || createdBy(deviceOf(e), '2026-11-09');
{ const h = quietBoiler(cut(e => HEATING.test(e.entity_id) && !LATER.test(e.entity_id) && !e.disabled_by));
  write('criuleni-heating-20261109.json', 'the heating as the 21.11 snapshot has it, not the capture of the morning of 09.11; set back: no hysteresis helpers, no third kitchen window, the boiler pressure thresholds off', h); }

// ---- the robot vacuum (tests/round2-heatvac, audit-cameras-vacuum-cards; scripts/cards/vacuum.mjs) ----
// The snapshot's entity rows carry neither the integration's key (translation_key) nor HA's link of the robot's rooms: both are put back here.
// The keys are the Roborock integration's own, matched to this house's entity ids by their ending; anything else of the robot keeps its ending as its key.
const ROBOT = house.entities.find(e => e.platform === 'roborock' && dom(e.entity_id) === 'vacuum' && !e.disabled_by);
if (ROBOT) {
  const P = ROBOT.entity_id.slice('vacuum.'.length);
  const KEY = { cleaning: 'in_cleaning', charging: 'in_charging', error: 'vacuum_error', cleaning_progress: 'clean_percent', dock_clean_water_box: 'clean_box_empty', dock_dirty_water_box: 'dirty_box_full', dock_cleaning_fluid: 'clean_fluid_empty',
    dock_error: 'dock_error', dock_mop_drying_remaining_time: 'mop_drying_remaining_time', dock_empty_mode: 'dust_collection_mode', dock_child_lock: 'child_lock', dock_dust_emptying: 'dust_emptying', dock_mop_drying: 'mop_drying', dock_mop_washing: 'mop_washing',
    do_not_disturb: 'dnd_switch', do_not_disturb_begin: 'dnd_start_time', do_not_disturb_end: 'dnd_end_time', off_peak_charging: 'off_peak_switch', dock_strainer_time_left: 'strainer_time_left', dock_reset_strainer_consumable: 'reset_dock_strainer_consumable' };
  const v = cut(e => e.platform === 'roborock' && !e.disabled_by);
  for (const e of v.entities) { const tail = e.entity_id.slice(e.entity_id.indexOf('.') + 1); e.translation_key = dom(e.entity_id) === 'vacuum' ? null : tail.startsWith(P + '_') ? (KEY[tail.slice(P.length + 1)] ?? tail.slice(P.length + 1)) : null; }
  // the robot's rooms in its own order, as its «current room» sensor lists them; the ids are the ones scripts/cards/vacuum.mjs links to areas (0_8 is on no list)
  const names = v.states[`sensor.${P}_current_room`]?.attributes.options ?? [], ids = ['0_1', '0_2', '0_3', '0_4', '0_5', '0_6', '0_7', '0_9', '0_10'];
  if (names.length !== ids.length) warn(`the robot lists ${names.length} rooms, scripts/cards/vacuum.mjs links ${ids.length}: the rooms list is left empty`);
  const kitchen = names.find(n => /кух|kitchen|bucăt/i.test(n)); if (!kitchen) warn('the robot has no room called a kitchen: its «current room» is left as the snapshot has it');
  // «captured while it cleaned the kitchen» (scripts/cards/vacuum.mjs), «the run at 91 %» (tests/audit-cameras-vacuum-cards.test.ts), the volume
  // «100 % in this snapshot» (scripts/qa-vacuum.mjs): on 21.11 the robot stands on its dock
  moment(v, { [ROBOT.entity_id]: 'cleaning', [`sensor.${P}_status`]: 'cleaning', [`binary_sensor.${P}_cleaning`]: 'on', [`binary_sensor.${P}_charging`]: 'off', [`sensor.${P}_cleaning_progress`]: '91', ...(kitchen ? { [`sensor.${P}_current_room`]: kitchen } : {}), [`number.${P}_volume`]: '100' });
  write('criuleni-vacuum-20261109.json', 'the robot as the 21.11 snapshot has it, not the capture of 09.11; put back by a table: translation keys, the rooms list, and the moment of the capture (cleaning the kitchen, 91 %); the map picture is not here', { ...v, segments: names.length === ids.length ? names.map((name, i) => ({ id: ids[i], name })) : [] });
} else warn('no Roborock vacuum in the snapshot: criuleni-vacuum-20261109.json is not written');

// ---- the rooms (tests/appliance; scripts/cards/rooms.mjs): every enabled entity that stands in a room, without diagnostics ----
{ const r = quietBoiler(cut(e => !e.disabled_by && e.entity_category !== 'diagnostic' && areaOf(e) !== null && by0911(e) && !LATER.test(e.entity_id)));
  write('criuleni-rooms-20261109.json', 'the rooms as the 21.11 snapshot has them (devices HA knew by 09.11), not the capture of 09.11 13:18; pictures served by HA are left out, the boiler pressure thresholds off', noHaPictures({ areas: house.areas.map(a => structuredClone(a)), ...r })); }

// ---- the cameras (tests/stage5, stage8, stage9; scripts/camera-fixture.mjs): the entrance camera and the doorbell as they stood on 04.11 ----
{ const c = cut(e => /^[a-z_]+\.entrance_(camera|doorbell)(_|$)/.test(e.entity_id) && !/^camera\.entrance_doorbell_/.test(e.entity_id) && !e.disabled_by && (!deviceOf(e) || createdBy(deviceOf(e), '2026-11-04')));
  const hall = house.areas.filter(a => c.devices.some(d => d.area_id === a.area_id) || a.area_id === 'podezd'); hall.sort((a, b) => (b.area_id === 'podezd') - (a.area_id === 'podezd'));
  // 04.11 as tests/stage5 and stage8 read it: the camera on and following a person, nobody at the door; the doorbell without its recording
  // cameras («the snapshot predates the recording camera»), on a healthy battery (its level is recorded nowhere: «100» is a stand-in) and its
  // battery row not yet hidden (scripts/camera-fixture.mjs hides it itself for the days after the mains power came)
  moment(c, { 'switch.entrance_camera_power': 'on', 'camera.entrance_camera': 'idle', 'binary_sensor.entrance_doorbell_motion': 'off', 'sensor.entrance_doorbell_battery': '100', 'select.entrance_camera_hdr': 'Выкл' /* scripts/qa-camera.mjs: «HDR Выкл» */ });
  for (const e of c.entities) if (e.entity_id === 'sensor.entrance_doorbell_battery') e.hidden_by = null;
  write('criuleni-camera-20261104.json', 'the entrance camera and the doorbell as the 21.11 snapshot has them (devices HA knew by 04.11), not the capture of 04.11; set back: the camera on, nobody at the door, no recording cameras of the doorbell, its battery healthy and not hidden', { areas: hall.map(a => structuredClone(a)), ...c }); }

// ---- the two houses the qa scripts run on in place of the lost registries of 28.10 ----
// Written under their own names, not as those registries: scripts/fixtures.mjs hands them to the scripts that ask for the lost files, and says so;
// the tests that need the two captures keep waiting for them.
//   criuleni-house-under-cards-rebuilt.json  for `criuleni-registry-live-20261028.json`: the house under the cards' mock layers (card-preview.mjs, qa-air, qa-feeder, qa-layout)
//   criuleni-house-rebuilt.json              for `criuleni-registry.json`: the whole house; its readers (preview-server.mjs, qa-live, qa-audit, …) add the feeder only
// The cards draw the cameras, the energy meters, the air sensors and the feeder themselves, under this house's ids: what they add is taken
// out here, or it would stand twice. (The 28.10 registry they were written over did not have those devices yet.)
if (existsSync(resolve(out, 'criuleni-camera-20261104.json'))) {
  const cam = JSON.parse(readFileSync(resolve(out, 'criuleni-camera-20261104.json'), 'utf8')), { card } = await import('./cards/cameras.mjs');
  const bare = { areas: house.areas.map(a => structuredClone(a)), devices: structuredClone(cam.devices), entities: structuredClone(cam.entities), states: structuredClone(cam.states) };
  const drawn = card.build(bare, card.scenarios.quiet, new Date()).snapshot, has = new Set(cam.entities.map(e => e.entity_id)), hasDev = new Set(cam.devices.map(d => d.id));
  const gone = new Set(drawn.entities.map(e => e.entity_id).filter(id => !has.has(id))), goneDev = new Set(drawn.devices.map(d => d.id).filter(id => !hasDev.has(id)));
  // …nor the alarm panel: «no security „Отпуск“ in this house yet» (scripts/qa-heating.mjs); the cards that need a guard add their own (cards/heating.mjs, cards/security.mjs)
  for (const e of house.entities) if (e.entity_id.startsWith('alarm_control_panel.')) gone.add(e.entity_id);
  const entities = house.entities.filter(e => !gone.has(e.entity_id) && !goneDev.has(e.device_id) && by0911(e) && !LATER.test(e.entity_id)), ids = new Set(entities.map(e => e.entity_id)), late = new Set(house.entities.filter(e => !by0911(e) || LATER.test(e.entity_id)).map(e => e.entity_id));
  const states = Object.fromEntries(Object.entries(house.states).filter(([id]) => ids.has(id) || (!gone.has(id) && !late.has(id) && !house.entities.some(e => e.entity_id === id))).map(([id, s]) => [id, structuredClone(s)]));
  write('criuleni-house-under-cards-rebuilt.json', 'the 21.11 house without what the cards\' mock layers draw themselves (cameras, energy, air, feeder), without the alarm panel and the devices HA got after 09.11 and without pictures served by HA, the boiler pressure thresholds off; stands in for the lost criuleni-registry-live-20261028.json in the qa scripts only', quietBoiler(noHaPictures({ areas: house.areas.map(a => structuredClone(a)), devices: house.devices.filter(d => !goneDev.has(d.id) && createdBy(d, '2026-11-09')).map(device), entities: entities.map(e => ({ ...e })), states, floors: house.floors ?? [] })));
}
// the whole house as the snapshot has it, without the feeder (feeder-fixture.mjs draws its own under the same ids) and without pictures served by HA
{ const { addFeeder } = await import('./feeder-fixture.mjs'), drawn = addFeeder({ areas: house.areas.map(a => structuredClone(a)), devices: [], entities: [], states: {} });
  const gone = new Set(drawn.entities.map(e => e.entity_id)), goneDev = new Set(drawn.devices.map(d => d.id)), left = new Set(house.entities.filter(e => gone.has(e.entity_id) || goneDev.has(e.device_id)).map(e => e.entity_id));
  const states = Object.fromEntries(Object.entries(house.states).filter(([id]) => !left.has(id) && !gone.has(id)).map(([id, s]) => [id, structuredClone(s)]));
  write('criuleni-house-rebuilt.json', 'the 21.11 house without the feeder (drawn by feeder-fixture.mjs) and without pictures served by HA; stands in for the lost criuleni-registry.json in the qa scripts only', noHaPictures({ areas: house.areas.map(a => structuredClone(a)), devices: house.devices.filter(d => !goneDev.has(d.id)).map(device), entities: house.entities.filter(e => !left.has(e.entity_id)).map(e => ({ ...e })), states, floors: house.floors ?? [] })); }

// ---- the owner's settings of 28.10: a house that had never used the card catalog. The settings of 21.11 are the same kind (no card, no room
// or device override); the robot's two uploaded pictures (1.23.x, files HA serves) and the electricity tariffs (1.25.0) came later and are not carried over. ----
{ const c = JSON.parse(readFileSync(resolve(out, CONFIG), 'utf8')), o = c.modules?.vacuum?.options;
  delete c.energy;
  if (o) { delete o.robot; delete o.dock; if (!Object.keys(o).length) delete c.modules.vacuum.options; if (!Object.keys(c.modules.vacuum).length) delete c.modules.vacuum; }
  put(clients, 'atom-home-config-20261028.json', 'private/fixtures/criuleni-config-20261121.json without the robot\'s uploaded pictures and the tariffs, not the settings of 28.10', JSON.stringify(c)); }

console.log(`rebuilt from ${SOURCE}:`); for (const w of written) console.log('  ' + w);
for (const k of kept) console.log(`  kept (not this script's own any more — a real capture, or edited by hand): ${k}`);
if (warned.length) process.exitCode = 1;
