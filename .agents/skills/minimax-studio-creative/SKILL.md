---
name: minimax-studio-creative
description: Use MiniMax MMX for text, search, image and video understanding, image generation and editing, Hailuo video, speech synthesis and transcription. Combine those capabilities with music assets in MiniMax Studio projects, bilingual edits, and editor-ready handoffs.
---

# MiniMax Studio Creative

Use the requested mode or combine modes in one project. Accept a brief, script, CSV, or existing media. Reuse supplied or approved assets when they meet the brief. Ask for a decision only when it changes the deliverable or leaves paid work without an agreed scope.

| Mode | Deliverable |
| --- | --- |
| Text, search and understanding | MiniMax chat, research, image or video analysis, script, dialogue, and shot list. |
| Image | Generate or edit a cover, keyframe, or reference image. |
| Video | Text-to-video, start/end frames, or multimodal references on eligible models. Retain job IDs and original media. |
| Speech and transcription | System voices, role-based synthesis and retakes, speech-to-text, timed transcripts and subtitles. |
| Music | Use a supplied track or a music backend chosen by the user. Keep the music, dialogue, and video as separate assets. |

## Work through a project

1. Resolve aspect ratio, duration, languages, and output files from the brief. Plan reusable images, shots, dialogue, and music before generation. For localized editions, use the same shot IDs and separate line IDs per language. If the user asks for a bilingual deliverable without specifying the edit, propose separate language versions with shared visuals. For a single asset, plan only that asset and its actual dependencies.
2. For an MMX or Token Plan request, use [the direct MiniMax workflow](references/mmx.md). Check the key's region, current plan, and available quota. Run the requested eligible commands through the local runner. Select [Agensi](references/agensi.md) when the user chooses its separate tool balance. If a capability is unavailable, continue with supported work and identify pending items. Keep subscription keys local to the authorized MiniMax caller.
3. Maintain [the project manifest](references/project.md) in the user's workspace. Save real assets and verify they open. Keep the returned quote and job handles for recovery, and distinguish confirmed charges from estimates. Recover an uncertain request before offering a replacement billable run.
4. For a multi-shot, localized or revised project, use the [shared assets and targeted revisions workflow](references/project.md#shared-assets-and-targeted-revisions). Sample dialogue before a larger batch when voice or pronunciation needs review. Resolve which assets a change affects before making a new generation request. Derive caption timing from the approved take and edit timeline.
5. Deliver the requested files. Use [the ZIP helper](scripts/package_project.py) to export an approved handoff, selecting each requested edit and its dependencies. Use [the FFmpeg helper](scripts/render_preview.py) with [an edit plan](references/project.md#edit-plan) for each requested preview. If file or execution access is unavailable, give the actual asset links grouped by edit and language, and identify the files still needed for a local handoff. Label plans, unreviewed drafts, and synthetic fixtures as such.

Use the user's working language. Preserve editable assets and subtitle files even when rendering an MP4.
