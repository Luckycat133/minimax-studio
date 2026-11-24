#!/usr/bin/env python3
"""Render an editable project's approved shots and audio as a local MP4 preview."""

import argparse
from dataclasses import dataclass
from graphlib import CycleError, TopologicalSorter
import json
import math
import os
from pathlib import Path
import re
import shutil
import subprocess
import tempfile


FORMATS = {
    "video": {".mp4": "mov"},
    "speech": {".wav": "wav", ".mp3": "mp3"},
    "music": {".wav": "wav", ".mp3": "mp3"},
    "captions": {".srt": "srt"},
}
AUDIO_SAMPLE_RATE = 48000


@dataclass(frozen=True)
class Media:
    path: Path
    demuxer: str

    def input_options(self):
        return ["-protocol_whitelist", "file", "-f", self.demuxer]


def project_file(root, relative):
    if not isinstance(relative, str) or any(char in relative for char in "\\:\0"):
        raise ValueError("expected a project-relative POSIX file path")
    path = root
    for part in relative.split("/"):
        if part in ("", ".", ".."):
            raise ValueError(f"invalid project-relative file path: {relative}")
        path = path / part
        if path.is_symlink():
            raise ValueError(f"symbolic link in project file path: {relative}")
    if not path.is_file():
        raise ValueError(f"project file missing: {relative}")
    return path


def load_object(path):
    value = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(value, dict):
        raise ValueError(f"{path.name} must contain a JSON object")
    return value


def load_items(root):
    manifest = load_object(project_file(root, "manifest.json"))
    if type(manifest.get("version")) is not int or manifest["version"] != 1:
        raise ValueError("expected manifest version 1")
    items = {}
    if not isinstance(manifest.get("items"), list):
        raise ValueError("manifest must contain an items array")
    for item in manifest["items"]:
        identifier = item.get("id") if isinstance(item, dict) else None
        if not isinstance(identifier, str) or not identifier or identifier in items:
            raise ValueError(f"manifest contains a missing or duplicate item ID: {identifier!r}")
        items[identifier] = item
    return items


def approved_media(root, items, identifier, kind):
    item = items.get(identifier) if isinstance(identifier, str) else None
    if item is None or item.get("kind") != kind or item.get("status") != "approved":
        raise ValueError(f"{identifier!r} must identify an approved {kind} item")
    path = project_file(root, item.get("path"))
    demuxer = FORMATS[kind].get(path.suffix.lower())
    if demuxer is None:
        raise ValueError(f"{identifier!r} requires one of {', '.join(FORMATS[kind])}")
    return Media(path, demuxer)


def validate_dependencies(root, items, identifiers):
    pending = list(identifiers)
    graph = {}
    while pending:
        identifier = pending.pop()
        if identifier in graph:
            continue
        item = items.get(identifier)
        if item is None or item.get("status") != "approved":
            raise ValueError(f"{identifier!r} must identify an approved item in the edit or its dependencies")
        project_file(root, item.get("path"))
        dependencies = item.get("depends_on", [])
        if not isinstance(dependencies, list) or any(not isinstance(dep, str) or not dep for dep in dependencies):
            raise ValueError(f"invalid dependencies for {identifier!r}")
        graph[identifier] = dependencies
        pending.extend(dependencies)
    try:
        TopologicalSorter(graph).prepare()
    except CycleError as error:
        raise ValueError("preview dependencies form a cycle") from error


def seconds(value, label):
    if type(value) not in (int, float) or not math.isfinite(value) or value < 0:
        raise ValueError(f"{label} must be a finite nonnegative number")
    return value


def run(command):
    result = subprocess.run(command, stdin=subprocess.DEVNULL, capture_output=True, text=True)
    if result.returncode:
        details = result.stderr.strip() or f"exit status {result.returncode}"
        raise ValueError(f"{Path(command[0]).name}: {details[-3000:]}")
    return result.stdout


def probe(ffprobe, media, selector):
    output = run([
        ffprobe, "-v", "error", *media.input_options(), "-select_streams", selector,
        "-show_entries", "stream=codec_type,start_time,duration,nb_frames", "-of", "json", str(media.path),
    ])
    streams = json.loads(output)["streams"]
    if not streams:
        raise ValueError(f"missing {selector} stream in {media.path.name}")
    return streams[0]


def stream_duration(stream, media):
    duration = stream.get("duration")
    if duration is None or duration == "N/A":
        raise ValueError(f"missing duration in {media.path.name}")
    return float(duration)


def stream_start(stream):
    start = stream.get("start_time")
    return float(start) if start not in (None, "N/A") else 0.0


SRT_TIME = r"(\d{2,}):([0-5]\d):([0-5]\d),(\d{3})"
SRT_CUE = re.compile(rf"{SRT_TIME}[ \t]+-->[ \t]+{SRT_TIME}(?:[ \t]+[^\r\n]+)?", re.ASCII)
SRT_INDEX = re.compile(r"[0-9]+")


