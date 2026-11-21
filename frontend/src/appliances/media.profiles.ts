/* The media family (TVs and TV boxes), pure part: one profile per make and model, what a card reads from its OWN bound entities, and the
 * commands each control sends. Nothing here calls Home Assistant: `mediaCommands` returns [domain, service, data] steps that the sheet hands
 * to `host.call` — so a test can run every control of two TVs of one model and see that each speaks only to its own media_player / remote.
 * Reference apps for what a card shows and in which order: Hisense VIDAA / RemoteNOW, Samsung SmartThings (TV card), Apple TV Remote,
 * Google TV remote: power, what is on (app or input, title, artwork), volume and mute, the remote pad, inputs/apps, picture and sound.
 * Left out on purpose (they change the TV deeply or are service tools): VIDAA «force reconnect», «sync clock», «trigger re-pairing»,
 * «probe capabilities», «debug logging»; the session/MQTT diagnostics. */
import type { ApplianceFamily } from './types.ts';
import type { Profile, RoleSpec, ProfileInstance } from '../model/card-catalog.ts';
import type { Registry, StateRow } from '../model/registry.ts';
import type { Key, T } from '../i18n/index.ts';
import type { Lang } from '../ui/format.ts';

// ---- profiles ----
const own = (id: string, domains: string[], suffix?: RegExp, extra: Partial<RoleSpec> = {}): RoleSpec => ({ id, labelKey: `cat.r.media.${id}`, domains, suffix, required: false, source: 'own', ...extra });
/** the same TV through a second integration (AirPlay, SmartThings): offered from the TV's room only; the card takes that device's tiles */
const sib = (id: string, domains: string[], suffix?: RegExp, extra: Partial<RoleSpec> = {}): RoleSpec => ({ id, labelKey: `cat.r.media.${id}`, domains, suffix, required: false, sibling: true, ...extra });
const TV = own('tv', ['media_player'], undefined, { required: true, as: 'primary', hintKey: 'cat.r.media.tv.hint' });
const REMOTE = own('remote', ['remote']);
const VIDAA_ROLES: RoleSpec[] = [TV, REMOTE,
  own('app', ['sensor'], /_active_app$/), own('source', ['sensor'], /_active_source$/),
  own('pictureMode', ['select'], /_picture_mode$/, { as: 'parameter' }), own('soundMode', ['select'], /_sound_mode$/, { as: 'parameter' }),
  own('backlight', ['number'], /_backlight$/, { as: 'parameter' }), own('brightness', ['number'], /_brightness$/, { as: 'parameter' }), own('contrast', ['number'], /_contrast$/, { as: 'parameter' }),
  own('audioOnly', ['switch'], /_audio_only$/, { as: 'parameter' })];
const vidaa = { platform: 'vidaa', name: 'VIDAA Smart TV' }, androidtv = { platform: 'androidtv_remote', name: 'Android TV Remote' };
const base = (id: string, brand: string, key: string, models: string[], integration: { platform: string; name: string }, terms: string[], roles: RoleSpec[]): Profile => ({
  id, version: '1.0.0', category: 'tv', brand, titleKey: `cat.p.${key}`, descKey: `cat.p.${key}.desc`, models, integration, terms, renderer: 'appliance', card: 'media',
  kind: 'media', icon: 'media', kindKey: /box|stick|chromecast|appletv/i.test(key) ? 'cat.kind.tvbox' : 'cat.kind.tv', anchor: 'tv', places: ['home', 'room'], roles });
export const HISENSE_65U8: Profile = base('hisense.65u8kq', 'Hisense', 'hisense65u8', ['65E86GEVS'], vidaa, ['hisense', 'u8', 'u8kq', '65u8kq', 'vidaa', 'телевизор', 'televizor', 'tv'], VIDAA_ROLES);
// the 55U6 is also seen by HomeKit as an AirPlay receiver (model 55U6KE): bound as a sibling, its tiles go into this card
export const HISENSE_55U6: Profile = base('hisense.55u6', 'Hisense', 'hisense55u6', ['55U67KEVS'], vidaa, ['hisense', 'u6', '55u6', 'vidaa', 'airplay', 'телевизор', 'televizor', 'tv'],
  [...VIDAA_ROLES, sib('airplay', ['media_player'], undefined, { hintKey: 'cat.r.media.airplay.hint' })]);
