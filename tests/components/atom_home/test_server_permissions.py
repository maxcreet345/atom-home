"""Saved alarm authority through the real WS handlers, using plain Python HA stubs."""
import asyncio
import copy
import pathlib
import sys
import types
import unittest

sys.path.insert(0, str(pathlib.Path(__file__).parent))
from test_surface import Surface, ah
from ha_stub import Connection, Unauthorized, run, send

LAMP, SPEAKER = "light.private_bedroom", "media_player.private_speaker"
OLD = {"id": "private", "time": "07:00", "days": [], "enabled": False,
       "light": True, "lightEntity": LAMP, "fadeMin": 0, "alice": "tts", "station": SPEAKER}
BASE = {"schemaVersion": 1, "rooms": {}, "devices": {}, "alarms": [OLD]}


class AlarmPermissions(Surface):
    async def configured(self, stored=BASE):
        w = await self.house(stored=copy.deepcopy(stored), revision=7)
        self.users = {}

        async def get_user(user_id):
            return self.users.get(user_id)
        w.auth = types.SimpleNamespace(async_get_user=get_user)
        return w

    def user(self, user_id="guest", admin=False, deny=()):
        c = Connection(admin=admin, deny=deny)
        c.user.id, c.user.is_active = user_id, True
        self.users[user_id] = c.user
        return c

    def test_new_alarm_cannot_reuse_a_forbidden_saved_target(self):
        async def go():
            w = await self.configured()
            for target in (LAMP, SPEAKER):
                guest = self.user(deny=[target])
                with self.assertRaises(Unauthorized, msg="a target in another stored alarm gives no authority"):
                    await send(guest, type="atom_home/alarms/set", alarms=[OLD, {**OLD, "id": "new", "enabled": True}], expected_revision=7)
                self.assertEqual(w.stored["atom_home.config"]["revision"], 7)
        run(go())

    def test_every_modified_alarm_checks_all_its_actual_targets(self):
        async def go():
            w = await self.configured()
            guest = self.user(deny=[LAMP])
            for changes in ({"enabled": True}, {"time": "08:00"}, {"label": "Changed"}, {"light": False, "alice": "music"}):
                guest.deny = {SPEAKER} if changes.get("light") is False else {LAMP}
                with self.assertRaises(Unauthorized, msg=str(changes)):
                    await send(guest, type="atom_home/alarms/set", alarms=[{**OLD, **changes}], expected_revision=7)
            self.assertEqual(w.stored["atom_home.config"]["revision"], 7)
        run(go())

    def test_unchanged_forbidden_alarm_can_be_carried_forward(self):
        async def go():
            w = await self.configured()
            guest = self.user(deny=[LAMP, SPEAKER])
            await send(guest, type="atom_home/alarms/set", alarms=[OLD, {"id": "mine", "time": "09:00"}], expected_revision=7)
            self.assertEqual(guest.errors, [])
            self.assertEqual(len(w.stored["atom_home.config"]["config"]["alarms"]), 2)
        run(go())

    def test_unchanged_comparison_uses_the_latest_committed_list(self):
        async def go():
            w = await self.configured()
            guest = self.user(deny=[LAMP, SPEAKER])
            state = ah._entry_data(w)["state"]
            entered, release = asyncio.Event(), asyncio.Event()
            save = state._save
            async def slow(data):
                entered.set()
                await release.wait()
                await save(data)
            state._save = slow
            writing = asyncio.ensure_future(state.write({**BASE, "alarms": []}, 7))
            await entered.wait()
            saving_guest = asyncio.ensure_future(send(guest, type="atom_home/alarms/set", alarms=[OLD]))
            await w.settle()
            release.set()
            await writing
            with self.assertRaises(Unauthorized, msg="a removed row is new again, even if it existed before lock acquisition"):
                await saving_guest
            self.assertEqual(state.config["alarms"], [])
        run(go())

    def test_unused_light_and_speaker_are_not_command_targets(self):
        async def go():
            await self.configured({**BASE, "alarms": []})
            guest = self.user(deny=[LAMP, SPEAKER])
            await send(guest, type="atom_home/alarms/set", alarms=[{**OLD, "light": False, "alice": "off"}], expected_revision=7)
            self.assertEqual(guest.errors, [])
            self.assertTrue(guest.results[-1]["saved"])
        run(go())

    def test_author_is_rechecked_after_save_and_survives_restart(self):
        async def go():
            w = await self.configured({**BASE, "alarms": []})
            guest = self.user()
            alarm = {**OLD, "enabled": True}
            await send(guest, type="atom_home/alarms/set", alarms=[alarm], expected_revision=7)
            saved = copy.deepcopy(w.stored["atom_home.config"])
            await ah.async_unload_entry(w, self.entry)
            w.stored["atom_home.config"] = saved
            await ah.async_setup_entry(w, self.entry)
            guest.deny.add(LAMP)
            await w.advance(hours=1)
            self.assertEqual(w.named("light.turn_on"), [], "revoked author permission applies after a restart")
            self.assertEqual(w.named("media_player.play_media"), [])
            await ah.async_unload_entry(w, self.entry)
        run(go())

    def test_deleted_or_disabled_author_cannot_ring(self):
        async def check(deleted):
            w = await self.configured({**BASE, "alarms": []})
            guest = self.user()
            await send(guest, type="atom_home/alarms/set", alarms=[{**OLD, "enabled": True}], expected_revision=7)
            if deleted:
                self.users.clear()
            else:
                guest.user.is_active = False
            await w.advance(hours=1)
            self.assertEqual(w.named("light.turn_on"), [])
            self.assertEqual(w.named("media_player.play_media"), [])
            await ah.async_unload_entry(w, self.entry)
        for deleted in (True, False):
            run(check(deleted))

    def test_theme_save_does_not_transfer_guest_authority_to_admin(self):
        async def go():
            w = await self.configured({**BASE, "alarms": []})
            guest, admin = self.user(), self.user("owner", admin=True)
            await send(guest, type="atom_home/alarms/set", alarms=[{**OLD, "enabled": True}], expected_revision=7)
            config = copy.deepcopy(w.stored["atom_home.config"]["config"])
            config["home"] = {"theme": "dark"}
            await send(admin, type="atom_home/config/set", config=config, expected_revision=8)
            guest.deny.add(LAMP)
            await w.advance(hours=1)
            self.assertEqual(w.named("light.turn_on"), [], "unrelated owner edits do not silently reauthorize guest alarms")
            await ah.async_unload_entry(w, self.entry)
        run(go())

    def test_a_failed_save_keeps_the_previous_author(self):
        async def go():
            w = await self.configured({**BASE, "alarms": []})
            guest, admin = self.user(), self.user("owner", admin=True)
            await send(guest, type="atom_home/alarms/set", alarms=[{**OLD, "enabled": True}], expected_revision=7)
            bucket = ah._entry_data(w)
            async def fail(_data):
                raise OSError("disk full")
            bucket["state"]._save = fail
            await send(admin, type="atom_home/alarms/set", alarms=[{**OLD, "enabled": True, "label": "Owner"}], expected_revision=8)
            self.assertEqual(admin.errors[-1][0], "save_failed")
            guest.deny.add(LAMP)
            await w.advance(hours=1)
            self.assertEqual(w.named("light.turn_on"), [])
            await ah.async_unload_entry(w, self.entry)
        run(go())

    def test_active_alarm_keeps_its_author_after_removal_or_owner_replacement(self):
        async def check(replaced, snooze):
            w = await self.configured({**BASE, "alarms": []})
            guest, admin = self.user(), self.user("owner", admin=True)
            alarm = {**OLD, "enabled": True, "days": [2], "repeats": 1, "repeatEveryMin": 5}
            await send(guest, type="atom_home/alarms/set", alarms=[alarm], expected_revision=7)
            await w.advance(hours=1)
            self.assertEqual(len(w.named("media_player.play_media")), 1)
            guest.deny.add(LAMP)
            await send(admin if replaced else guest, type="atom_home/alarms/set",
                       alarms=[{**alarm, "time": "09:00"}] if replaced else [], expected_revision=8)
            if snooze:
                await send(guest, type="atom_home/alarm/snooze", minutes=5)
            await w.advance(minutes=5)
            self.assertEqual(len(w.named("media_player.play_media")), 1,
                             "an active alarm's old author is retained even if the stored row is removed or replaced")
            self.assertEqual(len(w.named("light.turn_on")), 1)
            await ah.async_unload_entry(w, self.entry)
        for replaced in (False, True):
            for snooze in (False, True):
                run(check(replaced, snooze))

    def test_malformed_or_unknown_author_metadata_fails_closed(self):
        async def check(auth):
            w = await self.configured({**BASE, "alarms": [{**OLD, "enabled": True}]})
            await ah.async_unload_entry(w, self.entry)
            w.stored["atom_home.config"]["alarm_auth"] = auth
            await ah.async_setup_entry(w, self.entry)
            await w.advance(hours=1)
            self.assertEqual(w.named("light.turn_on"), [], "unknown/malformed persisted authority must not become trusted legacy")
            await ah.async_unload_entry(w, self.entry)
        for auth in (None, [], {"version": 2, "authors": {}}, {"version": 1, "authors": {"private": None}}):
            run(check(auth))

    def test_legacy_alarm_and_explicit_admin_edit_remain_integration_owned(self):
        async def go():
            w = await self.configured({**BASE, "alarms": [{**OLD, "enabled": True, "days": [2]}]})
            await w.advance(hours=1)
            self.assertEqual(len(w.named("light.turn_on")), 1, "preexisting schedules retain their trusted authority")
            await send(self.user("owner", admin=True), type="atom_home/alarms/set",
                       alarms=[{**OLD, "enabled": True, "time": "08:00", "days": [2]}], expected_revision=7)
            self.assertNotIn("alarm_auth", w.stored["atom_home.config"], "unattributed/admin-only storage keeps its original shape")
            await w.advance(hours=1)
            self.assertEqual(len(w.named("light.turn_on")), 2)
            await ah.async_unload_entry(w, self.entry)
        run(go())


if __name__ == "__main__":
    result = unittest.main(exit=False).result
    print(f"{'OK' if result.wasSuccessful() else 'FAILED'} {result.testsRun} tests (saved alarm permissions)", flush=True)
    raise SystemExit(0 if result.wasSuccessful() else 1)
