/* The «speaker» family: Yandex Stations through the HACS integration Yandex.Station (AlexxIT, platform `yandex_station`) and a Station Mini 2
 * reflashed as a Home Assistant Assist satellite (ESPHome firmware «pulsar»). Pure: the profiles, what a card reads from ITS OWN bindings, the
 * commands it may send (built from those bindings only — two Minis of one model are two cards, each driving its own player) and the tile line.
 *
 * What the integration gives (21.11.2026, read from the house): `media_player` (play/pause, next/previous while music plays, volume, mute,
 * shuffle/repeat, `alice_state`, track, artist and the cover in `entity_picture` while Yandex Music plays locally), `select` *_equalizer,
 * `calendar` *_alarms (the station's alarms and timers, read-only here), `camera` *_lyrics (not shown), `conversation` *_alice (HA's assistant,
 * not shown). «Сказать Алисе» is `media_player.play_media` with `media_content_type` `command` (Alice does it) or `text` (she says it; the cloud
 * reads at most 100 characters). No «не беспокоить» entity exists in the integration: the card offers none. */
import type { ApplianceFamily } from './types.ts';
import type { Profile, ProfileInstance, RoleSpec } from '../model/card-catalog.ts';
import type { Registry, StateRow } from '../model/registry.ts';
import type { Key, T } from '../i18n/index.ts';
import type { Lang } from '../ui/format.ts';
import { houseAt } from '../runtime/zone.ts';

export type Step = [domain: string, service: string, data: Record<string, unknown>];
/** HA's MediaPlayerEntityFeature bits the card reads */
export const F = { PAUSE: 1, VOLUME_SET: 4, VOLUME_MUTE: 8, PREVIOUS: 16, NEXT: 32, PLAY_MEDIA: 512, PLAY: 16384, SHUFFLE: 32768, REPEAT: 262144 } as const;
/** the cloud's limit for a phrase Alice says (README of the integration) */
export const SAY_MAX = 100;

const own = (id: string, labelKey: string, domains: string[], suffix: RegExp | undefined, extra: Partial<RoleSpec> = {}): RoleSpec => ({ id, labelKey, domains, suffix, required: false, source: 'own', ...extra });
/** The station's own fields through Yandex.Station. Only the player is needed: on the kitchen Mini the integration has disabled all the rest. */
const stationRoles = (): RoleSpec[] => [
  own('player', 'cat.r.spPlayer', ['media_player'], undefined, { required: true, as: 'primary', hintKey: 'cat.r.spPlayer.hint' }),
  own('equalizer', 'cat.r.spEqualizer', ['select'], /_equalizer$/, { as: 'parameter' }),
  own('alarms', 'cat.r.spAlarms', ['calendar'], /_alarms$/),
  // the socket the station stands on: another device, chosen on purpose (it is no second integration of the station — never `sibling`)
  { id: 'plug', labelKey: 'cat.r.spPlug', hintKey: 'cat.r.spPlug.hint', required: false, domains: ['switch'], source: 'prefer', plug: true },
  { id: 'power', labelKey: 'cat.r.spPower', required: false, domains: ['sensor'], deviceClass: ['power'], units: ['W'], source: 'prefer', as: 'metric', plug: true },
];
const station = (id: string, model: string, titleKey: string, terms: string[]): Profile => ({
  id, version: '1.0.0', category: 'speakers', brand: 'Yandex', titleKey, descKey: `${titleKey}.desc`, models: [model],
  integration: { platform: 'yandex_station', name: 'Yandex.Station (HACS)' }, terms: ['яндекс', 'yandex', 'станция', 'stație', 'station', 'алиса', 'alice', 'колонка', 'boxă', 'speaker', ...terms],
  renderer: 'appliance', card: 'speaker', kind: 'media', icon: 'speaker', kindKey: 'cat.kind.speaker', anchor: 'player', places: ['home', 'room'], roles: stationRoles(),
});
export const STATION_MAX = station('yandex.station_max', 'Станция Макс (2020)', 'cat.p.spMax', ['макс', 'max', 'yandexstation_2']);
export const STATION_LITE = station('yandex.station_lite', 'Станция Лайт (2021)', 'cat.p.spLite', ['лайт', 'lite', 'yandexmicro']);
export const STATION_MINI2 = station('yandex.station_mini2', 'Станция Мини 2 (2021)', 'cat.p.spMini2', ['мини 2', 'mini 2', 'yandexmini_2']);
/** A Station Mini 2 with the open firmware «pulsar» (ESPHome): Home Assistant's own voice assistant, no Alice. Its model in HA is `satellite`
 * (a generic word: a second firmware calling itself so would be offered too — the installer sees the device's name in the list). */
