// The media family (TVs and TV boxes, src/appliances/media.*) on the Criuleni snapshot of 21.11.2026: every model is found as ONE device (the
// Samsung by its Samsung TV device, not its SmartThings twin; the 55U6 without its AirPlay twin), two TVs of a house never drive each other's
// entities, the sibling devices' tiles go into the card, and the tile line says off / on / playing / paused / unavailable in words.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { MEDIA_PROFILES, HISENSE_65U8, HISENSE_55U6, SAMSUNG_Q60T, APPLE_TV_4K3, MI_TV_STICK, CHROMECAST, PAD_KEYS, readMedia, mediaCommands, mediaTileLine, safePicture, family, type MediaAction, type PadKey } from '../src/appliances/media.profiles.ts';
import { devicesFor, suggestBindings, instanceClaims, instanceView, foundHere, type ProfileInstance } from '../src/model/card-catalog.ts';
import { liveHost } from '../src/runtime/host.ts';
import { translator } from '../src/i18n/index.ts';
import { words_media } from '../src/i18n/words-media.ts';
import type { Registry, StateRow } from '../src/model/registry.ts';

const reg0: Registry = JSON.parse(readFileSync(resolve(import.meta.dirname, '../../private/fixtures/criuleni-registry-live-20261121.json'), 'utf8'));
const t = translator('ru');
const clone = () => structuredClone(reg0);
const set = (reg: Registry, id: string, state: string, attrs: Record<string, unknown> = {}) => { const s = reg.states[id] as StateRow; reg.states[id] = { ...s, state, attributes: { ...s.attributes, ...attrs } }; };
const DEV = { living: 'c339d2b7922ebb3d7dee15e8a8e29fb8', kids: 'a1fbaf6aa3512bb01267a26ecc90b7af', kidsAirplay: '97048f75fdd4aa2c98465b5190e740ae', samsung: '9b0b4d59d91437ab0c241956da3cfbf3', smartthings: 'e1fc08942fdd789cf0870d37b234f10d', appletv: '149d56f98bdc5fae322bf9531665a348', stick: 'cf46578fb719da34527f1c1814e0bf6d', chromecast: 'b9a72dcb8e854d8413e04ae7cee02ecb' };
const inst = (profileId: string, deviceId: string, bindings: Record<string, string>): ProfileInstance => ({ profileId, profileVersion: '1.0.0', deviceId, bindings, placement: ['home'] });

test('media: six profiles, one per make and model, all drawn by the media family in «Телевизоры и приставки»', () => {
  assert.equal(MEDIA_PROFILES.length, 6);
  assert.equal(new Set(MEDIA_PROFILES.map(p => p.id)).size, 6);
  for (const p of MEDIA_PROFILES) { assert.equal(p.renderer, 'appliance'); assert.equal(p.card, 'media'); assert.equal(p.category, 'tv'); assert.equal(p.anchor, 'tv'); assert.ok(p.models.length >= 1); assert.ok(p.integration); }
  assert.equal(family.profiles, MEDIA_PROFILES);
  // the two Hisense are two profiles; the AirPlay model code is no TV of its own
  assert.deepEqual(HISENSE_65U8.models, ['65E86GEVS']); assert.deepEqual(HISENSE_55U6.models, ['55U67KEVS']); assert.ok(!HISENSE_55U6.models.includes('55U6KE'));
});

test('media: every word in ru, ro and en (titles, descriptions, fields)', () => {
  for (const lang of ['ru', 'ro', 'en'] as const) {
    const w = words_media[lang] as Record<string, string>;
    for (const p of MEDIA_PROFILES) { for (const k of [p.titleKey, p.descKey, p.kindKey!, ...p.roles.flatMap(r => [r.labelKey, ...(r.hintKey ? [r.hintKey] : [])])]) assert.ok(w[k]?.trim(), `${lang}: ${k}`); }
  }
  assert.deepEqual(Object.keys(words_media.ro).sort(), Object.keys(words_media.ru).sort());
  assert.deepEqual(Object.keys(words_media.en).sort(), Object.keys(words_media.ru).sort());
});

