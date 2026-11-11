# Backend tests

The integration is tested with [pytest-homeassistant-custom-component](https://github.com/MatthewFlamm/pytest-homeassistant-custom-component), which needs the Python version of the Home Assistant it pins (3.13 at the time of writing):

```bash
uv venv --python 3.13 .venv && uv pip install --python .venv pytest-homeassistant-custom-component
.venv/bin/pytest tests
```

Without that harness (any Python 3.9+), the integration's own modules run against stand-ins of the few Home Assistant helpers they import (`tests/components/atom_home/ha_stub.py`); each file is a plain script:

```bash
for t in air_tasks alarms config_guard feeder_parse light_sleep surface; do python3 tests/components/atom_home/test_$t.py; done
```

`test_alarms.py` — «один раз», the sunrise, a restart in the middle of a ring; `test_light_sleep.py` — «Выключить через»; `test_surface.py` — the HTTP addresses (gzip, etag, what is open without sign-in), the WebSocket commands of a non-admin, set-up and unload. Where the real Home Assistant is installed these three are skipped: `test_config_ws.py` covers the socket there.

The panel's own tests live in `frontend/tests` (`npm test`).

## The whole gate

`frontend/scripts/gate-full.sh <output folder>` runs everything in one go: `tsc`, `npm test`, the backend files above that run under the local `python3`, both builds and every `frontend/scripts/qa-*.mjs` (not `qa-live`, which needs the real Home Assistant). One line per step, then `GATE: clean` or `GATE: FAILED <names>`. Steps named after the folder run alone: `gate-full.sh out tsc test py`, `gate-full.sh out qa-air qa-energy`.
