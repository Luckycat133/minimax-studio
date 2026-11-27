# Agent entry

Read `README.md` and `.agents/SKILLS.md` before substantive work. Use the project-local Skill whose trigger matches the task. Preserve existing work, keep changes scoped, and run focused checks proportional to the change.

## Repository entry points & boundaries

- **Voice-production workspace (active candidate)**: `dialogue.html`, `css/dialogue.css`, `js/dialogue.mjs`, `js/dialogue-core.mjs`, `js/production-core.mjs`, `js/production-storage.mjs`, `js/production-queue.mjs`.
- **Loopback speech service**: `server/dialogue-server.mjs` and `server/dialogue-provider.mjs` (`/api/dialogue/*`, generation disabled by default; requires explicit local enablement and budget for live speech).
- **Packaging scripts**: `scripts/build_pages.py` (fail-closed 17-file public allowlist into fresh `_site/`) and `scripts/build_offline.py` (standalone offline voice-workspace HTML).
- **Legacy multimodal workbench (maintenance mode)**: `index.html`, `js/app.js`, `js/api.js`, `js/backend-api.js`, `js/models.js`, `js/templates.js`. Note that `server/server.js` (`minimax-studio-backend`) remains absent; do not conflate `/api/dialogue/*` with a recovered legacy backend.
- **Safety boundary**: Never trigger live paid MiniMax API calls or expose real API keys (`server/.env`, `minimax_api_key`, `server/data/minimax.db`) unless explicitly authorized.

## Verification commands

| Scope | Command |
|---|---|
| Node unit tests (dialogue, production, provider, server, legacy backend client) | `npm test` |
| jsdom DOM tests | `npm run test:dom` |
| Puppeteer voice-workspace browser flow | `npm run test:browser` |
| Puppeteer legacy workbench loopback fixture | `npm run test:browser:legacy` |
| Python packaging, offline build & creative tests | `python3 -m unittest discover -s tests -v` |
| Allowlisted Pages artifact build (`_site/`) | `npm run build` |
| Standalone offline voice HTML build | `npm run build:offline` |
| Local voice workspace server | `npm run dialogue` |
