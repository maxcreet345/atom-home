// The «speaker» family (src/appliances/speaker.*) on the Criuleni snapshot of 21.11.2026: four Yandex Stations (Max, Lite, two Mini 2) and a
// Mini 2 reflashed as an Assist satellite. Two Minis of one model are two cards, and a command of card A never reaches B; the tile says
// «Тишина», «артист — трек», «Нет связи»; the station's socket is an optional field the card works without; controls follow the player's own
// supported features; the satellite's settings are an administrator's.
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import type { Registry } from '../src/model/registry.ts';
import { PROFILES, devicesFor, suggestBindings, instanceView, instanceClaims, candidates, searchProfiles, type ProfileInstance } from '../src/model/card-catalog.ts';
import { STATION_MAX, STATION_LITE, STATION_MINI2, PULSAR_MINI2, SPEAKER_PROFILES, readSpeaker, speakerCommands, speakerLine, family, F, SAY_MAX, tidyName, whenText, calendarTime, type Step } from '../src/appliances/speaker.profiles.ts';

import { words_speaker } from '../src/i18n/words-speaker.ts';
import { translator } from '../src/i18n/index.ts';

const FIX = new URL('../../private/fixtures/criuleni-registry-live-20261121.json', import.meta.url), have = existsSync(FIX);
const live: Registry = have ? JSON.parse(readFileSync(FIX, 'utf8')) : { areas: [], devices: [], entities: [], states: {}, floors: [] } as unknown as Registry;
const t = translator('ru');
const inst = (profileId: string, deviceId: string, bindings: Record<string, string>): ProfileInstance => ({ profileId, profileVersion: '1.0.0', deviceId, bindings, placement: ['home', 'room'] });
const deviceOf = (reg: Registry, entityId: string) => reg.entities.find(e => e.entity_id === entityId)?.device_id ?? null;
/** every command a card can build, with every argument its controls may pass */
function allSteps(i: Pick<ProfileInstance, 'bindings'>): Step[] {
  const c = speakerCommands(i);
  return [c.playPause(), c.play(), c.pause(), c.next(), c.prev(), c.volume(40), c.mute(true), c.mute(false), c.shuffle(true), c.repeat('one'), c.say('включи джаз', 'command'), c.say('привет', 'text'),
    c.equalizer('rock'), c.plug(true), c.plug(false), c.mics(false), c.ring(true), c.wakeWord('Алиса'), c.visual('Off'), c.wakeSound(true), c.voiceLight(true), c.nearest(false), c.restart()].flat();
}
/** the snapshot with the kids' Mini back online (it is unavailable on 21.11) */
function bothMinisUp(): Registry { const reg = structuredClone(live); for (const id of Object.keys(reg.states)) { const e = reg.entities.find(x => x.entity_id === id); const dev = e && reg.devices.find(d => d.id === e.device_id); if (dev?.model === STATION_MINI2.models[0] && id.startsWith('media_player.') && reg.states[id].state === 'unavailable') reg.states[id] = { ...reg.states[id], state: 'idle', attributes: { ...reg.states[id].attributes, volume_level: 0.3, is_volume_muted: false, supported_features: 515981 } }; } return reg; }

test('words: ru, ro and en have the same keys and none is empty', () => {
  const k = (o: Record<string, string>) => Object.keys(o).sort();
  assert.deepEqual(k(words_speaker.ro), k(words_speaker.ru)); assert.deepEqual(k(words_speaker.en), k(words_speaker.ru));
  for (const lang of ['ru', 'ro', 'en'] as const) for (const [key, v] of Object.entries(words_speaker[lang])) assert.ok(v.trim(), `${lang}:${key}`);
  for (const p of SPEAKER_PROFILES) for (const key of [p.titleKey, p.descKey, p.kindKey!, ...p.roles.flatMap(r => [r.labelKey, r.hintKey].filter((x): x is string => !!x))]) assert.ok(key in words_speaker.ru, key);
});

