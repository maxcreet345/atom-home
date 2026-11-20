"""Tile layouts per named device, without Home Assistant: python3 tests/components/atom_home/test_layouts.py"""
import asyncio
import importlib
import pathlib
import sys
import types
import unittest

pkg = types.ModuleType("atom_home_layouts")
pkg.__path__ = [str(pathlib.Path(__file__).parents[3] / "custom_components/atom_home")]
sys.modules["atom_home_layouts"] = pkg
lay = importlib.import_module("atom_home_layouts.layouts")


class Saved:
    def __init__(self):
        self.calls = []

    async def __call__(self, data):
        self.calls.append(data)


LOOP = asyncio.new_event_loop()  # one loop, as in HA: the store's lock belongs to the loop it first runs on


def run(coro):
    return LOOP.run_until_complete(coro)


HOME = {"home": [["tile:clock", 2, 1], ["d:light.kitchen", 1, 1]], "room:kukhnia": [["c:kettle", 2, 2]]}


class Layouts(unittest.TestCase):
    def test_two_devices_keep_their_own_layouts(self):
        saved = Saved(); s = lay.LayoutState(None, saved)
        run(s.write("tablet-kitchen", "Планшет кухня", HOME, None))
        run(s.write("phone-ararat", "Телефон Арарата", {"home": [["d:light.kitchen", 2, 2]]}, None))
        self.assertEqual(s.profiles["tablet-kitchen"]["scopes"], HOME)
        self.assertEqual(s.profiles["phone-ararat"]["scopes"], {"home": [["d:light.kitchen", 2, 2]]})
        self.assertEqual(len(saved.calls), 2)

    def test_a_replaced_device_reads_the_layout_back_after_a_restart(self):
        saved = Saved(); s = lay.LayoutState(None, saved)
        run(s.write("tablet-kitchen", "Планшет  кухня ", HOME, None))
        again = lay.LayoutState(saved.calls[-1], Saved())
        self.assertEqual(again.summary()["profiles"]["tablet-kitchen"]["name"], "Планшет кухня")
        self.assertEqual(again.summary()["profiles"]["tablet-kitchen"]["scopes"], HOME)

    def test_revision_guards_two_screens_of_one_name(self):
        s = lay.LayoutState(None, Saved())
        self.assertEqual(run(s.write("t", "T", HOME, 0)), 1)
        with self.assertRaises(lay.LayoutError) as e:
            run(s.write("t", "T", HOME, 0))
        self.assertEqual(e.exception.code, "conflict")
        self.assertEqual(run(s.write("t", "T", HOME, 1)), 2)

    def test_bad_payloads_are_refused_not_trimmed(self):
        s = lay.LayoutState(None, Saved())
        bad = [
            {"home": [["a", 0, 1]]}, {"home": [["a", 9, 1]]}, {"home": [["a", True, 1]]}, {"home": [["a", 1.5, 1]]},
            {"home": [["a", 1, 1], ["a", 1, 1]]}, {"home": [["a", 1]]}, {"kitchen": []}, {"home": [["", 1, 1]]},
            {"home": [["x\n", 1, 1]]}, {"home": [[f"k{i}", 1, 1] for i in range(lay.MAX_ITEMS + 1)]}, [],
        ]
        for scopes in bad:
            with self.assertRaises(lay.LayoutError, msg=repr(scopes)[:80]):
                run(s.write("t", "T", scopes, None))
        for pid in ("", "Tablet", "../x", "a" * 41, "__proto__"):
            with self.assertRaises(lay.LayoutError):
                run(s.write(pid, "T", {}, None))
        for name in ("", "   ", "x" * 41, 5):
            with self.assertRaises(lay.LayoutError):
                run(s.write("t", name, {}, None))
        self.assertEqual(s.profiles, {})

    def test_the_number_of_devices_is_capped(self):
        s = lay.LayoutState(None, Saved())
        for i in range(lay.MAX_PROFILES):
            run(s.write(f"d{i}", f"D{i}", {}, None, "admin", True))
        with self.assertRaises(lay.LayoutError):
            run(s.write("one-more", "X", {}, None, "admin", True))
        run(s.write("d0", "D0 again", {}, 1, "admin", True))  # an existing one may still save

    def test_one_resident_cannot_take_every_place(self):
        s = lay.LayoutState(None, Saved())
        for i in range(lay.MAX_PER_USER):
            run(s.write(f"k{i}", f"K{i}", {}, None, "kid"))
        with self.assertRaises(lay.LayoutError) as e:
            run(s.write("k-more", "More", {}, None, "kid"))
        self.assertEqual(e.exception.code, "too_many")
        run(s.write("tablet", "Планшет кухня", {}, None, "parent"))  # someone else still can

    def test_only_the_owner_or_an_admin_changes_a_device(self):
        s = lay.LayoutState(None, Saved())
        run(s.write("tablet", "Планшет кухня", HOME, None, "parent"))
        with self.assertRaises(lay.LayoutError) as e:
            run(s.write("tablet", "Планшет кухня", {}, 1, "kid"))
        self.assertEqual(e.exception.code, "not_owner")
        self.assertEqual(s.profiles["tablet"]["scopes"], HOME)
        run(s.write("tablet", "Планшет кухня", {}, 1, "parent"))
        run(s.write("tablet", "Планшет кухня", HOME, 2, "admin-user", True))
        self.assertEqual(s.profiles["tablet"]["owner"], "parent")  # an admin's save does not take the device over
        self.assertTrue(s.summary("parent")["profiles"]["tablet"]["mine"])
        self.assertFalse(s.summary("kid")["profiles"]["tablet"]["mine"])
        self.assertNotIn("owner", s.summary("kid")["profiles"]["tablet"])

    def test_an_existing_device_needs_its_revision(self):
        s = lay.LayoutState(None, Saved())
        run(s.write("t", "T", HOME, None, "u"))
        with self.assertRaises(lay.LayoutError) as e:
            run(s.write("t", "T", {}, None, "u"))  # a blind overwrite
        self.assertEqual(e.exception.code, "conflict")

    def test_two_saves_at_once_do_not_lose_each_other(self):
        class Slow(Saved):
            async def __call__(self, data):
                await asyncio.sleep(0.01); self.calls.append(data)
        saved = Slow(); s = lay.LayoutState(None, saved)
        async def both():
            return await asyncio.gather(s.write("a", "A", HOME, None, "u1"), s.write("b", "B", HOME, None, "u2"), return_exceptions=True)
        run(both())
        self.assertEqual(sorted(s.profiles), ["a", "b"])
        self.assertEqual(sorted(saved.calls[-1]["profiles"]), ["a", "b"])
        async def same():
            return await asyncio.gather(s.write("a", "A", {}, 1, "u1"), s.write("a", "A", {}, 1, "u1"), return_exceptions=True)
        r = run(same())
        self.assertEqual(sum(isinstance(x, lay.LayoutError) and x.code == "conflict" for x in r), 1)

    def test_a_failed_save_changes_nothing(self):
        async def broken(_data):
            raise OSError("disk")
        s = lay.LayoutState(None, broken)
        with self.assertRaises(OSError):
            run(s.write("t", "T", HOME, None))
        self.assertEqual(s.profiles, {})

    def test_a_damaged_entry_is_dropped_the_others_stay(self):
        s = lay.LayoutState({"profiles": {"ok": {"name": "Ok", "scopes": HOME, "rev": 3}, "bad": {"name": "", "scopes": {}}, "BAD": {"name": "x"}}}, Saved())
        self.assertEqual(list(s.profiles), ["ok"])
        self.assertEqual(s.profiles["ok"]["rev"], 3)

    def test_remove(self):
        s = lay.LayoutState(None, Saved())
        run(s.write("t", "T", HOME, None))
        self.assertTrue(run(s.remove("t")))
        self.assertFalse(run(s.remove("t")))


class Surface(unittest.TestCase):
    def test_commands_are_registered_and_advertised(self):
        src = (pathlib.Path(__file__).parents[3] / "custom_components/atom_home/__init__.py").read_text(encoding="utf-8")
        for cmd in ("ws_layouts_get", "ws_layouts_set", "ws_layouts_delete"):
            self.assertIn(f"async_register_command(hass, {cmd})", src)
        self.assertIn('"layouts": 1', src)
        # a resident writes their own screen; only forgetting a device is the administrator's
        set_block = src.split('f"{DOMAIN}/layouts/set"')[1].split("async def")[0]
        self.assertNotIn("require_admin", set_block)
        delete_block = src.split('f"{DOMAIN}/layouts/delete"')[1].split("async def")[0]
        self.assertIn("require_admin", delete_block)


if __name__ == "__main__":
    unittest.main()
