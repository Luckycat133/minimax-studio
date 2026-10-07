"""Build a self-contained, network-disabled offline HTML preview (no npm required)."""
from base64 import b64encode
from hashlib import sha256
from pathlib import Path
import re
import sys

ROOT = Path(__file__).resolve().parent.parent

def build_offline(destination: Path) -> None:
    if destination.exists():
        raise FileExistsError(f"Refusing to overwrite: {destination}")
    html = (ROOT / "dialogue.html").read_text()
    css = "\n".join((ROOT / path).read_text() for path in ("css/styles.css", "css/dialogue.css"))
    modules = ["dialogue-core.mjs", "production-core.mjs", "production-storage.mjs", "production-queue.mjs"]
    module_code=[]
    for module in modules:
        code=(ROOT / "js" / module).read_text()
        code=re.sub(r"^import .*?;\n", "", code, flags=re.MULTILINE)
        code=re.sub(r"^export ", "", code, flags=re.MULTILINE)
        # Each module owns private names. Expose only its exports to the next module.
        original=(ROOT / "js" / module).read_text()
        names=re.findall(r"^export (?:async )?(?:function|class|const) ([A-Za-z_][A-Za-z0-9_]*)", original, flags=re.MULTILINE)
        module_code.append("const {"+",".join(names)+"} = (() => {\n"+code+"\nreturn {"+",".join(names)+"};\n})();")
    core="\n".join(module_code)
    ui = (ROOT / "js/dialogue.mjs").read_text()
    ui = re.sub(r"^import .*?;\n", "", ui, flags=re.MULTILINE)
    script = core + "\n" + ui
    if "</script" in script.lower() or "</style" in css.lower():
        raise ValueError("Unsafe inline terminator")
    digest = lambda text: b64encode(sha256(text.encode()).digest()).decode()
    html = re.sub(r'  <link rel="stylesheet"[^>]+>\n', '', html)
    html = html.replace("connect-src 'self'", "connect-src 'none'")
    html = html.replace("script-src 'self'; style-src 'self'", f"script-src 'sha256-{digest(script)}'; style-src 'sha256-{digest(css)}'")
    html = html.replace('  <script type="module" src="js/dialogue.mjs"></script>', f'<style>{css}</style>\n<script type="module">{script}</script>')
    html = html.replace('href="dialogue.html"', 'href=""')
    html = re.sub(r'    <a class="legacy-link".*?</a>', '    <div class="legacy-link">独立离线预览<small>不包含原实验界面的 API 调用</small></div>', html)
    destination.parent.mkdir(parents=True, exist_ok=True)
    destination.write_text(html, encoding="utf-8")

if __name__ == "__main__":
    target = Path(sys.argv[1]) if len(sys.argv) > 1 else ROOT / "dist" / "MiniMax_Studio_Offline.html"
    build_offline(target)
    print(target)
