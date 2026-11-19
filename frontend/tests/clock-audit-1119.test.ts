// Clock audit of 19.11.2026: the clock's settings are read once and kept until a write.
import test from 'node:test';
import assert from 'node:assert/strict';
const store = new Map<string, string>();
(globalThis as unknown as { localStorage: Storage }).localStorage = { getItem: k => store.get(k) ?? null, setItem: (k, v) => { store.set(k, String(v)); }, removeItem: k => { store.delete(k); }, clear: () => store.clear(), key: () => null, length: 0 } as Storage;
const { readClockSettings, writeClockSettings, CLOCK_KEY } = await import('../src/modules/clock-state.ts');

test('the clock\'s settings are parsed once; a write is seen at once', () => {
  const first = readClockSettings();
  store.set(CLOCK_KEY, JSON.stringify({ style: 'digital' })); // changed behind its back (another tab): the cache stays until the storage event
  assert.equal(readClockSettings(), first);
  writeClockSettings({ ...first, style: 'digital' }); assert.equal(readClockSettings().style, 'digital');
});