test('media: each model is found in the house as exactly one device — the Samsung by its Samsung TV device, the 55U6 without AirPlay', () => {
  const want: Array<[typeof HISENSE_65U8, string]> = [[HISENSE_65U8, DEV.living], [HISENSE_55U6, DEV.kids], [SAMSUNG_Q60T, DEV.samsung], [APPLE_TV_4K3, DEV.appletv], [MI_TV_STICK, DEV.stick], [CHROMECAST, DEV.chromecast]];
  for (const [p, id] of want) { const d = devicesFor(reg0, p); assert.deepEqual(d.map(x => x.id), [id], p.id); assert.ok(foundHere(reg0, p)); }
  // the Samsung TV device has no `model`, only `model_id`: it is still the Q60T
  assert.equal(devicesFor(reg0, SAMSUNG_Q60T)[0].model, 'QE50Q60TAUXUA');
  // without SmartThings in a house the Samsung TV device alone is found; without the Samsung TV integration SmartThings is
  const noSt = clone(); noSt.devices = noSt.devices.filter(d => d.id !== DEV.smartthings); assert.deepEqual(devicesFor(noSt, SAMSUNG_Q60T).map(d => d.id), [DEV.samsung]);
  const onlySt = clone(); onlySt.devices = onlySt.devices.filter(d => d.id !== DEV.samsung); assert.deepEqual(devicesFor(onlySt, SAMSUNG_Q60T).map(d => d.id), [DEV.smartthings]);
});

test('media: the live host keeps the device registry\'s model_id (the Samsung is found in the real panel too)', async () => {
  const host = liveHost(() => ({ states: {}, callWS: async (m: { type: string }) => m.type === 'config/device_registry/list' ? [{ id: 'x', name: 'TV', model: null, model_id: 'QE50Q60TAUXUA', area_id: null }] : [], callService: async () => undefined } as never));
  const r = await host.registry(); assert.equal((r.devices[0] as { model_id?: string | null }).model_id, 'QE50Q60TAUXUA');
});

test('media: a chosen Hisense gets its own fields filled; the sibling fields are the installer\'s to choose', () => {
  const b = suggestBindings(reg0, HISENSE_65U8, DEV.living);
  assert.deepEqual(b, { tv: 'media_player.living_tv', remote: 'remote.living_tv', app: 'sensor.living_tv_active_app', source: 'sensor.living_tv_active_source', pictureMode: 'select.living_tv_picture_mode', soundMode: 'select.living_tv_sound_mode', backlight: 'number.living_tv_backlight', brightness: 'number.living_tv_brightness', contrast: 'number.living_tv_contrast', audioOnly: 'switch.living_tv_audio_only' });
  const k = suggestBindings(reg0, HISENSE_55U6, DEV.kids); assert.equal(k.tv, 'media_player.kids_tv'); assert.equal(k.remote, 'remote.kids_tv'); assert.equal(k.airplay, undefined);
  const s = suggestBindings(reg0, SAMSUNG_Q60T, DEV.samsung); assert.equal(s.tv, 'media_player.bedroom_tv'); assert.equal(s.remote, 'remote.bedroom_tv');
  for (const [p, d, tv, rm] of [[APPLE_TV_4K3, DEV.appletv, 'media_player.living_appletv', 'remote.living_appletv'], [MI_TV_STICK, DEV.stick, 'media_player.kids_mitv_stick', 'remote.kids_mitv_stick'], [CHROMECAST, DEV.chromecast, 'media_player.bedroom_chromecast', 'remote.bedroom_chromecast']] as const) assert.deepEqual(suggestBindings(reg0, p, d), { tv, remote: rm });
});

