# Spec 761 — Iteration 1 Review Rebuttals

## Verdicts

| Model | Verdict |
|-------|---------|
| Gemini | REQUEST_CHANGES |
| Codex | (unavailable — see below) |
| Claude | APPROVE |

## Gemini REQUEST_CHANGES — addressed

Gemini raised three critical issues in iteration 1, all flagged as `HIGH` confidence:

### 1. `afx status` data-source contradiction

> Scope item 4 states `afx status` should read from `/api/state` to get the `architects` collection, but Solution Approach 4 says to use `getWorkspaceStatus()` when Tower is running. `getWorkspaceStatus` hits `/api/workspaces/:path/status` (returning `InstanceStatus`, which lacks the `architects` array and builder metadata). The spec must standardize on using `client.getWorkspaceState()` (which hits `/api/state`) for `status.ts` when Tower is running.

**Resolution**: The architect issued a 2026-05-18 directive (timestamped 20:48Z) to slice v1 to dashboard tabs only for the 3.0.6 hotfix. `afx status` is now **deferred to a follow-up issue**. The contradiction is moot for v1. The deferred follow-up's open items include "standardise on `getWorkspaceState()` rather than `getWorkspaceStatus()`" — explicitly captured in the spec's "Deferred to follow-up issues" section.

### 2. Missing `spawnedByArchitect` on `/api/state` builders

> For `afx status --architect <name>` to filter builders via Tower, `DashboardState.builders` must include the `spawnedByArchitect` field. However, `handleWorkspaceState` in `tower-routes.ts` currently builds the builders list from the in-memory `entry.builders` cache (which only maps `builderId` to `terminalId`). The spec needs to explicitly state how `handleWorkspaceState` acquires this field.

**Resolution**: Deferred. The field is only needed for the `--architect <name>` builder filter, which is in the deferred slice. v1 explicitly says "No `spawnedByArchitect` on `/api/state` builders" under "Explicitly NOT in scope". The follow-up issue inherits this design decision (which is now properly documented).

### 3. VS Code `TerminalManager.openArchitect` map-key collision

> `terminalManager.ts` currently hardcodes the internal terminal map key: `const existing = this.terminals.get('architect');`. If the map key logic isn't updated to include the name (e.g., `architect-${name}`), opening a second architect will simply re-focus the first one.

**Resolution**: Deferred. The VS Code extension changes are deferred to a follow-up issue. Captured under "Deferred to follow-up issues" as a must-address-at-follow-up-time concern with the exact code path called out by file/line.

### Non-critical: `workspace.ts` TreeProvider must be async

Captured under the VS Code deferred follow-up.

### Non-critical: `?tab=architect` natural fallback in `useTabs.ts:87`

Confirmed; noted in Solution Approach step 2.

## Iteration-2 review (after architect slicing)

A second iteration of review was run after the slicing decision was incorporated. Stored as `761-spec-iter2-gemini.md` and `761-spec-iter2-claude.md` alongside this file.

**Gemini iter-2 (REQUEST_CHANGES)** raised two slicing-related contradictions left over from the rewrite:
1. **Stale Solution Approach steps 3 & 4** describing VS Code and `afx status` implementation despite Scope marking them deferred. — Fixed: Solution Approach trimmed to 2 steps matching v1 scope.
2. **Incorrect instruction to modify `getTerminalsForWorkspace`** — modifying it would change `InstanceStatus.terminals` and leak into `afx status` (violating slicing boundary). — Fixed: removed the instruction; added explicit "do NOT modify" note with rationale; added the file to References under "explicitly NOT touched in v1."

**Claude iter-2 (APPROVE)** verified all current-state claims against source. Two minor adoptions:
1. `?tab=architect:<name>` is not zero-new-logic — Solution Approach now explicitly says "small colon-parsing addition."
2. Left-pane rendering bypasses `activatedTerminals` — Solution Approach now calls out this implementation subtlety with two implementation options for plan-phase.

## Codex unavailable

The `@openai+codex@0.101.0-darwin-arm64` vendored binary directory is empty in this worktree's pnpm node_modules. Two retries (with `--issue` and `--project-id`) both failed with `ENOENT`. `pnpm rebuild` is blocked by the harness's permission classifier.

The architect was notified via `afx send architect` after the spec was drafted; they may choose to require codex re-review on the architect machine before approving, or accept the 2-of-3 result given the slicing directive's emphasis on shipping speed for 3.0.6.

## Net change to spec from iter-1

- Whole spec re-sliced to dashboard-tabs-only per architect directive.
- Solution Approach trimmed and re-grounded against the actual data flow (dashboard ← `entry.architects` via `tower-routes.ts`, NOT `TerminalEntry[]` via `getTerminalsForWorkspace`).
- Type-sync constraint added between `DashboardState` and the inline literal in `tower-routes.ts:handleWorkspaceState`.
- WebSocket lifecycle made explicit (extend existing `activatedTerminals` pattern to left pane).
- All deferred follow-up items captured with the gemini-flagged gotchas attached so the follow-up specs inherit them.

Ready for spec-approval gate.