test('profiles: four, in «Колонки», drawn by the speaker family, found by search; the catalog has them', () => {
  assert.equal(SPEAKER_PROFILES.length, 4);
  for (const p of SPEAKER_PROFILES) { assert.equal(p.category, 'speakers'); assert.equal(p.renderer, 'appliance'); assert.equal(p.card, 'speaker'); assert.ok(PROFILES.includes(p)); assert.ok(p.roles.find(r => r.id === p.anchor)?.required); assert.equal(p.roles.filter(r => r.required).length, 1, `${p.id}: only the main field is required`); }
  const found = (q: string) => searchProfiles(q, p => t(p.titleKey as never), { category: 'speakers' }).map(p => p.id);
  assert.ok(found('мини 2').includes(STATION_MINI2.id)); assert.ok(found('max').includes(STATION_MAX.id)); assert.ok(found('лайт').includes(STATION_LITE.id)); assert.ok(found('pulsar').includes(PULSAR_MINI2.id));
  // the socket is never «the same appliance through another integration»: it would take the socket's whole device off the panel
  for (const p of SPEAKER_PROFILES) for (const r of p.roles) assert.notEqual(r.sibling, true, `${p.id}.${r.id}`);
  // `_wake_word$` is the satellite's first wake word, not `_wake_word_2`
  assert.ok(PULSAR_MINI2.roles.find(r => r.id === 'wakeWord')!.suffix!.test('select.x_wake_word')); assert.ok(!PULSAR_MINI2.roles.find(r => r.id === 'wakeWord')!.suffix!.test('select.x_wake_word_2'));
});

test('this house: each model finds its own devices; two Mini 2 are two devices with their own players', { skip: !have && 'no house fixture' }, () => {
  assert.equal(devicesFor(live, STATION_MAX).length, 1); assert.equal(devicesFor(live, STATION_LITE).length, 1); assert.equal(devicesFor(live, PULSAR_MINI2).length, 1);
  const minis = devicesFor(live, STATION_MINI2); assert.equal(minis.length, 2);
  const players = minis.map(d => suggestBindings(live, STATION_MINI2, d.id).player);
  assert.ok(players.every(Boolean)); assert.notEqual(players[0], players[1]);
  for (const [i, d] of minis.entries()) assert.equal(deviceOf(live, players[i]!), d.id);
  // the kitchen Mini: the integration disabled all but the player — the card is complete with it alone
  const kitchen = minis.find(d => suggestBindings(live, STATION_MINI2, d.id).equalizer === undefined)!; assert.ok(kitchen, 'one Mini has only its player');
  const v = instanceView(live, 'k', inst(STATION_MINI2.id, kitchen.id, suggestBindings(live, STATION_MINI2, kitchen.id)))!; assert.deepEqual(v.incomplete, []);
  // the Max: player, equalizer, alarms by their own suffixes; the plug named after the station is its own (1.36.1; a plug called otherwise is the installer's choice)
  const max = devicesFor(live, STATION_MAX)[0], b = suggestBindings(live, STATION_MAX, max.id);
  assert.ok(b.player && b.equalizer?.endsWith('_equalizer') && b.alarms?.endsWith('_alarms')); assert.equal(b.plug, 'switch.living_yandex_max_plug'); assert.equal(b.power, 'sensor.living_yandex_max_plug_power');
  // …and the plug field offers the socket of its room first
  const plugs = candidates(live, STATION_MAX.roles.find(r => r.id === 'plug')!, { deviceId: max.id, areaId: max.areaId });
  assert.ok(plugs.length > 1); assert.equal(plugs.find(c => c.areaId === max.areaId) !== undefined, true);
  // the satellite: its own player, microphones, ring, the hardware mute (a diagnostic) and the settings by their suffixes
  const sat = devicesFor(live, PULSAR_MINI2)[0], sb = suggestBindings(live, PULSAR_MINI2, sat.id);
  for (const role of ['satellite', 'player', 'mics', 'hwMute', 'ring', 'wakeWord', 'wakeSound', 'voiceLight', 'visual', 'nearest', 'restart']) assert.ok(sb[role], role);
  assert.ok(!sb.wakeWord.endsWith('_2'));
});

test('two Mini 2 cards: every command of card A targets only A\'s entities, never B\'s', { skip: !have && 'no house fixture' }, () => {
  const reg = bothMinisUp(), [da, db] = devicesFor(reg, STATION_MINI2);
  const A = inst(STATION_MINI2.id, da.id, suggestBindings(reg, STATION_MINI2, da.id)), Bi = inst(STATION_MINI2.id, db.id, suggestBindings(reg, STATION_MINI2, db.id));
  const bEntities = new Set(reg.entities.filter(e => e.device_id === db.id).map(e => e.entity_id)), aEntities = new Set(reg.entities.filter(e => e.device_id === da.id).map(e => e.entity_id));
  const stepsA = allSteps(A), stepsB = allSteps(Bi);
  assert.ok(stepsA.length >= 8 && stepsB.length >= 8);
  for (const [, , data] of stepsA) { assert.ok(!bEntities.has(String(data.entity_id)), `A sent to ${data.entity_id}`); assert.ok(aEntities.has(String(data.entity_id)), `A's ${data.entity_id} is its own`); }
  for (const [, , data] of stepsB) assert.ok(!aEntities.has(String(data.entity_id)), `B sent to ${data.entity_id}`);
  // and each card reads its own player: B muted and loud does not change A
  reg.states[Bi.bindings.player] = { ...reg.states[Bi.bindings.player], attributes: { ...reg.states[Bi.bindings.player].attributes, volume_level: 0.9, is_volume_muted: true } };
  const ra = readSpeaker(reg, A), rb = readSpeaker(reg, Bi);
  assert.notEqual(ra.volume, 0.9); assert.equal(rb.volume, 0.9); assert.equal(rb.muted, true); assert.notEqual(ra.muted, true);
});