const HISENSE_LIVING = inst('hisense.65u8kq', DEV.living, suggestBindings(reg0, HISENSE_65U8, DEV.living));
const HISENSE_KIDS = inst('hisense.55u6', DEV.kids, { ...suggestBindings(reg0, HISENSE_55U6, DEV.kids), airplay: 'media_player.kids_tv_airplay' });
const SAMSUNG = inst('samsung.q60t', DEV.samsung, { ...suggestBindings(reg0, SAMSUNG_Q60T, DEV.samsung), smartthings: 'media_player.bedroom_tv_smartthings', pictureMode: 'select.spalnia_spalnia_televizor_smartthings_samsung_qe50q60t_picture_mode', channel: 'sensor.bedroom_tv_channel', channelName: 'sensor.bedroom_tv_channel_name' });
const ALL_ACTIONS = (reg: Registry, b: Record<string, string>): MediaAction[] => [
  { k: 'power', on: true }, { k: 'power', on: false }, ...(['up', 'down', 'left', 'right', 'ok', 'back', 'home', 'menu'] as PadKey[]).map(key => ({ k: 'pad', key }) as MediaAction),
  { k: 'volume', dir: 1 }, { k: 'volume', dir: -1 }, { k: 'mute' }, { k: 'playPause' }, { k: 'next' }, { k: 'prev' },
  ...((reg.states[b.tv]?.attributes.source_list as string[] | undefined) ?? []).map(id => ({ k: 'source', id }) as MediaAction),
  ...['pictureMode', 'soundMode'].flatMap(role => ((reg.states[b[role]]?.attributes.options as string[] | undefined) ?? []).map(option => ({ k: 'select', role, option }) as MediaAction)),
  ...['backlight', 'brightness', 'contrast'].map(role => ({ k: 'number', role, value: 40 }) as MediaAction), { k: 'switch', role: 'audioOnly', on: true }, { k: 'switch', role: 'audioOnly', on: false },
  { k: 'soundMode', mode: 'Стандартный' },
];

test('media: two Hisense TVs in one house — every control of each sends only to its own media_player / remote / settings', () => {
  // the real two (65U8 in the Living room, 55U6 in the Kids' room) and a second 65U8 of the same model: three cards, three sets of entities
  const reg = clone(), twin: Record<string, string> = {};
  for (const e of reg0.entities.filter(e => e.device_id === DEV.living)) { const id = e.entity_id.replace('living_tv', 'office_tv'); twin[e.entity_id] = id; reg.entities.push({ ...e, entity_id: id, device_id: 'twin-65u8' }); if (reg0.states[e.entity_id]) reg.states[id] = structuredClone(reg0.states[e.entity_id]); }
  reg.devices.push({ ...reg0.devices.find(d => d.id === DEV.living)!, id: 'twin-65u8', area_id: 'kabinet' });
  for (const id of ['media_player.living_tv', 'media_player.kids_tv', 'media_player.office_tv']) set(reg, id, 'on', { volume_level: 0.11, is_volume_muted: false, source: 'HDMI1' });
  for (const id of ['remote.living_tv', 'remote.kids_tv', 'remote.office_tv']) set(reg, id, 'on');
  assert.equal(devicesFor(reg, HISENSE_65U8).length, 2, 'two TVs of one model are two devices to choose from');
  const office = inst('hisense.65u8kq', 'twin-65u8', suggestBindings(reg, HISENSE_65U8, 'twin-65u8'));
  assert.equal(office.bindings.tv, 'media_player.office_tv'); assert.equal(office.bindings.remote, 'remote.office_tv');
  const cards: Array<[ProfileInstance, typeof HISENSE_65U8]> = [[HISENSE_LIVING, HISENSE_65U8], [HISENSE_KIDS, HISENSE_55U6], [office, HISENSE_65U8]];
  for (const [card, profile] of cards) {
    const mine = new Set(Object.values(card.bindings)), others = new Set(cards.filter(([c]) => c !== card).flatMap(([c]) => Object.values(c.bindings)));
    let sent = 0;
    for (const act of ALL_ACTIONS(reg, card.bindings)) for (const [, , data] of mediaCommands(reg, profile, card, act)) {
      sent++; const id = data.entity_id as string;
      assert.ok(mine.has(id), `${card.deviceId} ${JSON.stringify(act)} → ${id} is not its own`); assert.ok(!others.has(id), `${card.deviceId} → another TV's ${id}`);
    }
    assert.ok(sent >= 30, `${card.deviceId}: every control sends (${sent})`);
  }
  // the pad speaks VIDAA's own key names to the card's own remote
  assert.deepEqual(mediaCommands(reg, HISENSE_55U6, HISENSE_KIDS, { k: 'pad', key: 'back' }), [['remote', 'send_command', { entity_id: 'remote.kids_tv', command: 'KEY_RETURNS' }]]);
  assert.deepEqual(mediaCommands(reg, HISENSE_65U8, office, { k: 'pad', key: 'ok' }), [['remote', 'send_command', { entity_id: 'remote.office_tv', command: 'KEY_OK' }]]);
  // a source is chosen only from the TV's own list; a mode only from its own options
  assert.deepEqual(mediaCommands(reg, HISENSE_65U8, HISENSE_LIVING, { k: 'source', id: 'HDMI9' }), []);
  assert.deepEqual(mediaCommands(reg, HISENSE_65U8, HISENSE_LIVING, { k: 'select', role: 'pictureMode', option: 'Vivid' }), []);
});

