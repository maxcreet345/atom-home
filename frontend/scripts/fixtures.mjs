// Where the private fixtures of the qa scripts are, and what a script does when one is not there.
// The fixtures are the house's own data: they live in private/fixtures and beside the checkout in clients/ (never in git, the repository is public).
// A script that cannot find one stops with «SKIP <script>: fixture missing: <file>» and exit code 77 — not a crash, and never a pass:
// gate-full.sh counts any exit code but 0 as a failed step. `node scripts/rebuild-fixtures.mjs` writes what can be cut from the 21.11 snapshot.
import { existsSync, readFileSync } from 'node:fs';
import { resolve, basename } from 'node:path';
export const FIXTURES = resolve(import.meta.dirname, '../../private/fixtures'), CLIENT = resolve(import.meta.dirname, '../../../clients/criuleni');
export const SKIPPED = 77;
// The two registries of 28.10 are lost (rebuild-fixtures.mjs): the qa scripts run on the 21.11 house instead — whole for the readers of the first,
// cut for the cards' mock layers for the readers of the second — and say so.
const STAND_IN = { 'criuleni-registry.json': 'criuleni-house-rebuilt.json', 'criuleni-registry-live-20261028.json': 'criuleni-house-under-cards-rebuilt.json' };
const script = basename(process.argv[1] ?? 'script'), told = new Set();
const place = name => resolve(name.startsWith('atom-home-config-') ? CLIENT : FIXTURES, name);
const shown = name => (name.startsWith('atom-home-config-') ? 'clients/criuleni/' : 'private/fixtures/') + name;
/** The file's path, or null when neither it nor its stand-in is there. */
export function findFixture(name) {
  if (existsSync(place(name))) return place(name);
  const other = STAND_IN[name];
  if (other && existsSync(place(other))) { if (!told.has(name)) { told.add(name); console.error(`NOTE ${script}: ${shown(name)} is lost — running on ${shown(other)} (the 21.11 house, rebuilt)`); } return place(other); }
  return null;
}
export const missingFixtures = (...names) => names.filter(n => !findFixture(n));
/** Stops the script with a skip when any of the files is not there. */
export function needFixtures(...names) {
  const gone = missingFixtures(...names); if (!gone.length) return;
  console.error(`SKIP ${script}: fixture missing: ${gone.map(shown).join(', ')} — the house's private data is not in git; scripts/rebuild-fixtures.mjs writes what the 21.11 snapshot can give`);
  process.exit(SKIPPED);
}
/** The path of a file the script cannot run without (a skip when it is not there). */
export const fixturePath = name => { needFixtures(name); return findFixture(name); };
/** The same for a module a standing server loads on request (scripts/cards/*.mjs, camera-fixture.mjs): it throws — the server answers that request with an error and lives on. */
export const requireFixture = name => { const p = findFixture(name); if (!p) throw new Error(`fixture missing: ${shown(name)} (scripts/rebuild-fixtures.mjs writes what the 21.11 snapshot can give)`); return p; };
export const readFixture = name => readFileSync(fixturePath(name), 'utf8');
export const loadFixture = name => JSON.parse(readFixture(name));
/** A file one part of a script needs: parsed, or null — the part then records its own skip (`skipCheck`) and the script ends with 77 unless something failed. */
export const optionalFixture = name => { const p = findFixture(name); return p ? JSON.parse(readFileSync(p, 'utf8')) : null; };
const skipped = [];
/** One part of a script that could not run: said aloud, and the script ends with 77 unless it fails. */
export function skipCheck(what, name) { skipped.push(what); console.log(`SKIP ${what}: fixture missing: ${shown(name)}`); }
// only a run that would otherwise end clean becomes a skip: a crash, a stall (13) or the script's own failure code stay what they are
process.on('exit', code => { if (code === 0 && skipped.length) process.exitCode = SKIPPED; });
export const skippedChecks = () => [...skipped];
/** The script's exit code: 1 with failures, 77 with a part skipped for a missing fixture, else 0 (for the scripts that end with their own process.exit). */
export const exitWith = failed => failed ? 1 : skipped.length ? SKIPPED : 0;

// ---- what the two preview servers and each card of scripts/cards/ read (a script that starts a server asks before it starts it) ----
const CAM = 'criuleni-camera-20261104.json', HEAT = 'criuleni-heating-20261109.json', VAC = 'criuleni-vacuum-20261109.json';
const CARDS = {
  air: [], energy: [], header: [], cameras: [CAM], heating: [CAM, HEAT], airfryer: [CAM, HEAT], kettle: [CAM, HEAT], security: [CAM, HEAT], vacuum: [CAM, HEAT, VAC], rooms: [CAM, HEAT, VAC, 'criuleni-rooms-20261109.json'],
  'okapi-climate': ['okapi-climate-20261109.json'], 'okapi-light': ['okapi-light-20261109.json'], 'okapi-security': ['okapi-security-20261109.json'], 'okapi-energy': ['okapi-energy-20261109.json'],
};
const CARD_PREVIEW = ['criuleni-registry-live-20261028.json', 'atom-home-config-20261028.json'], PREVIEW_SERVER = ['criuleni-registry.json', 'atom-home-config-20261028.json'];
export const cardFixtures = (...cards) => [...new Set([...CARD_PREVIEW, ...cards.flatMap(c => CARDS[c] ?? [])])];
/** Before scripts/card-preview.mjs is started for these cards. */
export const needCards = (...cards) => needFixtures(...cardFixtures(...cards));
/** Before scripts/preview-server.mjs is started. */
export const needPreviewServer = () => needFixtures(...PREVIEW_SERVER);
/** The cards (of those named) whose fixtures are not there: their parts of a script are skipped by `skipCheck`. */
export const cardMissing = card => missingFixtures(...(CARDS[card] ?? []))[0] ?? null;
