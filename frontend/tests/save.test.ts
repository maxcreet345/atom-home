import test from 'node:test';
import assert from 'node:assert/strict';
import { memoryStore, SaveError } from '../src/runtime/store.ts';
import { haStore } from '../src/runtime/ha-store.ts';
import { defaultConfig } from '../src/model/config.ts';
import type { Hass } from '../src/runtime/host.ts';

const named = (name: string) => { const c = defaultConfig(name); return c; };

test('a second panel that saves after the first gets a conflict and keeps nothing of its own', async () => {
  const a = memoryStore(named('A')), b = a.client();
  await a.load(); await b.load();
  assert.equal((await a.save(named('from tablet'))).revision, 1);
  await assert.rejects(b.save(named('from phone')), (e: unknown) => e instanceof SaveError && e.code === 'conflict');
  assert.equal((await b.load()).config.home.name, 'from tablet');
  assert.equal((await b.save(named('phone, after reload'))).revision, 2);
});

test('an injected failure rejects once and leaves the stored config alone', async () => {
  const s = memoryStore(named('Kept')); await s.load();
  s.failNext('failed');
  await assert.rejects(s.save(named('Lost')), (e: unknown) => e instanceof SaveError && e.code === 'failed');
  assert.equal((await s.load()).config.home.name, 'Kept');
  await s.save(named('Next')); assert.equal((await s.load()).config.home.name, 'Next');
});

/** Fake HA connection with the integration's revision rule. `revision: false` imitates an integration older than 1.2. */
function fakeHass(opts: { revision?: boolean } = {}) {
  const calls: Array<Record<string, unknown>> = []; let revision = 4, stored: unknown = defaultConfig('Stored');
  const hass = {
    states: {}, async callService() { throw new Error('no commands'); },
    async callWS<T>(msg: Record<string, unknown>): Promise<T> {
      calls.push(msg); await new Promise(r => setTimeout(r, 1));
      if (msg.type === 'atom_home/config/get') return { config: stored, version: 'x', admin: true, ...(opts.revision === false ? {} : { revision }) } as T;
      if (msg.type === 'atom_home/config/set') {
        if (msg.expected_revision !== undefined && msg.expected_revision !== revision) throw { code: 'conflict', message: 'Configuration was changed elsewhere' };
        if ((msg.config as { home: { name: string } }).home.name === 'disk full') throw { code: 'save_failed', message: 'Configuration could not be written' };
        stored = msg.config; revision++; return { saved: true, ...(opts.revision === false ? {} : { revision }) } as T;
      }
      throw { code: 'unknown_command', message: 'Unknown command.' };
    },
  } as unknown as Hass;
  return { hass, calls, bump() { revision++; } };
}

test('haStore sends the revision it read and advances it after each confirmed save', async () => {
  const f = fakeHass(), s = haStore(() => f.hass);
  assert.equal((await s.load()).revision, 4);
  await s.save(named('one')); await s.save(named('two'));
  assert.deepEqual(f.calls.filter(c => c.type === 'atom_home/config/set').map(c => c.expected_revision), [4, 5]);
  assert.ok(f.calls.every(c => c.client_features === undefined), 'release 0 does not claim to keep wizard fields');
});

test('two quick edits are queued, not raced: both reach HA in order with their own revision', async () => {
  const f = fakeHass(), s = haStore(() => f.hass); await s.load();
  const [r1, r2] = await Promise.all([s.save(named('first')), s.save(named('second'))]);
  assert.deepEqual([r1.revision, r2.revision], [5, 6]);
});

test('an edit from another device turns the next save into a conflict; a failed write is reported as failed', async () => {
  const f = fakeHass(), s = haStore(() => f.hass); await s.load();
  f.bump();
  await assert.rejects(s.save(named('stale')), (e: unknown) => e instanceof SaveError && e.code === 'conflict');
  await s.load();
  await assert.rejects(s.save(named('disk full')), (e: unknown) => e instanceof SaveError && e.code === 'failed');
  assert.equal((await s.save(named('after'))).revision, 6, 'a failed save does not block the queue');
});

test('with an older integration (no revision) saves go out exactly as before', async () => {
  const f = fakeHass({ revision: false }), s = haStore(() => f.hass);
  assert.equal((await s.load()).revision, undefined);
  await s.save(named('legacy'));
  const set = f.calls.find(c => c.type === 'atom_home/config/set')!;
  assert.deepEqual(Object.keys(set).sort(), ['config', 'type']);
});