test('media: each integration\'s own remote keys; a TV box without a key has no button for it', () => {
  assert.equal(PAD_KEYS.vidaa.back, 'KEY_RETURNS'); assert.equal(PAD_KEYS.samsungtv.ok, 'KEY_ENTER'); assert.equal(PAD_KEYS.apple_tv.back, 'menu'); assert.equal(PAD_KEYS.apple_tv.menu, undefined); assert.equal(PAD_KEYS.androidtv_remote.ok, 'DPAD_CENTER');
  const reg = clone(); set(reg, 'media_player.living_appletv', 'playing'); set(reg, 'remote.living_appletv', 'on');
  const apple = inst('apple.tv4k3', DEV.appletv, { tv: 'media_player.living_appletv', remote: 'remote.living_appletv' });
  assert.deepEqual(mediaCommands(reg, APPLE_TV_4K3, apple, { k: 'pad', key: 'menu' }), []);
  assert.deepEqual(mediaCommands(reg, APPLE_TV_4K3, apple, { k: 'pad', key: 'home' }), [['remote', 'send_command', { entity_id: 'remote.living_appletv', command: 'home' }]]);
  // Apple TV has no mute (its supported_features): no command, no button
  assert.deepEqual(mediaCommands(reg, APPLE_TV_4K3, apple, { k: 'mute' }), []); assert.equal(readMedia(reg, apple).can.mute, false);
});

test('media: the Samsung wakes through SmartThings (its own integration cannot), turns off through its own; sound modes from SmartThings', () => {
  const reg = clone(); set(reg, 'media_player.bedroom_tv_smartthings', 'off');
  let m = readMedia(reg, SAMSUNG); assert.equal(m.phase, 'off'); assert.equal(m.can.on, true);
  assert.deepEqual(mediaCommands(reg, SAMSUNG_Q60T, SAMSUNG, { k: 'power', on: true }), [['media_player', 'turn_on', { entity_id: 'media_player.bedroom_tv_smartthings' }]]);
  set(reg, 'media_player.bedroom_tv', 'on', { source: 'HDMI' }); set(reg, 'media_player.bedroom_tv_smartthings', 'on', { sound_mode: 'Стандартный' });
  assert.deepEqual(mediaCommands(reg, SAMSUNG_Q60T, SAMSUNG, { k: 'power', on: false }), [['media_player', 'turn_off', { entity_id: 'media_player.bedroom_tv' }]]);
  m = readMedia(reg, SAMSUNG); assert.equal(m.can.soundMode, true); assert.deepEqual(m.soundModes, ['Адаптивный звук', 'Стандартный', 'Усиление']);
  assert.deepEqual(mediaCommands(reg, SAMSUNG_Q60T, SAMSUNG, { k: 'soundMode', mode: 'Усиление' }), [['media_player', 'select_sound_mode', { entity_id: 'media_player.bedroom_tv_smartthings', sound_mode: 'Усиление' }]]);
  // SmartThings gone: the card says it cannot wake the TV rather than offering a button that does nothing
  const r2 = clone(); assert.equal(readMedia(r2, SAMSUNG).can.on, false); assert.deepEqual(mediaCommands(r2, SAMSUNG_Q60T, SAMSUNG, { k: 'power', on: true }), []);
});

