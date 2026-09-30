"""Build only the reviewed browser assets, never the repository checkout."""

from pathlib import Path
import shutil


# New public assets must be deliberately added here during code review.
PUBLIC_FILES = (
    "index.html",
    "css/styles.css",
    "css/themes.css",
    "js/polyfills.js",
    "js/models.js",
    "js/utils.js",
    "js/templates.js",
    "js/api.js",
    "js/backend-api.js",
    "js/app.js",
)


def build_pages(source: Path, destination: Path) -> None:
    """Copy an exact allowlist into a fresh output directory; fail closed."""
    if destination.exists() or destination.is_symlink():
        raise FileExistsError(f"Output must be a fresh directory: {destination}")

    # Validate everything before writing. Never follow links into private data.
    for relative in PUBLIC_FILES:
        asset = source
        for component in Path(relative).parts:
            asset /= component
            if asset.is_symlink():
                raise ValueError(f"Public asset must not use a symlink: {relative}")
        if not asset.is_file():
            raise FileNotFoundError(f"Required public asset is missing: {relative}")

    destination.mkdir(parents=True)
    for relative in PUBLIC_FILES:
        target = destination / relative
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(source / relative, target)
    (destination / ".nojekyll").touch()


if __name__ == "__main__":
    root = Path(__file__).resolve().parent.parent
    build_pages(root, root / "_site")
    print(f"Prepared {len(PUBLIC_FILES)} public assets and .nojekyll in _site")
