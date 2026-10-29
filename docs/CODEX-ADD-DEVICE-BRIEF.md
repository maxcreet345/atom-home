# Brief for Codex: plan the «Add device» wizard with AI-assisted entity discovery

Copy everything below the line into Codex (planning mode, no code changes). The result must be a plan document `docs/PLAN-ADD-DEVICE.md`, not an implementation.

---

You are planning a feature for **Atom Home**, a universal Home Assistant panel (repo root = this directory). Produce a plan only: write `docs/PLAN-ADD-DEVICE.md`, change no other file. Read the code before planning; do not guess APIs.

## What the project is (read these first)
- `README.md`, `docs/PLAN.md` (stages 1–9 done, status line at the top), `docs/UX-GUIDE.md` (UX rules we follow), `docs/DESIGN-HOMEOS.md` (design system), `docs/STAGE-8-REPORT.md` and `docs/STAGE-9-REPORT.md` (how device sheets and motion are built).
- Frontend: Preact 11 + TypeScript + Vite in `frontend/`. Live bundle is built to `custom_components/atom_home/frontend/atom-home.js`; preview bundle `frontend/dist-preview` is used by the QA scripts.
- Backend: HACS integration `custom_components/atom_home/__init__.py` — a `panel_custom` panel plus WebSocket commands `atom_home/config/get`, `atom_home/config/set`, `atom_home/photo/set`, `atom_home/photo/delete`. Config is stored in `.storage/atom_home.config`. Python changes need a Home Assistant restart; frontend-only releases apply on reload.
- Data model: `frontend/src/model/discover.ts` builds `HomeDevice` objects from the HA device/entity/area registries and live states. Each `HomeDevice` has `kind` (`frontend/src/model/kinds.ts`), `primary`, `controls[]`, `metrics[]`, `parameters[]`, `diagnostics[]`, `roomId`, `manufacturer`, `model`, `haDeviceId`. Entities are classified by domain, device_class and `entity_category`. The house config (`frontend/src/model/config.ts`, `HouseConfig`) overrides devices by key: `enabled`, `name`, `roomId`, `icon`, `kind`, `art`, `favorite`, `order`, `photo`, and `mergeInto` (fold one device's entities into another device's card).
- Actions: `frontend/src/runtime/actions.ts` — `actionsFor(device)` and `entityActions(entity)` map entities to toggles/sliders/selects/buttons; `confirm`/`risk` flags drive confirmation dialogs.
- UI: `frontend/src/ui/app.tsx` (navigation, Home face, rooms, Systems segments), `frontend/src/ui/cards.tsx` (tiles), `frontend/src/ui/sheet.tsx` (device sheet: hero → power → modes → sliders → readings → settings → diagnostics), `frontend/src/ui/setup.tsx` (in-panel configurator, tabs Devices / Rooms / Sections / Buttons / Modules / Home). Modules (boiler eBUS, camera go2rtc, pet feeder) live in `frontend/src/modules/` with a catalog in `catalog.ts`.
- i18n: `frontend/src/i18n/{ru,ro,en}.ts`; every key must exist in all three. No `entity_id` or raw keys on user-facing screens (UX rule).
- QA: `frontend/tests/*.test.ts` (`npm test`), `frontend/scripts/qa-audit.mjs`, `qa-setup.mjs`, `qa-cards.mjs`, `qa-feeder.mjs`, `qa-live.mjs` run on the preview bundle against the registry snapshot `private/fixtures/criuleni-registry.json` (the preview host rejects commands, so they are safe). Private fixtures/references are not committed.
- Pilot house: Criuleni HA (config in `../clients/criuleni/atom-home-config-20261029.json`). A second fixture exists for the Traian house (`private/fixtures/traian-registry.json`, Xiaomi feeder, Roborock).

## The feature to plan: «Add device»
Today the configurator lists everything `discover()` found and the owner only ticks what to show. We want a guided flow:

