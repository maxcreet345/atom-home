/* The dashcam family (types.ts): a 70mai dash camera with its 4G module (A810 + UP04) through the «70mai» integration (lorenzo-deluca/
 * homeassistant-70mai, platform `mai70`). Reference: the 70mai app — where the car is, its battery, the last alarm, the 4G link, parking
 * surveillance. HA gives this device no model code, so the profile is a scheme found by its fields (`models: []`). The integration marks most of
 * its entities `diagnostic`; those fields are `as: 'parameter'`, the catalog's way to offer a diagnostic entity. The integration's README says the
 * meaning of `status`, of the network level and of most alarm codes is not confirmed: the card shows them as the integration gives them, it does
 * not guess «online» or «parking mode on» from a raw number. No SD card entity exists. Pure: reads the registry, sends nothing. */
import type { ApplianceFamily } from './types.ts';
import type { Profile, ProfileInstance, RoleSpec } from '../model/card-catalog.ts';
import { unavailable, type Registry } from '../model/registry.ts';
import type { Key, T } from '../i18n/index.ts';
import { num, type Lang } from '../ui/format.ts';
import { shortWhen } from './scale.profiles.ts';

const field = (id: string, domains: string[], suffix: RegExp, extra: Partial<RoleSpec> = {}): RoleSpec => ({ id, labelKey: `cat.r.dc.${id}`, domains, suffix, required: false, ...extra });
const A810: Profile = {
  id: '70mai.a810_up04', version: '1.0.0', category: 'car', brand: '70mai', titleKey: 'cat.p.a810', descKey: 'cat.p.a810.desc', models: [],
  integration: { platform: 'mai70', name: '70mai' }, terms: ['dashcam', 'dash cam', 'a810', 'up04', '70mai', 'регистратор', 'видеорегистратор', 'авто', 'машина', 'mașină', 'cameră auto', 'car'],
  renderer: 'appliance', card: 'dashcam', kind: 'measurement', icon: 'car', kindKey: 'cat.kind.dashcam', anchor: 'tracker', places: ['home', 'room'],
  roles: [
    field('tracker', ['device_tracker'], /_position$|dashcam|70mai/, { required: true, hintKey: 'cat.r.dc.tracker.hint', as: 'parameter' }),
    field('voltage', ['sensor'], /_battery_voltage$/, { deviceClass: ['voltage'], units: ['V'], as: 'metric' }),
    field('alarm', ['event'], /_alarm$/, { as: 'metric' }),
    field('lastReport', ['sensor'], /_last_report$/, { deviceClass: ['timestamp'], as: 'parameter' }),
    field('network', ['sensor'], /_network_level$/, { as: 'parameter' }),
    field('upload', ['binary_sensor'], /_monitor_upload$/, { as: 'parameter' }),
    field('simPower', ['binary_sensor'], /_sim_out_power$/, { as: 'parameter' }),
    field('parkingPhoto', ['image'], /_parking_photo$/, { as: 'metric' }),
    field('firmware', ['sensor'], /_firmware$/, { exclude: /cellular/, as: 'parameter' }),
  ],
};
export const DASHCAM_PROFILES: Profile[] = [A810];

