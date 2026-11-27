import test from 'node:test';
import assert from 'node:assert/strict';
import { errorReporter, errorText, REFUSAL_MAX } from '../src/runtime/self-heal.ts';
import { deviceLabel, panelLogSend } from '../src/runtime/panel-log.ts';
import { setRefusalReporter } from '../src/runtime/report.ts';
import { createCommands } from '../src/runtime/commands.ts';

// 27.11.2026: a look picked on a second house did not stay and left no trace. Refusals now go to the integration's log, kept across restarts.
const quiet = async <T,>(f: () => Promise<T> | T): Promise<T> => { const e = console.error, w = console.warn; console.error = console.warn = () => undefined; try { return await f(); } finally { console.error = e; console.warn = w; } };

test('the house\'s refusal is written by its code and message, not as [object Object]', () => {
  assert.equal(errorText({ code: 'conflict', message: 'Changed elsewhere' }), 'conflict: Changed elsewhere');
  const e = Object.assign(new Error('refused'), { code: 'client_outdated' }); e.name = 'SaveError';
  assert.equal(errorText(e), 'SaveError (client_outdated): refused');
  assert.equal(errorText('plain'), 'plain');
});

test('refusals have their own budget: twenty a page, each once', async () => {
  const sent: string[] = [];
  await quiet(() => { const r = errorReporter(async (_m, where, text) => { sent.push(`${where}|${text}`); }, REFUSAL_MAX); for (let i = 0; i < 30; i++) r({ code: 'x', message: String(i) }, 'command:k'); r({ code: 'x', message: '0' }, 'command:k'); });
  assert.equal(sent.length, REFUSAL_MAX); assert.equal(sent[0], 'command:k|x: 0');
});

test('the device in a few words', () => {
  assert.equal(deviceLabel('Mozilla/5.0 (Linux; Android 14) AppleWebKit Chrome/131 Safari/537 Fully Kiosk', 1070, 764), 'Fully Kiosk · Android · 1070×764');
  assert.equal(deviceLabel('Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit Chrome/131 YaBrowser/25 Safari/537', 1440, 900), 'Yandex · Mac · 1440×900');
  assert.equal(deviceLabel('Home Assistant/2026 (iPhone; iOS 19)', 402, 874), 'HA app · iOS · 402×874');
});

test('the integration\'s own log first; an integration not restarted after the update gets Home Assistant\'s log', async () => {
  const sent: Array<Record<string, unknown>> = []; let known = true;
  const ws = () => async <T,>(m: Record<string, unknown>): Promise<T> => { sent.push(m); if (m.type === 'atom_home/log/write' && !known) throw { code: 'unknown_command', message: 'Unknown command.' }; return {} as T; };
  await panelLogSend(ws, '1.43.0', 'warning')('Atom Home panel (save:config): conflict', 'save:config', 'conflict');
  assert.deepEqual({ ...sent[0], device: undefined }, { type: 'atom_home/log/write', where: 'save:config', text: 'conflict', version: '1.43.0', device: undefined });
  known = false; sent.length = 0; const send = panelLogSend(ws, null, 'warning');
  await send('m1', 'w', 't'); await send('m2', 'w', 't');
  assert.deepEqual(sent.map(m => m.type), ['atom_home/log/write', 'call_service', 'call_service'], 'asked once, then straight to the system log');
  assert.equal((sent[1].service_data as { level: string }).level, 'warning');
});

test('a refused command is written once, by its call, with the device it was for; «no connection» is not a refusal', async () => {
  const told: string[] = []; setRefusalReporter((_e, where) => { told.push(where); });
  try {
    let online = true;
    const host = { online: true, call: async () => { throw { code: 'unauthorized', message: 'no' }; } } as unknown as { online: boolean; call: () => Promise<void> };
    const c = createCommands({ host: () => ({ ...host, online }) as never, text: () => 'refused', notify: () => undefined });
    await c.run('light:kitchen', () => c.call('light', 'turn_on', { entity_id: 'light.kitchen' }));
    await new Promise(r => setTimeout(r, 0));
    assert.deepEqual(told, ['call:light.turn_on light.kitchen']);
    await c.run('other', async () => { throw new Error('boom'); }); assert.deepEqual(told.at(-1), 'command:other');
    online = false; const before = told.length; await c.run('x', async () => undefined); assert.equal(told.length, before);
  } finally { setRefusalReporter(() => undefined); }
});
