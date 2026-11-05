"""Xiaomi's event rows to the panel's journal; pure, runs without Home Assistant: python3 tests/components/atom_home/test_feeder_parse.py"""
import importlib.util
import json
import pathlib
import unittest

spec = importlib.util.spec_from_file_location("feeder", pathlib.Path(__file__).parents[3] / "custom_components/atom_home/feeder.py")
feeder = importlib.util.module_from_spec(spec)
spec.loader.exec_module(feeder)


def row(*pairs, time=0):
    return {"time": time, "value": json.dumps([{"piid": a, "value": b} for a, b in pairs])}


class ParseEvents(unittest.TestCase):
    def test_meals_only_no_running_totals(self):
        ate = [row((18, 4), (25, 100), (28, 0), (27, 10800)), row((18, 8), (25, 100), (28, 1), (27, 10800))]
        events, tz = feeder.parse_events(ate, [])
        self.assertEqual(events, [{"at": 100, "kind": "ate", "grams": 4}])
        self.assertEqual(tz, 10800)

    def test_dispensed_by_plan_and_by_hand(self):
        events, _ = feeder.parse_events([], [row((16, 2), (8, 20), (17, 50)), row((16, 1), (8, 10), (17, 60))])
        self.assertEqual([(e["kind"], e["grams"]) for e in events], [("plan", 20), ("manual", 10)])

    def test_duplicates_merge_and_order(self):
        ate = [row((18, 4), (25, 200), (28, 0)), row((18, 4), (25, 200), (28, 0)), row((18, 5), (25, 100), (28, 0))]
        events, _ = feeder.parse_events(ate, None)
        self.assertEqual([e["at"] for e in events], [100, 200])

    def test_garbage_is_skipped(self):
        events, tz = feeder.parse_events([{"value": "not json"}, {"value": None}, row((18, "x"), (25, 1), (28, 0))], [{"value": "[1]"}])
        self.assertEqual((events, tz), ([], None))


class ParseDesiccant(unittest.TestCase):
    def test_value(self):
        self.assertEqual(feeder.parse_desiccant([{"piid": 1, "value": 93, "code": 0}, {"piid": 2, "value": 28, "code": 0}]), {"level": 93, "days": 28})

    def test_error_code_means_unknown(self):
        self.assertIsNone(feeder.parse_desiccant([{"piid": 1, "value": 0, "code": -4001}, {"piid": 2, "value": 0, "code": 0}]))
        self.assertIsNone(feeder.parse_desiccant(None))


if __name__ == "__main__":
    unittest.main()
