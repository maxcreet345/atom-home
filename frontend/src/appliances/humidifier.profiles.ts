/* The humidifier family (types.ts): its catalog profiles and the second line of its tile. Pure: reads the registry, never calls a service.
 * Xiaomi Smart Humidifier 2 (deerma.humidifier.jsq2w) through Xiaomi Miot. Its MIOT spec (home.miot-spec.com, read 21.11.2026):
 *  - humidifier: on; fault 0 none / 1 low water / 2 tank separated; fan-level 1, 2, 3, 4 = constant humidity (恒湿); target-humidity 40–70 step 1;
 *    mode 0 fan level / 1 constant humidity (HA shows it as `available_modes: Off, None, Constant Humidity`);
 *  - environment: relative-humidity, temperature; alarm (the beep); indicator-light;
 *  - custom: the-tank-filed (水箱提起: the tank is LIFTED off), water-shortage-fault. No child lock, no filter on this model.
 * Its power plug (a metering relay) is an optional field bound on purpose: its power reading, and its switch to say «Розетка выключена» when the
 * humidifier is silent because the plug is off (it was so in the house on 21.11.2026). */
import type { ApplianceFamily } from './types.ts';
import type { Profile, ProfileInstance } from '../model/card-catalog.ts';
import type { Registry } from '../model/registry.ts';
import type { Key, T } from '../i18n/index.ts';
import { num, type Lang } from '../ui/format.ts';

const HUMIDIFIER_2: Profile = {
  id: 'xiaomi.humidifier2', version: '1.0.0', category: 'humidifiers', brand: 'Xiaomi', titleKey: 'cat.p.humidifier2', descKey: 'cat.p.humidifier2.desc',
  models: ['deerma.humidifier.jsq2w'], integration: { platform: 'xiaomi_miot', name: 'Xiaomi Miot' },
  terms: ['humidifier', 'smart humidifier 2', 'humidifier 2', 'jsq2w', 'deerma', 'увлажнитель', 'umidificator'],
  renderer: 'appliance', card: 'humidifier', kind: 'fan', icon: 'water', kindKey: 'cat.kind.humidifier', anchor: 'humidifier', places: ['home', 'room'],
  roles: [
    { id: 'humidifier', labelKey: 'cat.r.hu.humidifier', hintKey: 'cat.r.hu.humidifier.hint', required: true, domains: ['humidifier'], source: 'own', as: 'primary' },
    { id: 'humidity', labelKey: 'cat.r.hu.humidity', hintKey: 'cat.r.hu.humidity.hint', required: false, domains: ['sensor'], deviceClass: ['humidity'], units: ['%'], suffix: /_humidity$/, as: 'metric' },
    { id: 'waterShortage', labelKey: 'cat.r.hu.waterShortage', required: false, domains: ['binary_sensor'], suffix: /_water_shortage(_fault)?$/, source: 'own', as: 'metric' },
    { id: 'tankLifted', labelKey: 'cat.r.hu.tankLifted', required: false, domains: ['binary_sensor'], suffix: /_tank_(installed|filed|lifted|removed)$/, source: 'own', as: 'metric' },
    { id: 'fault', labelKey: 'cat.r.hu.fault', required: false, domains: ['sensor'], suffix: /_fault$/, source: 'own', as: 'metric' },
    { id: 'fanLevel', labelKey: 'cat.r.hu.fanLevel', required: false, domains: ['select'], suffix: /_fan_level$/, source: 'own', as: 'parameter' },
    { id: 'temperature', labelKey: 'cat.r.temperature', required: false, domains: ['sensor'], deviceClass: ['temperature'], units: ['°C'], suffix: /_temperature$/, source: 'own', as: 'metric' },
    { id: 'indicator', labelKey: 'cat.r.hu.indicator', required: false, domains: ['light', 'switch'], suffix: /_indicator(_light)?$/, source: 'own', as: 'parameter' },
    { id: 'buzzer', labelKey: 'cat.r.buzzer', required: false, domains: ['switch'], suffix: /_(buzzer|alarm)$/, source: 'own', as: 'parameter' },
    { id: 'plugPower', labelKey: 'cat.r.hu.plugPower', hintKey: 'cat.r.hu.plugPower.hint', required: false, domains: ['sensor'], deviceClass: ['power'], units: ['W'], as: 'metric' },
    { id: 'plug', labelKey: 'cat.r.hu.plug', hintKey: 'cat.r.hu.plug.hint', required: false, domains: ['switch'], as: 'parameter' },
  ],
};