export const PULSAR_MINI2: Profile = {
  id: 'pulsar.mini2_satellite', version: '1.0.0', category: 'speakers', brand: 'Yandex', titleKey: 'cat.p.spPulsar', descKey: 'cat.p.spPulsar.desc', models: ['satellite'],
  integration: { platform: 'esphome', name: 'ESPHome (pulsar)' }, terms: ['pulsar', 'assist', 'satellite', 'спутник', 'голосовой', 'мини 2', 'mini 2', 'esphome', 'колонка', 'boxă', 'speaker'],
  renderer: 'appliance', card: 'speaker', kind: 'media', icon: 'mic', kindKey: 'cat.kind.voice', nameKey: 'cat.kind.voice', anchor: 'satellite', places: ['home', 'room'],
  roles: [
    own('satellite', 'cat.r.spSatellite', ['assist_satellite'], /_assist_satellite$/, { required: true, as: 'primary' }),
    own('player', 'cat.r.spPlayer', ['media_player'], /_media_player$/),
    own('mics', 'cat.r.spMics', ['switch'], /_microphones$/),
    own('hwMute', 'cat.r.spHwMute', ['binary_sensor'], /_hardware_mic_mute$/, { as: 'parameter' }),
    own('ring', 'cat.r.spRing', ['light'], /_ring$/),
    // the owner's settings (shown to an administrator only)
    own('wakeWord', 'cat.r.spWakeWord', ['select'], /_wake_word$/, { as: 'parameter' }),
    own('wakeSound', 'cat.r.spWakeSound', ['switch'], /_wake_sound$/, { as: 'parameter' }),
    own('voiceLight', 'cat.r.spVoiceLight', ['switch'], /_voice_indication$/, { as: 'parameter' }),
    own('visual', 'cat.r.spVisual', ['select'], /_music_visualization$/, { as: 'parameter' }),
    own('nearest', 'cat.r.spNearest', ['switch'], /_nearest_station_answers$/, { as: 'parameter' }),
    own('restart', 'cat.r.spRestart', ['button'], /_restart$/, { as: 'parameter' }),
  ],
};
export const SPEAKER_PROFILES: Profile[] = [STATION_MAX, STATION_LITE, STATION_MINI2, PULSAR_MINI2];
export const isSatellite = (profileId: string) => profileId === PULSAR_MINI2.id;
export const artOf = (profileId: string): 'max' | 'lite' | 'mini' => profileId === STATION_MAX.id ? 'max' : profileId === STATION_LITE.id ? 'lite' : 'mini';

