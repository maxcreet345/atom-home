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
TARIFFS = {**BASE, "energy": {"tariffs": [{"from": "2025-08-01", "lei": 3.59}, {"from": "2026-04-02", "lei": 3.56}]}}
TARIFFS_DROPPED = dict(BASE)  # what a 1.24.0 panel saves back: its normaliser has no `energy`


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


class TariffGuard(unittest.TestCase):
    def test_feature_name_is_what_the_panel_sends(self):
        ha_store = (pathlib.Path(__file__).parents[3] / "frontend/src/runtime/ha-store.ts").read_text(encoding="utf-8")
        self.assertIn(f"TARIFF_FEATURE = '{const.CLIENT_FEATURE_TARIFF}'", ha_store)

    def test_tariffs_are_detected(self):
        self.assertFalse(cs.has_tariffs(None))
        self.assertFalse(cs.has_tariffs(BASE))
        self.assertFalse(cs.has_tariffs({**BASE, "energy": {"tariffs": []}}))
        self.assertFalse(cs.has_tariffs({**BASE, "energy": []}))
        self.assertTrue(cs.has_tariffs(TARIFFS))

    def test_an_old_panel_cannot_wipe_the_tariff(self):
        save = Saved()
        s = cs.ConfigState(BASE, 1, save)
        self.assertEqual(run(s.write(TARIFFS_DROPPED, 1, [const.CLIENT_FEATURE_ROOM_FEED])), 2, "no tariff stored yet: a 1.24.0 panel still saves")
        self.assertEqual(run(s.write(TARIFFS, 2, [const.CLIENT_FEATURE_ROOM_FEED, const.CLIENT_FEATURE_TARIFF])), 3)
        for features in (None, [], [const.CLIENT_FEATURE_ROOM_FEED], [const.CLIENT_FEATURE_COMPOSITION, const.CLIENT_FEATURE_ROOM_FEED]):
            with self.assertRaises(cs.ConfigWriteError) as err:
                run(s.write(TARIFFS_DROPPED, 3, features))
            self.assertEqual(err.exception.code, "client_outdated")
        self.assertEqual((s.config, s.revision, len(save.calls)), (TARIFFS, 3, 2), "a refused save writes nothing")
        self.assertEqual(run(s.write(TARIFFS_DROPPED, 3, [const.CLIENT_FEATURE_ROOM_FEED, const.CLIENT_FEATURE_TARIFF])), 4, "a new panel may clear the tariff on purpose")

    def test_alarms_set_keeps_the_tariff(self):
        """The server-side alarms write changes only `alarms`: the tariff, the feeds and the device setup stay as stored, whatever the panel knows of them."""
        stored = {**TARIFFS, "rooms": FEEDS["rooms"], "devices": {"w:1": {"composition": {"version": 1}}}}
        save = Saved()
        s = cs.ConfigState(stored, 3, save)
        revision, current, alarms = run(s.write_alarms(lambda _stored: [{"id": "a1", "time": "07:00"}], 3))
        self.assertEqual((revision, current), (4, True))
        self.assertEqual(save.calls, [{"config": {**stored, "alarms": alarms}, "revision": 4}])
        self.assertTrue(cs.has_tariffs(s.config) and cs.has_room_feeds(s.config) and cs.has_wizard_fields(s.config))
        init = (pathlib.Path(__file__).parents[3] / "custom_components/atom_home/__init__.py").read_text(encoding="utf-8")
        handler = init[init.index("async def ws_alarms_set"):init.index("def ws_alarm_stop")]
        self.assertIn("state.write_alarms(", handler)
        self.assertNotIn("state.write(", handler, "alarms/set must not send a whole config of its own")