test('the tile line: silent, playing «артист — трек», paused, Alice listening, unavailable, house offline', { skip: !have && 'no house fixture' }, () => {
  const reg = structuredClone(live), max = devicesFor(reg, STATION_MAX)[0], i = inst(STATION_MAX.id, max.id, suggestBindings(reg, STATION_MAX, max.id)), p = i.bindings.player;
  const line = () => family.tileLine!(reg, i, t, 'ru');
  // the Max is «paused» with an empty title on 21.11: nothing plays, it is silent (not «Пауза · »)
  assert.equal(reg.states[p].state, 'paused'); assert.equal(line(), 'Тишина');
  reg.states[p] = { ...reg.states[p], state: 'playing', attributes: { ...reg.states[p].attributes, media_title: 'Группа крови', media_artist: 'Кино', entity_picture: 'https://avatars.yandex.net/cover/400x400', supported_features: 515981 | F.NEXT | F.PREVIOUS } };
  assert.equal(line(), 'Кино — Группа крови');
  const r = readSpeaker(reg, i); assert.equal(r.cover, 'https://avatars.yandex.net/cover/400x400'); assert.ok(r.can.next && r.can.prev && r.can.playPause && r.can.volume && r.can.say);
  reg.states[p] = { ...reg.states[p], state: 'paused' }; assert.equal(line(), 'Пауза · Кино — Группа крови');
  reg.states[p] = { ...reg.states[p], state: 'playing', attributes: { ...reg.states[p].attributes, alice_state: 'LISTENING' } }; assert.equal(line(), 'Алиса слушает');
  reg.states[p] = { ...reg.states[p], state: 'unavailable', attributes: { friendly_name: 'x' } }; assert.equal(line(), 'Нет связи');
  assert.equal(readSpeaker(reg, i).cover, null);
  // the house offline: the card says no connection, never the last track as «now»
  const up = structuredClone(live); assert.equal(speakerLine(readSpeaker(up, i, false), t), 'Нет связи');
  // the kids' Mini is unavailable in the snapshot
  const kids = devicesFor(live, STATION_MINI2).find(d => live.states[suggestBindings(live, STATION_MINI2, d.id).player!]?.state === 'unavailable')!;
  assert.equal(family.tileLine!(live, inst(STATION_MINI2.id, kids.id, suggestBindings(live, STATION_MINI2, kids.id)), t, 'ru'), 'Нет связи');
  // other languages
  assert.equal(family.tileLine!(live, i, translator('ro'), 'ro'), 'Liniște'); assert.equal(family.tileLine!(live, i, translator('en'), 'en'), 'Silent');
});

test('controls follow the player\'s own features: idle Yandex has no next/previous; the equalizer «unknown» is not chosen', { skip: !have && 'no house fixture' }, () => {
  const lite = devicesFor(live, STATION_LITE)[0], i = inst(STATION_LITE.id, lite.id, suggestBindings(live, STATION_LITE, lite.id)), r = readSpeaker(live, i);
  assert.equal(r.phase, 'silent'); assert.equal(r.can.next, false); assert.equal(r.can.prev, false); assert.equal(r.can.playPause, true); assert.equal(r.can.volume, true); assert.equal(r.volume, 0.7);
  assert.ok(r.eq && r.eq.value === null && r.eq.options.includes('rock'));
  assert.ok(r.alarm && r.alarm.next === null && !r.alarm.ringing);
  // a station alarm in the calendar: its time and its words
  const reg = structuredClone(live); reg.states[i.bindings.alarms] = { ...reg.states[i.bindings.alarms], attributes: { ...reg.states[i.bindings.alarms].attributes, start_time: '2026-11-22 07:00:00', message: 'Будильник' } };
  const a = readSpeaker(reg, i).alarm!; assert.ok(a.next && a.next.message === 'Будильник');
  assert.match(whenText(Date.parse('2026-11-22T07:00:00+02:00'), Date.parse('2026-11-21T20:00:00+02:00'), 'ru', t, 'Europe/Chisinau'), /^завтра 07:00$/);
});