// ---- what a card reads: its own bindings, nothing else ----
const DEAD = new Set(['unavailable', 'unknown', '']);
const str = (v: unknown) => typeof v === 'string' && v.trim() ? v.trim() : null;
const numOf = (v: unknown) => { if (v === null || v === undefined || typeof v === 'boolean' || (typeof v === 'string' && !v.trim())) return null; const x = Number(v); return Number.isFinite(x) ? x : null; };
const onOff = (s: StateRow | undefined): boolean | null => s?.state === 'on' ? true : s?.state === 'off' ? false : null;
export type Phase = 'offline' | 'playing' | 'paused' | 'silent' | 'off';
export type Alice = 'idle' | 'listening' | 'speaking' | 'busy' | null;
export type Assist = 'idle' | 'listening' | 'processing' | 'responding' | null;
export interface SpeakerRead {
  satellite: boolean; player: string | null; available: boolean; phase: Phase;
  title: string | null; artist: string | null; cover: string | null; duration: number | null; position: number | null; positionAt: number | null;
  volume: number | null; muted: boolean | null; features: number; shuffle: boolean | null; repeat: 'off' | 'all' | 'one' | null;
  alice: Alice; assist: Assist;
  can: { playPause: boolean; prev: boolean; next: boolean; volume: boolean; mute: boolean; say: boolean; shuffle: boolean; repeat: boolean };
  eq: { id: string; value: string | null; options: string[]; available: boolean } | null;
  alarm: { id: string; available: boolean; ringing: boolean; next: { start: number; message: string } | null } | null;
  plug: { id: string; on: boolean | null } | null; watts: number | null;
  mics: { id: string; on: boolean | null } | null; hwMute: boolean | null; ring: { id: string; on: boolean | null; rgb: [number, number, number] | null } | null;
  admin: { wakeWord: { id: string; value: string | null; options: string[] } | null; wakeSound: { id: string; on: boolean | null } | null; voiceLight: { id: string; on: boolean | null } | null; visual: { id: string; value: string | null; options: string[] } | null; nearest: { id: string; on: boolean | null } | null; restart: string | null };
}
const opts = (s: StateRow | undefined) => Array.isArray(s?.attributes.options) ? (s!.attributes.options as unknown[]).map(String) : [];
/** A calendar's «2026-11-22 07:00:00» is the house's wall time (HA writes it without a zone): read in the house's zone, not the browser's. */
export function calendarTime(v: unknown, tz?: string): number {
  if (typeof v !== 'string') return NaN;
  const m = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?$/.exec(v.trim());
  return m ? houseAt(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +(m[6] ?? 0), tz) : Date.parse(v);
}
export function readSpeaker(reg: Registry, inst: Pick<ProfileInstance, 'profileId' | 'bindings'>, online = true, tz?: string): SpeakerRead {
  const B = inst.bindings, S = reg.states, st = (role: string) => B[role] ? S[B[role]] : undefined;
  const satellite = isSatellite(inst.profileId);
  const main = satellite ? st('satellite') : st('player'), p = st('player'), a = p?.attributes ?? {};
  const available = online && !!main && !DEAD.has(main.state);
  const playerUp = !!p && !DEAD.has(p.state) && online;
  const title = playerUp ? str(a.media_title) : null, artist = playerUp ? str(a.media_artist) : null;
  const ps = p?.state ?? 'unavailable';
  const phase: Phase = !available ? 'offline' : ps === 'off' || ps === 'standby' ? 'off' : ps === 'playing' ? 'playing' : ps === 'paused' && title ? 'paused' : (ps === 'buffering' ? 'playing' : 'silent');
  const features = numOf(a.supported_features) ?? 0, has = (bit: number) => playerUp && (features & bit) === bit;
  const aliceRaw = str(a.alice_state)?.toLowerCase() ?? null;
  const alice: Alice = !available || satellite ? null : aliceRaw === 'listening' ? 'listening' : aliceRaw === 'speaking' ? 'speaking' : aliceRaw === 'busy' ? 'busy' : aliceRaw === 'idle' ? 'idle' : null;
  const as = satellite && available ? main!.state : null;
  const assist: Assist = as === 'listening' || as === 'processing' || as === 'responding' || as === 'idle' ? as : null;
  const rep = str(a.repeat);
  const eqS = st('equalizer'), alS = st('alarms'), plugS = st('plug'), powS = st('power'), ringS = st('ring');
  const start = alS ? calendarTime(alS.attributes.start_time, tz) : NaN;
  const sw = (role: string) => B[role] && st(role) ? { id: B[role], on: online ? onOff(st(role)) : null } : null;
  const sel = (role: string) => B[role] && st(role) ? { id: B[role], value: DEAD.has(st(role)!.state) ? null : st(role)!.state, options: opts(st(role)) } : null;
  const rgb = Array.isArray(ringS?.attributes.rgb_color) && (ringS!.attributes.rgb_color as unknown[]).length === 3 ? (ringS!.attributes.rgb_color as number[]).map(Number) as [number, number, number] : null;
  return {
    satellite, player: B.player ?? null, available, phase, title, artist,
    cover: phase === 'playing' || phase === 'paused' ? str(a.entity_picture) : null,
    duration: playerUp ? numOf(a.media_duration) : null, position: playerUp ? numOf(a.media_position) : null,
    positionAt: playerUp && typeof a.media_position_updated_at === 'string' ? (Number.isFinite(Date.parse(a.media_position_updated_at)) ? Date.parse(a.media_position_updated_at) : null) : null,
    volume: playerUp ? numOf(a.volume_level) : null, muted: playerUp && typeof a.is_volume_muted === 'boolean' ? a.is_volume_muted : null,
    features, shuffle: playerUp && typeof a.shuffle === 'boolean' ? a.shuffle : null, repeat: rep === 'off' || rep === 'all' || rep === 'one' ? rep : null,
    alice, assist,
    can: { playPause: has(F.PAUSE) || has(F.PLAY), prev: has(F.PREVIOUS), next: has(F.NEXT), volume: has(F.VOLUME_SET), mute: has(F.VOLUME_MUTE), say: !satellite && has(F.PLAY_MEDIA), shuffle: has(F.SHUFFLE) && typeof a.shuffle === 'boolean', repeat: has(F.REPEAT) && !!rep },
    eq: B.equalizer && eqS ? { id: B.equalizer, value: DEAD.has(eqS.state) ? null : eqS.state, options: opts(eqS), available: online && eqS.state !== 'unavailable' } : null,
    alarm: B.alarms && alS ? { id: B.alarms, available: alS.state !== 'unavailable', ringing: alS.state === 'on', next: Number.isFinite(start) ? { start, message: str(alS.attributes.message) ?? '' } : null } : null,
    plug: B.plug && plugS ? { id: B.plug, on: online ? onOff(plugS) : null } : null,
    watts: online && powS && !DEAD.has(powS.state) ? numOf(powS.state) : null,
    mics: sw('mics'), hwMute: online ? onOff(st('hwMute')) : null,
    ring: B.ring && ringS ? { id: B.ring, on: online ? onOff(ringS) : null, rgb } : null,
    admin: { wakeWord: sel('wakeWord'), wakeSound: sw('wakeSound'), voiceLight: sw('voiceLight'), visual: sel('visual'), nearest: sw('nearest'), restart: B.restart && st('restart') ? B.restart : null },
  };
}

