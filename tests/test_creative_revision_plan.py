import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest


PLANNER = Path(__file__).resolve().parents[1] / ".agents/skills/minimax-studio-creative/scripts/plan_revision.py"


class CreativeRevisionPlanTest(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.manifest = Path(temporary.name) / "manifest.json"
        dependencies = {
            "edit-zh": ["shot-01", "zh-02", "captions-zh", "music"],
            "edit-en": ["shot-01", "en-02", "captions-en", "music"],
            "captions-zh": ["zh-02"],
            "captions-en": ["en-02"],
            "shot-01": ["keyframe-01"],
            "keyframe-01": [],
            "zh-02": [],
            "en-02": [],
            "music": [],
        }
        self.items = [
            {"id": identifier, "status": "approved", "depends_on": parents}
            for identifier, parents in dependencies.items()
        ]
        self.items.append({"id": "unused", "status": "planned"})

    def run_plan(self, *changed):
        data = json.dumps({"version": 1, "items": self.items})
        self.manifest.write_text(data, encoding="utf-8")
        result = subprocess.run(
            [sys.executable, str(PLANNER), str(self.manifest), *changed],
            capture_output=True, text=True,
        )
        self.assertEqual(self.manifest.read_text(encoding="utf-8"), data)
        return result

    def test_mandarin_revision_keeps_english_and_shared_assets(self):
        result = self.run_plan("zh-02")
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(json.loads(result.stdout), {
            "revise": ["zh-02"],
            "review_dependents": ["captions-zh", "edit-zh"],
            "reuse_approved": ["edit-en", "captions-en", "shot-01", "keyframe-01", "en-02", "music"],
        })

    def test_shared_keyframe_and_line_affect_both_edits_once(self):
        result = self.run_plan("keyframe-01", "zh-02")
        self.assertEqual(result.returncode, 0, result.stderr)
        plan = json.loads(result.stdout)
        review = plan["review_dependents"]
        self.assertCountEqual(review, ["shot-01", "captions-zh", "edit-zh", "edit-en"])
        self.assertLess(review.index("shot-01"), review.index("edit-en"))
        self.assertLess(review.index("captions-zh"), review.index("edit-zh"))
        self.assertCountEqual(plan["reuse_approved"], ["en-02", "captions-en", "music"])

    def test_unknown_change_and_cycle_fail_before_planning(self):
        result = self.run_plan("zh-99")
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("unknown revision item IDs: zh-99", result.stderr)
        self.items[0]["depends_on"].append("edit-zh")
        result = self.run_plan("zh-02")
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("manifest dependencies form a cycle", result.stderr)
        self.assertFalse(result.stdout)
