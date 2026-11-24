# Curated Project Skill Routing

This repository keeps task-specific Skills in `.agents/skills`. Codex (`.codex/skills`) and Claude (`.claude/skills`) entry directories symlink to the same project-owned copies.

Load only the Skill whose trigger matches the current task. Existing repository instructions (`AGENTS.md`, `README.md`) and the user's current request take priority over a Skill.

| Skill | Use here for |
|---|---|
| `minimax-studio-creative` | Use MiniMax MMX with a subscription key or Agensi, and create, revise, and deliver shared media projects |
| `minimax-studio-maintenance` | Voice-production workspace (`dialogue.html`), loopback speech service (`server/dialogue-server.mjs`), packaging scripts (`build_pages.py`, `build_offline.py`), `node --test` / Puppeteer verification, and legacy workbench boundaries |
| `puppeteer-automation` | Existing Puppeteer browser automation workflow (`tests/dialogue.browser.mjs`, `tests/legacy.browser.mjs`) |
| `github-actions` | Static Pages publishing (`.github/workflows/static.yml`) and CodeQL security workflows |
| `ui-ux-pro-max` (global) | Searchable UI/UX design, accessibility, and interface guidance via global skill (`~/.gemini/config/skills/ui-ux-pro-max`) |

## Maintenance rules

- Keep domain and implementation Skills in the project (`.agents/skills/`) instead of duplicating them in global directories.
- Remove mismatched or duplicate local skills (for example, Playwright `webapp-testing` when this repo uses Puppeteer, or `frontend-design` covered by global `ui-ux-pro-max`).
- Prefer symlinks in `.claude/skills/` and `.codex/skills/` so all tools read the same maintained source.
- Add or expand a Skill only when it captures repeatable project knowledge not already obvious from code or repository documentation.
- For small changes, run focused checks first and expand testing only when failures, risk, or new scope justify it.