def validate_captions(media, total_ms):
    text = media.path.read_text(encoding="utf-8-sig").strip()
    blocks = re.split(r"\n[ \t]*\n", text)
    previous_end = 0
    for block in blocks:
        lines = block.splitlines()
        cue = SRT_CUE.fullmatch(lines[1].strip()) if len(lines) >= 3 and SRT_INDEX.fullmatch(lines[0].strip()) else None
        if cue is None or not any(line.strip() for line in lines[2:]):
            raise ValueError(f"invalid SRT cue in {media.path.name}")
        parts = list(map(int, cue.groups()))
        start = sum(part * unit for part, unit in zip(parts[:4], (3600000, 60000, 1000, 1)))
        end = sum(part * unit for part, unit in zip(parts[4:], (3600000, 60000, 1000, 1)))
        if not 0 <= start < end <= total_ms:
            raise ValueError(f"SRT cue is outside the preview timeline in {media.path.name}")
        if start < previous_end:
            raise ValueError(f"SRT cues in {media.path.name} must be in time order and must not overlap for MP4 preview")
        previous_end = end


def list_of_objects(edit, key, default=None):
    values = edit.get(key, default)
    if not isinstance(values, list) or any(not isinstance(value, dict) for value in values):
        raise ValueError(f"edit {key} must be an array of objects")
    return values


def build_command(root, edit, ffmpeg, ffprobe):
    items = load_items(root)
    width, height, fps = (edit.get(name) for name in ("width", "height", "fps"))
    if any(type(size) is not int or size < 2 or size % 2 for size in (width, height)):
        raise ValueError("preview width and height must be positive even integers")
    if type(fps) is not int or not 1 <= fps <= 60:
        raise ValueError("preview fps must be an integer from 1 to 60")
    shot_specs = list_of_objects(edit, "shots")
    if not shot_specs:
        raise ValueError("edit must include at least one shot")
    narration_specs = list_of_objects(edit, "narration", [])

    command = [ffmpeg, "-nostdin", "-hide_banner", "-v", "error", "-xerror", "-n"]
    filters = []
    input_count = 0

    def add_input(media, loop=False):
        nonlocal input_count
        index = input_count
        input_count += 1
        if loop:
            command.extend(["-stream_loop", "-1"])
        command.extend([*media.input_options(), "-i", str(media.path)])
        return index

    total_frames = 0
    video_tracks = []
    audio_tracks = []
    for shot in shot_specs:
        media = approved_media(root, items, shot.get("id"), "video")
        frames = round(seconds(shot.get("seconds"), "shot seconds") * fps)
        if frames < 1:
            raise ValueError(f"{shot['id']!r} must occupy at least one frame")
        source_start = seconds(shot.get("source_start_seconds", 0), "source_start_seconds")
        video_stream = probe(ffprobe, media, "V:0")
        source_duration = stream_duration(video_stream, media)
        # Preserve the original one-frame tolerance for cuts from the first frame.
        end_tolerance = 1 / fps if source_start == 0 else 0.000001
        if source_start >= source_duration or source_start + frames / fps > source_duration + end_tolerance:
            raise ValueError(f"{shot['id']!r} source window exceeds the video duration")
        volume = seconds(shot.get("native_audio_volume", 0), "native_audio_volume")
        if volume > 1:
            raise ValueError("native_audio_volume must be between 0 and 1")
        index = add_input(media)
        video_timing = f"setpts=PTS-STARTPTS,fps={fps}"
        if source_start:
            video_timing = (
                f"setpts=PTS-STARTPTS-({source_start:.9f})/TB,"
                f"fps=fps={fps}:start_time=0:round=up"
            )
        filters.append(
            f"[{index}:V:0]{video_timing},"
            f"scale={width}:{height}:force_original_aspect_ratio=decrease:force_divisible_by=2,"
            f"pad={width}:{height}:(ow-iw)/2:(oh-ih)/2,setsar=1,format=yuv420p,"
            f"tpad=stop_mode=clone:stop=1,trim=end_frame={frames},setpts=N/({fps}*TB)[v{index}]"
        )
        video_tracks.append(f"[v{index}]")
        if volume:
            audio_stream = probe(ffprobe, media, "a:0")
            offset = stream_start(audio_stream) - stream_start(video_stream) - source_start
            start_sample = round(total_frames * AUDIO_SAMPLE_RATE / fps)
            end_sample = round((total_frames + frames) * AUDIO_SAMPLE_RATE / fps)
            shot_samples = end_sample - start_sample
            filters.append(
                f"[{index}:a:0]asetpts=PTS-STARTPTS+({offset:.9f})/TB,"
                f"aresample={AUDIO_SAMPLE_RATE}:async=1:first_pts=0,aformat=channel_layouts=stereo,"
                f"apad=whole_len={shot_samples},atrim=end_sample={shot_samples},"
                f"volume={volume},adelay={start_sample}S:all=1[native{index}]"
            )
            audio_tracks.append(f"[native{index}]")
        total_frames += frames
    total_seconds = total_frames / fps
    filters.append(f"{''.join(video_tracks)}concat=n={len(video_tracks)}:v=1:a=0[video]")

    for line in narration_specs:
        media = approved_media(root, items, line.get("id"), "speech")
        delay_ms = round(seconds(line.get("start_seconds"), "narration start_seconds") * 1000)
        if delay_ms >= total_seconds * 1000:
            raise ValueError(f"{line['id']!r} starts outside the preview timeline")
        narration_end = delay_ms / 1000 + stream_duration(probe(ffprobe, media, "a:0"), media)
        if narration_end > total_seconds + 1 / AUDIO_SAMPLE_RATE:
            raise ValueError(f"{line['id']!r} extends beyond the preview timeline")
        index = add_input(media)
        filters.append(
            f"[{index}:a:0]asetpts=PTS-STARTPTS,aformat=channel_layouts=stereo,adelay={delay_ms}:all=1[a{index}]"
        )
        audio_tracks.append(f"[a{index}]")
    if edit.get("music") is not None:
        media = approved_media(root, items, edit["music"], "music")
        index = add_input(media, loop=True)
        filters.append(f"[{index}:a:0]asetpts=PTS-STARTPTS,aformat=channel_layouts=stereo,volume=0.20[a{index}]")
        audio_tracks.append(f"[a{index}]")
    if audio_tracks:
        filters.append(
            f"{''.join(audio_tracks)}amix=inputs={len(audio_tracks)}:normalize=0,"
            f"alimiter=limit=0.95:level=0:latency=1,apad,atrim=duration={total_seconds:.9f}[audio]"
        )

    captions_index = None
    if edit.get("captions") is not None:
        media = approved_media(root, items, edit["captions"], "captions")
        validate_captions(media, total_seconds * 1000)
        captions_index = add_input(media)

    identifiers = [shot["id"] for shot in shot_specs] + [line["id"] for line in narration_specs]
    identifiers.extend(edit[field] for field in ("music", "captions") if edit.get(field) is not None)
    validate_dependencies(root, items, identifiers)

    command += ["-filter_complex_threads", "1", "-filter_complex", ";".join(filters)]
    command += ["-map", "[video]", "-c:v", "libx264", "-preset", "fast", "-crf", "20", "-r", str(fps)]
    if audio_tracks:
        command += ["-map", "[audio]", "-c:a", "aac", "-ar", str(AUDIO_SAMPLE_RATE), "-ac", "2"]
    if captions_index is not None:
        command += ["-map", f"{captions_index}:s:0", "-c:s", "mov_text"]
    command += ["-map_metadata", "-1", "-map_chapters", "-1", "-movflags", "+faststart", "-t", f"{total_seconds:.9f}"]
    return command, total_frames, bool(audio_tracks), captions_index is not None


