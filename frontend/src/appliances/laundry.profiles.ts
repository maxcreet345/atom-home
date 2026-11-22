/* The laundry family (types.ts): washers and dryers. Pure — its catalog profiles, the reading of a machine's entities into one state the card
 * and the tile both say, the tile's line and the commands the card sends (so that tests see them without a browser).
 *  - LG washer F_R7_Y___W.A__QEUK through the core LG ThinQ integration: status, the end of the cycle (a TIMESTAMP, not minutes), its length,
 *    «remote start» on the machine, the error and «done» events, the start / stop / power-off select and the delayed end. ThinQ gives no
 *    program and no pause of its own: the card shows neither (its «Остановить» is LG's STOP, «Продолжить» is START).
 *  - Samsung DV8400D dryer (DA_WM_TP1_21_COMMON) through LocalThings (HACS, local): machine state, stage, progress, remaining minutes,
 *    estimated finish, alarm code, Smart Control, child lock, the program and its options, start / pause / stop buttons, delay, the drum
 *    light. Its SmartThings cloud copy is the same dryer (`sibling`). Program names: LocalThings' own table «dryer_cycle_table_03».
 *  - An optional plug with a meter (Sonoff POW) under either: the power now and the energy of the cycle.
 * Child lock: LocalThings reports it as a `lock` binary sensor in HA's sense — `on` = UNLOCKED (its dryer table inverts the wire value).
 * Commands to start, pause or stop are only ever sent after the person confirmed them (laundry.tsx); every write needs remote control on the
 * machine itself (LG «Дистанционный старт», Samsung «Smart Control»), and the card says so in words when it is off. */
import type { ApplianceFamily } from './types.ts';
import type { Profile, ProfileInstance, RoleSpec } from '../model/card-catalog.ts';
import type { Registry, StateRow } from '../model/registry.ts';
import type { Key, T } from '../i18n/index.ts';
import { locales, type Lang } from '../ui/format.ts';
import { dateFormat, zoneOption } from '../runtime/zone.ts';

