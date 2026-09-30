"""Dependency-free tests: no real databases, credentials, or API calls."""

from functools import partial
from html.parser import HTMLParser
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
import subprocess
import tempfile
import threading
import unittest
from urllib.error import HTTPError
from urllib.parse import urlsplit
from urllib.request import Request, urlopen

from scripts.build_pages import PUBLIC_FILES, build_pages


ROOT = Path(__file__).resolve().parent.parent


class AssetReferences(HTMLParser):
    def __init__(self):
        super().__init__()
        self.paths = set()

    def handle_starttag(self, tag, attrs):
        attribute = {"link": "href", "script": "src", "img": "src"}.get(tag)
        value = dict(attrs).get(attribute, "")
        url = urlsplit(value)
        if value and not url.scheme and not url.netloc and url.path:
            self.paths.add(url.path)


class QuietHandler(SimpleHTTPRequestHandler):
    def log_message(self, *args):
        pass


class PagesBuildTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.source = Path(self.temporary.name) / "source"
        self.output = Path(self.temporary.name) / "_site"
        for relative in PUBLIC_FILES:
            path = self.source / relative
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text(f"test fixture: {relative}\n")

    def test_only_explicit_public_files_are_copied(self):
        private_files = (
            "server/data/minimax.db", "server/.env", ".env", ".git/config",
            "node_modules/private.js", "test-screenshots/private.png",
            "js/unreviewed.js", "css/private.css", "css/backup.db",
        )
        for relative in private_files:
            path = self.source / relative
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text("synthetic non-public fixture")
        build_pages(self.source, self.output)
        files = {p.relative_to(self.output).as_posix()
                 for p in self.output.rglob("*") if p.is_file()}
        self.assertEqual(files, set(PUBLIC_FILES))
        for relative in PUBLIC_FILES:
            self.assertEqual((self.output / relative).read_bytes(),
                             (self.source / relative).read_bytes())

    def test_missing_asset_fails_before_creating_output(self):
        (self.source / "js/app.js").unlink()
        with self.assertRaises(FileNotFoundError):
            build_pages(self.source, self.output)
        self.assertFalse(self.output.exists())

    def test_symlinked_asset_is_rejected(self):
        asset = self.source / "js/app.js"
        asset.unlink()
        asset.symlink_to(self.source / "index.html")
        with self.assertRaises(ValueError):
            build_pages(self.source, self.output)
        self.assertFalse(self.output.exists())

    def test_symlinked_asset_directory_is_rejected(self):
        (self.source / "js").rename(self.source / "private-js")
        (self.source / "js").symlink_to(self.source / "private-js")
        with self.assertRaises(ValueError):
            build_pages(self.source, self.output)

    def test_existing_output_cannot_leak_stale_files(self):
        self.output.mkdir()
        (self.output / "stale.db").write_text("synthetic stale fixture")
        with self.assertRaises(FileExistsError):
            build_pages(self.source, self.output)

    def test_output_symlink_is_rejected(self):
        self.output.symlink_to(self.source)
        with self.assertRaises(FileExistsError):
            build_pages(self.source, self.output)

    def test_frontend_references_are_in_allowlist(self):
        parser = AssetReferences()
        parser.feed((ROOT / "index.html").read_text())
        self.assertEqual(parser.paths, set(PUBLIC_FILES) - {"index.html"})

    def test_runtime_databases_are_not_tracked(self):
        # Inspect names only. Never open existing runtime data.
        tracked = subprocess.check_output(
            ["git", "ls-files", "-z"], cwd=ROOT, text=True
        ).split("\0")
        self.assertFalse([name for name in tracked
                          if name.startswith("server/data/")])

    def test_public_server_serves_assets_but_not_private_paths(self):
        build_pages(ROOT, self.output)
        handler = partial(QuietHandler, directory=str(self.output))
        server = ThreadingHTTPServer(("127.0.0.1", 0), handler)
        worker = threading.Thread(target=server.serve_forever, daemon=True)
        worker.start()
        try:
            base = f"http://127.0.0.1:{server.server_port}"
            for relative in PUBLIC_FILES:
                with urlopen(Request(f"{base}/{relative}", method="HEAD")) as response:
                    self.assertEqual(response.status, 200)
            for relative in ("server/data/minimax.db", "server/package.json",
                             "node_modules/", ".env", ".git/config"):
                with self.assertRaises(HTTPError) as error:
                    urlopen(Request(f"{base}/{relative}", method="HEAD"))
                self.assertEqual(error.exception.code, 404)
        finally:
            server.shutdown()
            server.server_close()
            worker.join()


if __name__ == "__main__":
    unittest.main()
