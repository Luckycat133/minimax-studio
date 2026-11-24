"""Build a ZIP from a MiniMax Studio project and its approved local assets."""

import argparse
import csv
from decimal import Decimal
from graphlib import CycleError, TopologicalSorter
import hashlib
import io
import json
import os
from pathlib import Path, PurePosixPath
import re
import stat
import struct
import sys
import tempfile
import unicodedata
from zipfile import ZIP_DEFLATED, ZipFile


EXTENSIONS = {
    "script": {".md", ".txt", ".json", ".csv"},
    "storyboard": {".md", ".txt", ".json", ".csv"},
    "analysis": {".md", ".txt", ".json"},
    "research": {".md", ".txt", ".json", ".csv"},
    "transcript": {".md", ".txt", ".json", ".csv", ".srt", ".vtt"},
    "image": {".png", ".jpg", ".jpeg", ".webp"},
    "video": {".mp4"},
    "speech": {".wav", ".mp3"},
    "music": {".wav", ".mp3"},
    "captions": {".srt"},
}
PUBLIC_FIELDS = ("id", "kind", "status", "path", "revision", "language", "provider_model", "depends_on")
ID = re.compile(r"[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}\Z")
AMOUNT = re.compile(r"[0-9]+(?:\.[0-9]{1,4})?\Z")
SRT_TIME = r"(\d{2,}):([0-5]\d):([0-5]\d),(\d{3})"
SRT_TIMING = re.compile(rf"{SRT_TIME}[ \t]+-->[ \t]+{SRT_TIME}(?:[ \t]+[^\r\n]+)?", re.ASCII)
SRT_INDEX = re.compile(r"[0-9]+")
VTT_TIME = r"(?:(\d{2,}):)?([0-5]\d):([0-5]\d)\.(\d{3})"
VTT_TIMING = re.compile(f"{VTT_TIME}[ \t]+-->[ \t]+{VTT_TIME}(?:[ \t]+.*)?")
RESERVED = {"CON", "PRN", "AUX", "NUL", *(f"COM{n}" for n in range(1, 10)), *(f"LPT{n}" for n in range(1, 10))}


def checked_path(root, name):
    if not isinstance(name, str) or not name or re.search(r'[\\:<>"|?*\x00-\x1f\x7f]', name):
        raise ValueError("expected a portable relative file path")
    parts = name.split("/")
    if any(not part or part in {".", ".."} or part.endswith((".", " ")) or part.split(".")[0].upper() in RESERVED for part in parts):
        raise ValueError("expected a portable relative file path")
    path = root
    for part in parts:
        path = path / part
        if path.is_symlink():
            raise ValueError(f"symbolic links are unsupported ({name})")
    if not path.is_file():
        raise ValueError(f"missing regular file ({name})")
    return path


def archive_key(name):
    return unicodedata.normalize("NFC", name).casefold()


def archive_parents(name):
    return {str(parent) for parent in PurePosixPath(name).parents if parent.parts}


def unique_manifest_object(pairs):
    result = {}
    for key, value in pairs:
        if key in result:
            raise ValueError(f"duplicate manifest field: {key!r}")
        result[key] = value
    return result


def item_dependencies(item):
    dependencies = item.get("depends_on", [])
    if not isinstance(dependencies, list) or any(not isinstance(dep, str) or not ID.fullmatch(dep) for dep in dependencies):
        raise ValueError("depends_on must contain valid item IDs")
    if len(set(dependencies)) != len(dependencies):
        raise ValueError("depends_on contains duplicate item IDs")
    return dependencies


def select_items(items, item_ids):
    if item_ids is None:
        return items
    if not isinstance(item_ids, (list, tuple)) or not item_ids:
        raise ValueError("item_ids must list at least one valid item ID")
    selected = set()
    for item_id in item_ids:
        if not isinstance(item_id, str) or not ID.fullmatch(item_id):
            raise ValueError(f"invalid selected item ID: {item_id!r}")
        if item_id in selected:
            raise ValueError(f"duplicate selected item ID: {item_id!r}")
        if item_id not in items:
            raise ValueError(f"selected item ID not found: {item_id!r}")
        selected.add(item_id)

    pending = list(reversed(item_ids))
    while pending:
        item_id = pending.pop()
        try:
            dependencies = item_dependencies(items[item_id])
        except ValueError as error:
            raise ValueError(f"{item_id}: {error}") from error
        for dependency in dependencies:
            if dependency not in items:
                raise ValueError(f"{item_id}: missing approved dependency {dependency}")
            if dependency not in selected:
                selected.add(dependency)
                pending.append(dependency)
    return {item_id: item for item_id, item in items.items() if item_id in selected}