// ---- what a card may send: built from ITS bindings only ----
/** Every command of one card. A role the card has no binding for gives no step (an empty list). */
export function speakerCommands(inst: Pick<ProfileInstance, 'bindings'>) {
  const B = inst.bindings, mp = (service: string, data: Record<string, unknown> = {}): Step[] => B.player ? [['media_player', service, { entity_id: B.player, ...data }]] : [];
  const toggle = (role: string, domain: string, on: boolean): Step[] => B[role] ? [[domain, on ? 'turn_on' : 'turn_off', { entity_id: B[role] }]] : [];
  const pick = (role: string, option: string): Step[] => B[role] ? [['select', 'select_option', { entity_id: B[role], option }]] : [];
  return {
    playPause: () => mp('media_play_pause'), play: () => mp('media_play'), pause: () => mp('media_pause'),
    next: () => mp('media_next_track'), prev: () => mp('media_previous_track'),
    volume: (pct: number) => mp('volume_set', { volume_level: Math.round(Math.max(0, Math.min(100, pct))) / 100 }),
    mute: (muted: boolean) => mp('volume_mute', { is_volume_muted: muted }),
    shuffle: (on: boolean) => mp('shuffle_set', { shuffle: on }),
    repeat: (mode: 'off' | 'all' | 'one') => mp('repeat_set', { repeat: mode }),
    /** «Сказать Алисе»: `command` — Alice does it as if she heard it; `text` — she says it aloud */
    say: (text: string, how: 'command' | 'text'): Step[] => { const s = text.trim().slice(0, SAY_MAX); return s ? mp('play_media', { media_content_id: s, media_content_type: how }) : []; },
    equalizer: (option: string) => pick('equalizer', option),
    plug: (on: boolean) => toggle('plug', 'switch', on),
    mics: (on: boolean) => toggle('mics', 'switch', on),
    ring: (on: boolean) => toggle('ring', 'light', on),
    wakeWord: (option: string) => pick('wakeWord', option), visual: (option: string) => pick('visual', option),
    wakeSound: (on: boolean) => toggle('wakeSound', 'switch', on), voiceLight: (on: boolean) => toggle('voiceLight', 'switch', on), nearest: (on: boolean) => toggle('nearest', 'switch', on),
    restart: (): Step[] => B.restart ? [['button', 'press', { entity_id: B.restart }]] : [],
  };
}

