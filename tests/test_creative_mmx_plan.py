import importlib.util
import io
import os
from pathlib import Path
import subprocess
import tempfile
import unittest
from unittest.mock import MagicMock, patch


RUNNER = Path(__file__).resolve().parents[1] / ".agents/skills/minimax-studio-creative/scripts/mmx_plan.py"
SPEC = importlib.util.spec_from_file_location("mmx_plan", RUNNER)
mmx = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(mmx)


class MiniMaxPlanTests(unittest.TestCase):
    def test_route_and_auth_overrides_are_rejected(self):
        for option in ("--api-key=other", "--apiKey=other", "--base-url=https://example.org", "--region=global", "--verbose"):
            with self.subTest(option=option), self.assertRaises(mmx.PlanError):
                mmx.check_command(["video", "generate", option])
        for command in (["auth", "login"], ["config", "set"], ["file", "delete"]):
            with self.subTest(command=command), self.assertRaises(mmx.PlanError):
                mmx.check_command(command)

    def test_generic_api_key_is_never_used_for_subscription(self):
        with patch.dict(os.environ, {"MINIMAX_API_KEY": "sk-api-fake"}, clear=True):
            with self.assertRaises(mmx.PlanError):
                mmx.token(None)
        with patch.dict(os.environ, {"MINIMAX_TOKEN_PLAN_KEY": "sk-api-fake"}, clear=True):
            with self.assertRaises(mmx.PlanError):
                mmx.token(None)

    def test_explicit_keychain_selection_takes_precedence(self):
        result = subprocess.CompletedProcess([], 0, stdout=b"sk-cp-keychain-fixture\n")
        with patch.dict(os.environ, {"MINIMAX_TOKEN_PLAN_KEY": "sk-cp-other-fixture"}, clear=True), \
             patch.object(mmx.sys, "platform", "darwin"), patch.object(mmx.subprocess, "run", return_value=result):
            self.assertEqual(mmx.token("requested-service"), "sk-cp-keychain-fixture")

    def test_subprocess_receives_ephemeral_key_and_redacts_echoes(self):
        key = "sk-cp-transient-fixture"
        child = MagicMock()
        child.__enter__.return_value = child
        child.stdout = io.BytesIO(key.encode())
        child.stderr = io.BytesIO(key.encode())
        child.wait.return_value = 5
        with tempfile.TemporaryDirectory() as temp:
            folder = Path(temp)
            stdout = io.TextIOWrapper(io.BytesIO())
            stderr = io.TextIOWrapper(io.BytesIO())
            with patch.object(mmx.subprocess, "Popen", return_value=child) as spawn, \
                 patch.object(mmx.sys, "stdout", stdout), patch.object(mmx.sys, "stderr", stderr):
                status = mmx.run_mmx("node", Path("mmx.mjs"), ["text", "chat", "--messages-file", "-"], "cn", "request", key, folder, {})
            self.assertEqual(status, 5)
            self.assertNotIn(key, " ".join(spawn.call_args.args[0]))
            self.assertNotIn(key, (folder / "private-auth.cjs").read_text())
            self.assertEqual(spawn.call_args.kwargs["env"]["MINIMAX_API_KEY"], key)
            self.assertIsNone(spawn.call_args.kwargs["stdin"])
            self.assertEqual(stdout.buffer.getvalue(), b"[REDACTED]")
            self.assertEqual(stderr.buffer.getvalue(), b"[REDACTED]")

    def test_relay_redacts_a_split_secret_without_delaying_normal_output(self):
        source = MagicMock()
        sink = io.BytesIO()

        def read():
            yield b"progress: sk-cp-"
            self.assertEqual(sink.getvalue(), b"progress: ")
            yield b"fixture, done\n"
            yield b""

        source.read1.side_effect = read()
        mmx.relay_output(source, sink, b"sk-cp-fixture")
        self.assertEqual(sink.getvalue(), b"progress: [REDACTED], done\n")

    def test_existing_destination_or_speech_sidecar_stops_before_dispatch(self):
        with tempfile.TemporaryDirectory() as temp:
            folder = Path(temp)
            existing = folder / "existing.srt"
            existing.write_text("original")
            cases = [
                ["image", "generate", "--out-dir", temp],
                ["speech", "synthesize", "--out", str(folder / "existing.wav"), "--subtitles"],
                ["speech", "transcribe", f"--out={existing}"],
                ["video", "download", "--file-id", "fixture"],
                ["video", "generate", "--async", "--download", str(folder / "new.mp4")],
            ]
            for arguments in cases:
                with self.subTest(arguments=arguments), self.assertRaises(mmx.PlanError):
                    mmx.check_outputs(arguments)
            self.assertEqual(existing.read_text(), "original")

    def test_dry_run_mode_keeps_credentials_optional(self):
        self.assertEqual(mmx.check_command(["quota", "show", "--dry-run"])[1], "dry-run")
        self.assertEqual(mmx.check_command(["quota", "show", "--dry-run=false"])[1], "request")


if __name__ == "__main__":
    unittest.main()
