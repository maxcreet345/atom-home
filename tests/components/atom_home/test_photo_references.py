"""Photo deletion respects the current saved configuration, including concurrent writes."""
import asyncio
import copy
import pathlib
import sys
import threading
import unittest

sys.path.insert(0, str(pathlib.Path(__file__).parent))
from test_surface import Surface, ah
from ha_stub import Connection, run, send

PHOTO = "/atom_home_photos/0123456789abcdef.jpg"
BASE = {"schemaVersion": 1, "rooms": {}, "devices": {}}


class PhotoReferences(Surface):
    async def configured(self, config):
        w = await self.house(stored=config, revision=7)
        path = w.data["atom_home"]["_photos_dir"] / PHOTO.rsplit("/", 1)[1]
        path.write_bytes(b"photo contents")
        return w, path

    def test_any_stored_reference_keeps_the_file(self):
        async def check(config):
            w, path = await self.configured(config)
            owner = Connection(admin=True)
            await send(owner, type="atom_home/photo/delete", url=PHOTO)
            self.assertTrue(path.exists(), "stored room/device/module/unknown fields must keep their image")
            self.assertEqual(w.stored["atom_home.config"]["config"], config)
        for field in ({"rooms": {"kitchen": {"photo": PHOTO}, "bedroom": {"photo": PHOTO}}},
                      {"devices": {"lamp": {"photo": PHOTO}}},
                      {"modules": {"custom": {"nested": [0, {"image": PHOTO + "?v=2#crop"}]}}},
                      {"future_field": [None, {"deep": "https://home.invalid" + PHOTO}]}):
            run(check({**BASE, **field}))

    def test_delete_before_failed_config_save_keeps_the_file(self):
        async def go():
            original = {**BASE, "rooms": {"kitchen": {"photo": PHOTO}}}
            w, path = await self.configured(original)
            owner = Connection(admin=True)
            await send(owner, type="atom_home/photo/delete", url=PHOTO)
            await send(owner, type="atom_home/config/set", config=BASE, expected_revision=6)
            self.assertEqual(owner.errors[-1][0], "conflict")
            self.assertTrue(path.exists(), "a rejected config transaction must not lose its original photo")
            self.assertEqual(w.stored["atom_home.config"]["config"], original)
        run(go())

    def test_delete_only_after_the_last_reference_has_been_saved_away(self):
        async def go():
            original = {**BASE, "rooms": {"kitchen": {"photo": PHOTO}, "bedroom": {"photo": PHOTO}}}
            _w, path = await self.configured(original)
            owner = Connection(admin=True)
            await send(owner, type="atom_home/config/set", config={**BASE, "rooms": {"bedroom": {"photo": PHOTO}}}, expected_revision=7)
            await send(owner, type="atom_home/photo/delete", url=PHOTO)
            self.assertTrue(path.exists())
            await send(owner, type="atom_home/config/set", config=BASE, expected_revision=8)
            await send(owner, type="atom_home/photo/delete", url=PHOTO)
            self.assertFalse(path.exists())
            self.assertEqual(owner.results[-1], {"removed": True})
            await send(owner, type="atom_home/photo/delete", url=PHOTO)
            self.assertEqual(owner.results[-1], {"removed": False})
        run(go())

    def test_delete_waits_for_a_pending_config_write_before_checking_references(self):
        async def go():
            w, path = await self.configured(copy.deepcopy(BASE))
            state = ah._entry_data(w)["state"]
            entered, release = asyncio.Event(), asyncio.Event()
            save = state._save
            async def slow(data):
                entered.set()
                await release.wait()
                await save(data)
            state._save = slow
            writing = asyncio.ensure_future(state.write({**BASE, "rooms": {"kitchen": {"photo": PHOTO}}}, 7))
            await entered.wait()
            deleting = asyncio.ensure_future(send(Connection(admin=True), type="atom_home/photo/delete", url=PHOTO))
            await w.settle()
            release.set()
            await asyncio.gather(writing, deleting)
            self.assertTrue(path.exists(), "the deletion must see the committed write, not stale memory")
        run(go())

    def test_delete_requires_loaded_state(self):
        async def go():
            w, path = await self.configured(copy.deepcopy(BASE))
            await ah.async_unload_entry(w, self.entry)
            owner = Connection(admin=True)
            await send(owner, type="atom_home/photo/delete", url=PHOTO)
            self.assertTrue(path.exists(), "without stored config loaded it is not safe to delete")
            self.assertEqual(owner.errors[-1][0], "not_loaded")
        run(go())

    def test_nested_deletion_urls_are_rejected(self):
        async def go():
            _w, path = await self.configured(copy.deepcopy(BASE))
            for url in (PHOTO.replace("/0123", "/nested/0123"), PHOTO.replace("/0123", "/../0123"), PHOTO + "\n"):
                owner = Connection(admin=True)
                await send(owner, type="atom_home/photo/delete", url=url)
                self.assertTrue(owner.errors and owner.errors[-1][0] == "bad_url", url)
                self.assertTrue(path.exists())
        run(go())

    def test_percent_encoded_reference_keeps_the_same_file(self):
        async def go():
            config = {**BASE, "rooms": {"kitchen": {"photo": PHOTO.replace("/0123", "/%30123")}}}
            _w, path = await self.configured(config)
            await send(Connection(admin=True), type="atom_home/photo/delete", url=PHOTO)
            self.assertTrue(path.exists(), "the HTTP path decodes percent escapes to this same file")
        run(go())

    def test_cancellation_keeps_the_lock_until_executor_unlink_has_finished(self):
        async def go():
            w, path = await self.configured(copy.deepcopy(BASE))
            state = ah._entry_data(w)["state"]
            entered, finished, release = asyncio.Event(), asyncio.Event(), threading.Event()
            loop = asyncio.get_running_loop()
            saw_reference = []
            executor = w.async_add_executor_job
            async def gated_executor(func, *args):
                if func.__name__ != "_remove":
                    return await executor(func, *args)
                def unlink():
                    loop.call_soon_threadsafe(entered.set)
                    try:
                        if not release.wait(5):
                            raise RuntimeError("test did not release unlink")
                        saw_reference.append(bool((state.config or {}).get("rooms")))
                        return func(*args)
                    finally:
                        loop.call_soon_threadsafe(finished.set)
                return await loop.run_in_executor(None, unlink)
            w.async_add_executor_job = gated_executor
            deleting = asyncio.ensure_future(send(Connection(admin=True), type="atom_home/photo/delete", url=PHOTO))
            await entered.wait()
            deleting.cancel()
            await w.settle()
            deleting.cancel()  # repeated cancellation must not release the writer lock either
            writing = asyncio.ensure_future(state.write({**BASE, "rooms": {"kitchen": {"photo": PHOTO}}}, 7))
            await w.settle()
            writer_was_blocked = not writing.done()
            release.set()
            await asyncio.gather(deleting, writing, return_exceptions=True)
            # Wait for the thread even on the original defective code, whose cancelled future no longer tracks it.
            await asyncio.wait_for(finished.wait(), 1)
            self.assertTrue(writer_was_blocked, "cancelling the request cannot let a config write overtake a pending unlink")
            self.assertEqual(saw_reference, [False], "the deletion completes before the waiting write can commit a new reference")
            self.assertTrue(deleting.cancelled())
        run(go())


if __name__ == "__main__":
    result = unittest.main(exit=False).result
    print(f"{'OK' if result.wasSuccessful() else 'FAILED'} {result.testsRun} tests (photo references)", flush=True)
    raise SystemExit(0 if result.wasSuccessful() else 1)
