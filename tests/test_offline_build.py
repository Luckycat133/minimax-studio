from pathlib import Path
import tempfile
import unittest
from html.parser import HTMLParser
from hashlib import sha256
from base64 import b64encode
from scripts.build_offline import build_offline

class InlineContent(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=False)
        self.tag = None
        self.script = ''
        self.style = ''
        self.policy = ''
        self.remote_assets = []
    def handle_starttag(self, tag, attrs):
        data = dict(attrs)
        if tag in ('script', 'style'):
            self.tag = tag
        if tag == 'meta' and data.get('http-equiv') == 'Content-Security-Policy':
            self.policy = data['content']
        if tag == 'script' and data.get('src'):
            self.remote_assets.append(data['src'])
        if tag == 'link' and data.get('rel') == 'stylesheet':
            self.remote_assets.append(data['href'])
    def handle_endtag(self, tag):
        if self.tag == tag: self.tag = None
    def handle_data(self, data):
        if self.tag == 'script': self.script += data
        if self.tag == 'style': self.style += data

class OfflineBuildTests(unittest.TestCase):
    def test_bundle_is_self_contained_and_has_exact_csp_hashes(self):
        with tempfile.TemporaryDirectory() as directory:
            target = Path(directory) / 'offline.html'
            build_offline(target)
            html = target.read_text()
            parser = InlineContent()
            parser.feed(html)
            self.assertFalse(parser.remote_assets)
            for text in (parser.script, parser.style):
                self.assertTrue(text)
                digest = b64encode(sha256(text.encode()).digest()).decode()
                self.assertIn(f"'sha256-{digest}'", parser.policy)
            self.assertIn("connect-src 'none'", parser.policy)
            self.assertIn("media-src 'self' blob:", parser.policy)
            self.assertNotIn('href="index.html"', html)
            self.assertNotIn("from './dialogue-core.mjs'", parser.script)
            self.assertNotIn('\nexport ', parser.script)
            with self.assertRaises(FileExistsError): build_offline(target)

if __name__ == '__main__': unittest.main()