// ---- the tile's second line ----
const w = (t: T, k: string, p?: Record<string, string | number>) => t(`speaker.${k}` as Key, p);
/** «Кухня · Яндекс Станция Мини 2 Кухня · Яндекс Станция Мини 2» (an installer's double name) is «Яндекс Станция Мини 2» */
export function tidyName(name: string): string {
  const n = name.trim();
  for (let i = n.indexOf(' '); i > 0; i = n.indexOf(' ', i + 1)) { const left = n.slice(0, i).trim(), right = n.slice(i + 1).trim(); if (left && (right === left || right.endsWith(` · ${left}`))) return left; }
  return n;
}
/** «07:00», «завтра 07:00», «пт 07:00» in the house's time zone */
export function whenText(at: number, now: number, lang: Lang, t: T, timeZone?: string): string {
  const loc = lang === 'ru' ? 'ru-RU' : lang === 'ro' ? 'ro-RO' : 'en-GB', zone = timeZone ? { timeZone } : {};
  const day = (ms: number) => new Intl.DateTimeFormat('en-CA', { ...zone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(ms));
  const time = new Intl.DateTimeFormat(loc, { ...zone, hour: '2-digit', minute: '2-digit' }).format(new Date(at));
  if (day(at) === day(now)) return `${w(t, 'today')} ${time}`;
  if (day(at) === day(now + 86_400_000)) return `${w(t, 'tomorrow')} ${time}`;
  return `${new Intl.DateTimeFormat(loc, { ...zone, weekday: 'short', day: 'numeric', month: 'short' }).format(new Date(at))} ${time}`;
}
/** «Кино — Группа крови», «Пауза · Группа крови», «Алиса слушает», «Тишина», «Нет связи». */
export function speakerLine(r: SpeakerRead, t: T): string {
  if (r.phase === 'offline') return w(t, 'tile.offline');
  if (r.satellite) {
    if (r.hwMute === true || r.mics?.on === false) return w(t, 'tile.micsOff');
    if (r.assist === 'listening') return w(t, 'assist.listening');
    if (r.assist === 'processing') return w(t, 'assist.processing');
    if (r.assist === 'responding') return w(t, 'assist.responding');
  } else if (r.alice === 'listening' || r.alice === 'speaking') return w(t, `alice.${r.alice}`);
  const song = r.artist && r.title ? `${r.artist} — ${r.title}` : r.title;
  if (r.phase === 'playing') return song ?? w(t, 'tile.playing');
  if (r.phase === 'paused') return w(t, 'tile.paused', { song: song ?? '' });
  if (r.phase === 'off') return w(t, 'tile.off');
  return r.satellite ? w(t, 'tile.ready') : w(t, 'tile.silent');
}
export const family: ApplianceFamily = {
  id: 'speaker', profiles: SPEAKER_PROFILES,
  tileLine: (registry, instance, t: T, _lang: Lang) => speakerLine(readSpeaker(registry, instance), t),
};
