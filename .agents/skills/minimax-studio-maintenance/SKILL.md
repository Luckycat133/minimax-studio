---
name: minimax-studio-maintenance
description: Maintain, debug, build, and verify MiniMax Studio's game dialogue voice-production workspace, loopback-only speech service, static/offline packaging scripts, and legacy multimodal workbench boundaries.
---

# MiniMax Studio Maintenance

Check the current tree before acting on historical audit claims. This repository
contains two strictly separated surfaces:

1. **Voice-production workspace (active candidate)**: `dialogue.html`,
   `css/dialogue.css`, `js/dialogue.mjs`, `js/dialogue-core.mjs`,
   `js/production-core.mjs`, `js/production-storage.mjs`,
   `js/production-queue.mjs`, served locally by the loopback-only speech
   service (`server/dialogue-server.mjs`, `server/dialogue-provider.mjs`).
2. **Legacy multimodal workbench (maintenance mode)**: `index.html`,
   `css/styles.css`, `css/themes.css`, `js/app.js`, `js/api.js`,
   `js/backend-api.js`, `js/models.js`, `js/templates.js`, `js/utils.js`,
   `js/polyfills.js`. See [references/legacy-media.md](references/legacy-media.md)
   when working on legacy Direct Mode, Backend Mode, or media retry/download flows.

A skill or documentation update does not activate deployment or authorize paid
MiniMax generation.

## Verified source boundary (2026-11-22; recheck on use)

- **Root `package.json`** declares dev tooling (`puppeteer`, `jsdom`,
  `fake-indexeddb`) and runnable scripts:
  - `npm run dialogue` -> `node server/dialogue-server.mjs` (loopback-only voice workspace & `/api/dialogue/*` routes; generation disabled by default)
  - `npm test` -> `node --test tests/dialogue.test.mjs tests/production.test.mjs tests/dialogue-provider.test.mjs tests/dialogue-server.test.mjs tests/backend-api.test.mjs`
  - `npm run test:dom` -> `node --test tests/dialogue.dom.test.mjs`
  - `npm run test:browser` -> `node tests/dialogue.browser.mjs` (Puppeteer Chromium voice-workspace flow)
  - `npm run test:browser:legacy` -> `node tests/legacy.browser.mjs` (Puppeteer loopback fixture for legacy workbench)
  - `npm run build` -> `python3 scripts/build_pages.py` (fail-closed 17-file public allowlist into fresh `_site/`)
  - `npm run build:offline` -> `python3 scripts/build_offline.py` (standalone offline HTML bundle for local-recording workflow)
- **Python unit tests**: `python3 -m unittest discover -s tests -v` covers
  `tests/test_pages_build.py`, `tests/test_offline_build.py`, and
  `tests/test_creative_*.py`.
- **`server/`**: `server/dialogue-server.mjs` and `server/dialogue-provider.mjs`
  implement the guarded `/api/dialogue/*` loopback service (no `.env` loading,
  strict `LOCAL_CSP`, 24 KiB JSON limit, explicit budget/enablement required for
  live speech). `server/package.json` exists, while the legacy `server/server.js`
  multimodal backend remains absent; never conflate `/api/dialogue/*` with a
  recovered legacy `/api/health` (`minimax-studio-backend`) server.
- **GitHub Pages publication boundary**: `scripts/build_pages.py` packages only
  the 17 explicitly allowlisted files in `PUBLIC_FILES` and refuses to overwrite
  an existing `_site` directory or follow symlinks. Any new public asset must be
  deliberately added to `PUBLIC_FILES` and verified with `tests/test_pages_build.py`.

## Verification & safety rules

- **Synthetic / loopback first**: Run `npm test`, `npm run test:dom`,
  `npm run test:browser`, `npm run test:browser:legacy`, and
  `python3 -m unittest discover -s tests -v` using synthetic WAV fixtures and
  loopback mocks. Never trigger live paid MiniMax requests unless explicitly
  authorized for that scope and cost.
- **Credential & user-data hygiene**: Saved browser credentials
  (`minimax_api_key`), `server/.env`, and any local `server/data/minimax.db` are
  user data, not fixtures. Never print, copy, or embed keys into scripts,
  screenshots, reports, or offline/Pages builds.
- **Honest status reporting**: Report the exact commands executed and pass/fail
  evidence. Synthetic/loopback browser passes do not establish live MiniMax
  entitlement, audio quality, billing behavior, or deployed Pages verification.
- **Legacy workbench details**: Load [references/legacy-media.md](references/legacy-media.md)
  before modifying `index.html`, `js/app.js`, `js/api.js`, `js/backend-api.js`,
  or `js/models.js`.
