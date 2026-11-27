import json
import math
from pathlib import Path
import shutil
import struct
import subprocess
import sys
import tempfile
import unittest


RENDER = Path(__file__).resolve().parents[1] / ".agents/skills/minimax-studio-creative/scripts/render_preview.py"
FFMPEG = shutil.which("ffmpeg")
FFPROBE = shutil.which("ffprobe")


@unittest.skipUnless(FFMPEG and FFPROBE, "FFmpeg and ffprobe are required for media integration")
class CreativePreviewSubclipTest(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.root = Path(temporary.name)
        self.output = self.root / "preview.mp4"
        picture = (
            "color=red:s=64x64:r=10:d=1[r];color=green:s=64x64:r=10:d=1[g];"
            "color=blue:s=64x64:r=10:d=1[b];[r][g][b]concat=n=3:v=1:a=0"
        )
        audio = (
            "sine=220:sample_rate=48000:d=1[a];sine=440:sample_rate=48000:d=1[b];"
            "sine=660:sample_rate=48000:d=1[c];[a][b][c]concat=n=3:v=0:a=1"
        )
        self.ffmpeg(
            "-f", "lavfi", "-i", picture, "-itsoffset", "0.2", "-f", "lavfi", "-i", audio,
            "-shortest", "-c:v", "libx264", "-c:a", "aac", self.root / "source.mp4",
        )
        (self.root / "manifest.json").write_text(json.dumps({
            "version": 1, "title": "Synthetic timeline",
            "items": [{"id": "source", "kind": "video", "status": "approved", "path": "source.mp4"}],
        }), encoding="utf-8")

    def ffmpeg(self, *args):
        result = subprocess.run([FFMPEG, "-v", "error", *args], capture_output=True)
        self.assertEqual(result.returncode, 0, result.stderr.decode(errors="replace"))
        return result.stdout

    def render(self, shots):
        (self.root / "edit.json").write_text(json.dumps({
            "width": 64, "height": 64, "fps": 20, "shots": shots,
        }), encoding="utf-8")
        return subprocess.run([sys.executable, RENDER, self.root, self.output], capture_output=True, text=True)

    def test_reused_video_and_native_audio_select_the_same_window(self):
        result = self.render([
            {"id": "source", "seconds": 0.5, "native_audio_volume": 1},
            {"id": "source", "source_start_seconds": 1.4, "seconds": 0.9, "native_audio_volume": 1},
        ])
        self.assertEqual(result.returncode, 0, result.stderr)
        rgb = self.ffmpeg(
            "-i", self.output, "-map", "0:v:0", "-vf", "scale=1:1", "-pix_fmt", "rgb24", "-f", "rawvideo", "-",
        )
        colors = [max(range(3), key=pixel.__getitem__) for pixel in struct.iter_unpack("BBB", rgb)]
        self.assertEqual(colors, [0] * 10 + [1] * 12 + [2] * 6)

        raw_audio = self.ffmpeg("-i", self.output, "-map", "0:a:0", "-ac", "1", "-ar", "8000", "-f", "s16le", "-")
        samples = [value for (value,) in struct.iter_unpack("<h", raw_audio)]
        self.assertLess(max(map(abs, samples[800:1120])), 100)  # Original 0.2 s audio lead-in.
        for when, expected_tone in ((0.3, 220), (0.8, 440), (1.15, 440), (1.34, 660)):
            # The original audio lags picture by 0.2 s even after selecting a new in-point.
            with self.subTest(when=when):
                excerpt = samples[round(when * 8000):round((when + 0.04) * 8000)]
                tones = {
                    tone: math.hypot(*(
                        sum(sample * trig(math.tau * tone * index / 8000) for index, sample in enumerate(excerpt))
                        for trig in (math.sin, math.cos)
                    ))
                    for tone in (220, 440, 660)
                }
                self.assertGreater(tones.pop(expected_tone), 5 * max(tones.values()))

    def test_invalid_subclip_never_creates_an_output(self):
        cases = (
            (2.6, 0.45, "source window exceeds the video duration"),
            (3, 0.05, "source window exceeds the video duration"),
            (-0.1, 0.05, "source_start_seconds must be a finite nonnegative number"),
            (True, 0.05, "source_start_seconds must be a finite nonnegative number"),
        )
        for offset, duration, error in cases:
            with self.subTest(offset=offset, duration=duration):
                result = self.render([{"id": "source", "source_start_seconds": offset, "seconds": duration}])
                self.assertNotEqual(result.returncode, 0)
                self.assertIn(error, result.stderr)
                self.assertFalse(self.output.exists())


if __name__ == "__main__":
    unittest.main()
