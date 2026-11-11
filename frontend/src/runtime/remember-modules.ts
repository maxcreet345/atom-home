import type { Registry } from '../model/registry.ts';
import type { HouseConfig } from '../model/config.ts';
type Row = Registry['states'][string];
/** What of a state decides which modules a house has (modules/catalog.ts: `detect`, the required roles): that it exists, whether it answers,
 *  its class, name and unit and the NAMES of its attributes — never its value. */
export const moduleShape = (s: Row | undefined): string => { if (!s) return ''; const a = s.attributes ?? {}; return `${s.state === 'unavailable' ? 'u' : 'a'}|${String(a.device_class ?? '')}|${String(a.friendly_name ?? '')}|${String(a.unit_of_measurement ?? '')}|${Object.keys(a).join(',')}`; };
/** A search over the registry and the settings (`find`: the active modules) with a memory. The same registry lists and settings, and states
 *  that differ only in values → the very same array comes back without looking for anything (a state change no longer costs a search by
 *  regular expressions through every entity). A state that appeared, went silent or came back, or changed its class, name or attributes →
 *  found anew, and still the same array when what was found is the same (`keyOf`), so nothing downstream recomputes.
 *  The answer always equals `find(registry, config)`. */
export function rememberByShape<T>(find: (registry: Registry, config: HouseConfig) => T[], keyOf: (list: T[]) => string): (registry: Registry, config: HouseConfig) => T[] {
  let last: { entities: Registry['entities']; devices: Registry['devices']; areas: Registry['areas']; config: HouseConfig; states: Registry['states']; rows: Map<string, Row>; shapes: Map<string, string>; key: string; list: T[] } | null = null;
  return (reg, config) => {
    if (last && last.entities === reg.entities && last.devices === reg.devices && last.areas === reg.areas && last.config === config) {
      if (last.states === reg.states) return last.list;
      const ids = Object.keys(reg.states); let same = ids.length === last.shapes.size;
      if (same) for (const id of ids) { const row = reg.states[id]; if (row === last.rows.get(id)) continue; if (moduleShape(row) !== last.shapes.get(id)) { same = false; break; } last.rows.set(id, row); }
      if (same) { last.states = reg.states; return last.list; }
    }
    const list = find(reg, config), key = keyOf(list);
    const rows = new Map<string, Row>(), shapes = new Map<string, string>();
    for (const id of Object.keys(reg.states)) { rows.set(id, reg.states[id]); shapes.set(id, moduleShape(reg.states[id])); }
    last = { entities: reg.entities, devices: reg.devices, areas: reg.areas, config, states: reg.states, rows, shapes, key, list: last && last.key === key ? last.list : list };
    return last.list;
  };
}