const own = (id: string, labelKey: string, domains: string[], suffix: RegExp, extra: Partial<RoleSpec> = {}): RoleSpec => ({ id, labelKey, domains, suffix, required: false, source: 'own', ...extra });
/** the plug that feeds the machine: another device, picked by the installer (the room's own plug first) */
const PLUG: RoleSpec[] = [
  { id: 'plugPower', labelKey: 'cat.r.lnPlugPower', hintKey: 'cat.r.lnPlug.hint', required: false, domains: ['sensor'], deviceClass: ['power'], units: ['W', 'kW'], suffix: /_power$/, as: 'metric', plug: true },
  { id: 'plugEnergy', labelKey: 'cat.r.lnPlugEnergy', hintKey: 'cat.r.lnPlug.hint', required: false, domains: ['sensor'], deviceClass: ['energy'], units: ['kWh', 'Wh'], suffix: /_energy_total$/, plug: true },
  { id: 'plugToday', labelKey: 'cat.r.lnPlugToday', required: false, domains: ['sensor'], deviceClass: ['energy'], units: ['kWh', 'Wh'], suffix: /_energy_today$/, plug: true },
];
export const LG_WASHER: Profile = {
  id: 'lg.washer_f_r7', version: '1.0.0', category: 'laundry', brand: 'LG', titleKey: 'cat.p.lgWasher', descKey: 'cat.p.lgWasher.desc',
  models: ['F_R7_Y___W.A__QEUK (DEVICE_WASHER)'], integration: { platform: 'lg_thinq', name: 'LG ThinQ' },
  terms: ['washer', 'washing machine', 'стиральная', 'стиралка', 'mașină de spălat', 'spălat', 'thinq', 'f_r7', 'f4r7'],
  renderer: 'appliance', card: 'laundry', kind: 'measurement', icon: 'washer', kindKey: 'laundry.kind.washer', anchor: 'status', places: ['home', 'room'],
  roles: [
    own('status', 'cat.r.lnStatus', ['sensor'], /_current_status$/, { required: true, as: 'primary' }),
    own('endsAt', 'cat.r.lnEndsAt', ['sensor'], /_remaining_time$/),
    own('total', 'cat.r.lnTotal', ['sensor'], /_total_time$/),
    own('remote', 'cat.r.lnRemote', ['binary_sensor'], /_remote_start$/),
    own('operation', 'cat.r.lnOperation', ['select'], /_operation$/),
    own('error', 'cat.r.lnError', ['event'], /_error$/),
    own('notify', 'cat.r.lnNotify', ['event'], /_notification$/),
    own('delayEnd', 'cat.r.lnDelayEnd', ['number'], /_delayed_end$/),
    own('delayEndAt', 'cat.r.lnDelayEndAt', ['sensor'], /_delayed_end$/),
    own('cycles', 'cat.r.lnCycles', ['sensor'], /_cycles$/),
    own('power', 'cat.r.lnPower', ['switch'], /_power$/),
    ...PLUG,
  ],
};
export const SAMSUNG_DRYER: Profile = {
  id: 'samsung.dryer_dv8400', version: '1.0.0', category: 'laundry', brand: 'Samsung', titleKey: 'cat.p.samsungDryer', descKey: 'cat.p.samsungDryer.desc',
  models: ['DA_WM_TP1_21_COMMON'], integration: { platform: 'localthings', name: 'LocalThings (HACS)' },
  terms: ['dryer', 'tumble dryer', 'сушильная', 'сушилка', 'uscător', 'uscare', 'dv8400', 'dv8400d', 'bespoke', 'localthings', 'smartthings'],
  // found by its «running» sensor: the SmartThings copy of the same dryer has the same model code and only a progress sensor alive, so it is
  // never offered as a second dryer
  renderer: 'appliance', card: 'laundry', kind: 'measurement', icon: 'washer', kindKey: 'laundry.kind.dryer', anchor: 'running', places: ['home', 'room'],
  roles: [
    own('running', 'cat.r.lnRunning', ['binary_sensor'], /_running$/, { required: true, as: 'primary' }),
    own('machine', 'cat.r.lnStatus', ['sensor'], /_machine_state$/),
    own('stage', 'cat.r.lnStage', ['sensor'], /_stage$/),
    own('progress', 'cat.r.lnProgress', ['sensor'], /_progress$/),
    own('left', 'cat.r.lnLeft', ['sensor'], /_remaining$/),
    own('finishAt', 'cat.r.lnEndsAt', ['sensor'], /_estimated_finish$/),
    own('alarm', 'cat.r.lnAlarm', ['sensor'], /_alarm_code$/, { as: 'parameter' }), // a diagnostic entity: only a «parameter» role may hold it
    own('remote', 'cat.r.lnSmartControl', ['binary_sensor'], /_smart_control$/),
    own('childLock', 'cat.r.lnChildLock', ['binary_sensor'], /_child_lock$/),
    own('power', 'cat.r.lnPower', ['binary_sensor'], /_power$/),
    own('cycle', 'cat.r.lnCycle', ['select'], /_cycle$/),
    own('dryLevel', 'cat.r.lnDryLevel', ['select'], /_dry_level$/),
    own('dryTime', 'cat.r.lnDryTime', ['select'], /_dry_time$/),
    own('delay', 'cat.r.lnDelay', ['number'], /_delay_start$/),
    own('finishBy', 'cat.r.lnFinishBy', ['time'], /_finish_by$/),
    own('start', 'cat.r.lnStart', ['button'], /_start$/),
    own('pause', 'cat.r.lnPause', ['button'], /_pause$/),
    own('stop', 'cat.r.lnStop', ['button'], /_stop$/),
    own('wrinkle', 'cat.r.lnWrinkle', ['switch'], /_wrinkle_prevent$/),
    own('wrinkleActive', 'cat.r.lnWrinkleActive', ['binary_sensor'], /_wrinkle_prevent_active$/),
    own('damp', 'cat.r.lnDamp', ['switch'], /_damp_alert$/),
    own('drumClean', 'cat.r.lnDrumClean', ['sensor'], /_drum_clean_due_in$/),
    own('light', 'cat.r.lnLight', ['light'], /_drum_light$/),
    own('buzzer', 'cat.r.lnBuzzer', ['select'], /_buzzer_sound$/),
    own('finishSound', 'cat.r.lnFinishSound', ['select'], /_finish_sound$/),
    own('energy', 'cat.r.lnEnergy', ['sensor'], /_energy$/),
    // the same dryer through SmartThings' cloud: any of its entities; its tiles go away with this card. No suffix: its progress sensor
    // has the dryer's own name and would be taken for the LocalThings one — the installer picks it
    { id: 'cloud', labelKey: 'cat.r.lnCloud', hintKey: 'cat.r.lnCloud.hint', required: false, domains: ['sensor', 'binary_sensor', 'select', 'switch'], sibling: true },
    ...PLUG,
  ],
};