def load_project(root, manifest_path, item_ids=None):
    with checked_path(root, manifest_path).open(encoding="utf-8") as source:
        project = json.load(source, object_pairs_hook=unique_manifest_object)
    if not isinstance(project, dict) or type(project.get("version")) is not int or project["version"] != 1:
        raise ValueError("manifest version must be 1")
    if not isinstance(project.get("title"), str) or not project["title"].strip():
        raise ValueError("manifest title must be non-empty text")
    if not isinstance(project.get("items"), list) or not project["items"]:
        raise ValueError("manifest must contain at least one delivery item")
    items = {}
    for item in project["items"]:
        item_id = item.get("id") if isinstance(item, dict) else None
        if not isinstance(item_id, str) or not ID.fullmatch(item_id):
            raise ValueError("each manifest item must have a valid ID")
        if item_id in items:
            raise ValueError(f"duplicate manifest item ID: {item_id!r}")
        items[item_id] = item

    records = {}
    selection_key = archive_key(manifest_path)
    paths = {"manifest.json", selection_key}
    folders = archive_parents(selection_key)
    for item_id, item in select_items(items, item_ids).items():
        try:
            archived, source_path = check_item(root, item)
            name = archive_key(archived["path"])
            parents = archive_parents(name)
            if name in paths or name in folders or paths & parents:
                raise ValueError("asset path collides with metadata or another item")
        except ValueError as error:
            raise ValueError(f"{item_id}: {error}") from error
        paths.add(name)
        folders.update(parents)
        records[item_id] = (archived, source_path)

    dependency_graph = {item_id: item.get("depends_on", []) for item_id, (item, _) in records.items()}
    for item_id, prerequisites in dependency_graph.items():
        for dependency in prerequisites:
            if dependency not in records:
                raise ValueError(f"{item_id}: missing approved dependency {dependency}")
    try:
        TopologicalSorter(dependency_graph).prepare()
    except CycleError as error:
        raise ValueError("manifest dependencies form a cycle") from error
    return project["title"], records


def check_item(root, item):
    kind = item.get("kind")
    if not isinstance(kind, str) or kind not in EXTENSIONS:
        raise ValueError("unknown asset kind")
    if item.get("status") != "approved":
        raise ValueError("item is awaiting approval")
    path = checked_path(root, item.get("path"))
    if path.suffix.lower() not in EXTENSIONS[kind]:
        raise ValueError(f"unsupported file extension for {kind}")
    revision = item.get("revision", 1)
    if type(revision) is not int or revision < 1:
        raise ValueError("revision must be a positive integer")
    for field in ("language", "provider_model"):
        if field in item and (not isinstance(item[field], str) or not item[field].strip()):
            raise ValueError(f"{field} must be non-empty text")
    item_dependencies(item)
    archived = {field: item[field] for field in PUBLIC_FIELDS if field in item}
    archived["revision"] = revision
    if "actual_usd" in item:
        amount = item["actual_usd"]
        if not isinstance(amount, str) or not AMOUNT.fullmatch(amount):
            raise ValueError("actual_usd must be a nonnegative decimal string with up to four decimal places")
        archived["actual_usd"] = amount
    return archived, path


def validate_wav(source, size):
    header = source.read(12)
    if len(header) != 12 or header[:4] != b"RIFF" or header[8:] != b"WAVE" or int.from_bytes(header[4:8], "little") + 8 != size:
        return False
    block_align = None
    data_size = None
    while source.tell() + 8 <= size:
        kind, length = struct.unpack("<4sI", source.read(8))
        end = source.tell() + length + length % 2
        if end > size:
            return False
        if kind == b"fmt ":
            if length < 16 or block_align is not None:
                return False
            codec, channels, sample_rate, byte_rate, block_align, bits = struct.unpack("<HHIIHH", source.read(16))
            if codec == 0xFFFE and length >= 40:
                extra = source.read(24)
                if extra[10:] != bytes.fromhex("000000001000800000aa00389b71"):
                    return False
                codec = int.from_bytes(extra[8:10], "little")
            valid_codec = (codec == 1 and bits in (8, 16, 24, 32)) or (codec == 3 and bits in (32, 64))
            if not valid_codec or channels < 1 or sample_rate < 1 or block_align != channels * bits // 8 or byte_rate != sample_rate * block_align:
                return False
        elif kind == b"data":
            if data_size is not None:
                return False
            data_size = length
        source.seek(end)
    return source.tell() == size and bool(block_align and data_size and data_size % block_align == 0)


