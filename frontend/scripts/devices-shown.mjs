// Which devices of a house «Устройства» shows and which it hides (src/model/device-list.ts), as markdown tables (the rule in words: docs/DEVICE-MODEL.md).
// usage: node scripts/devices-shown.mjs <card-preview port> [card scenario]...   e.g. node scripts/devices-shown.mjs 4472 rooms live security disarmed
// Reads the house the card preview builds for each scenario (its /__state: the snapshot and the owner's settings), finds the modules and what
// they claim the way the panel does, and prints one section per scenario.
import { discover } from '../src/model/discover.ts';
import { normaliseConfig } from '../src/model/config.ts';
import { activeSpecs, IMOU_ROLES } from '../src/modules/catalog.ts';
import { cameraClaims } from '../src/modules/camera-state.ts';
import { doorbellClaims } from '../src/modules/doorbell-state.ts';
import { deviceVerdicts, APPLIANCE_MODULES } from '../src/model/device-list.ts';
const [port, ...pairs] = process.argv.slice(2);
const claims = { pet_feeder: e => [...Object.entries(e).filter(([k]) => k !== 'device' && k !== 'rest').map(([, v]) => v), ...(e.rest ?? '').split(',')], kettle: e => [e.heater, ...(e.rest ?? '').split(',')], camera_go2rtc: cameraClaims, doorbell: doorbellClaims,
  // the modules' own claims (modules/camera-onvif.tsx, camera-imou.tsx): a camera's second stream and its switches are its card's
  camera_onvif: e => [e.camera !== e.sd ? e.sd : undefined, e.camera2 !== e.sd2 ? e.sd2 : undefined, e.person, e.pet, e.vehicle, e.motion, e.motionCell, e.reboot, e.setTime], camera_imou: e => IMOU_ROLES.map(r => r.role).filter(r => r !== 'camera').map(r => e[r]) };
const cell = s => String(s ?? '').replace(/\|/g, '/');
for (let i = 0; i < pairs.length; i += 2) {
  const [card, scenario] = [pairs[i], pairs[i + 1]], s = await (await fetch(`http://127.0.0.1:${port}/__state?card=${card}&scenario=${scenario}`)).json();
  const { config } = normaliseConfig(s.config), reg = s.snapshot, specs = activeSpecs(reg, config);
  const claimed = new Set(specs.flatMap(a => (claims[a.spec.id]?.(a.entities) ?? []).filter(Boolean)));
  const home = discover(reg, config, claimed), room = id => home.rooms.find(r => r.id === id)?.name || '—';
  const enabled = home.devices.filter(d => d.enabled), byId = new Map(reg.devices.map(d => [d.id, d]));
  // the panel's own cameras (app.tsx camViews): those that answer, and those a camera module plays
  const played = new Set(specs.filter(a => /^camera_|^doorbell$/.test(a.spec.id)).flatMap(a => [a.entities.camera, a.entities.camera2]).filter(Boolean));
  const cameras = new Set(enabled.filter(d => d.kind === 'camera' && (d.primary.available || played.has(d.primary.id))).map(d => d.key));
  const all = deviceVerdicts(enabled, { deviceName: id => { const d = byId.get(id); return d ? d.name_by_user ?? d.name ?? null : null; }, cameras }), shown = all.filter(x => x.verdict.shown), hidden = all.filter(x => !x.verdict.shown);
  const mods = specs.filter(a => APPLIANCE_MODULES.includes(a.spec.id));
  console.log(`## The house of the card preview «${card} / ${scenario}»\n\n${shown.length + mods.length} shown (${shown.length} devices + ${mods.length} module card${mods.length === 1 ? '' : 's'}), ${hidden.length} hidden.\n`);
  console.log('### Shown\n\n| group | device | room | kind | why |\n|---|---|---|---|---|');
  for (const m of mods) console.log(`| appliances | ${cell(m.label)} (module card «${m.spec.id}») | ${room(reg.devices.find(d => d.id === m.entities.device)?.area_id ?? '')} | module | its own card |`);
  for (const { device: d, verdict: v } of shown) console.log(`| ${v.group} | ${cell(v.label ? `${v.label} — its card «${d.name}»` : d.name)} | ${cell(room(d.roomId))} | ${d.kind} | ${v.why} |`);
  console.log('\n### Hidden (still in their rooms, sheets, summaries, «Безопасность», the search and «Внимание»)\n\n| device | room | kind | why |\n|---|---|---|---|');
  for (const { device: d, verdict: v } of hidden.sort((a, b) => a.verdict.why.localeCompare(b.verdict.why) || a.device.name.localeCompare(b.device.name, 'ru'))) console.log(`| ${cell(d.name)} | ${cell(room(d.roomId))} | ${d.kind} | ${v.why} |`);
  console.log('');
}