// ---- reading a machine ----
export type Phase = 'unavailable' | 'off' | 'idle' | 'delay' | 'running' | 'paused' | 'done' | 'error';
export type Step = 'sense' | 'wash' | 'steam' | 'rinse' | 'rinseHold' | 'spin' | 'dry' | 'cool' | 'refresh' | 'wrinkle';
export interface Laundry {
  machine: 'washer' | 'dryer'; brand: 'lg' | 'samsung';
  phase: Phase; step: Step | null; steps: Step[];
  /** the program in words (Samsung); null where the machine does not say it (LG ThinQ) */ program: string | null; programCode: string | null;
  /** the moment the cycle ends (ms) and the minutes left, only while it runs or pauses */ endAt: number | null; left: number | null;
  /** the whole program's minutes (LG's total, Samsung's remaining while idle = what the chosen program takes) */ total: number | null;
  progress: number | null; /** the delayed start / end moment */ delayAt: number | null;
  /** remote control allowed on the machine: true / false / not known */ remote: boolean | null;
  error: { code: string | null; key: Key | null } | null; doneAt: number | null;
  /** the machine's notices that are not errors (LocalThings: «FilterAlarm»…) */ alerts: string[];
  childLock: boolean | null; wrinkle: boolean; drumClean: number | null; cycles: number | null;
  /** the cycle began (ms), for the plug's energy of the cycle */ startAt: number | null;
}
const n = (v: unknown): number | null => { if (v === null || v === undefined || typeof v === 'boolean' || (typeof v === 'string' && !v.trim())) return null; const x = Number(v); return Number.isFinite(x) ? x : null; };
const ms = (v: unknown): number | null => { if (typeof v !== 'string' || !/^\d{4}-\d\d-\d\d/.test(v)) return null; const x = Date.parse(v); return Number.isFinite(x) ? x : null; };
const dead = (s: StateRow | undefined) => !s || s.state === 'unavailable' || s.state === 'unknown'; // audit 22.11.2026, H-3: a machine that says nothing is not «ожидание» with a live «Запустить»
const onOff = (s: StateRow | undefined): boolean | null => s?.state === 'on' ? true : s?.state === 'off' ? false : null;
const familyKind = (profileId: string): 'lg' | 'samsung' | null => profileId === LG_WASHER.id ? 'lg' : profileId === SAMSUNG_DRYER.id ? 'samsung' : null;
/** «Готово» stays this long after an LG washer finished and switched itself off — until it is switched on or started again */
export const DONE_KEEP_MS = 12 * 3_600_000;
const LG_ERRORS = ['out_of_balance_error', 'unable_to_lock_error', 'water_supply_error', 'water_level_sensor_error', 'overfill_error', 'door_open_error', 'temperature_sensor_error', 'water_drain_error', 'power_fail_error', 'locked_motor_error'];
/** LocalThings' «dryer_cycle_table_03» (codes confirmed on Samsung dryers by selecting each program and reading the code back) */
export const DRYER_CYCLES: Record<string, string> = { '01': 'normal', '06': 'timeDry', '16': 'cotton', '17': 'superSpeed', '18': 'synthetics', '19': 'delicates', '1a': 'wool', '1b': 'bedding', '1c': 'shirts', '1d': 'towels', '1e': 'outdoor', '1f': 'mixed', '20': 'ironDry', '21': 'hygiene', '22': 'silent', '23': 'quick35', '24': 'coolAir', '25': 'warmAir', '26': 'airWash', '27': 'timeDry', '29': 'aiDry', '2a': 'hygienePlus', '2b': 'selfTubDry', '4c': 'airRefresh', '4e': 'selfDry', '51': 'ecoCotton', '53': 'aiDryPlus' };
export const cycleName = (code: string | null | undefined, t: T): string | null => { if (!code || code === 'unknown' || code === 'unavailable') return null; const k = DRYER_CYCLES[code.toLowerCase()]; return k ? t(`laundry.cycle.${k}` as Key) : t('laundry.cycle.code', { code }); };

