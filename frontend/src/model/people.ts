import type { Registry } from './registry.ts';
import type { HouseConfig } from './config.ts';
/** Who is home, for the home page's header (owner, 09.11.2026). */
export interface Person { id: string; name: string; first: string; initials: string; picture: string | null; state: 'home' | 'away' | 'zone' | 'unknown'; zone: string | null; since: number | null }
/** HA's `person.*`: home, not_home, a zone's name, or nothing known. Left out: a person hidden or disabled in HA's entity registry (Setup never lists it,
 * so its switch there could not be reached), and one hidden in the panel's settings: the entity hidden, or its card switched off in Setup → Devices. */
export function people(registry: Pick<Registry, 'states' | 'entities'>, config: Pick<HouseConfig, 'entities' | 'devices'>): Person[] {
  const offInHa = new Set(registry.entities.filter(e => e.hidden_by || e.disabled_by).map(e => e.entity_id));
  return Object.entries(registry.states).filter(([id]) => id.startsWith('person.') && !offInHa.has(id) && !config.entities[id]?.hidden && config.devices[`e:${id}`]?.enabled !== false).map(([id, s]) => {
    const name = String(s.attributes.friendly_name ?? id.slice(7)).trim(), words = name.split(/\s+/).filter(Boolean), raw = s.state;
    const state: Person['state'] = raw === 'home' ? 'home' : raw === 'not_home' ? 'away' : raw === 'unknown' || raw === 'unavailable' || !raw ? 'unknown' : 'zone';
    const pic = typeof s.attributes.entity_picture === 'string' && s.attributes.entity_picture ? s.attributes.entity_picture : null, since = Date.parse(s.last_changed);
    return { id, name, first: words[0] ?? name, initials: (words.slice(0, 2).map(w => w[0]).join('') || '?').toUpperCase(), picture: pic, state, zone: state === 'zone' ? raw : null, since: Number.isFinite(since) ? since : null };
  }).sort((a, b) => Number(b.state === 'home') - Number(a.state === 'home') || a.name.localeCompare(b.name));
}
/** The header's one-line summary. Nobody known (after an HA restart) is not «nobody home»: it says there is no data. */
export function summaryOf(list: Person[]): { key: 'allHome' | 'nobody' | 'unknown' | 'count'; n: number } | null {
  if (!list.length) return null;
  const known = list.filter(p => p.state !== 'unknown').length, n = list.filter(p => p.state === 'home').length;
  return { key: known === 0 ? 'unknown' : n === list.length ? 'allHome' : n > 0 ? 'count' : known === list.length ? 'nobody' : 'unknown', n };
}
