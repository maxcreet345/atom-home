import type { HomeDevice } from './discover.ts';
import type { Kind } from './kinds.ts';

/* «Устройства» lists DEVICES (owner, 11.11.2026: «устройствами мы считаем именно устройства, например кормушка, а её миллион сенсоров — это
 * сенсоры; в панели «Устройства» будут только устройства, а не все сенсоры»). One pure rule, tested on the house's own fixture
 * (tests/device-list.test.ts); the rule in words: docs/DEVICE-MODEL.md («Устройства»); a house's table: scripts/devices-shown.mjs.
 *
 * Shown: what a person operates — lights (a relay the owner made a light is a light), thermostats and radiator heads, fans, purifiers and
 * humidifiers, the vacuum, cameras and the doorbell, speakers and TVs, covers, locks and valves; a plug or relay only when its name says
 * which appliance it IS (the owner's «Чайник» on a smart plug). The feeder and the kettle are module cards and stand in the list beside them.
 * Hidden: sensors and binary sensors (air, leaks, doors and windows, motion, smoke and gas), meters, bare plugs and relays, the weather,
 * the people and the alarm panel (it is the «Безопасность» page). A device's batteries and diagnostics were never cards of their own.
 * Hidden ones stay where they are needed: in their rooms, in the sheets, in the summaries, in «Безопасность», and the search and
 * «Внимание» still find them. */

/** Kinds that are, by themselves, something a person operates. */
export const OPERATED_KINDS: readonly Kind[] = ['light', 'climate', 'fan', 'vacuum', 'media', 'camera', 'cover', 'lock', 'valve'];
/** Kinds a plain on/off entity has: a plug or a relay — an appliance only when it says so. */
const RELAY_KINDS: readonly Kind[] = ['switch', 'socket'];
/** The words of a plug, a relay, a wall switch or a channel (ru / ro / en). */
const RELAY_WORDS = /розетк|реле|выключател|канал|relay|plug|socket|outlet|smart\s*switch|wall\s*switch|\bswitch\b|zbmini|\bmini\b|\bchannel\b|priz[aăe]|releu|întrerupător|intrerupator/i;
/** The words of an appliance a plug or relay may be (ru / ro / en). No bare «ворот»: it sits inside «поворот». */
const APPLIANCE_WORDS = /чайник|kettle|ceainic|фритюр|аэрогрил|мультиварк|air\s*fryer|fryer|friteuz|обогрев|heater|încălzitor|incalzitor|увлажн|humidif|umidific|очистит|purif|кормушк|feeder|hrănitor|hranitor|поилк|fountain|кофе|coffee|cafea|бойлер|water\s*heater|стирал|washing|washer|spălat|сушил|dryer|uscător|uscator|посудомо|dishwasher|холодильн|fridge|frigider|духов|\boven\b|cuptor|вытяжк|\bhood\b|hotă|вентилят|\bfan\b|ventilator|кондиц|conditioner|condiționat|осушит|dehumidif|dezumidific|гирлянд|garland|ghirland|christmas|аквариум|aquarium|acvariu|насос|pump|pompă|pompa|\bgate\b|poart/i;

export type ListGroup = 'lights' | 'climate' | 'appliances' | 'cameras' | 'media' | 'access';
/** The verdict for one device: on the list or not, the group it stands in, and why (in the words scripts/devices-shown.mjs prints). An appliance that
 * HA knows only through switches (an air fryer, a washer, a humidifier) is ONE entry: its first card stands for it (`label`: the appliance's
 * own name, not its first switch's), and its first card is never what a tap switches (`toggle: false`): the appliance decides
 * (model/appliance.ts, `tapSwitchOf`) — a tap switches its power switch when it has one (a fan's relay, a washer's «Питание», a fountain's
 * pump) and opens it when it has none; a settings switch is never flipped. A lone plug the owner named after its appliance (no HA device to judge by) is switched as a plug is. */
export interface ListVerdict { shown: boolean; group: ListGroup | null; why: string; label?: string; toggle?: boolean }
type Dev = Pick<HomeDevice, 'key' | 'kind' | 'name' | 'model' | 'manufacturer' | 'haDeviceId' | 'enabled'> & { metrics?: unknown[]; parameters?: unknown[]; diagnostics?: unknown[] };
/** What the rule may ask of the house beyond the devices: the name the owner gave a HA device, and which cameras the panel calls its cameras
 * (a camera's second and third stream are not more cameras). */
export interface ListContext { deviceName?: (haDeviceId: string) => string | null; cameras?: ReadonlySet<string> }

const GROUP_OF: Partial<Record<Kind, ListGroup>> = { light: 'lights', climate: 'climate', fan: 'appliances', vacuum: 'appliances', switch: 'appliances', socket: 'appliances', camera: 'cameras', media: 'media', cover: 'access', lock: 'access', valve: 'access' };
const HIDDEN_WHY: Partial<Record<Kind, string>> = {
  environment: 'sensor (air)', measurement: 'sensor (reading)', leak: 'sensor (leak)', opening: 'sensor (door or window)', motion: 'sensor (motion, tamper)', alarm: 'sensor (smoke, gas)',
  energy: 'meter', weather: 'weather (Home tile)', person: 'person', alarm_panel: 'alarm panel (on «Безопасность»)',
};
/** An entity with no name of its own is named by its id («switch.kitchen_cat_feeder_schedule»): its words, not its domain. */
const words = (raw: string) => { const s = raw.trim(); return /^[a-z_]+\.[a-z0-9_]+$/.test(s) ? s.replace(/^[a-z_]+\./, '').replace(/_/g, ' ') : s; };
/** A plug or relay whose name — or, when the name says nothing, whose model — names an appliance: the owner operates that appliance
 * through it. A name with a plug's or a relay's word («Розетка увлажнителя») stays a plug. */