function readLg(reg: Registry, b: Record<string, string>, now: number): Laundry {
  const st = (r: string) => b[r] ? reg.states[b[r]] : undefined;
  const status = st('status'), s = String(status?.state ?? '').toLowerCase();
  const total = n(st('total')?.state), remote = onOff(st('remote')), cycles = n(st('cycles')?.state);
  const base: Laundry = { machine: 'washer', brand: 'lg', phase: 'idle', step: null, steps: ['wash', 'rinse', 'spin'], program: null, programCode: null, endAt: null, left: null, total, progress: null, delayAt: null, remote, error: null, alerts: [], doneAt: null, childLock: null, wrinkle: false, drumClean: null, cycles, startAt: null };
  if (dead(status) || s === 'unknown' || !s) return { ...base, phase: 'unavailable' };
  const STEP: Record<string, Step> = { detecting: 'sense', running: 'wash', steam_softening: 'steam', refreshing: 'refresh', rinsing: 'rinse', rinse_hold: 'rinseHold', spinning: 'spin', drying: 'dry', cool_down: 'cool' };
  let phase: Phase = s === 'power_off' || s === 'sleep' ? 'off' : s === 'initial' ? 'idle' : s === 'reserved' ? 'delay' : s === 'pause' || s === 'rinse_hold' ? 'paused' : s === 'end' ? 'done' : s === 'error' ? 'error' : STEP[s] ? 'running' : 'idle';
  const step = STEP[s] ?? null, steps: Step[] = step === 'dry' || step === 'cool' ? ['wash', 'rinse', 'spin', 'dry'] : base.steps;
  let endAt: number | null = null, left: number | null = null, progress: number | null = null, startAt: number | null = null, doneAt: number | null = null, error: Laundry['error'] = null;
  if (phase === 'running' || phase === 'paused') {
    endAt = ms(st('endsAt')?.state); left = endAt === null ? null : Math.max(0, Math.ceil((endAt - now) / 60_000));
    if (total && left !== null) progress = Math.max(0, Math.min(1, 1 - left / total));
    if (endAt !== null && total) startAt = endAt - total * 60_000;
  }
  const delayAt = phase === 'delay' ? ms(st('delayEndAt')?.state) : null;
  if (phase === 'error') { const type = st('error')?.attributes.event_type; error = { code: typeof type === 'string' ? type : null, key: typeof type === 'string' && LG_ERRORS.includes(type) ? `laundry.err.lg.${type}` as Key : null }; }
  // «done» while the machine says «end», and after it switched itself off — as long as nothing ran since: the laundry is still inside
  const note = st('notify'), noteAt = ms(note?.state), changed = ms(status?.last_changed);
  if (phase === 'done') doneAt = changed;
  else if (phase === 'off' && note?.attributes.event_type === 'washing_is_complete' && noteAt !== null && now - noteAt < DONE_KEEP_MS && (changed === null || changed >= noteAt - 10 * 60_000)) { phase = 'done'; doneAt = noteAt; }
  if (phase === 'done' && doneAt !== null && total) startAt = doneAt - total * 60_000;
  return { ...base, phase, step: phase === 'running' || phase === 'paused' ? step : null, steps, endAt, left, progress, startAt, doneAt, error, delayAt };
}
function readSamsung(reg: Registry, b: Record<string, string>, now: number): Laundry {
  const st = (r: string) => b[r] ? reg.states[b[r]] : undefined;
  const running = st('running'), machine = String(st('machine')?.state ?? '').toLowerCase(), stage = String(st('stage')?.state ?? '').toLowerCase();
  const isDryer = !!b.dryLevel || !!b.dryTime || /dry/.test(stage);
  const code = st('cycle')?.state ?? null, alarm = String(st('alarm')?.state ?? '').trim();
  const lock = onOff(st('childLock')), wrinkle = st('wrinkleActive')?.state === 'on';
  const base: Laundry = { machine: isDryer ? 'dryer' : 'washer', brand: 'samsung', phase: 'idle', step: null, steps: isDryer ? ['dry', 'cool'] : ['wash', 'rinse', 'spin'], program: null, programCode: code && !['unknown', 'unavailable'].includes(code) ? code : null, endAt: null, left: null, total: null, progress: null, delayAt: null,
    remote: onOff(st('remote')), error: null, alerts: [], doneAt: null, childLock: lock === null ? null : !lock /* HA's lock class: on = unlocked */, wrinkle, drumClean: n(st('drumClean')?.state), cycles: null, startAt: null };
  if (dead(running) || (b.machine && dead(st('machine')))) return { ...base, phase: 'unavailable' };
  const STEP: Record<string, Step> = { weightsensing: 'sense', laundrysensing: 'sense', drying: 'dry', aidrying: 'dry', dryingwithdooropen: 'dry', cooling: 'cool', airwashing: 'refresh', steaming: 'steam', sanitizing: 'steam', prewash: 'wash', wash: 'wash', predrain: 'wash', rinse: 'rinse', spin: 'spin' };
  const active = machine ? machine === 'active' || machine === 'run' : running?.state === 'on';
  // LocalThings joins the board's active alarm codes with «, » («FilterAlarm», «DoorA_Opened»…) and says «none» when there is none: only a code
  // that names an error makes the machine's state an error; the others are notices beside its state
  const codes = ['none', 'unknown', 'unavailable', ''].includes(alarm.toLowerCase()) ? [] : alarm.split(/,\s*/).map(c => c.trim()).filter(Boolean);
  const errors = codes.filter(c => /error/i.test(c)), hasAlarm = errors.length > 0;
  base.alerts = codes.filter(c => !/error/i.test(c));
  let phase: Phase = hasAlarm ? 'error' : stage === 'delaywash' ? 'delay' : machine === 'pause' ? 'paused' : active ? 'running' : stage === 'finish' || wrinkle ? 'done' : st('power')?.state === 'off' ? 'off' : 'idle';
  const step: Step | null = phase === 'running' || phase === 'paused' ? (STEP[stage] ?? null) : phase === 'done' && wrinkle ? 'wrinkle' : null;
  const steps: Step[] = [...base.steps, ...(isDryer && st('wrinkle')?.state === 'on' ? ['wrinkle' as Step] : [])];
  const minutes = n(st('left')?.state), finish = ms(st('finishAt')?.state);
  let endAt: number | null = null, left: number | null = null, progress: number | null = null, total: number | null = null, startAt: number | null = null, delayAt: number | null = null;
  if (phase === 'running' || phase === 'paused') {
    endAt = finish ?? (minutes !== null ? now + minutes * 60_000 : null); left = finish !== null ? Math.max(0, Math.ceil((finish - now) / 60_000)) : minutes;
    const p = n(st('progress')?.state); if (p !== null) progress = Math.max(0, Math.min(1, p / 100));
    const since = ms(running?.last_changed); if (running?.state === 'on' && since !== null) startAt = since;
  } else if (phase === 'delay') delayAt = finish;
  else if (phase !== 'error') total = minutes; // idle: what the chosen program takes
  const doneAt = phase === 'done' ? ms(running?.last_changed) : null;
  if (phase === 'error') base.error = { code: errors.map(c => c.replace(/^error_?code_?/i, '')).join(', '), key: null };
  return { ...base, phase, step, steps, program: null, endAt, left, progress, total, startAt, delayAt, doneAt };
}
/** One machine of an instance, as the card and the tile say it. `now`: the clock, for what is left (tests pin it). */
export function readLaundry(reg: Registry, inst: Pick<ProfileInstance, 'profileId' | 'bindings'>, t: T | null, now = Date.now()): Laundry | null {
  const fam = familyKind(inst.profileId); if (!fam) return null;
  const l = fam === 'lg' ? readLg(reg, inst.bindings, now) : readSamsung(reg, inst.bindings, now);
  if (fam === 'samsung' && t) l.program = cycleName(l.programCode, t);
  return l;
}

