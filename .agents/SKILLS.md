# Curated Project Skill Routing

This repository keeps task-specific Skills in .agents/skills. Codex and Claude entry directories point to the same project-owned copies where links are present.

The table originated in the 2026-09-11 audit. The maintenance routing was refreshed on 2026-11-15 against `5d57027b4b91743e01795f7e0b00f547bd5f952a`; this does not remove or replace other project-owned Skills.

Load only the Skill whose trigger matches the current task. A Skill may be reused by several projects, and this project may use several Skills. Existing repository instructions and the user's current request take priority over a Skill.

| Skill | Use here for |
|---|---|
| `minimax-studio-maintenance` | Legacy Direct/Backend boundaries, offline voice production, guarded loopback speech, credential/retry/recovery semantics and source-backed delivery facts |
| `puppeteer-automation` | Existing browser automation workflow |
| `github-actions` | Static publishing and security workflows |
| `frontend-design` | Studio interface design |
| `webapp-testing` | Local browser-flow verification |
| `ui-ux-pro-max` | Searchable UX, accessibility, and interface guidance |

## Maintenance rules

- Keep domain and implementation Skills in the project instead of the global Codex Skill directory. Preserve project-specific Skills as the source of truth; do not replace them with an archived global copy.
- Prefer links for IDE-specific discovery. Do not replace a symlink with a divergent text copy or assume every tool directory already has every link.
- Add or expand a Skill only for repeatable project knowledge not already clear from code or repository documentation. Keep detailed acceptance facts in [docs/MAINTENANCE.md](../docs/MAINTENANCE.md).
- Route a change to its actual surface: legacy workbench, offline voice workspace, or local dialogue service. The new service does not recover the old backend; maintenance-only status applies to the legacy experiment, not to every file in the repository.
- Trace the UI, dispatcher, request, response and usable result before marking a capability delivered. Configuration, dependency manifests, a stored credential, a task ID and screenshots from another revision are insufficient.
- Record source SHA, verification date, exact checks, results and evidence type. Keep source inspection, existing CI, new local execution, real-browser acceptance, provider acceptance and publication checks separate.
- Use focused checks for small changes. Synthetic fixtures and fake transport must not consume MiniMax quota; any live acceptance needs explicit account, text and budget authorization.
- Preserve credentials, user data, local-only network restrictions, generation gates and publication allowlists. Docs updates do not authorize deployment, history rewriting, credential configuration or runtime fixes.

## Source-based routing update — 2026-11-15

Start with the project maintenance skill for product/data/runtime work; load UI,
testing or architecture specialists only when that narrower task needs them.
Use [the current maintenance ledger](../docs/MAINTENANCE.md) for boundaries and
acceptance, [the audit](../REPOSITORY_AUDIT.md) for current versus historical facts,
and the existing provider/browser runbooks for specialized procedures.
A source-map date is not a runtime or deployment pass.