export function relayIsAppliance(d: { name: string | null; model: string | null }): boolean {
  const name = words(d.name ?? ''), model = d.model ?? '';
  if (RELAY_WORDS.test(name)) return false;
  if (APPLIANCE_WORDS.test(name)) return true;
  return !RELAY_WORDS.test(model) && APPLIANCE_WORDS.test(model);
}
/** «Кухня · Аэрогриль (Xiaomi Smart Air Fryer 5.5L)» → «Кухня · Аэрогриль»: the model belongs to the sheet. */
const plain = (s: string) => s.replace(/\s*\([^)]*\)/g, '').replace(/\s{2,}/g, ' ').trim();
/** One device that is not a plug or a relay. */
export function deviceVerdict(d: Dev, cx: ListContext = {}): ListVerdict {
  if (!d.enabled) return { shown: false, group: null, why: 'switched off in «Настройка»' };
  if (d.kind === 'camera' && cx.cameras && !cx.cameras.has(d.key)) return { shown: false, group: null, why: 'another stream of a camera' };
  if (OPERATED_KINDS.includes(d.kind)) return { shown: true, group: GROUP_OF[d.kind]!, why: d.kind };
  if (RELAY_KINDS.includes(d.kind)) return relayIsAppliance(d) ? { shown: true, group: 'appliances', why: 'appliance on a plug or relay', toggle: true } : { shown: false, group: null, why: d.kind === 'socket' ? 'bare plug' : 'relay or plug' };
  return { shown: false, group: null, why: HIDDEN_WHY[d.kind] ?? 'not a device' };
}
/** Every device of the house with its verdict, in the house's order. Plugs and relays are judged by their HA device: the device's own name
 * says whether it is an appliance (an air fryer) or a plug (a Xiaomi plug with five settings); an appliance stands once. */
export function deviceVerdicts<T extends Dev>(all: readonly T[], cx: ListContext = {}): Array<{ device: T; verdict: ListVerdict }> {
  const relays = new Map<string, T[]>();
  for (const d of all) if (d.enabled && RELAY_KINDS.includes(d.kind)) { const k = d.haDeviceId ?? d.key; (relays.get(k) ?? relays.set(k, []).get(k)!).push(d); }
  const judged = new Map<T, ListVerdict>();
  for (const [owner, list] of relays) {
    const own = list[0].haDeviceId ? cx.deviceName?.(owner) ?? null : null, model = list[0].model;
    // the HA device's name speaks for all its switches; with no device (or no name for it) each switch's own name
    if (!own) { for (const d of list) judged.set(d, deviceVerdict(d, cx)); continue; }
    // a single switch the owner named after its appliance («Чайник» on a plug) is that appliance whatever the plug's own device is called
    if (!relayIsAppliance({ name: own, model }) && !(list.length === 1 && relayIsAppliance({ name: list[0].name, model: null }))) { for (const d of list) judged.set(d, { shown: false, group: null, why: d.kind === 'socket' ? 'bare plug' : 'relay or plug' }); continue; }
    // the card that holds the device's readings and settings stands for it (discover gives them to the first one)
    const size = (d: T) => (d.metrics?.length ?? 0) + (d.parameters?.length ?? 0) + (d.diagnostics?.length ?? 0), lead = list.reduce((a, b) => size(b) > size(a) ? b : a, list[0]);
    for (const d of list) judged.set(d, d === lead ? { shown: true, group: 'appliances', why: 'appliance on a plug or relay', label: relayIsAppliance({ name: own, model }) ? plain(own) : undefined, toggle: !relayIsAppliance({ name: own, model }) && list.length === 1 } : { shown: false, group: null, why: 'a setting of the appliance' });
  }
  return all.map(d => ({ device: d, verdict: judged.get(d) ?? deviceVerdict(d, cx) }));
}
/** The devices «Устройства» lists. */
export function listedDevices<T extends Dev>(all: readonly T[], cx: ListContext = {}): T[] { return deviceVerdicts(all, cx).filter(x => x.verdict.shown).map(x => x.device); }
/** The groups of the list, in their order: the kinds each one holds, and the module cards that stand in it. */
export const LIST_GROUPS: ReadonlyArray<{ id: ListGroup; kinds: readonly Kind[] }> = [
  { id: 'lights', kinds: ['light'] }, { id: 'climate', kinds: ['climate'] }, { id: 'appliances', kinds: ['fan', 'vacuum', 'switch', 'socket'] },
  { id: 'cameras', kinds: ['camera'] }, { id: 'media', kinds: ['media'] }, { id: 'access', kinds: ['cover', 'lock', 'valve'] },
];
/** Module cards that are appliances of their own (the feeder, the kettle): they stand in «Приборы». */
export const APPLIANCE_MODULES: readonly string[] = ['pet_feeder', 'kettle'];