1. **Setup → Devices → «Добавить устройство»** opens a wizard (sheet on tablets/laptops, full-screen steps on phones).
2. **Step 1 — type.** The user picks a device type from a visual grid (vacuum, air purifier, humidifier, thermostat/radiator, light, socket, camera, feeder, sensor, boiler, media, lock, cover, custom…). Types should map onto `Kind` plus module kinds; propose how new types that are not a `Kind` yet (air purifier, humidifier) are represented.
3. **Step 2 — candidate.** The panel shows HA devices/entities that look like that type (by domain, device_class, manufacturer/model, integration, names). The user picks one (or several to merge).
4. **Step 3 — «найти всё, что относится» (find everything related).** This is the core. Starting from the chosen device, collect every related entity: same HA device (`device_id`), same `via_device`, same integration config entry, entities whose `entity_id`/name share the device's slug or the HA device name, helper entities (`input_*`, `number`, `select`, `button`, `switch` sub-features, `sensor` readings, `binary_sensor` states), automations/scripts that reference the device, and camera/stream relations. Show the result as a checklist grouped into *controls / modes / readings / settings / diagnostics / related automations*, each with a plain-language label (no entity_id), pre-checked by confidence. The user confirms or unchecks.
5. **AI assist (optional, pluggable).** Plan an `AssistProvider` interface with two implementations: (a) a local heuristic ranker (name similarity, shared device/config entry, device_class rules, vendor fingerprints like Xiaomi MIOT `siid/piid` attributes, Roborock, Sonoff, Zigbee2MQTT); (b) an LLM provider that sends an anonymised description of the candidate entities (domain, device_class, attribute keys, names — never tokens, never user photos) and gets back grouping + labels + suggested card layout. The LLM provider must be opt-in with a configurable endpoint/key stored on the HA side (never in the frontend bundle), with Home Assistant's own conversation/LLM API as one option and a direct Anthropic/OpenAI call as another; everything must work without any AI (heuristic only).
6. **Step 4 — card preview.** Render the device sheet as it will look (hero, power, modes, sliders, readings, settings) using the real `sheet.tsx` with the chosen entities, let the user rename the device, pick the room, icon/illustration (`ui/device-art.tsx`), favourite, and mark risky actions as «confirm». Save = config patch via `atom_home/config/set` (`devices[key]`, `mergeInto`, new fields if needed).
7. **Afterwards** the device appears in rooms/Systems like any other, and «Edit device» reopens the same wizard at step 3.

## Constraints
- Keep the one-code-many-houses rule: nothing house-specific in code; everything the wizard decides goes into `HouseConfig`.
- No HA restart for frontend-only parts; if a backend WebSocket command is needed (e.g. to read automations, config entries, or to call the LLM), plan it as a separate backend stage with a schema, and note that it needs a restart.
- Risky actions (valves, locks, boiler, alarm, buttons that start machines) must default to `confirm: true`.
- Follow `docs/UX-GUIDE.md`: thumb zone, ≥44 px targets, state before action, no raw ids, ru/ro/en.
- Tests and QA scripts must be extended, not bypassed; plan which fixture snapshots and which `qa-*.mjs` checks each stage adds.
- Safety: the wizard never sends device commands during discovery; previews use the preview host which rejects commands.

## What the plan must contain
1. **User flow** step by step with screen sketches in text (what is on each screen, phone vs tablet/laptop).
2. **Data model changes**: exact additions to `HouseConfig` / `DeviceOverride` / `HomeDevice`, with backwards compatibility and `normaliseConfig` rules.
3. **Discovery algorithm**: the relation graph (device_id, via_device, config_entry, slug/name similarity, attributes), the scoring, and how results are grouped and labelled; concrete examples on the Criuleni Roborock and the Traian Xiaomi feeder from the fixtures.
4. **AssistProvider design**: interface, heuristic implementation, LLM implementation (prompt shape, what is sent, what is returned, validation of the response, timeouts, cost control), where keys live, how the user enables it.
5. **Backend changes** (if any): new WebSocket commands with schemas, permissions (admin only), and the restart requirement.
6. **UI components** to add/modify with file paths, and how the wizard reuses `sheet.tsx` for the preview.
7. **Stages** (3–5 releases), each with acceptance criteria, tests/QA to add, and what is verified live in the pilot house.
8. **Risks and open questions** for the owner (max 7, each with a recommended default).

Write the plan in Russian (headings and prose), keep code identifiers in English. Do not write implementation code; short TypeScript interface sketches are fine.