test('media: the sibling devices\' tiles go into the card — Hisense 55U6 AirPlay and Samsung SmartThings', () => {
  const claims = instanceClaims(reg0, { a: HISENSE_KIDS, b: SAMSUNG, c: HISENSE_LIVING });
  for (const id of ['media_player.kids_tv_airplay', 'switch.kids_tv_airplay_mute', 'button.kids_tv_airplay_identify']) assert.ok(claims.has(id), id);
  for (const id of ['media_player.bedroom_tv_smartthings', 'sensor.bedroom_tv_channel', 'sensor.bedroom_tv_channel_name', 'select.spalnia_spalnia_televizor_smartthings_samsung_qe50q60t_picture_mode']) assert.ok(claims.has(id), id);
  for (const id of ['media_player.kids_tv', 'remote.kids_tv', 'button.kids_tv_trigger_re_pairing', 'media_player.bedroom_tv', 'remote.bedroom_tv', 'media_player.living_tv']) assert.ok(claims.has(id), id);
  // without the sibling bound, the AirPlay tile stays where it was
  const bare = instanceClaims(reg0, { a: inst('hisense.55u6', DEV.kids, suggestBindings(reg0, HISENSE_55U6, DEV.kids)) });
  assert.ok(!bare.has('media_player.kids_tv_airplay'));
  // the card's tile is the TV, named and placed by its own device
  const v = instanceView(reg0, 'a', HISENSE_KIDS)!; assert.equal(v.device.kind, 'media'); assert.equal(v.device.primary.id, 'media_player.kids_tv'); assert.equal(v.device.roomId, 'detskaia'); assert.deepEqual(v.incomplete, []);
  assert.equal(v.device.name, 'Телевизор', 'called by its device without the model (the room stands beside it), not «<device> Телевизор»');
  assert.equal(instanceView(reg0, 'c', HISENSE_LIVING, () => 'Гостиная')!.device.name, 'Телевизор (Hisense 65U8KQ)');
});

test('media: the tile line — off, on, on with an input, playing «App · title», paused, unavailable', () => {
  const reg = clone();
  assert.equal(mediaTileLine(reg, HISENSE_LIVING, t), 'Выключен');
  set(reg, 'media_player.living_tv', 'on', { source: 'HDMI3', media_title: 'Apple TV', volume_level: 0.11 });
  assert.equal(mediaTileLine(reg, HISENSE_LIVING, t), 'Включён · Apple TV', 'the input by what is plugged in; its title is the same words and is not said twice');
  // VIDAA's «CEC names» option puts the device in the source itself: the same words, the chip still the chosen one
  set(reg, 'media_player.living_tv', 'on', { source: 'HDMI3 (Apple TV)', source_list: ['AV', 'HDMI1', 'HDMI3 (Apple TV)', 'TV'], custom_labels: {} });
  assert.equal(mediaTileLine(reg, HISENSE_LIVING, t), 'Включён · Apple TV');
  assert.deepEqual(readMedia(reg, HISENSE_LIVING).sources.find(x => x.id === readMedia(reg, HISENSE_LIVING).source), { id: 'HDMI3 (Apple TV)', label: 'Apple TV', sub: 'HDMI3' });
  set(reg, 'media_player.living_tv', 'on', { source: undefined, media_title: undefined, app_name: undefined }); set(reg, 'sensor.living_tv_active_app', 'Standby');
  assert.equal(mediaTileLine(reg, HISENSE_LIVING, t), 'Включён', 'VIDAA\'s «Standby» is not an app');
  set(reg, 'sensor.living_tv_active_app', 'YouTube'); assert.equal(mediaTileLine(reg, HISENSE_LIVING, t), 'Включён · YouTube');
  set(reg, 'media_player.living_appletv', 'playing', { app_name: 'YouTube', media_title: 'Lo-fi beats' });
  const apple = inst('apple.tv4k3', DEV.appletv, { tv: 'media_player.living_appletv', remote: 'remote.living_appletv' });
  assert.equal(mediaTileLine(reg, apple, t), 'YouTube · Lo-fi beats');
  set(reg, 'media_player.living_appletv', 'paused'); assert.equal(mediaTileLine(reg, apple, t), 'Пауза · YouTube · Lo-fi beats');
  set(reg, 'media_player.living_appletv', 'playing', { app_name: undefined, media_title: undefined }); assert.equal(mediaTileLine(reg, apple, t), 'Играет');
  set(reg, 'media_player.living_appletv', 'unavailable'); assert.equal(mediaTileLine(reg, apple, t), 'Нет связи');
  set(reg, 'media_player.living_appletv', 'unknown'); assert.equal(mediaTileLine(reg, apple, t), 'Нет связи');
  assert.equal(mediaTileLine(reg0, inst('google.chromecast', DEV.chromecast, { tv: 'media_player.bedroom_chromecast' }), t), 'Нет связи', 'the Chromecast is unavailable in the snapshot');
  set(reg, 'media_player.kids_mitv_stick', 'on', { app_name: 'Kinopub' }); assert.equal(mediaTileLine(reg, inst('xiaomi.mitv_stick', DEV.stick, { tv: 'media_player.kids_mitv_stick' }), t), 'Включён · Kinopub');
  // Apple's «TV» app is not the aerial
  set(reg, 'media_player.living_appletv', 'on', { app_name: 'TV', source: 'TV' }); assert.equal(mediaTileLine(reg, apple, t), 'Включён · TV');
  const samsung = clone(); set(samsung, 'media_player.bedroom_tv', 'on', { source: 'TV' }); assert.equal(mediaTileLine(samsung, SAMSUNG, t), 'Включён · Телевидение');
  // ro and en say the same
  assert.equal(mediaTileLine(reg0, HISENSE_LIVING, translator('ro')), 'Oprit'); assert.equal(mediaTileLine(reg0, HISENSE_LIVING, translator('en')), 'Off');
  // the family's hook is the same function
  assert.equal(family.tileLine!(reg0, HISENSE_LIVING, t, 'ru'), 'Выключен');
});