// ---- words ----
/** «42 мин», «1 ч 20 мин», «2 ч» */
export function minutesText(min: number, t: T): string { const m = Math.max(0, Math.round(min)); if (m < 60) return t('laundry.min', { n: m }); const h = Math.floor(m / 60), r = m % 60; return r ? t('laundry.hm', { h, m: r }) : t('laundry.h', { h }); }
/** «14:32» in the house's clock */
export const clockText = (at: number, lang: Lang) => dateFormat(locales[lang], { hour: '2-digit', minute: '2-digit', hourCycle: 'h23', ...zoneOption() }).format(at);
export const stepText = (s: Step, l: Pick<Laundry, 'machine'>, t: T) => t(`laundry.step.${s}` as Key);
/** a notice in words: the lint filter, the door; any other as the machine names it */
export const alertText = (code: string, t: T) => /filter/i.test(code) ? t('laundry.alert.filter') : /door.*open/i.test(code) ? t('laundry.alert.door') : t('laundry.alert.code', { code });
export function errorWords(l: Laundry, t: T): string { const e = l.error; if (!e) return ''; if (e.key) return t(e.key); return e.code && l.brand === 'samsung' ? t('laundry.err.code', { code: e.code }) : t('laundry.err.unknown'); }
/** What the machine is doing, in a few words: the tile's line and the sheet's status. */
export function lineOf(l: Laundry, t: T, lang: Lang): string | null {
  switch (l.phase) {
    case 'unavailable': return t('state.unavailable'); // said by the card itself: the tile's own word goes by the main entity alone, and a machine whose state sensor is silent while its «running» flag still reads «off» was «Выключено» (audit 22.11.2026, H-3)
    case 'off': return t('laundry.off');
    case 'idle': return t('laundry.idle');
    case 'delay': return l.delayAt !== null ? t('laundry.delayEnds', { time: clockText(l.delayAt, lang) }) : t('laundry.delay');
    case 'error': return `${t('laundry.error')}: ${errorWords(l, t)}`;
    case 'done': return l.wrinkle ? t('laundry.doneWrinkle') : t('laundry.done');
    case 'paused': { const w = l.step === 'rinseHold' ? t('laundry.step.rinseHold') : t('laundry.paused'); return l.left !== null && l.step !== 'rinseHold' ? `${w} · ${t('laundry.left', { m: minutesText(l.left, t) })}` : w; }
    case 'running': { const w = l.step ? stepText(l.step, l, t) : t(l.machine === 'dryer' ? 'laundry.drying' : 'laundry.washing'); return l.left === null ? w : l.left <= 0 ? `${w} · ${t('laundry.almost')}` : `${w} · ${t('laundry.left', { m: minutesText(l.left, t) })}`; }
  }
}

