# Appliance cards — common brief for every family (21.11.2026)

Product: Atom Home, a Preact + TypeScript panel for Home Assistant (repo maxcreet345/atom-home). Every house the company builds in Moldova gets it.
Owner's bar: world class, no worse than Apple Home / Mi Home / Aqara / Roborock / LG ThinQ / SmartThings; obvious for a 6-year-old and a pensioner.
Style is FIXED: the panel's current look ("Тихий дом": colour only on what is on and on alarms; dark and light themes as already in the panel;
soft shadow in light theme). Do not invent a new style; reuse the panel's tokens, classes and sheet chrome. Copy the structure of existing
appliance sheets: src/modules/kettle.tsx (KettleSheet), src/modules/airfryer.tsx, src/ui/vacuum.tsx, and their CSS in src/styles/atom.css
(search `at-kt-`, `at-fr-`, `at-vac-`). Use the vendor's own app as the reference for WHAT the card shows and in which order (all functions the
model has in HA), drawn in the panel's style.

## Architecture (already in place on branch appliances-base — read these first)
- src/appliances/types.ts — ApplianceFamily (pure: profiles + tileLine) and ApplianceUi (the Sheet). Read the header comment.
- src/model/card-catalog.ts — Profile, RoleSpec (`sibling`, `source`, `suffix`, `as`), instanceView, instanceClaims, candidates,
  suggestBindings, devicesFor. Example profile: PURIFIER_4. Your profiles use `renderer: 'appliance'`, `card: '<family>'`.
- A card is an INSTANCE in `config.profileInstances[id]` = { profileId, profileVersion, bindings{role: entity_id}, deviceId, placement, name?, roomId? }.
  Many instances of one family/model may exist in a house (three TVs). The sheet gets `view` (InstanceView: view.instance.bindings,
  view.device = the HomeDevice made from the anchor role) and must read and drive ONLY the entities in `view.instance.bindings`
  (plus, if truly needed, entities of `view.instance.deviceId`). Never "the first X in the registry".
- The tile on Home/room is the generic AccessoryTile; its second line is your `family.tileLine(registry, instance, t, lang)`.
  The tile's tap opens your Sheet. The catalog («＋ Добавить карточку») preview draws your tile and your Sheet inert.
- `sibling: true` on a role = the same appliance via a second HA integration (SmartThings, AirPlay…): offered only from devices in the chosen
  device's room, and the card hides that device's auto-made tiles.
- Words: src/i18n/words-<family>.ts — ru, ro, en with the SAME keys (ro and ru are equal citizens; en too). Typed so a missing key fails tsc.
  Catalog titles/descriptions keys `cat.p.<x>` / `cat.p.<x>.desc`, role labels `cat.r.<x>` may live in your words file.
- Commands: send via `host.call(domain, service, data)` the way KettleSheet's `useRun` does (one command at a time, nothing while offline,
  errors said in words). Anything destructive or long-running (start a wash, reboot a NAS, power off) goes behind a confirmation in words.
- Product photo: use `usePhoto(entityId)` / `ProductPhoto` from src/ui/photo.tsx (the house's own photo when set); a drawn glyph is the fallback.
- Size classes: cards adapt by container (src/ui/slot-size.ts). CSS rules: NO `@media` on width/height/orientation and NO vw/vh units
  (tests/layout.test.ts forbids them) — use container queries / `var(--hm-width)` like the existing CSS.
- States that must read well: unavailable, unknown, house offline (`host.online === false`), loading, running/idle/finished/error.

## Your files (only these; touching anything else needs a very good reason, say it in your report)
- src/appliances/<family>.profiles.ts, src/appliances/<family>.tsx, src/i18n/words-<family>.ts, src/styles/appliances/<family>.css
- tests/<family>.test.ts (node:test, run: `cd frontend && node --import ./tests/setup-i18n.ts --test tests/<family>.test.ts`)
- scripts/qa-<family>.mjs (playwright, model it on scripts/qa-catalog-all.mjs: preview server on dist-preview, fixture
  ../private/fixtures/criuleni-registry-live-20261121.json, config ../private/fixtures/criuleni-config-20261121.json, shadow root `?shadow=1`;
  add profileInstances to the config in localStorage, open `#home?device=p:<instanceId>` for the sheet and `#home?device=add-card` for the catalog)
- evidence goes to frontend/evidence/<family>/ (screenshots: phone 412×915 and tablet 1280×800, light and dark, every state)

## Data
- The live registry snapshot (read-only copy of the real house, 21.11.2026): private/fixtures/criuleni-registry-live-20261121.json
  ({areas, devices, entities, states, floors}). Dump your devices' entities with their states and ALL attributes before designing.
  Make state variants in tests/QA by mutating a structuredClone (playing, running, finished, error, unavailable…).
- Detect by model code and entity suffix, never by Criuleni's entity ids, device ids or Russian names.

## Hard rules
- Never contact the live Home Assistant. Never send a command to a real device. QA asserts zero commands
  (`window.atomPreview.host.log` filtered `c.domain !== 'ws'` must stay 0 unless the test presses a button on purpose against the preview host).
- Work only in your worktree; commit to your branch `card-<family>` and push it after every commit: `git push -u origin card-<family>`.
  Never touch main, never tag, never release. Commit messages end with:
  Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
- Before you finish: `cd frontend && npx tsc --noEmit -p . && npm test` (5 tests fail before you start because three old fixtures are
  missing — that is known; your change must not add failures), `npm run preview:build`, your qa script green, and look at your own
  screenshots critically (overflow, clipped text, contrast, empty states, both themes, phone and tablet).
- Report back: what each card shows and does (per model), files, test/QA results, screenshot paths, anything you could not do, any decision the
  owner must make, and anything you had to change outside your files.