def validate_mp3(source, size):
    header = source.read(10)
    offset = 0
    if header[:3] == b"ID3":
        if len(header) < 10 or header[3] not in (2, 3, 4) or any(byte >= 128 for byte in header[6:10]):
            return False
        tag_size = sum(byte << shift for byte, shift in zip(header[6:10], (21, 14, 7, 0)))
        offset = 10 + tag_size + (10 if header[3] == 4 and header[5] & 16 else 0)
    source.seek(offset)
    frame = source.read(4)
    if len(frame) != 4 or frame[0] != 255 or frame[1] & 224 != 224:
        return False
    version = (frame[1] >> 3) & 3
    layer = (frame[1] >> 1) & 3
    index = frame[2] >> 4
    frequency = (frame[2] >> 2) & 3
    if version == 1 or layer != 1 or not 0 < index < 15 or frequency == 3:
        return False
    if version == 3:
        bitrates = (0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320)
        frame_size = 144000 * bitrates[index] // (44100, 48000, 32000)[frequency]
    else:
        bitrates = (0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160)
        rate = (22050, 24000, 16000)[frequency] // (2 if version == 0 else 1)
        frame_size = 72000 * bitrates[index] // rate
    return offset + frame_size + ((frame[2] >> 1) & 1) <= size


def validate_mp4(source, size):
    boxes = set()
    while source.tell() + 8 <= size:
        start = source.tell()
        length, kind = struct.unpack(">I4s", source.read(8))
        if length == 1:
            extended = source.read(8)
            if len(extended) != 8:
                return False
            length = int.from_bytes(extended, "big")
        elif length == 0:
            length = size - start
        payload_size = start + length - source.tell()
        if payload_size < 0 or start + length > size:
            return False
        if (kind == b"ftyp" and payload_size >= 8) or (kind in (b"moov", b"mdat") and payload_size > 0):
            boxes.add(kind)
        source.seek(start + length)
    return source.tell() == size and {b"ftyp", b"moov", b"mdat"} <= boxes


def validate_png(source, size):
    header = source.read(24)
    if len(header) != 24 or header[:16] != b"\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR":
        return False
    if not all(struct.unpack(">II", header[16:24])):
        return False
    source.seek(33)
    image_data = False
    while source.tell() + 12 <= size:
        length, kind = struct.unpack(">I4s", source.read(8))
        end = source.tell() + length + 4
        if end > size:
            return False
        if kind == b"IDAT" and length > 0:
            image_data = True
        if kind == b"IEND":
            return image_data and length == 0 and end == size
        source.seek(end)
    return False


def validate_image(source, size, extension):
    if extension == ".png":
        return validate_png(source, size)
    if extension == ".webp":
        header = source.read(20)
        return (len(header) == 20 and header[:4] == b"RIFF" and header[8:12] == b"WEBP"
                and header[12:16] in (b"VP8 ", b"VP8L", b"VP8X")
                and int.from_bytes(header[4:8], "little") + 8 == size
                and 0 < int.from_bytes(header[16:20], "little") <= size - 20)
    header = source.read(3)
    if size < 5 or header != b"\xff\xd8\xff":
        return False
    source.seek(-2, os.SEEK_END)
    return source.read(2) == b"\xff\xd9"


