"""Backend tests run with pytest-homeassistant-custom-component (see tests/README.md)."""
import pytest


@pytest.fixture(autouse=True)
def auto_enable_custom_integrations(enable_custom_integrations):
    yield