// Samsung TV (samsungtvws) is the TV; SmartThings sees the same set: it can wake it, it has the picture and sound modes and the channel
export const SAMSUNG_Q60T: Profile = base('samsung.q60t', 'Samsung', 'samsungQ60t', ['QE50Q60TAUXUA'], { platform: 'samsungtv', name: 'Samsung Smart TV' }, ['samsung', 'q60t', 'qled', 'qe50q60t', 'smartthings', 'телевизор', 'televizor', 'tv'],
  [TV, REMOTE, sib('smartthings', ['media_player'], undefined, { hintKey: 'cat.r.media.smartthings.hint' }), sib('pictureMode', ['select'], /_picture_mode$/, { as: 'parameter' }),
    sib('channel', ['sensor'], /_channel$/), sib('channelName', ['sensor'], /_channel_name$/)]);
export const APPLE_TV_4K3: Profile = base('apple.tv4k3', 'Apple', 'appletv4k3', ['Apple TV 4K (gen 3)'], { platform: 'apple_tv', name: 'Apple TV' }, ['apple tv', 'appletv', '4k', 'tvos', 'приставка', 'tv box'], [TV, REMOTE]);
export const MI_TV_STICK: Profile = base('xiaomi.mitv_stick', 'Xiaomi', 'mitvStick', ['MiTV-AYFR0'], androidtv, ['mi tv stick', 'xiaomi', 'android tv', 'ayfr0', 'приставка', 'tv box', 'stick'], [TV, REMOTE]);
export const CHROMECAST: Profile = base('google.chromecast', 'Google', 'chromecast', ['Chromecast'], androidtv, ['chromecast', 'google tv', 'android tv', 'приставка', 'tv box'], [TV, REMOTE]);
export const MEDIA_PROFILES: Profile[] = [HISENSE_65U8, HISENSE_55U6, SAMSUNG_Q60T, APPLE_TV_4K3, MI_TV_STICK, CHROMECAST];

// ---- the remote pad: each integration's own key names (remote.send_command) ----
export type PadKey = 'up' | 'down' | 'left' | 'right' | 'ok' | 'back' | 'home' | 'menu';
/** VIDAA (stevene1919/hisense_vidaa tv/aliases_keys.py) · Samsung TV (HA samsungtv: KEY_*) · Apple TV (pyatv: «menu» is the Siri remote's Back,
 * «home» its TV button; no menu key of its own) · Android TV Remote (KEYCODE names without the prefix; «SETTINGS» opens the quick settings). */
export const PAD_KEYS: Record<string, Partial<Record<PadKey, string>>> = {
  vidaa: { up: 'KEY_UP', down: 'KEY_DOWN', left: 'KEY_LEFT', right: 'KEY_RIGHT', ok: 'KEY_OK', back: 'KEY_RETURNS', home: 'KEY_HOME', menu: 'KEY_MENU' },
  samsungtv: { up: 'KEY_UP', down: 'KEY_DOWN', left: 'KEY_LEFT', right: 'KEY_RIGHT', ok: 'KEY_ENTER', back: 'KEY_RETURN', home: 'KEY_HOME', menu: 'KEY_MENU' },
  apple_tv: { up: 'up', down: 'down', left: 'left', right: 'right', ok: 'select', back: 'menu', home: 'home' },
  androidtv_remote: { up: 'DPAD_UP', down: 'DPAD_DOWN', left: 'DPAD_LEFT', right: 'DPAD_RIGHT', ok: 'DPAD_CENTER', back: 'BACK', home: 'HOME', menu: 'SETTINGS' },
};
export const padKeysOf = (p: Profile) => PAD_KEYS[p.integration?.platform ?? ''] ?? {};

