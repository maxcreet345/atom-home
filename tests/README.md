# Backend tests

The integration is tested with [pytest-homeassistant-custom-component](https://github.com/MatthewFlamm/pytest-homeassistant-custom-component), which needs the Python version of the Home Assistant it pins (3.13 at the time of writing):

```bash
uv venv --python 3.13 .venv && uv pip install --python .venv pytest-homeassistant-custom-component
.venv/bin/pytest tests
```

The panel's own tests live in `frontend/tests` (`npm test`).
