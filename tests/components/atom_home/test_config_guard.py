"""The config write guard without Home Assistant: python3 tests/components/atom_home/test_config_guard.py

config_state.py is HA-free on purpose; it is loaded here as a module of a bare package so the integration's __init__ (which needs HA) never runs.
The same rules over the real socket are in test_config_ws.py, which needs the HA test harness.
"""
import asyncio
import importlib
import pathlib
import sys
import types
import unittest

pkg = types.ModuleType("atom_home_guard")
pkg.__path__ = [str(pathlib.Path(__file__).parents[3] / "custom_components/atom_home")]
sys.modules["atom_home_guard"] = pkg
cs = importlib.import_module("atom_home_guard.config_state")
const = importlib.import_module("atom_home_guard.const")

BASE = {"schemaVersion": 1, "home": {"name": "Test"}, "devices": {}}
FEEDS = {**BASE, "rooms": {"kukhnia": {"name": "Кухня", "feed": "entrance_spm_apt9"}, "detskaia": {"feed": "entrance_spm_apt8"}}}
FEEDS_DROPPED = {**BASE, "rooms": {"kukhnia": {"name": "Кухня"}, "detskaia": {}}}  # what a 1.18.0 panel saves back: its normaliser has no `feed`


class Saved:
    def __init__(self):
        self.calls = []

    async def __call__(self, data):
        self.calls.append(data)


def run(coro):
    return asyncio.new_event_loop().run_until_complete(coro)


class RoomFeedGuard(unittest.TestCase):
    def test_feature_name_is_what_the_panel_sends(self):
        ha_store = (pathlib.Path(__file__).parents[3] / "frontend/src/runtime/ha-store.ts").read_text(encoding="utf-8")
        self.assertIn(f"ROOM_FEED_FEATURE = '{const.CLIENT_FEATURE_ROOM_FEED}'", ha_store)

    def test_feeds_are_detected(self):
        self.assertFalse(cs.has_room_feeds(None))
        self.assertFalse(cs.has_room_feeds(BASE))
        self.assertFalse(cs.has_room_feeds(FEEDS_DROPPED))
        self.assertFalse(cs.has_room_feeds({**BASE, "rooms": []}))
        self.assertTrue(cs.has_room_feeds(FEEDS))

    def test_an_old_panel_cannot_wipe_the_feeds(self):
        save = Saved()
        s = cs.ConfigState(BASE, 1, save)
        self.assertEqual(run(s.write(FEEDS_DROPPED)), 2, "no feed stored yet: a 1.18.0 panel still saves")
        self.assertEqual(run(s.write(FEEDS, 2, [const.CLIENT_FEATURE_ROOM_FEED])), 3)
        for revision, features in ((None, None), (3, None), (3, []), (3, [const.CLIENT_FEATURE_COMPOSITION])):
            with self.assertRaises(cs.ConfigWriteError) as err:
                run(s.write(FEEDS_DROPPED, revision, features))
            self.assertEqual(err.exception.code, "client_outdated")
        self.assertEqual((s.config, s.revision, len(save.calls)), (FEEDS, 3, 2), "a refused save writes nothing")
        self.assertEqual(run(s.write(FEEDS_DROPPED, 3, [const.CLIENT_FEATURE_ROOM_FEED])), 4, "a new panel may clear a feed on purpose")

    def test_the_composition_guard_is_unchanged_next_to_it(self):
        wizard = {**FEEDS, "devices": {"p:feeder:1": {"type": "pet_feeder"}}}
        s = cs.ConfigState(wizard, 1, Saved())
        with self.assertRaises(cs.ConfigWriteError) as err:
            run(s.write(wizard, 1, [const.CLIENT_FEATURE_ROOM_FEED]))
        self.assertEqual(err.exception.code, "client_outdated")
        self.assertEqual(run(s.write(wizard, 1, [const.CLIENT_FEATURE_COMPOSITION, const.CLIENT_FEATURE_ROOM_FEED])), 2)


if __name__ == "__main__":
    result = unittest.main(exit=False).result
    print(f"{'OK' if result.wasSuccessful() else 'FAILED'} {result.testsRun} tests (config guard)", flush=True)
    raise SystemExit(0 if result.wasSuccessful() else 1)
