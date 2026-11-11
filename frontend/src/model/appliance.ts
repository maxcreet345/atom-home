import type { HomeDevice, EntityRef } from './discover.ts';
import type { Registry } from './registry.ts';
import { readRoom } from './room.ts';
import type { ListVerdict } from './device-list.ts';

/* An appliance Home Assistant knows only through switches (an air fryer, a washer, a dryer, a humidifier, a cat fountain, a relay that runs a fan):
 * the panel has a card per switch and none for the appliance itself. 1.27.0 gives it one: the device a tap on its tile opens, in «Устройства»
 * and on its room's page alike. What it shows first is what its tile shows — its power: its power switch when one of its switches IS its power
 * (a washer's «Питание», a fountain's pump, the relay that runs a fan: the sheet then has its on/off, as a switch's sheet does), else its
 * power reading (its own meter, or the plug or meter that feeds it, as the room page links them: model/room.ts), else its own state. NEVER
 * another of its switches (a humidifier's «Звук уведомления», an air fryer's «Подогрев»): those are its settings and stand in the sheet's
 * «Настройки» — an administrator's, behind a question, as every device's settings do. Pure. */
export const APPLIANCE_PREFIX = 'app:';
/** The words of a switch that is the appliance's power (ru / ro / en). */
const POWER_WORDS = /(^|[._\s])(power|pump|socket|plug|outlet|relay|on_off)([._\s]|$)|питани|насос|розетк|реле(?![а-яё])|alimentare|pomp/i; // no \b after a Cyrillic word: JS's \b is ASCII-only
const plain = (s: string) => s.replace(/\s*\([^)]*\)/g, '').replace(/\s{2,}/g, ' ').trim().toLowerCase();
/** The switch that is the appliance's power, if one is: by its words, or because it is named as the device itself («Ванная · Вентилятор
 * (Tuya TS000F) Ванная · Вентилятор»: the relay IS the fan). A setting («Звук уведомления», «Блокировка кнопок») is never it. */
export function powerSwitchOf(cards: HomeDevice[], deviceName: string): HomeDevice | null {
  const dev = plain(deviceName);
  return cards.find(d => POWER_WORDS.test(d.primary.id) || POWER_WORDS.test(d.primary.name.toLowerCase().startsWith(deviceName.toLowerCase()) ? d.primary.name.slice(deviceName.length) : d.primary.name))
    ?? cards.find(d => { const own = plain(d.primary.name.toLowerCase().startsWith(deviceName.toLowerCase()) ? d.primary.name.slice(deviceName.length) : d.primary.name); return own === '' || own === dev; })
    ?? null;
}
/** The device of one appliance from the cards of its switches. `power`: its power reading, when it has one. */
export function applianceDevice(cards: HomeDevice[], label: string, deviceName: string, power: EntityRef | null): HomeDevice {
  const lead = cards.reduce((a, b) => b.metrics.length + b.parameters.length > a.metrics.length + a.parameters.length ? b : a, cards[0]);
  const own = cards.flatMap(d => d.metrics), sw = powerSwitchOf(cards, deviceName);
  const state = own.find(m => m.domain === 'sensor' && /status|state|состоян|статус|stage|этап/i.test(`${m.id} ${m.name}`)) ?? own.find(m => m.domain === 'sensor') ?? own[0] ?? null;
  const settings = [...cards.filter(d => d !== sw).map(d => d.primary), ...cards.flatMap(d => d.parameters)].filter((p, i, all) => all.findIndex(x => x.id === p.id) === i);
  const base = { ...lead, key: `${APPLIANCE_PREFIX}${lead.haDeviceId ?? lead.key}`, name: label, controls: [] as HomeDevice['controls'], parameters: settings, diagnostics: cards.flatMap(d => d.diagnostics), section: 'systems' as const, enabled: true, available: cards.some(d => d.available) || (power?.available ?? false) };
  // its power switch: a switch's sheet (on/off, its power big when it has a reading)
  if (sw) return { ...base, kind: 'switch', primary: sw.primary, controls: [sw.primary], metrics: [...(power && !own.some(m => m.id === power.id) ? [power] : []), ...own] };
  // no switch of its own power: its power reading, or its state, read only; a switch only when it has nothing else at all (shown, never switched)
  const primary = power ?? state ?? lead.primary;
  return { ...base, kind: primary.domain === 'switch' || !power ? 'measurement' : 'energy', primary, metrics: own.filter(m => m.id !== primary.id) };
}
/** What a tap on the appliance's tile in «Устройства» switches: its power switch when one of its switches IS its power (the relay that runs a
 * fan, a washer's «Питание», a fountain's pump) — the tile 1.26.1 had, a tap switches it and «…» opens the appliance; null when it has none
 * (a humidifier, an air fryer, a dryer known by the power their plug measures): a tap opens it. Never a setting: `primary` is never one. */
export const tapSwitchOf = (app: HomeDevice): EntityRef | null => app.kind === 'switch' && app.primary.domain === 'switch' && app.controls.some(c => c.id === app.primary.id) ? app.primary : null;
/** Every switch-only appliance of the house («Устройства» shows it once, under its own name), keyed by its HA device id.
 * `verdicts`: the list rule's answers by card key (model/device-list.ts); `roomName`: the room's name as the room page reads it. */
export function applianceDevices(all: HomeDevice[], verdicts: ReadonlyMap<string, ListVerdict>, reg: Registry, roomName: (id: string) => string): Map<string, HomeDevice> {
  const out = new Map<string, HomeDevice>(), rooms = new Map<string, ReturnType<typeof readRoom>>();
  const refs = new Map<string, EntityRef>(); for (const d of all) for (const r of [d.primary, ...d.metrics, ...d.diagnostics]) if (!refs.has(r.id)) refs.set(r.id, r);
  for (const lead of all) {
    const v = verdicts.get(lead.key); if (!v?.shown || !v.label || !lead.haDeviceId) continue;
    const cards = all.filter(d => d.haDeviceId === lead.haDeviceId && (d.kind === 'switch' || d.kind === 'socket'));
    // its power as the room page links it: its own meter, or the plug or meter named after it (model/room.ts, `poweredBy`)
    const room = rooms.get(lead.roomId) ?? rooms.set(lead.roomId, readRoom(reg, lead.roomId, roomName(lead.roomId), null, null)).get(lead.roomId)!;
    const thing = [...room.things, ...room.air].find(t => t.key === lead.haDeviceId), pid = thing?.powerIds[0];
    const name = (reg.devices.find(x => x.id === lead.haDeviceId) as { name?: string | null; name_by_user?: string | null } | undefined), deviceName = name?.name_by_user ?? name?.name ?? v.label;
    out.set(lead.haDeviceId, applianceDevice(cards, v.label, deviceName, pid ? refs.get(pid) ?? null : null));
  }
  return out;
}
