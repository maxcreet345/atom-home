import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { HELPERS, missingHelpers, missingUses, createHelpers, outcomeText, TakenError } from '../src/runtime/helpers-setup.ts';
import type { StateRow, EntityRow, Registry } from '../src/model/registry.ts';
import { activeSpecs } from '../src/modules/catalog.ts';
import { defaultConfig } from '../src/model/config.ts';

// 26.11.2026: a new house had no `timer.atom_1…3` and the «Время» sheet showed no timers at all. The panel now offers an administrator
// a bar until the helpers exist, on any house, and creates them through Home Assistant's own `<domain>/create`.
const row = (state = ''): StateRow => ({ state, attributes: {}, last_changed: '', last_updated: '' });
const entity = (entity_id: string, extra: Partial<EntityRow> = {}) => ({ entity_id, ...extra }) as EntityRow;
const all = Object.fromEntries(HELPERS.map(h => [h.entityId, row()]));

test('the list matches the integration (helpers_check.py SPECS) id for id and name for name', () => {
  const py = readFileSync(new URL('../../custom_components/atom_home/helpers_check.py', import.meta.url), 'utf8');
  for (const h of HELPERS) assert.ok(py.includes(h.entityId.includes('timer.atom_') ? 'TIMERS = ("timer.atom_1", "timer.atom_2", "timer.atom_3")' : `"${h.entityId}"`), h.entityId);
  for (const name of new Set(HELPERS.map(h => String(h.params.name)))) assert.ok(py.includes(`"${name}"`) || name.startsWith('Atom ') && py.includes('f"Atom {n}"'), name);
});

test('a new house misses every helper; one that has them all, none; an older one, only what it lacks', () => {
  assert.equal(missingHelpers({ states: {}, entities: [] }).length, HELPERS.length);
  assert.deepEqual(missingHelpers({ states: all, entities: [] }), []);
  const old = { ...all }; delete old['timer.atom_3']; delete old['input_boolean.timer_done'];
  assert.deepEqual(missingHelpers({ states: old, entities: [] }).map(h => h.entityId), ['timer.atom_3', 'input_boolean.timer_done']);
  assert.deepEqual(missingUses(missingHelpers({ states: old, entities: [] })), ['timers']);
});

test('a helper the owner disabled (in the registry, no state) is not offered: creating it again would make timer.atom_1_2', () => {
  const s = { ...all }; delete s['timer.atom_1'];
  assert.deepEqual(missingHelpers({ states: s, entities: [entity('timer.atom_1', { disabled_by: 'user' })] }), []);
});

test('the integration hands out the list: each helper is created once with its parameters; the bar and the sheet tapped together share one try; another screen is told it is busy', async () => {
  const sent: Array<Record<string, unknown>> = []; let claims = 0;
  const ws = async <T,>(m: Record<string, unknown>): Promise<T> => { sent.push(m); if (m.type === 'atom_home/helpers/claim') return { busy: claims > 0, create: claims++ ? [] : [{ entity_id: 'timer.atom_1', params: { name: 'Atom 1', restore: true } }, { entity_id: 'input_text.atom_timer_labels', params: { name: 'Atom timer labels', max: 255 } }] } as T; if (m.type === 'timer/create') return { id: 'atom_1', name: 'Atom 1' } as T; return { id: 'atom_timer_labels' } as T; };
  const reg = { states: {}, entities: [] };
  const [a, b] = await Promise.all([createHelpers(ws, reg), createHelpers(ws, reg)]);
  assert.equal(a, b, 'one try for both taps');
  assert.deepEqual(sent.map(m => m.type), ['atom_home/helpers/claim', 'timer/create', 'input_text/create']);
  assert.deepEqual(sent.slice(1), [{ type: 'timer/create', name: 'Atom 1', restore: true }, { type: 'input_text/create', name: 'Atom timer labels', max: 255 }]);
  assert.deepEqual([a.created, a.busy], [['timer.atom_1', 'input_text.atom_timer_labels'], false]);
  const later = await createHelpers(ws, reg); // another screen, within the lease
  assert.equal(later.busy, true);
});

