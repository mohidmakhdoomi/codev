# PIR Review: Show issue # + title in the two outlier builder Quick Picks

Fixes #925

## Summary

Two VSCode command-palette pickers — **Codev: Open Builder Terminal** and **Codev: Send Message to Builder** — rendered each builder as its bare internal id (`pir-1333`), while the other seven builder pickers show `#<issueId> <issueTitle>`. The fix brings the two outliers in line. The non-obvious part: the two outliers read `client.getWorkspaceState` (→ `Builder`, which has **no** `issueId`/`issueTitle`), whereas the seven correct pickers read `client.getOverview` (→ `OverviewBuilder`, which has them) — so the issue's proposed one-line field swap would not have compiled. The implementation mirrors the existing `run-worktree-dev.ts` pattern: source display fields from `getOverview`, join back to the workspace `Builder` (for `terminalId` and the canonical id the action needs) via `resolveAgentName`, behind one shared pure helper.

## Files Changed

`git diff --stat` vs merge-base (code only):

- `packages/vscode/src/builder-pick-rows.ts` (+75 / -0) — new pure helper `buildBuilderPickRows` + types
- `packages/vscode/src/__tests__/builder-pick-rows.test.ts` (+95 / -0) — new, 6 unit tests
- `packages/vscode/src/extension.ts` (+10 / -7) — `openBuilderTerminal` picker rewired
- `packages/vscode/src/commands/send.ts` (+11 / -6) — `sendMessage` picker rewired

Plus protocol artifacts: `codev/plans/925-…md`, `codev/state/pir-925_thread.md`, `codev/projects/925-…/status.yaml`.

## Commits

`git log main..HEAD --oneline` (excluding porch chore commits):

- `e521c3cd` [PIR #925] Plan draft
- `991d311e` [PIR #925] Render issue # + title in Open Terminal & Send Message pickers

## Test Results

- Build (`tsc --noEmit` + `eslint` + `esbuild --production`): ✓ pass
- Unit (`pnpm test:unit`): ✓ 119 passed (6 new in `builder-pick-rows.test.ts`)
- Porch checks (`porch done`, implement phase): build ✓, tests ✓
- Manual verification: human approved at the `dev-approval` gate.

## Architecture Updates

No `arch.md` changes needed. This reuses an existing pattern rather than introducing one: a picker that needs both `getOverview` display fields and a `getWorkspaceState`-only runtime field already exists (`run-worktree-dev.ts`), using `getOverview` as the display source joined to the workspace `Builder` via `resolveAgentName` (tail-match, because `OverviewBuilder.id` and `Builder.id` differ in shape). The only new surface is a small pure helper that factors that join out of the two call sites — no module boundary or data-flow change.

## Lessons Learned Updates

No new entry added to `codev/resources/lessons-learned.md` — the lesson here is a concrete instance of an existing one rather than a new principle:

> [From 0059] Verify what data is actually available in state before designing features that depend on it.

This PR is a textbook case: the issue body asserted both outliers sourced builders "from the same `getWorkspaceState` endpoint the seven correct pickers use, so the fields should already be populated." In fact the seven use `getOverview`, and `getWorkspaceState`'s `Builder` type carries no `issueId`/`issueTitle` — so the proposed drop-in `b.issueId` was a compile error, not a mechanical swap. The audit table in a well-researched issue can still mis-state the data source; confirm the actual endpoint/type before trusting a "~10 LOC mechanical" framing. Recording the specifics here keeps the curated lessons file from accumulating a near-duplicate of 0059.

(Also relevant: memory `reference_overview_builder_dual_type` — the overview-builder shape is defined twice. The helper sidesteps this by accepting structural minimal interfaces rather than importing a concrete type, so it couples to neither definition.)

## Things to Look At During PR Review

- **The `resolveAgentName` join** (`builder-pick-rows.ts`) is the crux. It matches an overview id (`pir-925`) to a workspace id (`builder-pir-925`) by tail-match, not `===`. A builder that fails to join, or whose joined `Builder` has no `terminalId`, is dropped from the picker — this intentionally preserves the outliers' original `filter(b => b.terminalId)` "only builders with a live terminal" semantics. Verified by the "excludes no-terminal" and "excludes no-match" unit tests.
- **Terminal tab title preserved**: `openBuilder` is still passed `Codev: ${name}` (the builder name), not the new friendly label — so only the *picker row* changes, the resulting tab name is unchanged. #925 scopes the picker row only.
- **Two fetches per invocation**: both call sites now issue `getOverview` + `getWorkspaceState` concurrently via `Promise.all`. `getOverview` is served from a 30s-TTL cache (`overview.ts`), so the common case is a cache hit; the picker is a cold, user-initiated path regardless. This matches what `run-worktree-dev.ts` already does (it issues both, sequentially).

## How to Test Locally

For reviewers pulling the branch:

- **View diff**: VSCode sidebar → right-click builder `pir-925` → **View Diff**
- **Run the extension** (this is a VSCode-extension change, so `afx dev` does not apply — use the Extension Development Host): open the worktree in VSCode, press **F5** ("Run Codev Extension"), and in the dev-host window open your **main** Codev checkout (the workspace Tower tracks, so the picker is populated).
- **What to verify** (mapped to the plan's Test Plan):
  - `Codev: Open Builder Terminal…` → rows read `#<id> <title>` with `<phase>` in the description; picking opens the right terminal (tab title `Codev: <name>`).
  - `Codev: Send Message` (or Cmd+K D) → same row format; sending reaches the right builder.
  - Sanity: `Codev: Cleanup Builder` still renders the same format (no regression to the seven).
  - Degenerate: a builder with a null `issueId` falls back to `#<id>`.