def validate_text(source, extension):
    content = source.read().decode("utf-8-sig")
    if not content.strip() or "\0" in content:
        return False
    if extension == ".json":
        json.loads(content)
    if extension == ".csv":
        has_values = False
        for row in csv.reader(io.StringIO(content), strict=True):
            has_values = has_values or any(cell.strip() for cell in row)
        return has_values
    if extension == ".srt":
        normalized = content.replace("\r\n", "\n").replace("\r", "\n")
        for block in re.split(r"\n[ \t]*\n", normalized.strip()):
            lines = block.splitlines()
            if len(lines) < 3 or not SRT_INDEX.fullmatch(lines[0].strip()) or not any(line.strip() for line in lines[2:]):
                return False
            timing = SRT_TIMING.fullmatch(lines[1].strip())
            if not timing:
                return False
            parts = tuple(int(part) for part in timing.groups())
            if parts[:4] >= parts[4:]:
                return False
    if extension == ".vtt":
        header, *blocks = re.split(r"\n[ \t]*\n", content.replace("\r\n", "\n").replace("\r", "\n").strip())
        if not re.fullmatch(r"WEBVTT(?:[ \t]+[^\n]*)?", header.splitlines()[0]):
            return False
        found_cue = False
        for block in blocks:
            lines = block.strip().splitlines()
            if not lines or lines[0].split(maxsplit=1)[0] in {"NOTE", "STYLE", "REGION"}:
                continue
            if "-->" not in lines[0]:
                lines = lines[1:]
            timing = VTT_TIMING.fullmatch(lines[0]) if len(lines) > 1 else None
            if timing is None or not any(line.strip() for line in lines[1:]):
                return False
            parts = tuple(int(part or 0) for part in timing.groups())
            if parts[:4] >= parts[4:]:
                return False
            found_cue = True
        return found_cue
    return True


def validate_asset(source, size, extension):
    if size <= 0:
        return False
    if extension in EXTENSIONS["image"]:
        return validate_image(source, size, extension)
    validator = {".wav": validate_wav, ".mp3": validate_mp3, ".mp4": validate_mp4}.get(extension)
    return validator(source, size) if validator else validate_text(source, extension)


def write_asset(archive, item, path):
    digest = hashlib.sha256()
    with path.open("rb") as source:
        before = os.fstat(source.fileno())
        try:
            valid = stat.S_ISREG(before.st_mode) and validate_asset(source, before.st_size, path.suffix.lower())
        except (UnicodeError, ValueError, csv.Error, struct.error):
            valid = False
        if not valid:
            raise ValueError(f"{item['id']}: file contents do not match {path.suffix.lower()}")
        source.seek(0)
        count = 0
        with archive.open(item["path"], "w", force_zip64=True) as target:
            for block in iter(lambda: source.read(1024 * 1024), b""):
                target.write(block)
                digest.update(block)
                count += len(block)
        after = os.fstat(source.fileno())
        if count != before.st_size or after.st_mtime_ns != before.st_mtime_ns:
            raise ValueError(f"{item['id']}: asset changed while creating the archive")
    item.update(sha256=digest.hexdigest(), bytes=count)


def package_project(root, output, manifest_path="manifest.json", *, item_ids=None):
    root = root.resolve(strict=True)
    if not root.is_dir():
        raise ValueError("project root must be a directory")
    if output.suffix.lower() != ".zip":
        raise ValueError("output must have a .zip extension")
    if output.exists() or output.is_symlink():
        raise ValueError("output already exists")
    title, records = load_project(root, manifest_path, item_ids)
    manifest = {"version": 1, "title": title, "items": [item for item, _ in records.values()]}
    amounts = [Decimal(item["actual_usd"]) for item in manifest["items"] if "actual_usd" in item]
    if amounts:
        manifest["recorded_actual_usd"] = format(sum(amounts), ".4f")

    with tempfile.TemporaryDirectory(prefix=".studio-package-", dir=output.parent) as temp:
        staging = Path(temp) / "deliverable.zip"
        with ZipFile(staging, "w", compression=ZIP_DEFLATED) as archive:
            for item, path in records.values():
                write_asset(archive, item, path)
            archive.writestr("manifest.json", json.dumps(manifest, ensure_ascii=False, indent=2) + "\n")
        os.link(staging, output)
    return manifest


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("root", type=Path)
    parser.add_argument("output", type=Path)
    parser.add_argument("--manifest", default="manifest.json", help="source manifest path relative to the project root")
    parser.add_argument("--items", nargs="+", metavar="ID", help="export these IDs and their dependencies from the source manifest")
    args = parser.parse_args()
    try:
        manifest = package_project(args.root, args.output, args.manifest, item_ids=args.items)
    except (OSError, ValueError, UnicodeError) as error:
        parser.exit(1, f"Packaging failed: {error}\n")
    print(f"Packaged {len(manifest['items'])} approved items to {args.output}")


if __name__ == "__main__":
    main()