test('a name whose id is taken (a helper renamed since): Home Assistant makes atom_1_2 — removed again and named as the reason', async () => {
  const sent: Array<Record<string, unknown>> = [];
  const ws = async <T,>(m: Record<string, unknown>): Promise<T> => { sent.push(m); if (m.type === 'atom_home/helpers/claim') return { create: [{ entity_id: 'timer.atom_1', params: { name: 'Atom 1' } }] } as T; if (m.type === 'timer/create') return { id: 'atom_1_2' } as T; return {} as T; };
  const r = await createHelpers(ws, { states: {}, entities: [] });
  assert.deepEqual(sent.slice(1), [{ type: 'timer/create', name: 'Atom 1' }, { type: 'timer/delete', timer_id: 'atom_1_2' }]);
  assert.deepEqual(r.created, []);
  assert.ok(r.failed[0].error instanceof TakenError);
  const t = (k: string, v?: Record<string, string | number>) => `${k}${v ? JSON.stringify(v) : ''}`;
  assert.equal(outcomeText(r, t, () => '?'), `helpers.failed${JSON.stringify({ why: `helpers.taken${JSON.stringify({ id: 'timer.atom_1' })}` })}`);
});

test('nothing to create (the house had them all) is said as such, not «созданы»', async () => {
  const ws = async <T,>(): Promise<T> => ({ create: [], busy: false }) as T;
  const r = await createHelpers(ws, { states: all, entities: [] });
  assert.equal(outcomeText(r, k => k, () => ''), 'helpers.nothing');
});

test('an integration not restarted since the update: the panel creates its own list; one refusal does not stop the rest', async () => {
  const sent: string[] = [];
  const ws = async <T,>(m: Record<string, unknown>): Promise<T> => { sent.push(String(m.type)); if (m.type === 'atom_home/helpers/claim') throw { code: 'unknown_command', message: 'Unknown command.' }; if (m.type === 'timer/create' && m.name === 'Atom 2') throw { code: 'invalid_format', message: 'bad' }; return {} as T; };
  const r = await createHelpers(ws, { states: {}, entities: [] });
  assert.equal(r.created.length, HELPERS.length - 1);
  assert.deepEqual(r.failed.map(f => f.entityId), ['timer.atom_2']);
  const t = (k: string, v?: Record<string, string | number>) => `${k}${v ? JSON.stringify(v) : ''}`;
  assert.equal(outcomeText(r, t, () => 'bad'), `helpers.partly${JSON.stringify({ ok: HELPERS.length - 1, n: HELPERS.length, why: 'bad' })}`);
  assert.equal(outcomeText({ busy: false, created: ['x'], failed: [] }, t, () => ''), 'helpers.done');
});

test('a refused claim (not an administrator, the house away) is the caller\'s error, not a silent «done»', async () => {
  const ws = async <T,>(): Promise<T> => { throw { code: 'unauthorized', message: 'Unauthorized' }; };
  await assert.rejects(createHelpers(ws, { states: {}, entities: [] }));
});

test('the timers appear on the open panel as soon as Home Assistant has them: no reload (modules are found anew on every change; modules/index.ts keeps the array only while the entities are the same)', () => {
  const config = defaultConfig();
  const before: Registry = { areas: [], devices: [], entities: [entity('sun.sun')], states: { 'sun.sun': row('above_horizon') } };
  const clockOf = (r: Registry) => activeSpecs(r, config).find(m => m.spec.id === 'clock');
  assert.equal(clockOf(before)?.entities.timer1, undefined);
  const created = HELPERS.filter(h => h.use === 'timers').map(h => h.entityId);
  const after: Registry = { ...before, entities: [...before.entities, ...created.map(id => entity(id))], states: { ...before.states, ...Object.fromEntries(created.map(id => [id, row('idle')])) } };
  const m = clockOf(after)!;
  assert.deepEqual([m.entities.timer1, m.entities.timer2, m.entities.timer3, m.entities.labels, m.entities.done], created);
});
