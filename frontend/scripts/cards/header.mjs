// The home page's header for the preview: who is home, the language, the settings. People as the house has them on 09.11.2026.
import { card as energy } from './energy.mjs';
const AVA = (hue, letter) => 'data:image/svg+xml;utf8,' + encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="hsl(${hue},70%,72%)"/><stop offset="1" stop-color="hsl(${hue + 40},60%,45%)"/></linearGradient></defs><rect width="64" height="64" fill="url(#g)"/><circle cx="32" cy="25" r="11" fill="#fff" opacity=".9"/><path d="M12 60c2-12 10-18 20-18s18 6 20 18z" fill="#fff" opacity=".9"/><text x="54" y="14" font-size="9" fill="#fff" font-family="system-ui" text-anchor="end">${letter}</text></svg>`);
const PEOPLE = { ararat: ['Ararat Melconean', AVA(210, '')], gayane: ['Gayane Grigorean', null], daniela: ['Daniela Melconean', AVA(320, '')] };
function withPeople(fx, states, long = false) {
  fx = JSON.parse(JSON.stringify(fx)); const old = new Set(fx.entities.filter(e => e.entity_id.startsWith('person.')).map(e => e.entity_id));
  fx.entities = fx.entities.filter(e => !old.has(e.entity_id)); for (const id of old) delete fx.states[id];
  const ago = m => new Date(Date.now() - m * 60000).toISOString();
  Object.entries(PEOPLE).forEach(([key, [name, pic]], i) => { const id = `person.${key}`, st = states[key]; if (st === undefined) return;
    fx.entities.push({ entity_id: id, device_id: null, area_id: null, disabled_by: null, hidden_by: null, entity_category: null, platform: 'person', device_class: null, name: null, original_name: name });
    fx.states[id] = { state: st, attributes: { friendly_name: long && i === 1 ? 'Gayane-Anahit Grigorean-Melconean' : name, ...(pic ? { entity_picture: pic } : {}) }, last_changed: ago([35, 190, 1500][i]), last_updated: ago(1) }; });
  return fx;
}
export const card = {
  name: 'Шапка', sheet: '#home', home: '#home', sheetRoot: '.hm-head', tileRoot: '.at-head-tools', actionButton: null,
  scenarios: {
    allHome: { people: { ararat: 'home', gayane: 'home', daniela: 'home' } },
    mixed: { people: { ararat: 'home', gayane: 'Traian', daniela: 'not_home' } },
    nobody: { people: { ararat: 'not_home', gayane: 'not_home', daniela: 'Atom Service' } },
    unknown: { people: { ararat: 'home', gayane: 'unknown', daniela: 'unavailable' } },
    allUnknown: { people: { ararat: 'unavailable', gayane: 'unknown', daniela: 'unavailable' } },
    long: { people: { ararat: 'home', gayane: 'Esperanza Sanitas', daniela: 'home' }, long: true },
    single: { people: { ararat: 'home' } },
    none: { people: {} },
  },
  build: (base, s, now) => { const b = energy.build(base, energy.scenarios.now, now); return { ...b, snapshot: withPeople(b.snapshot, s.people, s.long) }; },
  config: (text, s) => energy.config(text, {}),
};