// ---- reading one card: ONLY its own bound entities ----
const F = { pause: 1, volumeSet: 4, mute: 8, prev: 16, next: 32, turnOn: 128, turnOff: 256, volumeStep: 1024, source: 2048, play: 16384, soundMode: 65536 } as const;
const feats = (s: StateRow | undefined) => typeof s?.attributes.supported_features === 'number' ? s.attributes.supported_features : 0;
const has = (s: StateRow | undefined, f: number) => (feats(s) & f) === f;
const str = (v: unknown) => typeof v === 'string' && v.trim() ? v.trim() : null;
const list = (v: unknown) => Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string' && !!x.trim()) : [];
const DEAD = new Set(['unavailable', 'unknown', '']);
/** words a sensor uses for «nothing is on» (VIDAA's «Standby») */
const NOTHING = /^(standby|off|none|unknown|unavailable|idle|—|-)$/i;
export type Phase = 'unavailable' | 'off' | 'on' | 'playing' | 'paused';
export interface MediaState {
  phase: Phase; /** the TV's own entity answers (not «нет связи») */ available: boolean;
  app: string | null; title: string | null; /** the current input or app as HA names it (select_source takes it) */ source: string | null;
  sources: Array<{ id: string; label: string; sub: string | null }>; artwork: string | null;
  volume: number | null; muted: boolean | null;
  can: { on: boolean; off: boolean; play: boolean; next: boolean; prev: boolean; volumeStep: boolean; volumeSet: boolean; mute: boolean; source: boolean; pad: boolean; soundMode: boolean };
  soundModes: string[]; soundMode: string | null;
}
const st = (reg: Registry, b: Record<string, string>, role: string) => b[role] ? reg.states[b[role]] : undefined;
/** a picture is shown only from Home Assistant itself (its proxy path) or a plain web / data address — never `javascript:` and the like */
export const safePicture = (v: unknown): string | null => { const s = str(v); return s && (/^\/(?!\/)/.test(s) || /^https?:\/\//i.test(s) || /^data:image\//i.test(s)) ? s : null; };
export function readMedia(reg: Registry, inst: Pick<ProfileInstance, 'bindings'>): MediaState {
  const b = inst.bindings, tv = st(reg, b, 'tv'), a = tv?.attributes ?? {}, sib = st(reg, b, 'smartthings');
  const available = !!tv && !DEAD.has(tv.state);
  const s = tv?.state ?? 'unavailable';
  const phase: Phase = !available ? 'unavailable' : s === 'off' || s === 'standby' ? 'off' : s === 'playing' || s === 'buffering' ? 'playing' : s === 'paused' ? 'paused' : 'on';
  const live = phase !== 'off' && phase !== 'unavailable';
  // VIDAA names an HDMI input by what is plugged in (custom_labels: HDMI3 → «Apple TV»)
  const labels = (a.custom_labels && typeof a.custom_labels === 'object' ? a.custom_labels : {}) as Record<string, unknown>;
  // …or, with its «CEC names» option, in the source itself: «HDMI3 (Apple TV)» (tv/media.py build_media_player_current_source)
  const cec = (id: string) => /^(.+?) \((.+)\)$/.exec(id);
  const label = (id: string) => str(labels[id]) ?? cec(id)?.[2] ?? id, port = (id: string) => cec(id)?.[1] ?? id;
  const source = live ? str(a.source) : null;
  const sensorApp = live ? str(st(reg, b, 'app')?.state) : null;
  const app = live ? str(a.app_name) ?? (source ? label(source) : null) ?? (sensorApp && !NOTHING.test(sensorApp) ? sensorApp : null) : null;
  const channel = live ? str(a.media_channel) ?? str(st(reg, b, 'channelName')?.state) : null;
  let title = live ? str(a.media_title) ?? str(a.media_series_title) ?? (channel && !DEAD.has(channel) ? channel : null) : null;
  if (title && app && (title.toLowerCase() === app.toLowerCase() || (source && title.toLowerCase() === source.toLowerCase()))) title = null; // VIDAA's title falls back to the input's device: «Apple TV · Apple TV» says nothing twice
  if (title && /^(unknown|unavailable)$/i.test(title)) title = null;
  const pad = padKeys(b, reg);
  const sibOn = !!sib && !DEAD.has(sib.state) && has(sib, F.turnOn);
  const vol = typeof a.volume_level === 'number' && Number.isFinite(a.volume_level) ? Math.round(Math.max(0, Math.min(1, a.volume_level)) * 100) : null;
  const sources = has(tv, F.source) ? list(a.source_list).map(id => ({ id, label: label(id), sub: label(id) !== id ? port(id) : null })) : [];
  // the sound modes: the TV's own media_player, or SmartThings' for the Samsung (its sound_mode_list)
  const modeHost = has(tv, F.soundMode) && list(a.sound_mode_list).length ? tv : sib && !DEAD.has(sib.state) && has(sib, F.soundMode) ? sib : undefined;
  return {
    phase, available, app, title, source, sources,
    artwork: live ? safePicture(a.entity_picture) : null,
    volume: live ? vol : null, muted: live && typeof a.is_volume_muted === 'boolean' ? a.is_volume_muted : null,
    can: {
      on: available && phase === 'off' && (has(tv, F.turnOn) || sibOn), off: available && live && (has(tv, F.turnOff) || (!!sib && !DEAD.has(sib.state) && has(sib, F.turnOff))),
      play: live && (has(tv, F.play) || has(tv, F.pause)), next: live && has(tv, F.next), prev: live && has(tv, F.prev),
      volumeStep: live && has(tv, F.volumeStep), volumeSet: live && has(tv, F.volumeSet) && vol !== null, mute: live && has(tv, F.mute),
      source: live && sources.length > 0, pad: live && pad, soundMode: live && !!modeHost,
    },
    soundModes: modeHost ? list(modeHost.attributes.sound_mode_list) : [], soundMode: modeHost ? str(modeHost.attributes.sound_mode) : null,
  };
}
const padKeys = (b: Record<string, string>, reg: Registry) => !!b.remote && !!reg.states[b.remote] && !DEAD.has(reg.states[b.remote].state);

// ---- commands: what each control sends, from the card's own bindings only ----
export type Step = [string, string, Record<string, unknown>];
export type MediaAction =
  | { k: 'power'; on: boolean } | { k: 'pad'; key: PadKey } | { k: 'volume'; dir: 1 | -1 } | { k: 'mute' } | { k: 'playPause' } | { k: 'next' } | { k: 'prev' }
  | { k: 'source'; id: string } | { k: 'soundMode'; mode: string } | { k: 'select'; role: string; option: string } | { k: 'number'; role: string; value: number } | { k: 'switch'; role: string; on: boolean };
export function mediaCommands(reg: Registry, profile: Profile, inst: Pick<ProfileInstance, 'bindings'>, act: MediaAction): Step[] {
  const b = inst.bindings, tv = b.tv, tvS = st(reg, b, 'tv'), sibS = st(reg, b, 'smartthings'), sib = sibS && !DEAD.has(sibS.state) ? b.smartthings : undefined; // a silent SmartThings twin is asked nothing
  if (!tv) return [];
  const mp = (service: string, data: Record<string, unknown> = {}, id = tv): Step[] => [['media_player', service, { entity_id: id, ...data }]];
  switch (act.k) {
    case 'power':
      if (act.on) return has(tvS, F.turnOn) ? mp('turn_on') : sib && has(sibS, F.turnOn) ? mp('turn_on', {}, sib) : [];
      return has(tvS, F.turnOff) ? mp('turn_off') : sib && has(sibS, F.turnOff) ? mp('turn_off', {}, sib) : [];
    case 'pad': { const key = padKeysOf(profile)[act.key]; return b.remote && key ? [['remote', 'send_command', { entity_id: b.remote, command: key }]] : []; }
    case 'volume': {
      if (has(tvS, F.volumeStep)) return mp(act.dir > 0 ? 'volume_up' : 'volume_down');
      const v = tvS?.attributes.volume_level;
      return has(tvS, F.volumeSet) && typeof v === 'number' ? mp('volume_set', { volume_level: Math.round(Math.max(0, Math.min(1, v + act.dir * 0.02)) * 100) / 100 }) : [];
    }
    case 'mute': return has(tvS, F.mute) ? mp('volume_mute', { is_volume_muted: tvS?.attributes.is_volume_muted !== true }) : [];
    case 'playPause': return has(tvS, F.play) || has(tvS, F.pause) ? mp('media_play_pause') : [];
    case 'next': return has(tvS, F.next) ? mp('media_next_track') : [];
    case 'prev': return has(tvS, F.prev) ? mp('media_previous_track') : [];
    case 'source': return has(tvS, F.source) && list(tvS?.attributes.source_list).includes(act.id) ? mp('select_source', { source: act.id }) : [];
    case 'soundMode': {
      if (has(tvS, F.soundMode) && list(tvS?.attributes.sound_mode_list).includes(act.mode)) return mp('select_sound_mode', { sound_mode: act.mode });
      return sib && has(sibS, F.soundMode) && list(sibS?.attributes.sound_mode_list).includes(act.mode) ? mp('select_sound_mode', { sound_mode: act.mode }, sib) : [];
    }
    case 'select': { const id = b[act.role], s = id ? reg.states[id] : undefined; return id && id.startsWith('select.') && list(s?.attributes.options).includes(act.option) ? [['select', 'select_option', { entity_id: id, option: act.option }]] : []; }
    case 'number': { const id = b[act.role]; if (!id || !id.startsWith('number.')) return []; const a = reg.states[id]?.attributes ?? {}, min = typeof a.min === 'number' ? a.min : 0, max = typeof a.max === 'number' ? a.max : 100; return [['number', 'set_value', { entity_id: id, value: Math.max(min, Math.min(max, act.value)) }]]; }
    case 'switch': { const id = b[act.role]; return id && id.startsWith('switch.') ? [['switch', act.on ? 'turn_on' : 'turn_off', { entity_id: id }]] : []; }
  }
}

// ---- the tile's second line ----
const mw = (t: T, k: string, p?: Record<string, string | number>) => t(`media.${k}` as Key, p);
/** «Выключен» · «Включён · Apple TV» · «YouTube · Lo-fi beats» · «Пауза · YouTube» · «Нет связи» */
/** «TV» / «digital_tv» → «Телевидение», «hdmi1» → «HDMI 1»; anything else as the TV names it */
export const sourceLabel = (t: T, s: string) => /^(tv|digital_tv|dtv|live ?tv)$/i.test(s) ? mw(t, 'src.tv') : /^hdmi\s?(\d)$/i.test(s) ? `HDMI ${s.replace(/\D/g, '')}` : s;
/** a box whose «sources» are its apps (Apple TV): «TV» there is Apple's TV app, not the aerial */
export const sourcesAreApps = (profileId: string | undefined) => MEDIA_PROFILES.find(p => p.id === profileId)?.integration?.platform === 'apple_tv';
export function mediaTileLine(reg: Registry, inst: Pick<ProfileInstance, 'bindings'> & { profileId?: string }, t: T): string {
  const r = readMedia(reg, inst), m = { ...r, app: r.app && !sourcesAreApps(inst.profileId) ? sourceLabel(t, r.app) : r.app };
  if (m.phase === 'unavailable') return t('state.unavailable');
  if (m.phase === 'off') return mw(t, 'off');
  const what = [m.app, m.title].filter(Boolean).join(' · ');
  if (m.phase === 'paused') return what ? `${mw(t, 'paused')} · ${what}` : mw(t, 'paused');
  if (m.phase === 'playing') return what || mw(t, 'playing');
  return what ? `${mw(t, 'on')} · ${what}` : mw(t, 'on');
}
export const family: ApplianceFamily = { id: 'media', profiles: MEDIA_PROFILES, tileLine: (reg: Registry, inst: ProfileInstance, t: T, _lang: Lang) => mediaTileLine(reg, inst, t) };
