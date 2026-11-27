import hashlib
import json
from pathlib import Path
import shutil
import struct
import subprocess
import sys
import tempfile
import unittest
from zipfile import ZipFile


SCRIPTS = Path(__file__).resolve().parents[1] / ".agents" / "skills" / "minimax-studio-creative" / "scripts"
FFMPEG = shutil.which("ffmpeg")
FFPROBE = shutil.which("ffprobe")


@unittest.skipUnless(FFMPEG and FFPROBE, "FFmpeg and ffprobe are required for media integration")
class CreativeMediaIntegrityTest(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.root = Path(temporary.name)
        subprocess.run([
            FFMPEG, "-v", "error", "-f", "lavfi", "-i", "color=c=black:s=64x64:r=30",
            "-t", "1", "-c:v", "libx264", str(self.root / "shot.mp4"),
        ], check=True, capture_output=True)
        self.items = [
            {"id": "shot", "kind": "video", "status": "approved", "path": "shot.mp4"},
            {"id": "captions", "kind": "captions", "status": "approved", "path": "captions.srt"},
        ]
        self.write_json("edit.json", {
            "width": 64, "height": 64, "fps": 30,
            "shots": [{"id": "shot", "seconds": 1}], "captions": "captions",
        })
        self.write_captions("1\n00:00:00,000 --> 00:00:00,900\n第一句\n")

    def write_json(self, name, content):
        (self.root / name).write_text(json.dumps(content), encoding="utf-8")

    def write_manifest(self):
        self.write_json("manifest.json", {"version": 1, "title": "Media test", "items": self.items})

    def write_captions(self, content):
        (self.root / "captions.srt").write_text(content, encoding="utf-8")

    def run_helper(self, script, output):
        return subprocess.run([
            sys.executable, str(SCRIPTS / script), str(self.root), str(self.root / output),
        ], capture_output=True, text=True)

    def test_package_and_preview_accept_srt_whitespace_and_position(self):
        self.write_manifest()
        captions = "1\n00:00:00,000  -->  00:00:00,900 X1:10 X2:20 Y1:30 Y2:40\n第一句\n"
        self.write_captions(captions)
        for script, output in (("package_project.py", "delivery.zip"), ("render_preview.py", "preview.mp4")):
            with self.subTest(script=script):
                result = self.run_helper(script, output)
                self.assertEqual(result.returncode, 0, result.stderr)
        with ZipFile(self.root / "delivery.zip") as archive:
            self.assertIsNone(archive.testzip())
            manifest = json.loads(archive.read("manifest.json"))
            for item in manifest["items"]:
                content = archive.read(item["path"])
                self.assertEqual(item["sha256"], hashlib.sha256(content).hexdigest())
                self.assertEqual(item["bytes"], len(content))
            self.assertEqual(archive.read("captions.srt"), captions.encode("utf-8"))
        extracted = subprocess.run([
            FFMPEG, "-v", "error", "-i", self.root / "preview.mp4", "-map", "0:s:0", "-f", "srt", "-",
        ], check=True, capture_output=True, text=True)
        self.assertIn("00:00:00,000 --> 00:00:00,900\n第一句", extracted.stdout)

    def test_preview_rejects_overlapping_or_unordered_cues_without_output(self):
        self.write_manifest()
        cues = {
            "overlap": ("00:00:00,000 --> 00:00:00,900", "00:00:00,600 --> 00:00:00,950"),
            "unordered": ("00:00:00,600 --> 00:00:00,900", "00:00:00,100 --> 00:00:00,500"),
        }
        for name, (first, second) in cues.items():
            with self.subTest(name=name):
                self.write_captions(f"1\n{first}\n第一句\n\n2\n{second}\nSecond line\n")
                result = self.run_helper("render_preview.py", f"{name}.mp4")
                self.assertNotEqual(result.returncode, 0)
                self.assertIn("must be in time order and must not overlap", result.stderr)
                self.assertFalse((self.root / f"{name}.mp4").exists())

    def test_preview_checks_transitive_dependencies_and_ignores_unrelated_pending_work(self):
        self.items[1]["depends_on"] = ["script"]
        self.items.extend([
            {"id": "script", "kind": "script", "status": "approved", "path": "script.md", "depends_on": ["notes"]},
            {"id": "notes", "kind": "research", "status": "stale", "path": "notes.md"},
            {"id": "unrelated", "kind": "speech", "status": "planned"},
        ])
        (self.root / "script.md").write_text("Reviewed script", encoding="utf-8")
        self.write_manifest()
        result = self.run_helper("render_preview.py", "preview.mp4")
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("'notes' must identify an approved item", result.stderr)
        self.assertFalse((self.root / "preview.mp4").exists())

        self.items[3]["status"] = "approved"
        self.write_manifest()
        result = self.run_helper("render_preview.py", "preview.mp4")
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("project file missing: notes.md", result.stderr)
        self.assertFalse((self.root / "preview.mp4").exists())

        (self.root / "notes.md").write_text("Reviewed notes", encoding="utf-8")
        result = self.run_helper("render_preview.py", "preview.mp4")
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertTrue((self.root / "preview.mp4").is_file())

    def test_preview_preserves_stereo_music_when_first_audio_is_mono_narration(self):
        audio = (
            ("speech", "line.wav", "sine=frequency=880:sample_rate=48000"),
            ("music", "bed.wav", "aevalsrc=0.5*sin(2*PI*440*t)|0:s=48000"),
        )
        for kind, name, signal in audio:
            subprocess.run([
                FFMPEG, "-v", "error", "-f", "lavfi", "-i", signal, "-t", "1",
                "-c:a", "pcm_s16le", str(self.root / name),
            ], check=True, capture_output=True)
            self.items.append({"id": kind, "kind": kind, "status": "approved", "path": name})
        self.write_manifest()
        self.write_json("edit.json", {
            "width": 64, "height": 64, "fps": 30,
            "shots": [{"id": "shot", "seconds": 1}],
            "narration": [{"id": "speech", "start_seconds": 0}], "music": "music",
        })
        result = self.run_helper("render_preview.py", "preview.mp4")
        self.assertEqual(result.returncode, 0, result.stderr)
        samples = subprocess.run([
            FFMPEG, "-v", "error", "-i", self.root / "preview.mp4", "-map", "0:a:0",
            "-c:a", "pcm_s16le", "-f", "s16le", "-",
        ], check=True, capture_output=True).stdout
        channels = list(struct.iter_unpack("<hh", samples))
        self.assertGreater(max(abs(left - right) for left, right in channels), 1000)
        self.assertGreater(sum(left**2 for left, _ in channels), 1.25 * sum(right**2 for _, right in channels))
