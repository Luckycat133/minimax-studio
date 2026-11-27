"""Offline transport fixtures for the cached, pinned MiniMax video CLI."""

import base64
import hashlib
import importlib.util
import io
import json
from pathlib import Path
import shutil
import subprocess
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import patch


RUNNER = Path(__file__).resolve().parents[1] / ".agents/skills/minimax-studio-creative/scripts/mmx_plan.py"
SPEC = importlib.util.spec_from_file_location("mmx_video_plan", RUNNER)
mmx = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(mmx)

API = "https://api.minimax.cn"
H3 = "MiniMax-H3"
HAILUO = "MiniMax-Hailuo-2.3"
KEY = "sk-cp-studio-video-fixture"
CDN = "https://video-fixture.invalid/finished.mp4"
PROMPT = "A paper kite drifts over a quiet field."
PNG_BASE64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jiv8AAAAASUVORK5CYII="
VIDEO_BYTES = "synthetic CDN fixture bytes"

TRANSPORT = r"""
const fs = require('node:fs');
const assert = require('node:assert/strict');
require('node:net').Socket.prototype.connect = () => {
  throw new Error('Network sockets are disabled in the Studio fixture');
};
const fixture = JSON.parse(fs.readFileSync(process.env.STUDIO_MMX_FIXTURE, 'utf8'));
let cursor = 0;
globalThis.fetch = async (url, options = {}) => {
  const headers = new Headers(options.headers);
  const authorization = headers.get('Authorization') || headers.get('x-api-key');
  const auth = authorization === null ? 'none' :
    authorization === `Bearer ${fixture.token}` ? 'plan' : 'unexpected';
  const call = {url: String(url), method: options.method || 'GET', auth};
  if (options.body) call.body = JSON.parse(options.body);
  fs.appendFileSync(fixture.trace, JSON.stringify(call) + '\n');
  const response = fixture.responses[cursor++];
  assert(response, `Unexpected request: ${call.method} ${call.url}`);
  assert.equal(call.url, response.url);
  assert.equal(call.method, response.method || 'GET');
  assert.equal(call.auth, response.auth || 'plan');
  if (response.network_error) throw new TypeError('fetch failed');
  if ('bytes' in response) {
    return new Response(response.bytes, {headers: {'Content-Length': Buffer.byteLength(response.bytes)}});
  }
  if ('events' in response) {
    const chunks = response.events.map(event => `data: ${JSON.stringify(event)}\n\n`).join('');
    return new Response(chunks, {headers: {'Content-Type': 'text/event-stream'}});
  }
  return new Response(JSON.stringify(response.json), {headers: {'Content-Type': 'application/json'}});
};
"""


class MiniMaxVideoContractTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        if shutil.which("node") is None:
            raise unittest.SkipTest("Node is unavailable")
        cls.node = mmx.executable("node")
        cache = Path.home() / ".npm" / "_npx"
        for candidate in cache.glob("*/node_modules/mmx-cli/dist/mmx.mjs"):
            if hashlib.sha256(candidate.read_bytes()).hexdigest() == mmx.ENTRY_SHA256:
                cls.entry = candidate
                break
        else:
            raise unittest.SkipTest(f"official {mmx.PACKAGE} is absent from the local npm exec cache")

    def setUp(self):
        folder = tempfile.TemporaryDirectory(prefix="studio-mmx-video-fixture-")
        self.addCleanup(folder.cleanup)
        self.root = Path(folder.name).resolve()
        self.transport = self.root / "transport.cjs"
        self.transport.write_text(TRANSPORT, encoding="utf-8")
        self.scenario = self.root / "scenario.json"
        self.trace = self.root / "trace.jsonl"

    def invoke(self, arguments, *responses, expected_status=0, raw_output=False):
        self.trace.write_text("", encoding="utf-8")
        self.scenario.write_text(json.dumps({"token": KEY, "trace": str(self.trace), "responses": responses}), encoding="utf-8")
        env = mmx.isolated_environment(self.root, self.node)
        env["STUDIO_MMX_FIXTURE"] = str(self.scenario)
        command, mode = mmx.check_command([*arguments, "--output", "json", "--timeout", "3"])
        stdout = io.TextIOWrapper(io.BytesIO(), encoding="utf-8")
        stderr = io.TextIOWrapper(io.BytesIO(), encoding="utf-8")

        def isolated(argv):
            return [argv[0], "--require", str(self.transport), *argv[1:]]

        fixture_subprocess = SimpleNamespace(
            PIPE=subprocess.PIPE, DEVNULL=subprocess.DEVNULL,
            run=lambda argv, **options: subprocess.run(isolated(argv), cwd=self.root, timeout=10, **options),
            Popen=lambda argv, **options: subprocess.Popen(isolated(argv), cwd=self.root, **options),
        )
        with patch.object(mmx, "subprocess", fixture_subprocess), \
             patch.object(mmx.sys, "stdout", stdout), patch.object(mmx.sys, "stderr", stderr):
            status = mmx.run_mmx(self.node, self.entry, command, "cn", mode, KEY, self.root, env)
        output = stdout.buffer.getvalue().decode("utf-8")
        errors = stderr.buffer.getvalue().decode("utf-8")
        self.assertEqual(status, expected_status, errors)
        self.assertNotIn(KEY, output + errors)
        calls = [json.loads(line) for line in self.trace.read_text(encoding="utf-8").splitlines()]
        self.assertEqual([(call["url"], call["method"], call["auth"]) for call in calls], [
            (response["url"], response.get("method", "GET"), response.get("auth", "plan"))
            for response in responses
        ])
        payload = output if raw_output else (json.loads(output) if output.strip() else None)
        return payload, calls, errors

    def test_streaming_speech_requests_incremental_audio_without_the_final_duplicate(self):
        output, calls, _ = self.invoke(
            ["speech", "synthesize", "--text", "Coffee", "--format", "mp3", "--stream"],
            {"url": f"{API}/v1/t2a_v2", "method": "POST", "events": [
                {"data": {"status": 1, "audio": "6669727374"}},
                {"data": {"status": 1, "audio": "7365636f6e64"}},
                {"data": {"status": 2}},
            ]},
            raw_output=True,
        )
        self.assertTrue(calls[0]["body"]["stream"])
        self.assertEqual(calls[0]["body"]["stream_options"], {"exclude_aggregated_audio": True})
        self.assertEqual(output, "firstsecond")

    def test_h3_async_uses_local_first_frame_then_resumes_the_original_task(self):
        frame = self.root / "frame.png"
        frame.write_bytes(base64.b64decode(PNG_BASE64))
        submission, calls, _ = self.invoke(
            ["video", "generate", "--model", H3, "--prompt", PROMPT, "--image", str(frame),
             "--duration", "5", "--resolution", "768P", "--async"],
            {"url": f"{API}/v2/video_generation", "method": "POST", "json": {"task_id": "h3-fixture"}},
        )
        self.assertEqual(submission, {"taskId": "h3-fixture"})
        self.assertEqual(calls[0]["body"], {
            "model": H3, "resolution": "768P", "duration": 5, "ratio": "adaptive",
            "content": [
                {"type": "text", "text": PROMPT},
                {"type": "image_url", "role": "first_frame", "image_url": {"url": f"data:image/png;base64,{PNG_BASE64}"}},
            ],
        })

        task_id = submission["taskId"]
        lookup = ["video", "task", "get", "--model", H3, "--task-id", task_id]
        url = f"{API}/v2/query/video_generation/{task_id}"
        for status, content in (("processing", {}), ("succeeded", {"url": CDN})):
            with self.subTest(status=status):
                task, _, _ = self.invoke(lookup, {"url": url, "json": {"task": {
                    "id": task_id, "model": H3, "status": status, "content": content,
                    "resolution": "768P", "duration": 5, "ratio": "adaptive",
                }}})
                self.assertEqual(task, {
                    "task_id": task_id, "model": H3, "status": status,
                    "resolution": "768P", "duration": 5, "ratio": "adaptive", **content,
                })

    def test_legacy_async_lookup_exposes_file_id_and_download_writes_the_cdn_bytes(self):
        submission, calls, _ = self.invoke(
            ["video", "generate", "--model", HAILUO, "--prompt", PROMPT, "--async"],
            {"url": f"{API}/v1/video_generation", "method": "POST", "json": {"task_id": "v1-fixture"}},
        )
        self.assertEqual(submission, {"taskId": "v1-fixture"})
        self.assertEqual(calls[0]["body"], {"model": HAILUO, "prompt": PROMPT})

        task_id = submission["taskId"]
        task, _, _ = self.invoke(
            ["video", "task", "get", "--model", HAILUO, "--task-id", task_id],
            {"url": f"{API}/v1/query/video_generation?task_id={task_id}", "json": {
                "task_id": task_id, "status": "Success", "file_id": "video-fixture", "video_width": 1280, "video_height": 720,
            }},
        )
        self.assertEqual(task, {
            "task_id": task_id, "status": "Success", "file_id": "video-fixture", "video_width": 1280, "video_height": 720,
        })

        file_id = task["file_id"]
        output = self.root / "finished.mp4"
        receipt, _, _ = self.invoke(
            ["video", "download", "--file-id", file_id, "--out", str(output)],
            {"url": f"{API}/v1/files/retrieve?file_id={file_id}", "json": {"file": {"download_url": CDN}}},
            {"url": CDN, "auth": "none", "bytes": VIDEO_BYTES},
        )
        self.assertEqual(receipt["saved"], str(output))
        self.assertEqual(output.read_bytes(), VIDEO_BYTES.encode())

    def test_ambiguous_post_failure_is_reported_without_repeating_the_request(self):
        output, _, errors = self.invoke(
            ["video", "generate", "--model", H3, "--prompt", PROMPT, "--async"],
            {"url": f"{API}/v2/video_generation", "method": "POST", "network_error": True},
            expected_status=6,
        )
        self.assertIsNone(output)
        self.assertIn("Network request failed", errors)

    def test_terminal_task_failure_is_json_state_even_when_query_exit_is_zero(self):
        task_id = "h3-failed-fixture"
        error = {"code": "provider_failure_fixture", "message": "Synthetic renderer failed."}
        task, _, _ = self.invoke(
            ["video", "task", "get", "--model", H3, "--task-id", task_id],
            {"url": f"{API}/v2/query/video_generation/{task_id}", "json": {"task": {
                "id": task_id, "model": H3, "status": "failed", "error": error,
            }}},
        )
        self.assertEqual(task, {"task_id": task_id, "model": H3, "status": "failed", "error": error})


if __name__ == "__main__":
    unittest.main()
