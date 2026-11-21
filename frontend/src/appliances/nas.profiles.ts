/* The nas family (types.ts): a home NAS, drawn after the UGREEN NAS app's dashboard and Synology's mobile overview — one sentence first («Всё в
 * порядке» or what is wrong), then the free space of every volume, the drives with their health and temperature, the load, and the pools in a fold.
 * Pure: the profile, the reader the sheet draws and the tile's line. Never calls a service.
 *
 * A NAS has as many drives and volumes as its owner put in it (2, 4, 8…), so they are NOT roles: the card binds the main device's own readings
 * (status, load, fan, the two buttons) and finds the pools, drives and volumes under the chosen device — HA's device hierarchy (`via_device_id`: the
 * UGreen integration hangs pools on the NAS, drives and volumes on their pool), each part told by its entities' suffixes, never by its model or name.
 * Without the hierarchy (an older registry read) the parts are found by the integration's entity ids under the NAS's own prefix
 * (`sensor.<nas>_pool_1_disk_2_temperature`). */
import type { ApplianceFamily } from './types.ts';
import type { Profile, ProfileInstance, RoleSpec } from '../model/card-catalog.ts';
import type { Registry, DeviceRow } from '../model/registry.ts';
import type { Key, T } from '../i18n/index.ts';
import type { Lang } from '../ui/format.ts';
import { numberFormat } from '../runtime/zone.ts';
// format.ts's `num`, without its imports: this file is read by the catalog (model/card-catalog.ts → appliances/profiles.ts), and format.ts leads back there
const LOCALE: Record<Lang, string> = { ru: 'ru-RU', ro: 'ro-RO', en: 'en-GB' };
const num = (v: number, lang: Lang, digits: number) => Number.isFinite(v) ? numberFormat(LOCALE[lang], { maximumFractionDigits: digits, minimumFractionDigits: 0 }).format(Number(v.toFixed(digits)) || 0) : '—';

const own = (id: string, labelKey: string, domains: string[], suffix: RegExp, extra: Partial<RoleSpec> = {}): RoleSpec => ({ id, labelKey, domains, suffix, required: false, source: 'own', as: 'metric', ...extra });
/** The UGreen NAS integration's own entities of the main device (custom component «UGreen NAS», 2026: `sensor.<nas>_server_status` …). */
const ROLES: RoleSpec[] = [
  own('status', 'cat.r.nasStatus', ['sensor'], /_server_status$/, { required: true, as: 'primary', hintKey: 'cat.r.nasStatus.hint' }),
  own('message', 'cat.r.nasMessage', ['sensor'], /_system_message$/),
  own('statusCode', 'cat.r.nasStatusCode', ['sensor'], /_system_status_code$/),
  own('tempStatus', 'cat.r.nasTempStatus', ['sensor'], /_temperature_status_code$/),
  own('cpu', 'cat.r.nasCpu', ['sensor'], /_cpu_usage$/),
  own('cpuTemp', 'cat.r.nasCpuTemp', ['sensor'], /_cpu_temperature$/),
  own('ram', 'cat.r.nasRam', ['sensor'], /_ram_usage$/),
  own('ramTotal', 'cat.r.nasRamTotal', ['sensor'], /_ram_total_size$/),
  own('up', 'cat.r.nasUp', ['sensor'], /_overall_lan_upload_raw$/),
  own('down', 'cat.r.nasDown', ['sensor'], /_overall_lan_download_raw$/),
  own('runtime', 'cat.r.nasRuntime', ['sensor'], /_total_runtime$/),
  own('fan', 'cat.r.nasFan', ['sensor'], /_device_fan$/),
  own('fanStatus', 'cat.r.nasFanStatus', ['sensor'], /_fan_status_overall$/),
  own('version', 'cat.r.nasVersion', ['sensor'], /_ugos_version$/),
  own('update', 'cat.r.nasUpdate', ['sensor'], /_update_available$/),
  own('ups', 'cat.r.nasUps', ['sensor'], /_ups_power_remaining$/),
  own('fanMode', 'cat.r.nasFanMode', ['select'], /_fan_mode$/, { as: 'parameter' }),
  own('powerMode', 'cat.r.nasPowerMode', ['select'], /_power_mode$/, { as: 'parameter' }),
  own('reboot', 'cat.r.nasReboot', ['button'], /_power_action_reboot$/, { as: 'parameter' }),
  own('shutdown', 'cat.r.nasShutdown', ['button'], /_power_action_shutdown$/, { as: 'parameter' }),
];
const DXP2800: Profile = {
  id: 'ugreen.dxp2800', version: '1.0.0', category: 'network', brand: 'UGREEN', titleKey: 'cat.p.nasDxp2800', descKey: 'cat.p.nasDxp2800.desc',
  models: ['UGREEN DXP2800'], integration: { platform: 'ugreen', name: 'UGreen NAS' },
  terms: ['nas', 'nasync', 'dxp2800', 'ugos', 'хранилище', 'сетевое хранилище', 'диски', 'stocare', 'storage', 'raid'],
  renderer: 'appliance', card: 'nas', kind: 'environment', icon: 'service', kindKey: 'cat.kind.nas', anchor: 'status', places: ['home', 'room'], roles: ROLES,
};