test('«Сказать Алисе»: play_media with command or text, cut to the cloud\'s 100 characters, nothing for an empty phrase', () => {
  const c = speakerCommands({ bindings: { player: 'media_player.a' } });
  assert.deepEqual(c.say('  включи джаз ', 'command'), [['media_player', 'play_media', { entity_id: 'media_player.a', media_content_id: 'включи джаз', media_content_type: 'command' }]]);
  assert.equal((c.say('я'.repeat(150), 'text')[0][2].media_content_id as string).length, SAY_MAX);
  assert.deepEqual(c.say('   ', 'command'), []);
  assert.deepEqual(c.volume(55), [['media_player', 'volume_set', { entity_id: 'media_player.a', volume_level: 0.55 }]]);
  // a field the card has no binding for sends nothing at all
  assert.deepEqual(c.plug(false), []); assert.deepEqual(c.equalizer('rock'), []); assert.deepEqual(speakerCommands({ bindings: {} }).playPause(), []);
});

test('the station\'s socket is optional: without it nothing about power; with it the reading, and its switch is a command of its own', { skip: !have && 'no house fixture' }, () => {
  const max = devicesFor(live, STATION_MAX)[0], { plug: _plug, power: _power, ...b } = suggestBindings(live, STATION_MAX, max.id); void _plug; void _power; // the card without its socket
  const bare = readSpeaker(live, inst(STATION_MAX.id, max.id, b)); assert.equal(bare.plug, null); assert.equal(bare.watts, null);
  const plug = candidates(live, STATION_MAX.roles.find(r => r.id === 'plug')!, { deviceId: max.id, areaId: max.areaId }).find(c => c.areaId === max.areaId && /plug/.test(c.id) && !/_(led|auto_)/.test(c.id))!;
  const power = candidates(live, STATION_MAX.roles.find(r => r.id === 'power')!, { deviceId: max.id, areaId: max.areaId }).find(c => deviceOf(live, c.id) === deviceOf(live, plug.id))!;
  assert.ok(plug && power, 'the room\'s socket and its power are offered');
  const withPlug = inst(STATION_MAX.id, max.id, { ...b, plug: plug.id, power: power.id }), r = readSpeaker(live, withPlug);
  assert.equal(r.plug?.on, true); assert.ok(r.watts !== null && r.watts > 0);
  assert.deepEqual(speakerCommands(withPlug).plug(false), [['switch', 'turn_off', { entity_id: plug.id }]]);
  // the card takes the bound socket's switch off the auto-made cards (instanceClaims), not the socket's other entities
  const claims = instanceClaims(live, { a: withPlug }); assert.ok(!claims.has(plug.id), 'the plug keeps its own tile (bound on purpose, another device)'); assert.ok(claims.has(b.player!));
  // the view is complete either way
  assert.deepEqual(instanceView(live, 'a', withPlug)!.incomplete, []); assert.deepEqual(instanceView(live, 'b', inst(STATION_MAX.id, max.id, b))!.incomplete, []);
});

test('the satellite: what Assist does in words, microphones off said first, a hardware mute is read-only', { skip: !have && 'no house fixture' }, () => {
  const sat = devicesFor(live, PULSAR_MINI2)[0], i = inst(PULSAR_MINI2.id, sat.id, suggestBindings(live, PULSAR_MINI2, sat.id));
  const line = (reg: Registry) => family.tileLine!(reg, i, t, 'ru');
  assert.equal(line(live), 'Готова слушать');
  const r = readSpeaker(live, i); assert.equal(r.satellite, true); assert.equal(r.can.say, false); assert.equal(r.can.next, false); assert.equal(r.can.volume, true); assert.equal(r.mics?.on, true); assert.equal(r.hwMute, false);
  const reg = structuredClone(live); reg.states[i.bindings.satellite] = { ...reg.states[i.bindings.satellite], state: 'listening' }; assert.equal(line(reg), 'Слушает');
  reg.states[i.bindings.hwMute] = { ...reg.states[i.bindings.hwMute], state: 'on' }; assert.equal(line(reg), 'Микрофоны выключены');
  reg.states[i.bindings.satellite] = { ...reg.states[i.bindings.satellite], state: 'unavailable' }; assert.equal(line(reg), 'Нет связи');
  // its commands: its own switch, light and button
  const c = speakerCommands(i); assert.deepEqual(c.mics(false), [['switch', 'turn_off', { entity_id: i.bindings.mics }]]); assert.deepEqual(c.ring(true), [['light', 'turn_on', { entity_id: i.bindings.ring }]]); assert.deepEqual(c.restart(), [['button', 'press', { entity_id: i.bindings.restart }]]);
});

