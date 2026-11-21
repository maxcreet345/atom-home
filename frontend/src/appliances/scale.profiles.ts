/* The scale family (types.ts): Xiaomi Mi Body Composition Scale 2 through HA's Xiaomi BLE, the people who stand on it through
 * «Multi-User Scale Router» (one weight sensor per person, each naming the scale's sensor it was routed from: `source_entity_id`) and their body
 * composition through «Bodymiscale» (one device per person: BMI, basal metabolism, visceral fat… and an `ideal` weight).
 * Reference: Mi Fit / Zepp Life — the last weighing (who, when, how much), then each person's weight, its trend, BMI and the rest.
 * Privacy (a shared wall panel, health data of a family): the tile never says a weight, only when the last weighing was; the sheet keeps every
 * figure folded until a tap. Pure: reads the registry, sends nothing. */
import type { ApplianceFamily } from './types.ts';
import type { Profile, ProfileInstance, RoleSpec } from '../model/card-catalog.ts';
import { unavailable, type Registry, type EntityRow } from '../model/registry.ts';
import type { Key, T } from '../i18n/index.ts';
import { locales, num, type Lang } from '../ui/format.ts';
import { dateFormat, houseDay, zoneOption } from '../runtime/zone.ts';

const own = (id: string, labelKey: string, domains: string[], suffix: RegExp, extra: Partial<RoleSpec> = {}): RoleSpec => ({ id, labelKey, domains, suffix, required: false, source: 'own', ...extra });
/** a person's weight from the router: any weight sensor of the house, the installer picks whose (they are not the scale's own device). No
 * suffix: the scale's own `…_weight` would be «the» suggestion for every person; the card finds the people by itself when these stay empty. */
const person = (n: number): RoleSpec => ({ id: `person${n}`, labelKey: `cat.r.scalePerson${n}`, hintKey: 'cat.r.scalePerson.hint', required: false, domains: ['sensor'], deviceClass: ['weight'], units: ['kg'], exclude: /_raw$|нестабил|unstab/i, as: 'metric' });
const MI_SCALE_2: Profile = {
  id: 'xiaomi.scale2', version: '1.0.0', category: 'health', brand: 'Xiaomi', titleKey: 'cat.p.scale2', descKey: 'cat.p.scale2.desc',
  models: ['XMTZC02HM/XMTZC05HM/NUN4049CN'], integration: { platform: 'xiaomi_ble', name: 'Xiaomi BLE' },
  terms: ['scale', 'body composition', 'mi body composition scale 2', 'весы', 'cântar', 'xmtzc02hm', 'xmtzc05hm', 'nun4049cn', 'bodymiscale', 'zepp', 'mi fit'],
  renderer: 'appliance', card: 'scale', kind: 'measurement', icon: 'person', kindKey: 'cat.kind.scale', anchor: 'weight', places: ['home', 'room'],
  roles: [
    own('weight', 'cat.r.scaleWeight', ['sensor'], /_weight$/, { required: true, deviceClass: ['weight'], units: ['kg'], exclude: /_raw$/, as: 'primary', hintKey: 'cat.r.scaleWeight.hint' }),
    own('stable', 'cat.r.scaleStable', ['binary_sensor'], /_stabili[sz]ed$/),
    own('impedance', 'cat.r.scaleImpedance', ['sensor'], /_impedance$/),
    person(1), person(2), person(3), person(4),
  ],
};
export const SCALE_PROFILES: Profile[] = [MI_SCALE_2];