export type HuPhase = 'house' | 'plugOff' | 'offline' | 'unknown' | 'off' | 'on';
export interface HuState {
  phase: HuPhase; /** the device answers (on, off) */ available: boolean;
  /** the room's humidity now: the bound sensor (the device's own or the room's), else the humidifier's own `current_humidity` */ current: number | null;
  target: number | null; min: number; max: number; step: number;
  /** the fan level the select holds (1…3), or 'auto' (constant humidity: the 4th level, or the humidifier's mode) */ level: number | 'auto' | null;
  /** the select's options as the card offers them: the HA option and what it means */ levels: Array<{ option: string; level: number | 'auto' }>;
  noWater: boolean; tankOut: boolean; /** a fault the model reports that is neither water nor the tank: its own words */ fault: string | null;
  temperature: number | null; watts: number | null; buzzer: boolean | null; light: boolean | null;
}
const n = (v: unknown): number | null => { if (v === null || v === undefined || typeof v === 'boolean' || (typeof v === 'string' && !v.trim())) return null; const x = Number(v); return Number.isFinite(x) ? x : null; };
const onOff = (s: string | undefined): boolean | null => s === 'on' ? true : s === 'off' ? false : null;
const NO_FAULT = /^(0|none|no[\s_-]*faults?|normal|ok|无故障)$/i, WATER = /water|shortage|lack|insufficient|水量|缺水/i, TANK = /tank|separat|水箱/i;
/** «Level1» → 1, «Level4» / «Constant Humidity» → 'auto' (the model's 4th level is constant humidity) */
export function levelOf(option: string, count: number): number | 'auto' | null {
  if (/constant|humid|auto|恒湿/i.test(option)) return 'auto';
  const d = option.match(/(\d+)/); if (!d) return null; const v = Number(d[1]);
  return count >= 4 && v === count ? 'auto' : v;
}
/** Everything the card and its tile say, from the bindings only. `online`: the house answers. */
export function readHumidifier(reg: Registry, b: Record<string, string>, online = true): HuState {
  const st = (role: string) => b[role] ? reg.states[b[role]] : undefined;
  const main = st('humidifier'), a = main?.attributes ?? {};
  const s = main?.state, available = online && (s === 'on' || s === 'off');
  const plug = st('plug')?.state;
  const phase: HuPhase = !online ? 'house' : available ? s as 'on' | 'off' : !main || s === 'unavailable' ? (plug === 'off' ? 'plugOff' : 'offline') : 'unknown';
  // the room's humidity is the room's: an external sensor still says it when the humidifier is silent; the house unreachable says nothing «now»
  const hum = st('humidity'), humLive = hum && hum.state !== 'unavailable' ? n(hum.state) : null;
  const current = !online ? null : humLive ?? (available ? n(a.current_humidity) : null);
  const min = n(a.min_humidity) ?? 40, max = n(a.max_humidity) ?? 70, step = n(a.target_humidity_step) ?? 1;
  const target = available ? n(a.humidity) : null;
  const sel = st('fanLevel'), opts = Array.isArray(sel?.attributes.options) ? (sel!.attributes.options as unknown[]).filter((o): o is string => typeof o === 'string') : [];
  const levels = opts.map(o => ({ option: o, level: levelOf(o, opts.length) })).filter((x): x is { option: string; level: number | 'auto' } => x.level !== null);
  const fromSel = available && sel && opts.includes(sel.state) ? levelOf(sel.state, opts.length) : null;
  const level = !available ? null : typeof a.mode === 'string' && /constant|humid/i.test(a.mode) ? 'auto' : fromSel;
  const faultRaw = available ? String(st('fault')?.state ?? '').trim() : '';
  const realFault = !!faultRaw && !['unavailable', 'unknown'].includes(faultRaw) && !NO_FAULT.test(faultRaw);
  const tankOut = available && (st('tankLifted')?.state === 'on' || (realFault && TANK.test(faultRaw)));
  const noWater = available && !tankOut && (st('waterShortage')?.state === 'on' || (realFault && WATER.test(faultRaw)));
  const fault = available && realFault && !WATER.test(faultRaw) && !TANK.test(faultRaw) ? faultRaw : null;
  const temp = st('temperature'), power = st('plugPower');
  return {
    phase, available, current, target, min, max, step, level, levels, noWater, tankOut, fault,
    temperature: available && temp ? n(temp.state) : null, watts: online && power && power.state !== 'unavailable' ? n(power.state) : null,
    buzzer: available ? onOff(st('buzzer')?.state) : null, light: available ? onOff(st('indicator')?.state) : null,
  };
}
const hk = (t: T, k: string, p?: Record<string, string | number>) => t(`hu.${k}` as Key, p);
/** «Слабо», «Средне», «Сильно», «Авто»; a level the model has beyond three: «Уровень 5» */
export const levelWord = (t: T, level: number | 'auto') => level === 'auto' ? hk(t, 'level.auto') : level >= 1 && level <= 3 ? hk(t, `level.${level}`) : hk(t, 'level.n', { n: level });
/** The tile's second line: «52 % → 60 %» (holding a humidity), «52 % · Сильно», «Нет воды», «Бак снят», «Выключен · 52 %», «Розетка выключена». */
export function humidifierLine(h: HuState, t: T, lang: Lang): string {
  const pct = (v: number) => `${num(v, lang, 0)} %`;
  if (h.phase === 'house' || h.phase === 'offline') return hk(t, 'tile.offline');
  if (h.phase === 'plugOff') return hk(t, 'tile.plugOff');
  if (h.phase === 'unknown') return t('state.unknown');
  if (h.tankOut) return hk(t, 'tile.tankOut');
  if (h.noWater) return hk(t, 'tile.noWater');
  if (h.fault) return hk(t, 'tile.fault');
  if (h.phase === 'off') return h.current === null ? hk(t, 'tile.off') : `${hk(t, 'tile.off')} · ${pct(h.current)}`;
  const now = h.current === null ? '' : pct(h.current);
  if (h.level === 'auto' || (h.level === null && h.target !== null)) return h.target === null ? now || hk(t, 'tile.on') : `${now ? `${now} ` : ''}→ ${pct(h.target)}`;
  return [now, h.level !== null ? levelWord(t, h.level) : hk(t, 'tile.on')].filter(Boolean).join(' · ');
}
/** What the hero says under the big number. */
export function statusText(h: HuState, t: T, lang: Lang): string {
  switch (h.phase) {
    case 'house': return t('ui.offline' as Key);
    case 'plugOff': return hk(t, 'plugOff');
    case 'offline': return hk(t, 'offline');
    case 'unknown': return hk(t, 'unknown');
    case 'off': return hk(t, 'off');
    default: return h.level === 'auto' && h.target !== null ? hk(t, 'holding', { v: num(h.target, lang, 0) }) : h.level !== null ? hk(t, 'running', { m: levelWord(t, h.level) }) : hk(t, 'on');
  }
}

export const family: ApplianceFamily = {
  id: 'humidifier', profiles: [HUMIDIFIER_2],
  tileLine: (reg: Registry, inst: ProfileInstance, t: T, lang: Lang) => humidifierLine(readHumidifier(reg, inst.bindings), t, lang),
};
