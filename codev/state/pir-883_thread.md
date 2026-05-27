# pir-883 — vscode builder cleanup tab regression

## 2026-05-27 — plan phase begin

Investigating regression where VSCode builder terminal tabs linger after
`afx cleanup`. Worked in 3.0.6 (3.0.2 per issue text but actually 3.0.6
per CHANGELOG); broken now.

## Root cause located

Two diagnostic queries side-by-side:

- `/workspace/.../api/state` `.builders[].id` (what the current diff reads):
  12 entries — includes orphan-shellper builders (bugfix-799, bugfix-838,
  bugfix-839, bugfix-840, bugfix-880, pir-819) whose worktrees no longer
  exist on disk.

- `/api/overview` `.builders[].roleId` (independent source — disk scan of
  `.builders/`): 6 entries — only the active worktrees.

`/api/state.builders` is built from SQLite `terminal_sessions` rebuilt
into an in-memory map. After `afx cleanup`, the shellper process often
survives (designed to survive Tower restarts), the SQLite row isn't
deleted, and `getRehydratedTerminalsEntry` reconnects on the fly. So
`state.builders` keeps the cleaned-up builder forever.

`/api/overview.builders` comes from `discoverBuilders` scanning
`.builders/` on disk. `afx cleanup` removes the worktree directory for
bugfix builders, so it disappears from overview immediately.

The diff at extension.ts:209-234 uses the wrong source. The issue's
Cause #2 (Tower's `state.builders` no longer drops the cleaned-up
builder) is the actual cause, and the user explicitly marks the
Tower-side bookkeeping (orphan shellpers / ghost SQLite rows) as
**out of scope** — so the VSCode side must become resilient to it.

## Verification evidence

20 builder rows in `~/.agent-farm/global.db terminal_sessions` vs 6
worktrees on disk. 25 live `shellper-main.js` processes; many own a
worktree that no longer exists.

## Fix direction

Switch `pruneClosedBuilderTerminals` to read from `overviewCache.getData()`
and diff on `OverviewBuilder.roleId`. OverviewData is rooted in the
worktree directory scan, so it's the authoritative "this builder still
exists" signal.

Side benefits: drops the async state fetch (data already in the cache),
drops the `pruneInFlight` guard (no async work), simpler code.

Soft-mode limitation: `OverviewBuilder.roleId` is `null` for soft-mode
worktrees (task-/worktree- prefix). Soft-mode terminals opened via
QuickPick are keyed by PtySession UUID and not visible to a roleId-based
diff. The issue's repro path is `afx spawn --protocol bugfix` (strict
mode), so this is an accepted edge.

## 2026-05-27 — implement phase

Plan-approval gate approved. Implementation lives in:

- `packages/vscode/src/prune-builder-terminals.ts` — new pure helper
  module (no `vscode` import) holding `computeBuildersToClose` and
  `roleIdsFromBuilders`. Plan called for the helper to live in
  `extension.ts`; pulled it into a sidecar module so the vitest unit
  can import it directly without mocking `vscode`. Functional shape is
  identical.
- `packages/vscode/src/extension.ts` — `pruneClosedBuilderTerminals` now
  reads `overviewCache.getData()`, runs synchronously, drops the
  `pruneInFlight` guard, and renames `prevBuilderIds` → `prevRoleIds`.
- `packages/vscode/src/__tests__/prune-builder-terminals.test.ts` —
  11 new vitest cases.

Build clean (`pnpm --filter codev-vscode check-types` ✓,
`pnpm --filter codev-vscode lint` ✓). Tests: 49 vitest unit
(11 new) ✓, 83 mocha integration ✓.

Pushed as commit `5c21360b`. Sitting at `dev-approval`.