// ---- reading ----
const sk = (t: T, k: string, p?: Record<string, string | number>) => t(`scale.${k}` as Key, p);
const numOf = (v: unknown): number | null => { if (v === null || v === undefined || typeof v === 'boolean' || (typeof v === 'string' && (!v.trim() || unavailable(v)))) return null; const x = Number(v); return Number.isFinite(x) ? x : null; };
const timeOf = (v: unknown): number | null => { if (typeof v === 'number') return Number.isFinite(v) ? (v < 1e12 ? v * 1000 : v) : null; if (typeof v !== 'string' || unavailable(v)) return null; const x = Date.parse(v); return Number.isFinite(x) ? x : null; };
/** One figure of a person's body composition (Bodymiscale's sensors, by their own entity suffix). */
export interface Fact { key: string; value: number | string; unit: string | null }
export interface Person {
  /** the router's weight sensor of this person */ id: string; name: string; weight: number | null; unit: string;
  /** when this person last stood on the scale (the integrations' own time; HA's last_changed is the restart's) */ at: number | null;
  /** the router's own list of this person's weighings, oldest first */ history: Array<{ at: number; kg: number }>;
  ideal: number | null; bmi: number | null; facts: Fact[];
}
export interface ScaleRead { available: boolean; persons: Person[]; last: Person | null }
/** Bodymiscale's sensors in the order Zepp Life shows them; BMI and weight have their own places on the card. */
export const FACTS: Array<[string, RegExp]> = [['bodyFat', /_body_fat$/], ['muscle', /_muscle_mass$/], ['water', /_water$/], ['visceral', /_visceral_fat$/], ['bone', /_bone_mass$/], ['protein', /_protein$/], ['basal', /_basal_metabolism$/], ['metabolicAge', /_metabolic_age$/], ['lean', /_lean_body_mass$/], ['bodyType', /_body_type$/], ['score', /_(body_)?score$/]];
/** «Арарат's Weight» (the router's own name for the sensor) → «Арарат» */
const nameOfRouted = (reg: Registry, e: EntityRow | undefined, id: string) => { const n = e?.original_name ?? ''; const m = /^(.+?)['’]s\s+weight$/i.exec(n.trim()); if (m) return m[1].trim(); const f = reg.states[id]?.attributes.friendly_name; return typeof f === 'string' ? f : id; };
const low = (s: string | null | undefined) => (s ?? '').trim().toLowerCase();
/** The person's Bodymiscale: its device named as the router names the person (both integrations take the name the family gave), else its
 * `bodymiscale.<x>` entity of that name. Never Criuleni's own names or ids. */
function bodyOf(reg: Registry, name: string) {
  const want = low(name), body = reg.entities.filter(e => e.platform === 'bodymiscale' && !e.disabled_by);
  const dev = [...new Set(body.map(e => e.device_id).filter((d): d is string => !!d))].find(d => low(reg.devices.find(x => x.id === d)?.name) === want);
  const sensors = dev ? body.filter(e => e.device_id === dev && e.entity_id.startsWith('sensor.')) : [];
  const main = body.find(e => e.entity_id.startsWith('bodymiscale.') && (low(e.original_name) === want || low(reg.states[e.entity_id]?.attributes.friendly_name as string) === want));
  return { sensors, attrs: main ? reg.states[main.entity_id]?.attributes ?? {} : {} };
}
function readPerson(reg: Registry, id: string): Person {
  const e = reg.entities.find(x => x.entity_id === id), s = reg.states[id], a = s?.attributes ?? {}, name = nameOfRouted(reg, e, id);
  const history = (Array.isArray(a.weight_history) ? a.weight_history : []).flatMap((h: unknown) => { const r = h as Record<string, unknown>; const at = timeOf(r?.timestamp), kg = numOf(r?.weight); return at !== null && kg !== null ? [{ at, kg }] : []; }).sort((x, y) => x.at - y.at);
  const body = bodyOf(reg, name), by = (re: RegExp) => body.sensors.find(x => re.test(x.entity_id));
  const val = (re: RegExp) => { const x = by(re); return x ? reg.states[x.entity_id] : undefined; };
  const bodyWeight = val(/_weight$/), last = val(/_last_measurement$/);
  const weight = numOf(s?.state) ?? numOf(bodyWeight?.state) ?? (history.length ? history[history.length - 1].kg : null);
  const at = Math.max(history.length ? history[history.length - 1].at : 0, timeOf(last?.state) ?? 0, timeOf(body.attrs.last_measurement_time) ?? 0) || null;
  const ideal = numOf(bodyWeight?.attributes.ideal) ?? numOf(body.attrs.ideal);
  const facts: Fact[] = FACTS.flatMap(([key, re]) => { const st = val(re); if (!st || unavailable(st.state)) return []; const n = numOf(st.state); return [{ key, value: n ?? st.state, unit: typeof st.attributes.unit_of_measurement === 'string' ? st.attributes.unit_of_measurement : null }]; });
  return { id, name, weight, unit: typeof a.unit_of_measurement === 'string' ? a.unit_of_measurement : 'kg', at, history, ideal, bmi: numOf(val(/_bmi$/)?.state) ?? numOf(body.attrs.bmi), facts };
}
/** The people of this scale: the ones bound to the card, else every router sensor routed from the card's own weight sensor. */
export function personIds(reg: Registry, b: Record<string, string>): string[] {
  const scaleDev = b.weight ? reg.entities.find(e => e.entity_id === b.weight)?.device_id ?? null : null;
  const notScale = (id: string) => id !== b.weight && (!scaleDev || reg.entities.find(e => e.entity_id === id)?.device_id !== scaleDev);
  const bound = [1, 2, 3, 4].map(n => b[`person${n}`]).filter((x): x is string => !!x && !!reg.states[x] && notScale(x));
  if (bound.length || !b.weight) return [...new Set(bound)];
  // the router names its source only once a person has weighed: its other people are the weight sensors of the same router device
  const routed = reg.entities.filter(e => !e.disabled_by && e.entity_id.startsWith('sensor.') && reg.states[e.entity_id]?.attributes.source_entity_id === b.weight);
  const routers = new Set(routed.map(e => e.device_id).filter((d): d is string => !!d && d !== scaleDev));
  const same = reg.entities.filter(e => !e.disabled_by && e.device_id && routers.has(e.device_id) && e.entity_id.startsWith('sensor.') && e.entity_category !== 'diagnostic' && reg.states[e.entity_id] && (e.device_class ?? reg.states[e.entity_id].attributes.device_class) === 'weight');
  return [...new Set([...routed, ...same].map(e => e.entity_id))].filter(notScale);
}
export function readScale(reg: Registry, b: Record<string, string>): ScaleRead {
  const w = b.weight ? reg.states[b.weight] : undefined;
  const persons = personIds(reg, b).map(id => readPerson(reg, id));
  const last = persons.filter(p => p.at !== null).sort((x, y) => y.at! - x.at!)[0] ?? null;
  return { available: !!w && w.state !== 'unavailable', persons, last };
}
/** BMI by the WHO bands (the same Zepp Life colours its bar by) */
export const bmiBand = (bmi: number): 'under' | 'normal' | 'over' | 'obese' => bmi < 18.5 ? 'under' : bmi < 25 ? 'normal' : bmi < 30 ? 'over' : 'obese';

// ---- words of time, shared by the info cards (scale, dashcam, gas meter) ----
/** «сегодня, 19:41» / «вчера, 19:41» / «1 нояб., 19:41» in the house's clock */
export function whenText(at: number, t: T, lang: Lang, now = Date.now()): string {
  const time = dateFormat(locales[lang], { hour: '2-digit', minute: '2-digit', ...zoneOption() }).format(at);
  const d = houseDay(at), today = houseDay(now), yesterday = houseDay(now - 86_400_000);
  if (d === today) return t('scale.when.today' as Key, { time });
  if (d === yesterday) return t('scale.when.yesterday' as Key, { time });
  return t('scale.when.date' as Key, { date: dateFormat(locales[lang], { day: 'numeric', month: 'short', ...zoneOption() }).format(at), time });
}
/** «1 нояб.» — a short date only */
export const dayText = (at: number, t: T, lang: Lang, now = Date.now()) => houseDay(at) === houseDay(now) ? t('scale.when.todayShort' as Key) : houseDay(at) === houseDay(now - 86_400_000) ? t('scale.when.yesterdayShort' as Key) : dateFormat(locales[lang], { day: 'numeric', month: 'short', ...zoneOption() }).format(at);
export const kgText = (v: number | null, lang: Lang, t: T) => v === null ? '—' : `${num(v, lang, 1)} ${t('ep.unit.kg' as Key)}`;

export const family: ApplianceFamily = {
  id: 'scale', profiles: SCALE_PROFILES,
  // never a weight on the tile: only when the last weighing was (owner's decision pending, see the report of 21.11.2026)
  tileLine(reg: Registry, inst: ProfileInstance, t: T, lang: Lang) {
    const s = readScale(reg, inst.bindings);
    if (!s.available && !s.last) return t('state.unavailable');
    return s.last ? sk(t, 'tileLast', { when: whenText(s.last.at!, t, lang) }) : sk(t, 'tileNone');
  },
};
