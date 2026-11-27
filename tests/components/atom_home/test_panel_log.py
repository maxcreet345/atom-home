"""The panels' log (panel_log.py, 27.11.2026): python3 tests/components/atom_home/test_panel_log.py"""
import asyncio
import pathlib
import sys
import unittest
from datetime import datetime, timezone

sys.path.insert(0, str(pathlib.Path(__file__).parent))
import ha_stub  # noqa: E402

pl = ha_stub.load("panel_log")
T = datetime(2026, 11, 27, 10, 0, tzinfo=timezone.utc)


def run(coro):
    return asyncio.new_event_loop().run_until_complete(coro)


class Log(unittest.TestCase):
    def make(self, stored=None):
        saved = []

        async def load():
            return stored

        async def save(data):
            saved.append(data)
        return pl.PanelLog(load, save, now=lambda: T), saved

    def test_an_entry_is_cleaned_cut_and_kept_across_a_restart(self):
        log, saved = self.make()
        run(log.async_load())
        e = log.add("Ararat", "save:config", "conflict\x00: changed elsewhere\nreload " + "x" * 5000, "1.43.0", "Mac · 1440×900")
        self.assertEqual((e["at"], e["user"], e["where"], e["version"], e["device"]), ("2026-11-27T10:00:00+00:00", "Ararat", "save:config", "1.43.0", "Mac · 1440×900"))
        self.assertNotIn("\x00", e["text"]); self.assertIn("\n", e["text"]); self.assertEqual(len(e["text"]), pl.TEXT_MAX)
        run(log.async_save())
        again, _ = self.make(saved[-1]); run(again.async_load())
        self.assertEqual(again.entries, [e], "the next start reads what was kept")

    def test_only_the_last_entries_are_kept_and_empty_ones_none(self):
        log, _ = self.make({"entries": [{"where": "w", "text": str(i)} for i in range(250)] + ["junk"]})
        run(log.async_load()); self.assertEqual(len(log.entries), pl.KEEP)
        for i in range(10): log.add("u", "w", f"n{i}")
        self.assertEqual(len(log.entries), pl.KEEP); self.assertEqual(log.entries[-1]["text"], "n9")
        self.assertIsNone(log.add("u", "", "x")); self.assertIsNone(log.add("u", "w", "   ")); self.assertIsNone(log.add("u", 5, None))

    def test_one_socket_cannot_flood_the_log_nor_one_user_with_many(self):
        now = [0.0]; b = pl.Budget(lambda: now[0])
        self.assertEqual(sum(b.take(1, "u1") for _ in range(pl.PER_SOCKET + 10)), pl.PER_SOCKET)
        self.assertTrue(b.take(2, "u2"), "another tablet still may")
        self.assertEqual(sum(b.take(k, "u1") for k in range(10, 20) for _ in range(pl.PER_SOCKET)), pl.PER_USER - pl.PER_SOCKET, "more sockets of one user share PER_USER")
        now[0] += pl.WINDOW_S; self.assertTrue(b.take(1, "u1"), "ten minutes later it may again")
        b.forget(1); self.assertFalse(b.knows(1))

    def test_the_ha_log_gets_one_line(self):
        line = pl.log_line({"user": "A", "where": "w", "text": "first\nFAKE: second", "device": "Mac"})
        self.assertEqual(line, "Atom Home panel · A · Mac · w: first")


if __name__ == "__main__":
    unittest.main()
