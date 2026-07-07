# Builder thread — pir-1144 (vscode IDE-mode foundation)

## 2026-07-07 — Plan phase

- Read issue #1144 + its two comments. Key context deltas from the fork side: Part 3 is the IDE's ONLY first-run UX (core onboarding removed in the fork), and nothing first-launch-visible may ride on `configurationDefaults` (async registration races first render) — all runtime code.
- Architect instruction received mid-investigation: the fork rebrand has NOT landed; the exact `product.json` `nameLong` ('Codev' vs 'Codev IDE') is still being confirmed. Plan single-sources the string as `CODEV_IDE_APP_NAME` in a new `src/ide-mode.ts` so a differing confirmed value is a one-line edit. Flagged as pending in the plan.
- Investigation findings:
  - Part 1 root cause confirmed: `views/workspace.ts` `getChildren` builds Architects/Spawn/Shell rows unconditionally; no view in `contributes.views` gates on workspace presence. Data views (Agents/Backlog/PRs/Recently Closed) already render empty on null cache data; Status renders rows unconditionally.
  - The inertness risk for Part 2 is real: `connectionManager.initialize()` (extension.ts:1308) auto-starts Tower even with `detectWorkspacePath() === null`. Full side-effect inventory in the plan: initialize(), runPreflight (walkthrough focus steal), one-time panel reveal, statusBarItem.show(), workspaceState/globalState writes. Constructors are inert.
- Plan written to `codev/plans/1144-vscode-ide-mode-foundation-dua.md`: activation-tier model (full / ide-empty / dormant) computed from `detectIdeMode` + `detectWorkspacePath`, a pure `activationPolicy(tier)` so the quadrant matrix is unit-provable, `codev.hasWorkspace` + `codev.ideMode` context keys, view-level `when` gating + `viewsWelcome` per quadrant, dev seam `CODEV_SIMULATE_IDE=1` honored only in ExtensionMode.Development.
- Sitting at `plan-approval` gate.
