import json
from pathlib import Path
import runpy
import subprocess
import sys
import tempfile
import unittest
from zipfile import ZipFile


SCRIPT = Path(__file__).resolve().parents[1] / ".agents" / "skills" / "minimax-studio-creative" / "scripts" / "package_project.py"


class CreativeDeliverySelectionTest(unittest.TestCase):
    def setUp(self):
        directory = tempfile.TemporaryDirectory()
        self.addCleanup(directory.cleanup)
        self.root = Path(directory.name)
        self.output = self.root / "delivery.zip"
        self.items = [
            {"id": "zh-edit", "kind": "storyboard", "status": "approved", "path": "zh-edit.json", "depends_on": ["zh-captions"]},
            {"id": "old-edit", "kind": "storyboard", "status": "stale"},
            {"id": "script", "kind": "script", "status": "approved", "path": "script.md"},
            {"id": "en-captions", "kind": "captions", "status": "approved", "path": "en.srt", "depends_on": ["script"]},
            {"id": "en-edit", "kind": "storyboard", "status": "approved", "path": "en-edit.json", "depends_on": ["en-captions"]},
            {"id": "zh-captions", "kind": "captions", "status": "approved", "path": "zh.srt", "depends_on": ["script"]},
            {"id": "next-edit", "kind": "storyboard", "status": "planned"},
        ]
        (self.root / "script.md").write_text("Approved bilingual script", encoding="utf-8")
        for language, caption in (("zh", "你好"), ("en", "Hello")):
            (self.root / f"{language}-edit.json").write_text(json.dumps({"captions": f"{language}-captions"}), encoding="utf-8")
            (self.root / f"{language}.srt").write_text(f"1\n00:00:00,000 --> 00:00:01,000\n{caption}\n", encoding="utf-8")
        self.write_manifest()

    def write_manifest(self, name="manifest.json"):
        path = self.root / name
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps({"version": 1, "title": "Bilingual delivery", "items": self.items}), encoding="utf-8")

    def run_helper(self, *args):
        return subprocess.run([
            sys.executable, str(SCRIPT), str(self.root), str(self.output), *args,
        ], capture_output=True, text=True)

    def assert_failed(self, result, reason):
        self.assertNotEqual(result.returncode, 0)
        self.assertIn(reason, result.stderr)
        self.assertFalse(self.output.exists())

    def test_bilingual_roots_export_shared_transitive_dependencies_in_source_order(self):
        original = (self.root / "manifest.json").read_bytes()
        result = self.run_helper("--items", "en-edit", "zh-edit")
        self.assertEqual(result.returncode, 0, result.stderr)
        with ZipFile(self.output) as archive:
            self.assertIsNone(archive.testzip())
            self.assertEqual(archive.namelist(), ["zh-edit.json", "script.md", "en.srt", "en-edit.json", "zh.srt", "manifest.json"])
            manifest = json.loads(archive.read("manifest.json"))
            self.assertEqual([item["id"] for item in manifest["items"]], ["zh-edit", "script", "en-captions", "en-edit", "zh-captions"])
        self.assertEqual((self.root / "manifest.json").read_bytes(), original)

    def test_existing_full_export_behavior_and_alternate_source(self):
        self.assert_failed(self.run_helper(), "old-edit: item is awaiting approval")
        self.items = [item for item in self.items if item["status"] == "approved"]
        self.write_manifest("sources/approved.json")
        result = self.run_helper("--manifest", "sources/approved.json")
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("Packaged 5 approved items", result.stdout)
        self.output.unlink()

        package_project = runpy.run_path(str(SCRIPT))["package_project"]
        manifest = package_project(self.root, self.output, "sources/approved.json", item_ids=("en-edit",))
        self.assertEqual([item["id"] for item in manifest["items"]], ["script", "en-captions", "en-edit"])

    def test_rejects_duplicate_and_missing_roots_or_ambiguous_manifest(self):
        self.assert_failed(self.run_helper("--items", "en-edit", "en-edit"), "duplicate selected item ID")
        self.assert_failed(self.run_helper("--items", "unknown"), "selected item ID not found")
        self.items.append({"id": "old-edit", "kind": "storyboard", "status": "planned"})
        self.write_manifest()
        self.assert_failed(self.run_helper("--items", "en-edit"), "duplicate manifest item ID")
        (self.root / "manifest.json").write_text(
            '{"version":1,"title":"Bilingual delivery","items":[{"id":"script","id":"en-edit"}]}', encoding="utf-8",
        )
        self.assert_failed(self.run_helper("--items", "en-edit"), "duplicate manifest field")

    def test_requires_approved_valid_dependency_closure_without_partial_archive(self):
        script = self.items[2]
        script["depends_on"] = ["missing"]
        self.write_manifest()
        self.assert_failed(self.run_helper("--items", "en-edit"), "missing approved dependency missing")

        script["depends_on"] = ["en-edit"]
        self.write_manifest()
        self.assert_failed(self.run_helper("--items", "en-edit"), "manifest dependencies form a cycle")

        script.pop("depends_on")
        script["status"] = "stale"
        self.write_manifest()
        self.assert_failed(self.run_helper("--items", "en-edit"), "script: item is awaiting approval")

        script["status"] = "approved"
        self.write_manifest()
        (self.root / "script.md").write_bytes(b"\xff")
        self.assert_failed(self.run_helper("--items", "en-edit"), "script: file contents do not match .md")