/** The machine's own name for the sheet's head: the installer's name for the card, else its HA device's without the room and the model
 * («Ванная · Сушильная машина (Samsung DV8400D)» → «Сушильная машина»); never an entity's («Сушилка · Работает»). */
export function machineName(reg: Registry, inst: Pick<ProfileInstance, 'name' | 'deviceId'>): string | null {
  if (inst.name) return inst.name;
  const d = inst.deviceId ? reg.devices.find(x => x.id === inst.deviceId) as { name?: string | null; name_by_user?: string | null } | undefined : undefined;
  const raw = (d?.name_by_user ?? d?.name ?? '').replace(/\s*\([^)]*\)/g, '').trim(), parts = raw.split(' · ');
  return (parts.length > 1 ? parts.slice(1).join(' · ') : raw).trim() || null;
}

// ---- commands (sent by the card after the person's «да») ----
export type Act = 'start' | 'resume' | 'pause' | 'stop' | 'powerOff';
export type Call = [domain: string, service: string, data: Record<string, unknown>];
/** The one call an action is for this machine, or null when the machine has no such control here. LG: its operation select's own options
 * (START, STOP, POWER_OFF); Samsung: its buttons. */
export function callFor(reg: Registry, inst: Pick<ProfileInstance, 'profileId' | 'bindings'>, act: Act): Call | null {
  const b = inst.bindings, fam = familyKind(inst.profileId);
  if (fam === 'lg') {
    const id = b.operation; if (!id) return null;
    const opts = reg.states[id]?.attributes.options, has = (o: string) => Array.isArray(opts) && opts.includes(o);
    const option = act === 'start' || act === 'resume' ? 'start' : act === 'pause' || act === 'stop' ? 'stop' : 'power_off';
    return has(option) ? ['select', 'select_option', { entity_id: id, option }] : null;
  }
  if (fam === 'samsung') { const role = act === 'resume' ? 'start' : act === 'powerOff' ? null : act; const id = role ? b[role] : undefined; return id ? ['button', 'press', { entity_id: id }] : null; }
  return null;
}
/** What the card offers at this moment (each behind a question). */
export function actsFor(l: Laundry, reg: Registry, inst: Pick<ProfileInstance, 'profileId' | 'bindings'>): Act[] {
  const can = (a: Act) => callFor(reg, inst, a) !== null;
  const out: Act[] = [];
  if (l.phase === 'idle') { if (can('start')) out.push('start'); }
  else if (l.phase === 'running') { if (can('pause')) out.push('pause'); if (l.brand === 'samsung' && can('stop')) out.push('stop'); }
  else if (l.phase === 'paused') { if (can('resume')) out.push('resume'); if (l.brand === 'samsung' && can('stop')) out.push('stop'); }
  else if (l.phase === 'delay') { if (l.brand === 'samsung' && can('stop')) out.push('stop'); else if (can('pause')) out.push('pause'); }
  if (l.brand === 'lg' && (l.phase === 'idle' || l.phase === 'done' || l.phase === 'paused' || l.phase === 'error') && can('powerOff')) out.push('powerOff');
  return out;
}

export const family: ApplianceFamily = {
  id: 'laundry', profiles: [LG_WASHER, SAMSUNG_DRYER],
  tileLine(registry, instance, t, lang) { const l = readLaundry(registry, instance, t); return l ? lineOf(l, t, lang) : null; },
};
