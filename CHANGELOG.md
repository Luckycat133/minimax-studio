# Changelog

All notable changes to MiniMax Studio are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

Version history is reconstructed from the repository's git milestones starting
at `0.1.0`.

## [Unreleased]

## [0.2.1] - 2026-11-11

### Changed
- **CI workflow updates**: Bumped GitHub Actions dependencies including `github/codeql-action` and `static.yml` workflow actions (#11, #14).

### Fixed
- **Server dependency security (`f43cad2`)**: Resolved remaining npm audit vulnerabilities in `server/package.json` and `server/package-lock.json`.

### Removed
- **Tracked dependency trees (`7cbcc4a`)**: Untracked root and `server/` `node_modules` directories from Git.

### Docs
- **AI & LLM documentation (GEO) (#15)**: Added `llms.txt` and `llms-full.txt` following the `llmstxt.org` specification and linked them from `README.md` (`4d0f58e`).

## [0.2.0] - 2026-10-25

### Added
- **Game dialogue voice-production workspace (#13)**: Added `dialogue.html`, `css/dialogue.css`, `js/dialogue.mjs`, `js/dialogue-core.mjs`, `js/production-core.mjs`, `js/production-storage.mjs`, and `js/production-queue.mjs` for CSV import, cast voice configuration, WAV take attachment/playback/review, and validated ZIP export (`72fb79d`).
- **Loopback-only guarded speech service (#13)**: Added `server/dialogue-server.mjs` and `server/dialogue-provider.mjs` exposing `/api/dialogue/*` routes with strict CSP, payload limits, and generation disabled by default.
- **Offline HTML bundle & test suites (#13)**: Added `scripts/build_offline.py` for standalone offline voice-workspace builds, expanded `scripts/build_pages.py` allowlist to 17 public assets, and added `node --test`, jsdom DOM, and Puppeteer browser test scripts to `package.json`.
- **Workspace documentation (#13)**: Added `OFFLINE_WORKFLOW.md`, `docs/PROVIDER_INTEGRATION.md`, and `docs/BROWSER_QA_RUNBOOK.md`.

### Changed
- **Project agent rules & maintenance skill (`e061f76`)**: Updated `.agents/SKILLS.md`, `AGENTS.md`, and project-scoped skills including `minimax-studio-maintenance`.

## [0.1.3] - 2026-09-30

### Changed
- **Allowlisted GitHub Pages build (#12)**: Restricted `.github/workflows/static.yml` via `scripts/build_pages.py` and `tests/test_pages_build.py` to package only explicitly reviewed public frontend assets instead of the repository root (`4968a62`).
- **Dependabot configuration (`5796eff`, #10)**: Updated `github/codeql-action` and dropped the npm ecosystem from `.github/dependabot.yml`.

### Fixed
- **Dependency audit remediation (`b514dd3`, `57015cc`)**: Rebuilt root `package.json` and `server/package.json` from lockfiles and resolved high-severity `npm audit` findings.

### Removed
- **Tracked runtime database (`4968a62`, #12)**: Removed tracked `server/data/minimax.db` from the repository and updated `.gitignore`.

## [0.1.2] - 2026-07-28

### Added
- **Security automation**: Added `.github/dependabot.yml` with monthly grouped updates (`f694cf2`, `7dd36bf`) and `.github/workflows/codeql.yml` targeting `javascript-typescript` (`71bb0d9`, `7401eee`).
- **Project documentation & audit**: Added `README.md` (`6854c9f`) and documented reproducibility and backend-source blockers in `REPOSITORY_AUDIT.md` (`a590119`).

### Changed
- **GitHub Actions updates (#4–#8)**: Bumped `github/codeql-action`, `actions/deploy-pages`, `actions/upload-pages-artifact`, `actions/configure-pages`, and `actions/checkout` (`2af7593`–`8f34d21`).

### Removed
- **Sensitive local files (`b8f0bf6`)**: Added `.gitignore` and untracked `.env` and `:memory:` database artifacts.

## [0.1.1] - 2026-06-27

### Added
- **Project-level agent skills (#1)**: Added `puppeteer-automation` skill across `.agents/skills/`, `.claude/skills/`, and `.codex/skills/` with `skills-lock.json` (`a5fefd9`, `856276f`).
- **Browser test report**: Added `BROWSER_TEST_REPORT.md` (`f534dbd`).

### Changed
- **Workspace updates**: Updated `js/app.js` and synced local workspace branches (`94255b4`, `2bd49b8`, `b9a7619`).

## [0.1.0] - 2026-05-04

### Added
- **Initial MiniMax Studio static workbench (`68438fb`)**: Created `index.html`, `css/styles.css`, `css/themes.css`, `js/app.js`, `js/api.js`, `js/backend-api.js`, `js/models.js`, `js/templates.js`, `js/utils.js`, and `js/polyfills.js`.
- **GitHub Pages workflow (`1940082`)**: Added `.github/workflows/static.yml` for static site deployment.