test('a calendar\'s zone-less time is the house\'s wall time', () => {
  assert.equal(calendarTime('2026-11-22 07:00:00', 'Europe/Chisinau'), Date.parse('2026-11-22T07:00:00+02:00'));
  assert.equal(calendarTime('2026-11-22T07:00:00+00:00', 'Europe/Chisinau'), Date.parse('2026-11-22T07:00:00Z'));
  assert.ok(Number.isNaN(calendarTime(undefined)));
});

test('names: the installer\'s doubled name is said once', () => {
  assert.equal(tidyName('Яндекс Станция Мини 2 Кухня · Яндекс Станция Мини 2'), 'Яндекс Станция Мини 2');
  assert.equal(tidyName('Яндекс Станция Макс'), 'Яндекс Станция Макс'); assert.equal(tidyName('Мини Мини'), 'Мини');
});

test('one Mini 2 in two modes: the silent card says which mode the speaker works in — only when told the other mode\'s entity, and never guessed', { skip: !have && 'no house fixture' }, () => {
  const sat = 'assist_satellite.iandeks_stantsiia_mini_2_assist_satellite', kids = 'media_player.kids_yandex_mini';
  const satDev = deviceOf(live, sat)!, kidsDev = deviceOf(live, kids)!;
  // on the snapshot the speaker is a voice assistant: its Station card is silent
  const station = inst(STATION_MINI2.id, kidsDev, { player: kids, assist: sat });
  const r = readSpeaker(live, station); assert.equal(r.available, false); assert.equal(r.otherMode, 'assist'); assert.equal(speakerLine(r, t), 'Режим помощника');
  assert.equal(readSpeaker(live, inst(STATION_MINI2.id, kidsDev, { player: kids })).otherMode, null); assert.equal(speakerLine(readSpeaker(live, inst(STATION_MINI2.id, kidsDev, { player: kids })), t), 'Нет связи');
  // the other way round: the speaker is back to Alice, the voice assistant's card says so
  const back = structuredClone(live); back.states[sat] = { ...back.states[sat], state: 'unavailable' }; back.states[kids] = { ...back.states[kids], state: 'idle' };
  const voice = inst(PULSAR_MINI2.id, satDev, { ...suggestBindings(live, PULSAR_MINI2, satDev), station: kids });
  const v = readSpeaker(back, voice); assert.equal(v.otherMode, 'station'); assert.equal(speakerLine(v, t), 'Режим Алисы');
  assert.equal(readSpeaker(live, voice).otherMode, null, 'the assistant answers: nothing to say');
  // both silent (the speaker is unplugged), or the house offline: «Нет связи»
  const dead = structuredClone(back); dead.states[kids] = { ...dead.states[kids], state: 'unavailable' };
  assert.equal(readSpeaker(dead, voice).otherMode, null); assert.equal(speakerLine(readSpeaker(dead, voice), t), 'Нет связи'); assert.equal(readSpeaker(back, voice, false).otherMode, null);
  // the form never fills these fields by itself, and the card sends nothing to the other mode's entity
  assert.equal(suggestBindings(live, PULSAR_MINI2, satDev).station, undefined); assert.equal(suggestBindings(live, STATION_MINI2, kidsDev).assist, undefined);
  assert.ok(allSteps(voice).length > 3, 'the assistant\'s card has commands of its own'); for (const s of allSteps(voice)) assert.ok(!JSON.stringify(s).includes(kids), JSON.stringify(s));
  for (const s of allSteps(station)) assert.ok(!JSON.stringify(s).includes(sat), JSON.stringify(s));
  // the satellite's own player is not offered as «the same speaker as a Station»
  const offered = candidates(live, PULSAR_MINI2.roles.find(x => x.id === 'station')!, { deviceId: satDev }).map(c => c.id);
  assert.ok(offered.includes(kids)); assert.ok(!offered.includes('media_player.iandeks_stantsiia_mini_2_media_player'));
});
