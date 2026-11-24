# Project files and revisions

Keep project files in a user-selected directory. Use a new project directory if the request supplies none. `manifest.json` tracks one current revision per item. Media live under project-relative paths. IDs identify creative units and remain stable when those units change. Put the revision in each new asset filename so an existing file remains available for review or rollback.

```json
{
  "version": 1,
  "title": "Travel mug launch",
  "items": [
    {"id": "script", "kind": "script", "status": "approved", "path": "planning/script.md"},
    {"id": "boards", "kind": "storyboard", "status": "approved", "path": "planning/shots.csv", "depends_on": ["script"]},
    {"id": "cover", "kind": "image", "status": "approved", "path": "images/cover-r1.png", "revision": 1},
    {"id": "shot-01", "kind": "video", "status": "approved", "path": "video/shot-01-r1.mp4", "revision": 1, "depends_on": ["cover"]},
    {"id": "zh-01", "kind": "speech", "status": "approved", "path": "audio/zh-01-r2.wav", "revision": 2, "language": "zh-CN"},
    {"id": "music", "kind": "music", "status": "approved", "path": "audio/music-r1.mp3"},
    {"id": "zh-captions", "kind": "captions", "status": "approved", "path": "captions/zh-r2.srt", "language": "zh-CN", "depends_on": ["zh-01", "shot-01"]}
  ]
}
```

- Required fields are `version` (integer `1`), `title`, and a nonempty `items` array. Each item has a unique `id`, a `kind` value from the example or `analysis`, `research`, or `transcript`, and a `status`. `approved` items need a relative `path` to an existing file. `depends_on` lists assets whose contents are used by the item. Use dependencies narrowly so revising dialogue does not invalidate picture or music. Optional `revision` is a positive integer and defaults to `1`. Other optional metadata includes `language`, `provider_model`, and `actual_usd` as a decimal string when the charge is known.
- Use `planned`, `quoted`, `submitted`, `uncertain`, `review`, `approved`, `failed`, or `stale`. Transition from `review` to `approved` after the requested checks and any required user review. An interrupted call stays `uncertain` until resolved. Persist `quote_id` and any `job_id` in the working manifest. Keep a local record keyed by item, revision, and submitted quote or job so repeats and abandoned takes remain visible in the total spend. Treat handles as private working state. Do not put credentials or temporary signed URLs in manifests.
- When replacing a file, retain the prior revision in the workspace and update the path only once the replacement is saved. Mark affected dependent items `stale`, then update and review them. Re-export with a new filename. Saving a new manifest snapshot before each paid call or revision makes interrupted work easier to reconcile.
- Package Markdown or UTF-8 CSV/JSON for script and storyboard, PNG/JPEG/WebP for images, MP4 for video, WAV/MP3 for audio, and UTF-8 SRT for captions. Use text or JSON for analysis and research, and text, JSON, SRT, or WebVTT for transcripts. Preserve the source format and create a supported derivative if conversion is needed. Inspect media in the host or decode it with a media tool when available, and base subtitle timing on the final audio and shot timing. A byte signature verifies format cues and does not prove playable or acceptable content.

## Shared assets and targeted revisions

Keep one item per shared shot, keyframe and music track. Give each localized line, caption file and edit plan its own ID and language. List every shot, narration take, music track and caption file used by an edit in that edit item's `depends_on`. A caption file depends on its language's approved spoken lines. Also record the shots or other inputs that actually drive cue timing when the cues are picture-synced. Keep timing dependencies specific so that a wording change in one language does not invalidate the other edition.

When the user requests a changed line or shot, identify the exact item and whether it changes the locked timing. Plan the impact from the approved manifest before generating. Run `python3 scripts/plan_revision.py PROJECT_ROOT/manifest.json zh-02` to list the items to revise, their downstream dependents in dependency order, and approved items outside that impact. Pass multiple IDs for a combined revision. Without script execution, follow the declared `depends_on` links from every changed item.

For a Mandarin line retake in a Mandarin/English project, regenerate the Mandarin line, update its captions and verify its edit. Preserve shared shots, existing music and the English files. If a new take exceeds its time slot, adjust the delivery or update the affected timings and recheck the corresponding caption cues before approving the edit. For a shared shot replacement at the same duration, verify both edits against the replacement and reuse audio and captions when their timing and content still match. If the cut timing changes, recompute each affected edition's downstream placements and captions. Review dependents before deciding which need new files or another paid call.

Keep the approved files and record the proposed revision separately until the replacement passes review. Then move the item to the new file and mark its affected dependents `stale` until verified. Recheck the changed language's edit for correct line and caption timing and use a new preview or ZIP filename. An already-approved unaffected edition can still be exported while the other edition is being revised.

## Export

Run `python3 scripts/package_project.py PROJECT_ROOT NEW_OUTPUT.zip` from the Skill folder, or run the unchanged script at the temporary path supplied by the host. A full export requires every manifest item to be approved and present. For a specific delivery, pass its root item IDs with `--items`, for example `--items script edit-zh edit-en`. The helper includes the declared transitive dependencies once and checks that the selected files are approved and present. Use `--items edit-en` to deliver the English edition while Mandarin work is pending. Add standalone deliverables such as a cover to the root list when requested. Use `--manifest export-selection.json` to select an alternative project-relative source manifest.

The ZIP includes an export manifest with file sizes and SHA-256 digests. Private quote/job IDs and working records stay in the project. Declare edit-plan JSON as `storyboard` to include it. Before delivering editable timelines, extract the ZIP into a separate directory and render each included edition from that directory using only its packaged files. This checks that the declared dependencies cover the media actually referenced by each edit. For an incomplete handoff, give the available files and identify pending assets. This creative ZIP is an editor handoff with a version 1 creative manifest. The Studio voice workspace uses a separate archive format.

## Edit plan

For a rendered preview, create `edit.json` in the project, using approved asset IDs from the manifest. Example for one five-second shot:

```json
{
  "width": 720,
  "height": 1280,
  "fps": 30,
  "shots": [{"id": "shot-01", "seconds": 5}],
  "narration": [{"id": "zh-01", "start_seconds": 0.4}],
  "music": "music",
  "captions": "zh-captions"
}
```

Run `python3 scripts/render_preview.py PROJECT_ROOT NEW_PREVIEW.mp4`. For multiple versions, use `--edit edits/zh.json` or `--edit edits/en.json` to select the corresponding narration and captions. The preview uses the ordered clips, scheduled narration, and optional music.

Use `source_start_seconds` on a shot to reuse a later segment of its approved source clip. It defaults to zero and is measured from the source video's first frame. `seconds` is still the shot's duration in the edit, rounded to output frames. The selected window must fit the source. Set `native_audio_volume` between 0 and 1 to mix in the original sound. It defaults to zero. A nonzero value requires an audio track and uses the same in-point while preserving that track's timing relative to the picture.

Prepare chronological, non-overlapping cues for the MP4 subtitle track. Combine simultaneous caption text into one cue where needed. The ZIP preserves the source SRT. Keep the original media and SRT files for an editor.
