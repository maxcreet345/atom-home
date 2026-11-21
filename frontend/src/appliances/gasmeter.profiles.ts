/* The gas meter family (types.ts): a gas counter read by a camera (a sensor of class `gas` that only grows, and the camera that looks at the
 * meter's drums). In Criuleni: the kitchen meter, read every 5 minutes by an OpenIPC camera and an AI; an automation checks each answer before
 * writing it (book/03-devices/gas-meter.md). The meter itself is the panel's own gas model (model/gas.ts) — the same reading «Энергия» shows;
 * today and this month come from HA's statistics through the gas card's hook. Two optional helpers tell whether the reading is fresh: the time of
 * the last ACCEPTED reading and the AI's last answer («? …» = it could not read). Pure: reads the registry, sends nothing. */
import type { ApplianceFamily } from './types.ts';
import type { Profile, ProfileInstance, RoleSpec } from '../model/card-catalog.ts';
import { unavailable, type Registry } from '../model/registry.ts';
import { gasMeters } from '../model/gas.ts';
import type { Key, T } from '../i18n/index.ts';
import { num, type Lang } from '../ui/format.ts';
import { shortWhen } from './scale.profiles.ts';

const field = (id: string, domains: string[], extra: Partial<RoleSpec> = {}): RoleSpec => ({ id, labelKey: `cat.r.gm.${id}`, domains, required: false, ...extra });
const CAMERA_METER: Profile = {
  id: 'meter.gas_camera', version: '1.0.0', category: 'meters', brand: null, titleKey: 'cat.p.gasCamera', descKey: 'cat.p.gasCamera.desc', models: [],
  terms: ['gas', 'gas meter', 'газ', 'счётчик', 'счетчик', 'gaz', 'contor', 'camera', 'камера', 'ocr', 'llm vision'],
  renderer: 'appliance', card: 'gasmeter', kind: 'measurement', icon: 'flame', kindKey: 'cat.kind.gasmeter', anchor: 'meter', places: ['home', 'room'],
  roles: [
    field('meter', ['sensor'], { required: true, hintKey: 'cat.r.gm.meter.hint', deviceClass: ['gas'], units: ['m³', 'm3'], as: 'primary' }),
    field('camera', ['camera'], { hintKey: 'cat.r.gm.camera.hint', suffix: /gas|meter|счетчик|contor/, as: 'metric' }),
    field('lastRead', ['input_datetime', 'sensor'], { suffix: /_last_read$/, as: 'metric' }),
    field('answer', ['input_text', 'sensor'], { hintKey: 'cat.r.gm.answer.hint', suffix: /_raw$/, as: 'metric' }),
  ],
};
export const GASMETER_PROFILES: Profile[] = [CAMERA_METER];

const gk = (t: T, k: string, p?: Record<string, string | number>) => t(`gasmeter.${k}` as Key, p);
/** The camera reads every 5 minutes: three missed reads in a row and the reading is no longer «now». */
export const STALE_MS = 30 * 60_000;
export type Problem = 'stale' | 'rejected' | 'unread';
export interface GasMeterRead {
  available: boolean; value: number | null; unit: string; lastRead: number | null;
  /** the AI's last answer as the helper keeps it; `unread` when it could not read the drums («? …»), its figure when it gave one */ answer: string | null; answerValue: number | null; unread: boolean;
  problem: Problem | null; camera: string | null; cameraOnline: boolean;
}
const tsOf = (state: string | undefined, attrs: Record<string, unknown> | undefined): number | null => {
  if (!state || unavailable(state)) return null;
  const ts = attrs?.timestamp; if (typeof ts === 'number' && Number.isFinite(ts) && ts > 0) return ts * 1000; // input_datetime: real seconds in the house's zone
  const x = Date.parse(state.includes('T') ? state : state.replace(' ', 'T')); return Number.isFinite(x) ? x : null;
};
export function readGasMeter(reg: Registry, b: Record<string, string>, now = Date.now()): GasMeterRead {
  const st = (r: string) => b[r] ? reg.states[b[r]] : undefined;
  const m = b.meter ? gasMeters(reg).find(x => x.id === b.meter) : undefined, ms = st('meter');
  const value = m ? m.value : ms && !unavailable(ms.state) && Number.isFinite(Number(ms.state)) ? Number(ms.state) : null;
  const unit = m?.unit ?? (typeof ms?.attributes.unit_of_measurement === 'string' ? ms.attributes.unit_of_measurement : 'm³');
  const lr = st('lastRead'), lastRead = tsOf(lr?.state, lr?.attributes);
  const ans = st('answer'), answer = ans && !unavailable(ans.state) ? ans.state.trim() : null;
  const unread = !!answer && /^\?/.test(answer);
  const fig = answer && !unread ? /\d+(?:[.,]\d+)?/.exec(answer) : null, answerValue = fig ? Number(fig[0].replace(',', '.')) : null;
  const stale = lastRead !== null && now - lastRead > STALE_MS;
  // the automation refused the AI's figure (it was below the reading or grew faster than the meter can): it is said, never shown as the reading
  const rejected = answerValue !== null && value !== null && Math.abs(answerValue - value) > 0.05;
  const cam = st('camera');
  return { available: !!ms && ms.state !== 'unavailable', value, unit, lastRead, answer, answerValue, unread, problem: !(ms && ms.state !== 'unavailable') ? null : stale ? 'stale' : rejected ? 'rejected' : unread ? 'unread' : null, camera: b.camera ?? null, cameraOnline: !!cam && !unavailable(cam.state) };
}
export const m3 = (v: number | null, lang: Lang, t: T, digits = 3) => v === null ? '—' : `${num(v, lang, digits)} ${t('gas.m3' as Key)}`;

export const family: ApplianceFamily = {
  id: 'gasmeter', profiles: GASMETER_PROFILES,
  // «970,684 м³ · сегодня, 12:20»; a meter the camera no longer reads says so («Не читается · 970,684 м³»)
  tileLine(reg: Registry, inst: ProfileInstance, t: T, lang: Lang) {
    const g = readGasMeter(reg, inst.bindings);
    if (!g.available) return t('state.unavailable');
    const v = m3(g.value, lang, t);
    return g.problem === 'stale' ? gk(t, 'tileStale', { v }) : g.lastRead !== null ? `${v} · ${shortWhen(g.lastRead, t, lang)}` : v;
  },
};