class AlarmsOnly(unittest.TestCase):
    """`alarms/set` and the server's own «rang once» write: only the `alarms` key, on top of whatever is stored at that moment."""
    STORED = {**BASE, "home": {"name": "Criuleni", "theme": "light"}, "rooms": {"kukhnia": {"feed": "apt9"}}, "alarms": [{"id": "a1", "time": "07:00"}]}

    def test_a_panel_behind_by_a_save_that_left_the_alarms_alone_is_not_refused(self):
        save = Saved()
        s = cs.ConfigState(self.STORED, 57, save)
        dark = {**self.STORED, "home": {"name": "Criuleni", "theme": "dark"}}
        self.assertEqual(run(s.write(dark, 57, [const.CLIENT_FEATURE_ROOM_FEED])), 58)  # the theme, on another screen
        mine = [{"id": "a1", "time": "07:00"}, {"id": "b2", "time": "06:30"}]
        revision, current, alarms = run(s.write_alarms(lambda stored: mine, 57))
        self.assertEqual((revision, current, alarms), (59, False, mine), "saved, and the caller is told its copy of the rest is behind")
        self.assertEqual(s.config, {**dark, "alarms": mine}, "the other screen's theme is kept: nothing but the alarms is taken from this panel")
        self.assertEqual(save.calls[-1], {"config": {**dark, "alarms": mine}, "revision": 59})

    def test_alarms_changed_since_are_a_conflict(self):
        save = Saved()
        s = cs.ConfigState(self.STORED, 57, save)
        self.assertEqual(run(s.write_alarms(lambda stored: stored + [{"id": "b2", "time": "06:30"}], 57))[:2], (58, True))
        for stale in (57, 0):
            with self.assertRaises(cs.ConfigWriteError) as err:
                run(s.write_alarms(lambda stored: [], stale))
            self.assertEqual(err.exception.code, "conflict")
        self.assertEqual((len(s.config["alarms"]), s.revision, len(save.calls)), (2, 58, 1))
        self.assertEqual(run(s.write_alarms(lambda stored: stored[:1], 57, alarms_seen=58))[:2], (59, False), "the writer of 58 itself, its revision still 57")
        # config/set carries the alarms too: an admin's save that changes them moves the mark as well
        self.assertEqual(run(s.write({**s.config, "alarms": []}, 59, [const.CLIENT_FEATURE_ROOM_FEED])), 60)
        with self.assertRaises(cs.ConfigWriteError):
            run(s.write_alarms(lambda stored: [{"id": "a1"}], 59))

    def test_what_happened_before_this_run_is_not_guessed(self):
        s = cs.ConfigState(self.STORED, 57, Saved())
        with self.assertRaises(cs.ConfigWriteError, msg="a panel from before the restart, behind: its alarms may be old"):
            run(s.write_alarms(lambda stored: [], 56))
        self.assertEqual(run(s.write_alarms(lambda stored: [], None))[:2], (58, False), "no revision sent: written, and no revision to take")

    def test_nothing_to_change_writes_nothing(self):
        save = Saved()
        s = cs.ConfigState(self.STORED, 57, save)
        self.assertEqual(run(s.write_alarms(lambda stored: None)), (57, False, self.STORED["alarms"]))
        self.assertEqual((save.calls, s.revision), ([], 57))

    def test_nothing_stored_yet_and_a_failed_save(self):
        s = cs.ConfigState(None, 0, Saved())
        run(s.write_alarms(lambda stored: stored + [{"id": "a1"}], 0))
        self.assertEqual((s.config["schemaVersion"], s.config["alarms"], s.revision), (1, [{"id": "a1"}], 1))

        async def broken(_data):
            raise OSError("disk full")
        s = cs.ConfigState(self.STORED, 57, broken)
        with self.assertRaises(cs.ConfigWriteError) as err:
            run(s.write_alarms(lambda stored: [], 57))
        self.assertEqual((err.exception.code, s.config, s.revision), ("save_failed", self.STORED, 57))
        with self.assertRaises(cs.ConfigWriteError) as err:
            run(cs.ConfigState(self.STORED, 57, Saved()).write_alarms(lambda stored: [{"id": "x", "label": "я" * const.MAX_CONFIG_BYTES}], 57))
        self.assertEqual(err.exception.code, "too_large")


if __name__ == "__main__":
    result = unittest.main(exit=False).result
    print(f"{'OK' if result.wasSuccessful() else 'FAILED'} {result.testsRun} tests (config guard)", flush=True)
    raise SystemExit(0 if result.wasSuccessful() else 1)