const dk = (t: T, k: string, p?: Record<string, string | number>) => t(`dashcam.${k}` as Key, p);
const numOf = (v: unknown): number | null => { if (v === null || v === undefined || typeof v === 'boolean' || (typeof v === 'string' && (!v.trim() || unavailable(v)))) return null; const x = Number(v); return Number.isFinite(x) ? x : null; };
const msOf = (v: unknown): number | null => { if (typeof v === 'number' && Number.isFinite(v) && v > 0) return v < 1e12 ? v * 1000 : v; if (typeof v === 'string' && !unavailable(v)) { const x = Date.parse(v); return Number.isFinite(x) ? x : null; } return null; };
/** The alarm codes the card has words for (the event's own `event_types`); any other is said as the integration names it. */
export const ALARM_KINDS = ['collision', 'suspicious_person', 'battery_protection', 'alarm'] as const;
export type Place = { kind: 'home' | 'away' | 'zone'; zone: string | null; lat: number | null; lon: number | null; accuracy: number | null; at: number | null };
export interface DashcamRead {
  available: boolean; place: Place | null;
  /** volts of the car's battery, and what they mean for a 12 V lead-acid battery at rest */ volts: number | null; battery: 'charging' | 'good' | 'mid' | 'low' | null;
  alarm: { kind: string; at: number; fresh: boolean; picture: string | null } | null;
  lastReport: number | null; network: number | null; upload: boolean | null; simPower: boolean | null; firmware: string | null; parkingPhoto: string | null;
}
const onOff = (s: string | undefined) => s === 'on' ? true : s === 'off' ? false : null;
/** 12 V lead-acid at rest: ≥ 12,4 well charged, 12,0–12,4 half, under 12,0 low (the engine may not start); ≥ 13,2 the alternator is charging. */
export const batteryOf = (v: number): DashcamRead['battery'] => v >= 13.2 ? 'charging' : v >= 12.4 ? 'good' : v >= 12 ? 'mid' : 'low';
export function readDashcam(reg: Registry, b: Record<string, string>, now = Date.now()): DashcamRead {
  const st = (r: string) => b[r] ? reg.states[b[r]] : undefined;
  const tr = st('tracker'), ta = tr?.attributes ?? {};
  const available = !!tr && tr.state !== 'unavailable';
  const place: Place | null = !tr || unavailable(tr.state) ? null : { kind: tr.state === 'home' ? 'home' : tr.state === 'not_home' ? 'away' : 'zone', zone: tr.state === 'home' || tr.state === 'not_home' ? null : tr.state, lat: numOf(ta.latitude), lon: numOf(ta.longitude), accuracy: numOf(ta.gps_accuracy), at: msOf(ta.last_update_time) };
  const volts = numOf(st('voltage')?.state);
  const ev = st('alarm'), ea = ev?.attributes ?? {};
  // the moment the camera saw it (`happen_time`), not when HA heard of it (the event's state: hours later through the cloud)
  const at = msOf(ea.happen_time) ?? msOf(ev?.state);
  const kind = typeof ea.event_type === 'string' ? ea.event_type : typeof ea.alarm_name === 'string' ? ea.alarm_name : null;
  const pic = [ea.cover_url, ea.picture_url].find((x): x is string => typeof x === 'string' && /^https?:|^\//.test(x)) ?? null;
  const photo = st('parkingPhoto'), photoUrl = photo && !unavailable(photo.state) && typeof photo.attributes.entity_picture === 'string' ? photo.attributes.entity_picture : null;
  const fw = st('firmware');
  return {
    available, place, volts, battery: volts === null ? null : batteryOf(volts),
    alarm: at !== null && kind ? { kind, at, fresh: now - at < 24 * 3600_000, picture: pic } : null,
    lastReport: msOf(st('lastReport')?.state), network: numOf(st('network')?.state), upload: onOff(st('upload')?.state), simPower: onOff(st('simPower')?.state),
    firmware: fw && !unavailable(fw.state) ? fw.state : null, parkingPhoto: photoUrl,
  };
}
export const alarmText = (kind: string, t: T) => (ALARM_KINDS as readonly string[]).includes(kind) ? dk(t, `alarm.${kind}`) : kind.replace(/_/g, ' ');
export const placeText = (p: Place, t: T) => p.kind === 'home' ? dk(t, 'home') : p.kind === 'away' ? dk(t, 'away') : p.zone!;
export const voltsText = (v: number, lang: Lang, t: T) => `${num(v, lang, 1)} ${dk(t, 'v')}`;

export const family: ApplianceFamily = {
  id: 'dashcam', profiles: DASHCAM_PROFILES,
  // a fresh alarm first («Столкновение · сегодня, 09:28»); else where the car is and its battery («Дома · 12,6 В»)
  tileLine(reg: Registry, inst: ProfileInstance, t: T, lang: Lang) {
    const d = readDashcam(reg, inst.bindings);
    if (!d.available) return t('state.unavailable');
    if (d.alarm?.fresh) return `${alarmText(d.alarm.kind, t)} · ${shortWhen(d.alarm.at, t, lang)}`;
    return [d.place ? placeText(d.place, t) : null, d.volts !== null ? voltsText(d.volts, lang, t) : null].filter(Boolean).join(' · ') || t('state.unknown');
  },
};