def render(root, edit_file, output):
    ffmpeg, ffprobe = shutil.which("ffmpeg"), shutil.which("ffprobe")
    if not ffmpeg or not ffprobe:
        raise ValueError("preview requires FFmpeg and ffprobe")
    root = root.resolve(strict=True)
    if not root.is_dir():
        raise ValueError("ROOT must be a directory")
    if output.suffix.lower() != ".mp4" or not output.parent.is_dir():
        raise ValueError("output must be an .mp4 file in an existing directory")
    if output.exists() or output.is_symlink():
        raise ValueError(f"output already exists: {output}")
    edit = load_object(project_file(root, edit_file))
    command, frame_count, has_audio, has_captions = build_command(root, edit, ffmpeg, ffprobe)
    with tempfile.TemporaryDirectory(prefix=".studio-preview-", dir=output.parent) as folder:
        rendered = Path(folder) / "preview.mp4"
        run([*command, str(rendered)])
        media = Media(rendered, "mov")
        frames = probe(ffprobe, media, "V:0").get("nb_frames")
        if frames != str(frame_count):
            raise ValueError(f"rendered {frames} video frames, expected {frame_count}")
        if has_audio:
            probe(ffprobe, media, "a:0")
        if has_captions:
            probe(ffprobe, media, "s:0")
        os.link(rendered, output)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("root", type=Path, help="directory containing project manifest and media")
    parser.add_argument("output", type=Path, help="new MP4 preview path")
    parser.add_argument("--edit", default="edit.json", help="project-relative edit JSON (default: edit.json)")
    args = parser.parse_args()
    try:
        render(args.root, args.edit, args.output)
    except (ValueError, OSError, OverflowError) as error:
        parser.exit(1, f"Preview failed: {error}\n")
    print(args.output)


if __name__ == "__main__":
    main()