test('media: artwork only from Home Assistant or a plain web/data address; none while off', () => {
  assert.equal(safePicture('/api/media_player_proxy/media_player.x?token=1'), '/api/media_player_proxy/media_player.x?token=1');
  assert.equal(safePicture('javascript:alert(1)'), null); assert.equal(safePicture('//evil.example/x.png'), null); assert.equal(safePicture('data:text/html,x'), null);
  const reg = clone(); set(reg, 'media_player.living_appletv', 'off', { entity_picture: '/api/media_player_proxy/x' }); assert.equal(readMedia(reg, inst('apple.tv4k3', DEV.appletv, { tv: 'media_player.living_appletv' })).artwork, null);
  set(reg, 'media_player.living_appletv', 'playing'); assert.equal(readMedia(reg, inst('apple.tv4k3', DEV.appletv, { tv: 'media_player.living_appletv' })).artwork, '/api/media_player_proxy/x');
});

test('media: what a card can do follows its own media_player — Android TV has volume steps and mute but no input list', () => {
  const reg = clone(); set(reg, 'media_player.kids_mitv_stick', 'on'); set(reg, 'remote.kids_mitv_stick', 'on');
  const m = readMedia(reg, inst('xiaomi.mitv_stick', DEV.stick, { tv: 'media_player.kids_mitv_stick', remote: 'remote.kids_mitv_stick' }));
  assert.deepEqual({ step: m.can.volumeStep, set: m.can.volumeSet, mute: m.can.mute, source: m.can.source, pad: m.can.pad }, { step: true, set: false, mute: true, source: false, pad: true });
  // off: the pad and the volume are not offered; unavailable: nothing is
  const off = readMedia(reg0, HISENSE_LIVING); assert.equal(off.phase, 'off'); assert.equal(off.can.pad, false); assert.equal(off.can.volumeStep, false); assert.equal(off.can.on, true);
  const gone = clone(); set(gone, 'media_player.living_tv', 'unavailable'); const u = readMedia(gone, HISENSE_LIVING); assert.equal(u.phase, 'unavailable'); assert.ok(Object.values(u.can).every(v => !v));
});