// ---------------------------------------------------------------- reading
export type Level = 'alert' | 'warn';
export type IssueKind = 'house' | 'offline' | 'system' | 'hot' | 'diskGone' | 'disk' | 'pool' | 'volume' | 'full' | 'diskHot' | 'cpuHot' | 'fan';
export interface Issue { kind: IssueKind; level: Level; n?: number; t?: number; p?: number }
export type DiskType = 'hdd' | 'ssd' | 'nvme' | null;
export interface NasDisk { n: number; device: string | null; pool: number | null; type: DiskType; model: string | null; size: number | null; temp: number | null; status: string | null; ok: boolean; answers: boolean; hours: number | null; sleeping: boolean }
export interface NasVolume { n: number; device: string | null; pool: number | null; total: number | null; used: number | null; free: number | null; pct: number | null; status: string | null; fs: string | null; ok: boolean; answers: boolean }
export interface NasPool { n: number; device: string | null; level: string | null; status: string | null; ok: boolean; disks: NasDisk[]; volumes: NasVolume[] }
export interface NasAction { role: 'fanMode' | 'powerMode' | 'reboot' | 'shutdown'; entity: string; kind: 'select' | 'button'; options: string[]; current: string | null; answers: boolean }
export interface NasRead {
  /** the NAS answers (its status sensor) and the house is reachable */ available: boolean; online: boolean;
  issues: Issue[]; pools: NasPool[]; loose: NasDisk[]; disks: NasDisk[]; volumes: NasVolume[];
  cpu: number | null; cpuTemp: number | null; ram: number | null; ramTotal: number | null; up: number | null; down: number | null; uptime: number | null;
  fans: Array<{ rpm: number | null }>; fanOk: boolean | null; version: string | null; update: string | null; ups: number | null; message: string | null;
  freeTotal: number | null; actions: NasAction[]; deviceId: string | null;
}
const GONE = new Set(['unavailable', 'unknown', '']);
/** what the NAS calls fine: only «Normal» appears on a healthy UGOS; anything else is worth a look, never guessed into «fine» */
export const isNormal = (s: string | null | undefined) => !!s && /^(normal|ok|good|healthy)$/i.test(s.trim());
const n = (v: unknown): number | null => { if (v === null || v === undefined || typeof v === 'boolean' || (typeof v === 'string' && !v.trim())) return null; const x = Number(v); return Number.isFinite(x) ? x : null; };
const K = 1024;
/** UGOS counts in 1024s (3 653 841 518 592 B is its «3.32 TB»): the card says the same numbers as the NAS's own app */
const UNIT: Record<string, number> = { b: 1, kb: K, kib: K, mb: K ** 2, mib: K ** 2, gb: K ** 3, gib: K ** 3, tb: K ** 4, tib: K ** 4, pb: K ** 5 };
export const toBytes = (state: string | undefined, unit: unknown): number | null => { const v = n(state); if (v === null) return null; const u = typeof unit === 'string' ? UNIT[unit.trim().toLowerCase()] : 1; return u ? v * u : null; };
/** temperatures a drive should not pass in a home cupboard (conservative: WD Red is rated to 65 °C, NVMe throttles about 70–80 °C) */
export const HOT = { hdd: 55, ssd: 65, nvme: 70, other: 60, cpu: 95 };
export const FULL_PCT = 90;
const PART_FIELDS = ['used_size_raw', 'total_size_raw', 'available_size_raw', 'power_on_hours', 'sleep_state', 'used_size', 'total_size', 'available_size', 'free_size', 'interface_type', 'temperature', 'disk_count', 'filesystem', 'on_pool', 'health', 'status', 'level', 'model', 'type', 'size', 'slot'];
const fieldOf = (id: string) => PART_FIELDS.find(f => id.endsWith(`_${f}`)) ?? null;
type Part = { kind: 'disk' | 'volume' | 'pool'; device: string | null; parent: string | null; pool: number | null; idx: number | null; order: number; f: Record<string, string> };
const kindOf = (f: Record<string, string>): Part['kind'] | null => f.level || f.disk_count ? 'pool' : f.temperature || f.power_on_hours || f.slot || f.sleep_state ? 'disk' : f.health || f.filesystem || f.on_pool || f.used_size_raw || f.available_size ? 'volume' : null;
const idxOf = (ids: string[], re: RegExp) => { for (const id of ids) { const m = re.exec(id); if (m) return m.slice(1).map(Number); } return null; };
/** every device under `root`, at any depth (pools on the NAS, drives and volumes on their pool) */
export function descendants(reg: Registry, root: string): DeviceRow[] {
  const out: DeviceRow[] = [], seen = new Set([root]); let level = [root];
  for (let depth = 0; depth < 4 && level.length; depth++) {
    const next = reg.devices.filter(d => d.via_device_id && level.includes(d.via_device_id) && !seen.has(d.id) && !d.disabled_by);
    for (const d of next) { seen.add(d.id); out.push(d); } level = next.map(d => d.id);
  }
  return out;
}
/** The pools, drives and volumes of the NAS: by the hierarchy; without one, by the integration's entity ids under the NAS's own prefix. */
function partsOf(reg: Registry, deviceId: string | null, anchor: string | undefined): Part[] {
  const parts: Part[] = [];
  if (deviceId) descendants(reg, deviceId).forEach((d, order) => {
    const f: Record<string, string> = {};
    for (const e of reg.entities) if (e.device_id === d.id && !e.disabled_by) { const k = fieldOf(e.entity_id); if (k && !f[k]) f[k] = e.entity_id; }
    const kind = kindOf(f); if (!kind) return;
    const ids = Object.values(f), pd = idxOf(ids, /_pool_(\d+)_(?:disk|volume)_(\d+)_/), pp = idxOf(ids, /_pool_(\d+)_/);
    parts.push({ kind, device: d.id, parent: d.via_device_id ?? null, pool: pd?.[0] ?? pp?.[0] ?? null, idx: kind === 'pool' ? pp?.[0] ?? null : pd?.[1] ?? null, order, f });
  });
  if (parts.some(p => p.kind !== 'pool') || !anchor) return parts;
  // no hierarchy: `sensor.<prefix>_pool_N_disk_M_<field>`, `…_pool_N_volume_M_…`, `…_pool_N_<field>`, the prefix being the status sensor's own
  const prefix = anchor.replace(/_server_status$/, ''); if (prefix === anchor) return parts;
  const byKey = new Map<string, Part>(), esc = prefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), re = new RegExp(`^${esc}_pool_(\\d+)(?:_(disk|volume)_(\\d+))?_(.+)$`);
  reg.entities.forEach((e, order) => {
    if (e.disabled_by) return; const m = re.exec(e.entity_id); if (!m) return; const k = fieldOf(e.entity_id); if (!k || m[4] !== k) return;
    const key = `${m[1]}:${m[2] ?? 'pool'}:${m[3] ?? ''}`; let p = byKey.get(key);
    if (!p) { p = { kind: m[2] === 'disk' ? 'disk' : m[2] === 'volume' ? 'volume' : 'pool', device: null, parent: null, pool: Number(m[1]), idx: m[3] ? Number(m[3]) : Number(m[1]), order, f: {} }; byKey.set(key, p); }
    if (!p.f[k]) p.f[k] = e.entity_id;
  });
  return [...byKey.values()];
}
const byPlace = (a: Part, b: Part) => (a.pool ?? 99) - (b.pool ?? 99) || (a.idx ?? 99) - (b.idx ?? 99) || a.order - b.order;
const ofCode = (v: string | undefined) => { const x = n(v); return x === null ? null : x !== 0; };
/** Everything the card says about one NAS instance. `online`: the house is reachable (`host.online`). */
export function readNas(reg: Registry, inst: ProfileInstance, online = true): NasRead {
  const B = inst.bindings, st = (id: string | undefined) => id ? reg.states[id] : undefined, val = (role: string) => { const s = st(B[role]); return s && !GONE.has(s.state) ? s.state : null; };
  const num_ = (role: string) => n(val(role));
  const anchor = B.status, anchorState = st(anchor), alive = !!anchorState && !GONE.has(anchorState.state) && !!reg.entities.find(e => e.entity_id === anchor && !e.disabled_by);
  const deviceId = inst.deviceId ?? (anchor ? reg.entities.find(e => e.entity_id === anchor)?.device_id ?? null : null);
  const available = online && alive;
  const parts = partsOf(reg, deviceId, anchor);
  const sv = (f: Record<string, string>, k: string) => { const s = st(f[k]); return s && !GONE.has(s.state) ? s.state : null; };
  const bytes = (f: Record<string, string>, raw: string, sized: string) => { const r = st(f[raw]); if (r && !GONE.has(r.state)) { const x = toBytes(r.state, r.attributes.unit_of_measurement ?? 'B'); if (x !== null) return x; } const s = st(f[sized]); return s && !GONE.has(s.state) ? toBytes(s.state, s.attributes.unit_of_measurement) : null; };
  const pools = parts.filter(p => p.kind === 'pool').sort(byPlace);
  const poolNo = (p: Part) => { const parent = pools.find(x => x.device && x.device === p.parent); return parent ? parent.pool ?? pools.indexOf(parent) + 1 : p.device ? null : p.pool; };
  // drives and volumes are numbered once across the whole NAS (pool 2's first drive is «Диск 3»): the tile and the sheet say the same number
  const disks: NasDisk[] = parts.filter(p => p.kind === 'disk').map(p => ({ p, pool: poolNo(p) })).sort((a, b) => (a.pool ?? 99) - (b.pool ?? 99) || byPlace(a.p, b.p)).map(({ p, pool }, i) => {
    const status = sv(p.f, 'status'), type = (sv(p.f, 'type') ?? '') + ' ' + (sv(p.f, 'interface_type') ?? '');
    const kind: DiskType = /nvme|m\.?2/i.test(type) ? 'nvme' : /ssd/i.test(type) ? 'ssd' : /hdd|sata|sas/i.test(type) ? 'hdd' : null;
    const sz = st(p.f.size);
    return { n: i + 1, device: p.device, pool, type: kind, model: sv(p.f, 'model'), size: sz && !GONE.has(sz.state) ? toBytes(sz.state, sz.attributes.unit_of_measurement) : null, temp: n(sv(p.f, 'temperature')), status, ok: isNormal(status), answers: status !== null, hours: n(sv(p.f, 'power_on_hours')), sleeping: /^(true|on|yes|1|sleep)/i.test(sv(p.f, 'sleep_state') ?? '') };
  });
  const volumes: NasVolume[] = parts.filter(p => p.kind === 'volume').map(p => ({ p, pool: poolNo(p) })).sort((a, b) => (a.pool ?? 99) - (b.pool ?? 99) || byPlace(a.p, b.p)).map(({ p, pool }, i) => {
    const total = bytes(p.f, 'total_size_raw', 'total_size'), used = bytes(p.f, 'used_size_raw', 'used_size'), free0 = bytes(p.f, 'available_size_raw', 'available_size');
    const free = free0 ?? (total !== null && used !== null ? Math.max(0, total - used) : null);
    const status = sv(p.f, 'status'), health = sv(p.f, 'health'), says = status ?? health;
    // used / (used + free): what the person can still put there, as UGOS shows the bar (the file system's own reserve is not «free»)
    const pct = used !== null && free !== null && used + free > 0 ? Math.round(used / (used + free) * 100) : total && used !== null ? Math.round(used / total * 100) : null;
    return { n: i + 1, device: p.device, pool, total, used, free, pct, status: says, fs: sv(p.f, 'filesystem'), ok: (status === null || isNormal(status)) && (health === null || isNormal(health)) && says !== null, answers: says !== null || used !== null };
  });
  const poolList: NasPool[] = pools.map((p, i) => { const no = p.pool ?? i + 1, status = sv(p.f, 'status'); return { n: no, device: p.device, level: sv(p.f, 'level'), status, ok: isNormal(status), disks: disks.filter(d => d.pool === no), volumes: volumes.filter(v => v.pool === no) }; });
  const loose = disks.filter(d => !poolList.some(p => p.n === d.pool));
  // fans: the bound one, and any other fan speed the NAS itself reports (a 4- or 8-bay model has more than one)
  const fanIds = [B.fan, ...reg.entities.filter(e => e.device_id === deviceId && e.device_id && !e.disabled_by && e.entity_id !== B.fan && /^sensor\..+_fan(_\d+)?$/.test(e.entity_id) && /rpm/i.test(String(st(e.entity_id)?.attributes.unit_of_measurement ?? ''))).map(e => e.entity_id)].filter((x): x is string => !!x);
  const fans = fanIds.map(id => ({ rpm: n(st(id)?.state) }));
  const fanState = val('fanStatus'), fanOk = fanState === null ? null : isNormal(fanState);
  const upd = st(B.update), update = upd && /^(true|on)$/i.test(upd.state) ? String(upd.attributes.available_version ?? '') || '—' : null;
  const actions: NasAction[] = (['fanMode', 'powerMode', 'reboot', 'shutdown'] as const).filter(r => B[r] && reg.states[B[r]]).map(r => { const s = reg.states[B[r]], sel = r === 'fanMode' || r === 'powerMode'; return { role: r, entity: B[r], kind: sel ? 'select' : 'button', options: sel && Array.isArray(s.attributes.options) ? (s.attributes.options as unknown[]).map(String) : [], current: sel && !GONE.has(s.state) ? s.state : null, answers: s.state !== 'unavailable' }; });
  const freeVals = volumes.map(v => v.free).filter((x): x is number => x !== null);
  const r: NasRead = {
    available, online, issues: [], pools: poolList, loose, disks, volumes,
    cpu: num_('cpu'), cpuTemp: num_('cpuTemp'), ram: num_('ram'), ramTotal: (() => { const s = st(B.ramTotal); return s && !GONE.has(s.state) ? toBytes(s.state, s.attributes.unit_of_measurement) : null; })(),
    up: num_('up'), down: num_('down'), uptime: num_('runtime'), fans, fanOk, version: val('version'), update, ups: num_('ups'), message: val('message'),
    freeTotal: freeVals.length ? freeVals.reduce((a, b) => a + b, 0) : null, actions, deviceId,
  };
  r.issues = issuesOf(r, { status: val('status'), code: ofCode(val('statusCode') ?? undefined), temp: ofCode(val('tempStatus') ?? undefined) });
  return r;
}
/** What is wrong, worst first. A NAS that does not answer says only that: its last readings are not today's. */
export function issuesOf(r: NasRead, sys: { status: string | null; code: boolean | null; temp: boolean | null }): Issue[] {
  if (!r.online) return [{ kind: 'house', level: 'alert' }];
  if (!r.available) return [{ kind: 'offline', level: 'alert' }];
  const out: Issue[] = [];
  if ((sys.status !== null && !isNormal(sys.status)) || sys.code === true) out.push({ kind: 'system', level: 'alert' });
  if (sys.temp === true) out.push({ kind: 'hot', level: 'alert' });
  for (const d of r.disks) if (!d.answers) out.push({ kind: 'diskGone', level: 'alert', n: d.n });
  for (const p of r.pools) if (p.status !== null && !p.ok) out.push({ kind: 'pool', level: 'warn', n: p.n });
  for (const d of r.disks) if (d.answers && !d.ok) out.push({ kind: 'disk', level: 'warn', n: d.n });
  for (const v of r.volumes) if (v.answers && v.status !== null && !v.ok) out.push({ kind: 'volume', level: 'warn', n: v.n });
  for (const v of r.volumes) if (v.pct !== null && v.pct > FULL_PCT) out.push({ kind: 'full', level: 'warn', n: v.n, p: v.pct });
  for (const d of r.disks) if (d.temp !== null && d.temp > (d.type ? HOT[d.type] : HOT.other)) out.push({ kind: 'diskHot', level: 'warn', n: d.n, t: Math.round(d.temp) });
  if (sys.temp !== true && r.cpuTemp !== null && r.cpuTemp > HOT.cpu) out.push({ kind: 'cpuHot', level: 'warn', t: Math.round(r.cpuTemp) });
  if (r.fanOk === false) out.push({ kind: 'fan', level: 'warn' });
  return out;
}
const KEY: Record<IssueKind, string> = { house: 'nas.houseOffline', offline: 'nas.offline', system: 'nas.system', hot: 'nas.hot', diskGone: 'nas.diskGone', disk: 'nas.disk', pool: 'nas.pool', volume: 'nas.volume', full: 'nas.full', diskHot: 'nas.diskHot', cpuHot: 'nas.cpuHot', fan: 'nas.fan' };
export const issueText = (i: Issue, t: T) => t(KEY[i.kind] as Key, { n: i.n ?? '', t: i.t ?? '', p: i.p ?? '' });
/** The one sentence: «Всё в порядке», or the worst thing and how many more there are. */
export function sentence(r: NasRead, t: T): string {
  if (!r.issues.length) return t('nas.ok' as Key);
  const first = issueText(r.issues[0], t);
  return r.issues.length > 1 ? t('nas.andMore' as Key, { text: first, n: String(r.issues.length - 1) }) : first;
}
/** «3,3 ТБ», «387 ГБ», «564 МБ»: in 1024s, as the NAS's own app */
export function sizeText(bytes: number | null, t: T, lang: Lang): string {
  if (bytes === null) return '—';
  if (bytes >= 0.95 * K ** 4) return t('nas.tb' as Key, { v: num(bytes / K ** 4, lang, 1) });
  if (bytes >= 0.95 * K ** 3) { const g = bytes / K ** 3; return t('nas.gb' as Key, { v: num(g, lang, g < 10 ? 1 : 0) }); }
  return t('nas.mb' as Key, { v: num(bytes / K ** 2, lang, 0) });
}
export const rateText = (bps: number | null, t: T, lang: Lang) => bps === null ? '—' : bps >= K ** 2 ? t('nas.mbs' as Key, { v: num(bps / K ** 2, lang, 1) }) : t('nas.kbs' as Key, { v: num(bps / K, lang, 0) });
export function uptimeText(s: number | null, t: T): string {
  if (s === null || s < 0) return '—';
  const d = Math.floor(s / 86400), h = Math.floor(s % 86400 / 3600), m = Math.floor(s % 3600 / 60);
  return d > 0 ? `${t('nas.days' as Key, { n: d })} ${t('nas.hours' as Key, { n: h })}` : h > 0 ? `${t('nas.hours' as Key, { n: h })} ${t('nas.minutes' as Key, { n: m })}` : t('nas.minutes' as Key, { n: m });
}
/** the tile's second line: «Свободно 3,7 ТБ · всё в порядке», «Диск 2: внимание», «Нет связи с NAS» */
export function nasTileLine(reg: Registry, inst: ProfileInstance, t: T, lang: Lang): string {
  const r = readNas(reg, inst);
  if (r.issues.length) return sentence(r, t);
  return r.freeTotal === null ? t('nas.ok' as Key) : `${t('nas.freeTile' as Key, { v: sizeText(r.freeTotal, t, lang) })} · ${t('nas.okTile' as Key)}`;
}
export const family: ApplianceFamily = { id: 'nas', profiles: [DXP2800], tileLine: nasTileLine };
