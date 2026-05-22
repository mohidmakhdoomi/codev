# Plan: Multi-Architect Feature — Lifecycle, Persistence, and UX

## Metadata
- **ID**: plan-2026-05-22-786-multi-architect-feature
- **Status**: draft (iter-2 — post plan iter-1 CMAP: Gemini APPROVE, Codex REQUEST_CHANGES, Claude COMMENT; both addressed)
- **Specification**: [codev/specs/786-multi-architect-feature-is-und.md](../specs/786-multi-architect-feature-is-und.md)
- **Created**: 2026-05-22

## Executive Summary

Approach 1 from the spec — full lifecycle + persistence + UX parity in one coherent feature pass. Work is broken into seven phases ordered by dependency: pure utilities first, then server-side identity/lifecycle, then user-facing remove-architect (CLI + dashboard, with #764's solo-architect label fix folded in), then surface enumeration, then VSCode parity, finally docs. Each phase is a single atomic git commit on this builder branch; the cumulative branch ships as one PR per the architect's PR-strategy guidance.

Key design choices baked into the plan from the spec's Architect Decisions:
- **OQ-A** remove-anyway: `remove-architect` proceeds even with in-flight builders; the existing `tower-messages.ts:336` fallback routes them to `main`.
- **OQ-B** auto-delete row on permanent exit: the exit handlers for sibling architects delete `state.db.architect` and `terminal_sessions` rows on max-restart exhaustion.
- **OQ-D** expandable VSCode "Architects" tree section keyed by architect name.
- **OQ-G** confirmation prompt before sibling removal, with informational text about in-flight builders (does NOT block per OQ-A).

## Success Metrics
- [ ] All MUST/SHOULD criteria from the spec satisfied
- [ ] No reduction in test coverage on touched files
- [ ] Persistence write/delete <100ms per architect; restart re-spawn <2s for N≤8
- [ ] All 12 functional + 3 non-functional test scenarios from the spec pass
- [ ] Manual verify-phase round-trip exercised on a real workspace (per [[feedback_e2e_headline_path]])
- [ ] Playwright visual smoke for N=1/2/3 architects (per [[feedback_ui_visual_verification]])

## Phases (Machine Readable)

```json
{
  "phases": [
    {"id": "phase_1_foundation", "title": "Foundation utilities (validateArchitectName reserved-name, removeArchitect helper, clearState split)"},
    {"id": "phase_2_identity_restart", "title": "Identity preservation on shellper auto-restart (CODEV_ARCHITECT_NAME re-injection)"},
    {"id": "phase_3_graceful_stop", "title": "Graceful-stop persistence (exit-handler distinction, stopInstance preserve, launchInstance reconcile, stop.ts use registration-preserving clear)"},
    {"id": "phase_4_remove_and_ux", "title": "remove-architect CLI/RPC + dashboard close affordance + active-tab fallback + #764 solo-architect label fix"},
    {"id": "phase_5_surface_parity", "title": "Surface enumeration (v1 collapse removal, per-architect /status emission, loadState collection-aware, afx status update)"},
    {"id": "phase_6_vscode_multi", "title": "VSCode multi-architect surface (expandable Architects tree, per-name terminal slots, parameterized open command, right-click remove)"},
    {"id": "phase_7_docs_and_verify", "title": "Documentation updates (agent-farm.md, arch.md, --help, CHANGELOG) + manual verify scenario scaffolding"}
  ]
}
```

## Phase Breakdown

### Phase 1: Foundation utilities
**Dependencies**: None

#### Objectives
- Establish the pure utility changes that later phases build on, without touching Tower or any runtime path.
- Three small, independently testable changes: reserved-name check, removeArchitect helper, clearState split.

#### Deliverables
- [ ] `validateArchitectName` rejects the reserved name `main`
- [ ] `removeArchitect(name)` helper in `state.ts` — pure DB delete by id, idempotent (no-op if row absent)
- [ ] `clearState()` split into `clearState({ preserveArchitects?: boolean })` (or two distinct functions); default behaviour unchanged for existing callers; new variant skips the `DELETE FROM architect` row
- [ ] Unit tests for each change

#### Implementation Details
- **`packages/codev/src/agent-farm/utils/architect-name.ts`** — extend `validateArchitectName` with an explicit `name === DEFAULT_ARCHITECT_NAME` early-return that produces the error "Architect name `main` is reserved." Keep the existing regex and length checks. Update the JSDoc.
- **`packages/codev/src/agent-farm/state.ts`** — add `removeArchitect(name: string): void` that runs `DELETE FROM architect WHERE id = ?` (mirrors the existing `setArchitectByName(name, null)` shape, but spelled as its own function for callsite clarity). Could alternatively just expose `setArchitectByName(name, null)` — pick the spelling that reads best at the call sites; new tests are cheap.
- **`packages/codev/src/agent-farm/state.ts:314-324`** — split `clearState()`. Option A: add an options bag (`clearState({ preserveArchitects?: boolean })`). Option B: keep `clearState()` as full clear and add `clearRuntime()` that skips the architect table. Either is fine; option B keeps the existing callers unchanged and is slightly more readable at `commands/stop.ts`. Plan defaults to option B; builder picks the cleaner spelling during implementation.

#### Acceptance Criteria
- [ ] `validateArchitectName('main')` returns the new reserved-name error
- [ ] `validateArchitectName('ob-refine')`, `validateArchitectName('team-a')` still return `null`
- [ ] `removeArchitect('ob-refine')` deletes the row; second call is a no-op (no error)
- [ ] Original `clearState()` semantics preserved for existing callers (unchanged behaviour for uninstall / nuke flows)
- [ ] New `clearRuntime()` (or `clearState({ preserveArchitects: true })`) leaves `architect` rows intact, still clears `builders`, `utils`, `annotations`
- [ ] All new tests pass; existing state.ts and architect-name.ts tests still pass

#### Test Plan
- **Unit Tests**: 
  - `architect-name.test.ts` — add cases for `'main'`, also for whitespace-padded `'main'` (architect-name is trimmed by callers; verify behaviour matches caller expectations)
  - `state.test.ts` — `removeArchitect` round-trip (add → remove → re-add); `clearRuntime` vs `clearState` differential test (insert a `main` row + a `ob-refine` row + a builder; `clearRuntime` leaves architects intact, `clearState` wipes both)
- **Integration Tests**: not yet — pure utilities only
- **Manual Testing**: none required this phase

#### Rollback Strategy
Revert the commit. No persisted state mutations introduced by this phase.

#### Risks
- **Risk**: `validateArchitectName('main')` change breaks existing test fixtures or workflows that try to add `main`.
  - **Mitigation**: grep for `addArchitect.*main` / `'main'` in test fixtures before changing. If any exist that intentionally test the collision path, update them to use the new reserved-name error path.
- **Risk**: `clearState` shape change breaks a caller silently.
  - **Mitigation**: prefer option B (new function `clearRuntime`) over option A (options bag) — option B makes callers explicit and TypeScript catches any miss.

---

### Phase 2: Identity preservation on shellper auto-restart
**Dependencies**: None (but logically follows Phase 1)

#### Objectives
- Fix the env-injection gap in `tower-terminals.ts` so that when shellper auto-restarts a sibling architect's claude process, the new process receives `CODEV_ARCHITECT_NAME: <sibling-name>` instead of inheriting Tower's process env.
- Small, focused change in two locations.

#### Deliverables
- [ ] `tower-terminals.ts:559-567` `restartOptions.env` builder includes `CODEV_ARCHITECT_NAME: dbSession.role_id || 'main'`
- [ ] `tower-terminals.ts:773-776` (workspace-status reconnect path) — same change
- [ ] Tests assert env contents on each path
- [ ] No regression in main's behaviour (its `role_id` is `'main'`, so the injection is a no-op for it functionally)

#### Implementation Details
- Two locations in `tower-terminals.ts` build `cleanEnv` from `process.env` then delete `CLAUDECODE`. Add `CODEV_ARCHITECT_NAME: dbSession.role_id || 'main'` immediately after the `delete` line. The fallback to `'main'` covers legacy rows where `role_id` is null (v13 backfill should already have populated them; the fallback is belt-and-suspenders).
- Confirm by grep that no other restart-options-building site for architects exists in the file. The two known sites are the reconciliation path and the per-workspace status path.

#### Acceptance Criteria
- [ ] When a sibling's claude process exits with a non-permanent code and shellper restarts it, the new process's env contains `CODEV_ARCHITECT_NAME=<sibling-name>`
- [ ] A builder spawned by the restarted sibling has `spawningArchitect = <sibling-name>` (asserts identity preservation end-to-end)
- [ ] `main`'s restart behaviour unchanged
- [ ] Existing reconciliation tests still pass

#### Test Plan
- **Unit Tests**: unit-test the restart-options builder by extracting the env construction into a small helper (or asserting on the constructed options object). Cases: `role_id = 'ob-refine'` → env has `CODEV_ARCHITECT_NAME=ob-refine`; `role_id = null` → env has `CODEV_ARCHITECT_NAME=main`.
- **Integration Tests**: in the reconciliation test suite, simulate a shellper auto-restart for a sibling and assert the restart command was invoked with the correct env.
- **Manual Testing**: spawn a workspace, add `ob-refine`, spawn a builder from it, kill the claude process inside the sibling's PTY (use the existing dev tooling), wait for auto-restart, spawn another builder, assert it tags `spawningArchitect = ob-refine` via `state.db.builders.spawned_by_architect`.

#### Rollback Strategy
Revert the commit. The two-line addition is trivially reversible. No data migration needed.

#### Risks
- **Risk**: Other code paths construct `restartOptions.env` for architects and were missed.
  - **Mitigation**: grep for `restartOptions` in tower-terminals.ts and adjacent files. Currently only the two known sites exist.
- **Risk**: `dbSession.role_id` is unexpectedly null for `main` rows that were created before v13 backfill.
  - **Mitigation**: the `|| 'main'` fallback handles this. Test the fallback path explicitly.

---

### Phase 3: Graceful-stop persistence
**Dependencies**: Phase 1 (uses `clearRuntime()` from the split), Phase 2 (identity must be preserved or restart is pointless)

#### Objectives
- Make sibling architects survive `afx workspace stop` + `afx workspace start` (and `afx tower stop` + start).
- Distinguish intentional stop from permanent exit at the exit-handler level across the five identified locations.
- Modify `launchInstance` to boot `main` AND reconcile any persisted siblings, instead of only-create-main.

#### Deliverables
- [ ] Exit handlers at `tower-instances.ts:452-462`, `:507`, `:777-793`, `:830-846` and `tower-terminals.ts:665-677` honour an "intentional stop" signal that suppresses the `setArchitectByName(name, null)` row deletion; permanent-exit semantics (max-restart exhaustion) still delete rows per OQ-B
- [ ] `stopInstance` (`tower-instances.ts:555-625`) marks the workspace as "intentionally stopping" before killing terminals, so the cascaded exit handlers see the flag. Replace the blanket `deleteWorkspaceTerminalSessions(resolvedPath)` call with a selective version that preserves the `architect` table rows (or refrains from deleting `terminal_sessions` rows whose `type === 'architect' && role_id !== 'main'` for the workspace — pick whichever is cleaner)
- [ ] `launchInstance` (`tower-instances.ts:316-555`) no longer gates `main` creation on `entry.architects.size === 0`. Replacement condition: `!entry.architects.has('main')` for main; for siblings, iterate persisted rows from `state.db.architect` and re-spawn each via the existing `addArchitect` code path
- [ ] `commands/stop.ts:42, :93` switches from `clearState()` to `clearRuntime()` (the registration-preserving variant from Phase 1)
- [ ] `handleWorkspaceStopAll` in `tower-routes.ts:~2061` explicitly remains a full wipe — confirmed and tested (assertion that after stop-all, both `main` and any siblings are gone)

#### Implementation Details
- **Intentional-stop flag**: simplest implementation is a per-workspace `Set<string>` of paths currently shutting down. **Cross-module access (per Claude iter-1 finding)**: of the five exit handlers, four live in `tower-instances.ts` and one lives in `tower-terminals.ts:665-677`. The flag therefore needs to be reachable from both files. Recommended seam: put the Set in `tower-instances.ts` as a module-scoped const and **export a getter** (`isIntentionallyStopping(workspacePath: string): boolean`). `tower-terminals.ts` imports the getter. `stopInstance` adds the path to the set before iterating kills; the set is cleared in `finally` after kills complete. Exit handlers call `isIntentionallyStopping(workspacePath)` and skip the `setArchitectByName(name, null)` call when true.
- Alternative: pass a per-kill "intentional" flag through `killTerminalWithShellper` to the PtySession's exit emit. This is more invasive but doesn't rely on shared state. The plan recommends the exported-getter approach for minimal blast radius; the builder may switch if they find a cleaner seam.
- **`launchInstance` reconciliation loop**: 
  - **Critical ordering constraint** (per Claude iter-1 finding + Codex iter-1 finding): `addArchitect()` at `tower-instances.ts:666` explicitly rejects with "Workspace not running" when `entry.architects.size === 0`. So calling `addArchitect()` from `launchInstance` BEFORE `main` is created would fail.
  - **Required order**: (1) Create `main` if `!entry.architects.has('main')` — same logic as today, just with the new gate condition. (2) Query `state.db.architect` for all rows whose `id !== 'main'`. (3) For each persisted sibling not already in `entry.architects`, call `addArchitect(workspacePath, name)` (which now passes the size>0 guard because `main` exists). The persisted `cmd` is read from the `architect` table row via `getArchitects()`.
  - **`main`-first ordering also satisfies Spec 761's `architectTabId` convention**: the first registered architect gets the bare `'architect'` id; subsequent ones get `architect:<name>`. By always creating `main` first, `main` reliably owns the bare id, and deep-link parsing stays stable. This is the pinned answer to Claude iter-1's "Phase 5 main-first ordering" question.
- **`deleteWorkspaceTerminalSessions` selectivity**: simplest implementation — leave the existing function alone and add a new `deleteWorkspaceTerminalSessionsExceptSiblings(workspacePath)` variant that runs `DELETE FROM terminal_sessions WHERE workspace_path = ? AND NOT (type = 'architect' AND role_id != 'main')`. `stopInstance` calls the new variant; `handleWorkspaceStopAll` keeps the existing full-wipe call.

#### Acceptance Criteria
- [ ] Integration test: add `ob-refine` → `afx workspace stop` → `afx workspace start` → `ob-refine` is in `entry.architects`, has a working PTY, is visible in dashboard
- [ ] Integration test: add `ob-refine` → spawn builder from it → `workspace stop` + `start` → builder still affinity-tagged → `afx send architect` from builder lands on `ob-refine` (this is the headline round-trip)
- [ ] Integration test: simulate max-restart exhaustion on `ob-refine` → row IS deleted from `state.db.architect` AND `terminal_sessions` (OQ-B behaviour), `afx send architect` from its builder falls back to `main`
- [ ] Regression test: `handleWorkspaceStopAll` → both `main` and siblings are gone after
- [ ] Regression: `main`'s existing behaviour unchanged in all scenarios

#### Test Plan
- **Unit Tests**: 
  - `tower-instances.test.ts` — mock the architect table; assert `launchInstance` calls `addArchitect` for each non-main persisted row, with main created first
  - `tower-instances.test.ts` — assert the intentional-stop flag suppresses the exit-handler's `setArchitectByName(null)` call
  - `tower-instances.test.ts` — assert the intentional-stop flag is cleared via `finally` even when a kill throws
- **Integration Tests** (live tower + sqlite — automated, per Codex iter-1 Co4):
  - **Workspace stop+start round-trip**: add sibling, `afx workspace stop`, `afx workspace start`, assert sibling reappears and is functional. (Codex iter-1 specifically called this out as needing automation, not just manual.)
  - **Tower stop+start round-trip**: add sibling, `afx tower stop`, restart Tower, assert sibling reappears. (Distinct from workspace stop+start — exercises a different shutdown path.)
  - **Crash recovery regression**: add sibling, SIGKILL Tower (simulated via the existing crash-recovery test harness), restart, assert sibling restored and identity preserved.
  - **`handleWorkspaceStopAll` full-wipe regression**: hit the `/api/workspaces/:enc/stop-all` endpoint with siblings present, assert both `main` and siblings are gone after.
  - **Permanent-exit auto-delete**: force max-restart on a sibling, assert `state.db.architect` row AND `terminal_sessions` row are both gone (OQ-B behaviour).
- **Non-functional timing assertions** (per Codex iter-1 Co4 + spec NFR):
  - Add 8 architects, `afx workspace stop`, `start`, time the reconciliation. Assert `<2s` total per the spec's NFR.
  - Time individual persistence write/delete operations. Assert `<100ms` each.
- **Manual Testing**: 
  - Real workspace with 2 siblings; `afx workspace stop` + `start`; verify dashboard
  - Permanent-exit simulation on a sibling (force max-restart by killing its claude N times)

#### Rollback Strategy
Revert the commit. `clearRuntime` from Phase 1 still works (just no caller). Stale `architect` rows from any test workspaces during the broken window can be cleaned with `sqlite3 .agent-farm/state.db "DELETE FROM architect WHERE id != 'main'"`.

#### Risks
- **Risk**: The intentional-stop flag is not cleared on error paths, leaving the workspace permanently "in shutdown" — future kills wouldn't delete rows that should be deleted.
  - **Mitigation**: use `try { ... } finally { intentionallyStopping.delete(path) }`. Add a unit test for the error path.
- **Risk**: `launchInstance`'s new reconciliation loop races with the existing `reconcileTerminalSessions()` startup path (which also restores architects). Double-restoration could corrupt the in-memory map.
  - **Mitigation**: idempotent checks — `if (!entry.architects.has(name))` before each `addArchitect`. Verify which path runs first at Tower startup and document.
- **Risk**: `handleWorkspaceStopAll` semantic change (we're confirming behaviour, not changing it) is misread by a test that expected the old "single architect" behaviour.
  - **Mitigation**: explicit regression test for the stop-all + multi-sibling case.

---

### Phase 4: `remove-architect` + dashboard close affordance + active-tab fallback + #764 label fix
**Dependencies**: Phase 1 (removeArchitect helper), Phase 3 (graceful-stop semantics in place; otherwise remove vs stop tangle)

#### Objectives
- Ship the user-facing lifecycle parity: a CLI command, an RPC, a Tower handler, a dashboard close button, a confirmation prompt, and an active-tab fallback.
- Fold in #764: solo-architect tab label restored to `'Architect'` when N=1.

#### Deliverables
- [ ] `packages/codev/src/agent-farm/commands/workspace-remove-architect.ts` — new command. Validates name is not `main`; calls Tower client method; reports success/failure
- [ ] `packages/codev/src/agent-farm/cli.ts` — register `workspace remove-architect <name>` subcommand mirroring the existing `workspace add-architect` pattern at `cli.ts:108-114` (lazy-import the command module, pass the parsed name)
- [ ] `packages/core/src/tower-client.ts` — new `removeArchitect(workspacePath, name)` client method; **REST transport** mirroring the existing `addArchitect` shape at `:201-230` — issues `DELETE /api/workspaces/:encoded/architects/:name` (REST-idiomatic). Re-exported via `packages/codev/src/agent-farm/lib/tower-client.ts` (no edit needed if the re-export is wildcard; otherwise add the type)
- [ ] `packages/codev/src/agent-farm/servers/tower-routes.ts` — register the new `DELETE /api/workspaces/:encoded/architects/:name` route; route handler decodes path params, calls `removeArchitect(workspacePath, name)` Tower-side handler, returns `{ success, error? }` JSON
- [ ] `packages/codev/src/agent-farm/servers/tower-instances.ts` — new `removeArchitect(workspacePath, name)` Tower-side handler: refuses `main`, refuses unknown names, kills the sibling's PTY (raising the intentional-stop flag from Phase 3 to suppress the cascaded auto-delete path, then explicitly deleting rows), removes from in-memory `entry.architects`, deletes `architect` row and `terminal_sessions` row
- [ ] `packages/dashboard/src/hooks/useTabs.ts:52` — `closable: name !== 'main'` (only `main` is non-closable; siblings always have close buttons. At N=1 main is the only architect, so it's non-closable by name anyway. Defensive `architects.length > 1` guard is unnecessary because main-by-name is sufficient)
- [ ] `packages/dashboard/src/components/ArchitectTabStrip.tsx` — **add close-button rendering** (per Claude iter-1 finding). Today the component renders only `<span className="tab-label">{tab.label}</span>` and has no close button at all, unlike `TabBar.tsx:48-64` which conditionally renders `&times;` when `tab.closable === true`. Add a matching conditional close-button render: `{tab.closable && (<span className="tab-close" onClick={...}>×</span>)}`. The click handler invokes the confirmation modal (next deliverable below) rather than directly calling remove. Without this addition, setting `closable: true` on the tab object would have no visible effect — flagged by Claude iter-1 as a gap in the original plan
- [ ] `useTabs.ts:buildArchitectTabs` — when `architects.length === 1`, the single architect's tab label is `'Architect'` (restoring pre-#762 behaviour, **folds #764**); when `architects.length > 1`, use `name`
- [ ] Dashboard click handler for the close-X opens a confirmation modal: "Remove architect `<name>`?" with informational text about in-flight builders (count + names if any). Confirm → calls `removeArchitect` RPC
- [ ] `useTabs` active-tab fallback: explicit logic — if `activeTabId === <removed-architect-tab-id>`, set `activeTabId` to `'architect'` (main's tab id per Spec 761's first-architect-is-bare design). The existing fallback at `:194` goes to `tabs[0]` which is `'work'` — that's wrong; new code is needed
- [ ] `main` tab has no close button (already handled by `closable: false` on its tab object)

#### Implementation Details
- **CLI**: model after `workspace-add-architect.ts`. Same arg parsing (`<name>`), client construction, error handling. `cli.ts` registration mirrors lines 108-114 (the `add-architect` subcommand block).
- **Client + route (REST)**: Tower uses REST endpoints, not JSON-RPC. Model after `addArchitect` at `tower-client.ts:201-230` (`POST /api/workspaces/:encoded/architects`). For remove, use `DELETE /api/workspaces/:encoded/architects/:name` — REST-idiomatic and avoids needing a request body. Returns `{ success: boolean; error?: string }`.
- **Tower handler**:
  ```
  if (name === 'main') return { ok: false, error: 'Cannot remove main architect' };
  if (!entry.architects.has(name)) return { ok: false, error: `Architect '${name}' not found` };
  intentionallyStopping.add(workspacePath); // suppress the auto-delete cascade
  try {
    await killTerminalWithShellper(manager, entry.architects.get(name));
    entry.architects.delete(name);
    setArchitectByName(name, null);
    deleteTerminalSession(name);  // or by terminal id, whichever matches existing patterns
  } finally {
    intentionallyStopping.delete(workspacePath);
  }
  return { ok: true };
  ```
  Note: intentional-stop flag prevents the cascaded exit handler from double-deleting (which is fine as a no-op but cleaner to skip).
- **Confirmation modal**: simple in-component modal in the dashboard. Lists `<name>` and in-flight builders count. Buttons: "Remove" / "Cancel". The informational text is non-blocking per OQ-A — the Remove button is always enabled.
- **Active-tab fallback**: in `useTabs`, after a sibling is removed from `state.architects`, check `activeTabId === <removed-tab-id>` (the id is `architect:<name>` per Spec 761). If yes, call `setActiveTabId('architect')`. Add to the existing `useEffect` that tracks tab changes.

#### Acceptance Criteria
- [ ] `afx workspace remove-architect ob-refine` succeeds; sibling gone from state, dashboard, in-memory map; corresponding terminal_sessions row gone
- [ ] `afx workspace remove-architect main` fails with "Cannot remove main architect"
- [ ] `afx workspace remove-architect nonexistent` fails with "Architect 'nonexistent' not found"
- [ ] Click X on sibling tab → confirmation modal appears with in-flight builders info
- [ ] Cancel → no change
- [ ] Confirm → architect removed end-to-end, active tab switches to `main` if removed sibling was active
- [ ] Solo architect (N=1) tab label is `'Architect'`; N=2 architect tabs are labelled by name
- [ ] Remove with in-flight builders: removal succeeds, builders' next `afx send architect` falls back to `main`
- [ ] No close button on `main` tab regardless of N
- [ ] Existing tests still pass (especially Spec 761's `buildArchitectTabs` tests — the N=1 label change may break one)

#### Test Plan
- **Unit Tests**:
  - CLI: test arg parsing, error reporting (mock the RPC)
  - Tower handler: test the four branches (success, main-rejection, unknown-rejection, in-flight-builders no-op)
  - `useTabs`: test N=1 label = 'Architect', N=2 labels = names; test `closable` flag per architect; test active-tab fallback to 'architect' when removed sibling was active
- **Integration Tests**:
  - Live: spawn workspace, add 2 siblings, remove one via CLI, assert state
  - Live: same flow via dashboard close button
- **Manual Testing (Playwright)**:
  - Render dashboard at N=1, N=2, N=3 architects; visually verify tab labels, close button presence/absence, modal interactions
- **Manual Testing (real workspace)**:
  - Add `ob-refine`, spawn builder from it, click close-X on `ob-refine` tab, confirm modal, verify removal, verify builder's `afx send architect` lands on main

#### Rollback Strategy
Revert the commit. The CLI command, RPC, dashboard modal, and useTabs changes are additive — removing them returns to the pre-phase state. Test workspaces with siblings created during testing can be cleaned by editing state.db directly if needed.

#### Risks
- **Risk**: Existing tests for `buildArchitectTabs` (added by Spec 761) hardcode `label: name` and break when N=1 label changes to `'Architect'`.
  - **Mitigation**: update those tests as part of this phase. Document the change in the commit message.
- **Risk**: Confirmation modal in the dashboard introduces a new pattern that conflicts with existing modal code.
  - **Mitigation**: grep for existing modal patterns first; reuse rather than introduce. Use the simplest pattern that works.
- **Risk**: Active-tab fallback to `'architect'` (main's bare id per Spec 761) fails when there's no architect at all (shouldn't happen — main is always present after Phase 3).
  - **Mitigation**: guard the fallback: if no architect tab exists, fall back to `'work'`. This is defensive; should be unreachable in practice.
- **Risk**: #764 label change for N=1 looks wrong in production where users are accustomed to seeing `main` label.
  - **Mitigation**: this is per architect's explicit instruction restoring pre-#762 behaviour. Manual visual verification at N=1 in Playwright is required (already in plan).

---

### Phase 5: Surface enumeration
**Dependencies**: Phase 4 (remove-architect must exist so tests can exercise it through the new enumeration surfaces)

#### Objectives
- Remove the v1 collapse logic so the workspace-terminals API returns one entry per architect.
- Make `loadState()` collection-aware so `afx status` Tower-down fallback works correctly.
- Update `afx status` to enumerate all architects.
- Confirm or pin the Tower /status API contract (extend existing shape vs. new `/architects` endpoint).

#### Deliverables
- [ ] `tower-terminals.ts:928-940` — replace the single-entry emission with `for (const [name, terminalId] of freshEntry.architects) { terminals.push({ type: 'architect', id: name === 'main' ? 'architect' : `architect:${name}`, label: name, url: `${proxyUrl}?tab=${name === 'main' ? 'architect' : `architect:${name}`}`, active: true, architectName: name, pid: <from PtySession>, port: <if any> }) }` (preserves Spec 761's first-architect-is-bare-id convention; main is always first per Phase 3's pinned ordering)
- [ ] **Tower /status API contract — extend terminal entries** (per Gemini iter-1 endorsement; avoids N+1 vs a separate `/architects` endpoint). Add optional `architectName?: string; pid?: number; port?: number` fields to terminal entries when `type === 'architect'`. Existing clients ignore unknown fields. Document the addition in `arch.md` (Phase 7)
- [ ] `packages/types/src/api.ts` (if shared types live there) and `packages/core/src/tower-client.ts` — extend `TowerWorkspaceStatus` / terminal-entry type with the new optional fields (per Codex iter-1 finding — missed in iter-1 plan)
- [ ] `packages/codev/src/agent-farm/types.ts` — extend the local `State` type with an `architects: ArchitectState[]` collection field (per Codex iter-1 finding — required for `loadState()` collection-aware result; keep the scalar `architect` field for legacy callers, populate it from `architects[0]` for backward-compat)
- [ ] `state.ts:loadState()` — populate the new `architects` collection from `SELECT * FROM architect`, sorted by `id === 'main' DESC` then by `started_at ASC` so `main` is always `architects[0]`. Keep the existing scalar `architect` shim pointing at `architects[0]`
- [ ] `packages/codev/src/agent-farm/commands/status.ts:86-92` — enumerate `state.architects` rather than reading `state.architect`. Tower-up mode reads from Tower API (using new `architectName/pid/port` fields); Tower-down mode reads from `state.db.architect` via the updated `loadState`. Show name + terminal_id always; show PID + port when Tower is running and the API exposes them; print "Tower not running" when in fallback
- [ ] Tests for each change

#### Implementation Details
- **v1 collapse removal**: replace the existing `if (freshEntry.architects.size > 0) { terminals.push({...single Architect entry}); }` with a `for` loop over `freshEntry.architects` (Map iteration order is insertion order, so `main` first when it was created first, then siblings — but with `launchInstance` changes in Phase 3, siblings may be restored before `main`; ensure ordering puts `main` first either by explicit sort or by always creating main first). The tab `id`/`url` follows Spec 761's `architectTabId` convention: first architect (by ordering) gets bare `'architect'`, rest get `architect:<name>`.
- **Tower /status API contract**: extend the terminal-entry shape with optional `pid?: number; port?: number; architectName?: string` fields, populated only when `type === 'architect'`. Existing clients ignore unknown fields. Document the addition in the API contract section of `arch.md` (Phase 7).
- **`loadState` collection-aware**: `state.ts` already has `getArchitects()` per `commands/stop.ts:60`. Use that or add an `architects` array to the `State` shape. Decide based on what reads more naturally at `status.ts`.

#### Acceptance Criteria
- [ ] Tower `/status` returns N architect entries when N are registered (instead of one collapsed entry)
- [ ] Dashboard renders the tabs correctly (regression check — Spec 761 tab rendering should keep working since it already iterates `architects`)
- [ ] `afx status` (Tower running): lists all architects by name with PID/port/terminal_id
- [ ] `afx status` (Tower stopped): lists all architects by name with cmd; PID/port omitted with "Tower not running" note
- [ ] No regression in `loadState`'s legacy scalar `architect` shim — existing callers still work
- [ ] All existing tests pass

#### Test Plan
- **Unit Tests**:
  - `tower-terminals.test.ts` — assert per-architect emission for N=1, N=2, N=3; assert id/url scheme (main → bare `architect`; siblings → `architect:<name>`)
  - `status-naming.test.ts` (existing) — extend to cover sibling enumeration in both modes
  - `state.test.ts` — `loadState` returns collection with `main` first
- **Integration Tests** (automated, per Codex iter-1 Co4):
  - Live: add 3 architects, run `afx status`, assert output matches expected (lists all 3 by name + PID + port + terminal_id)
  - Same, after `afx tower stop` (fallback mode) — should list all 3 by name + cmd, omit PID/port, note "Tower not running"
  - **Architect-to-architect routing (automated)**: add sibling `ob-refine`. From `main`'s PTY, send a message with target address `architect:ob-refine`. Assert the message is delivered to ob-refine's PTY (via the PTY's input buffer or output assertion). Reverse: from ob-refine's PTY, send to `architect:main`. Assert it lands on main. (Codex iter-1 specifically asked for this to be automated, not just manual.)
- **Manual Testing**: verify `afx status` output by eye in a real workspace

#### Rollback Strategy
Revert the commit. The Tower API extension is additive (new optional fields); rolling back removes the new fields, which clients ignore. The v1 collapse can be restored by reverting the loop change.

#### Risks
- **Risk**: A consumer of `/status` depends on the v1 single-architect entry shape.
  - **Mitigation**: grep all `/status` consumers (dashboard, VSCode extension, CLI, tests). Dashboard already iterates `state.architects` per Spec 761. VSCode extension changes in Phase 6 are still pending. Update any other consumer found.
- **Risk**: `loadState` scalar shim diverges from the new collection (e.g. removing main accidentally null-shims).
  - **Mitigation**: keep the scalar shim pointing at `architects[0]` (first registered, which is `main` after Phase 3). Test the shim explicitly.

---

### Phase 6: VSCode multi-architect surface
**Dependencies**: Phase 4 (remove RPC), Phase 5 (architect enumeration API)

#### Objectives
- Replace the singleton "Open Architect" tree item with an expandable "Architects" tree section, one entry per registered architect.
- Re-key VSCode terminal slots by architect name so each architect gets its own terminal instance.
- Add right-click "Remove Architect" context menu on sibling entries (NOT on `main`). **Confirm shape with architect at plan-approval gate** — the spec mentions the expandable section but doesn't pin the remove-UX path; the architect's plan-time note recommends right-click context menu.
- Decide and implement behaviour of `codev.referenceIssueInArchitect` Backlog inline-button (Gemini iter-3 note): always inject to `main`, or to the active/expanded architect. Recommend always inject to `main` (most conservative; preserves current Backlog UX).

#### Deliverables
- [ ] `packages/vscode/src/views/workspace.ts:getChildren` — replace the single architect TreeItem with an expandable "Architects" collapsible TreeItem; its `getChildren` fetches the architects list from Tower's API (per Phase 5's per-architect emission) and emits one TreeItem per architect
- [ ] Each architect TreeItem has `command: { command: 'codev.openArchitectTerminal', arguments: [name] }`
- [ ] `packages/vscode/src/terminal-manager.ts` — replace singleton `'architect'` key (at `:96, :116, :333`) with per-name keys (e.g. `architect:<name>`). `openArchitectTerminal(name)` looks up by `architect:${name}`; `injectArchitectText(name, text)` similarly
- [ ] `packages/vscode/src/extension.ts` — register the parameterised `codev.openArchitectTerminal` command accepting `(name: string)` and routing to terminal-manager. Also register new `codev.removeArchitect` command accepting `(name: string)` that invokes the REST endpoint from Phase 4
- [ ] `packages/vscode/package.json` (per Codex iter-1 finding — missed in iter-1 plan): contribute the new `codev.removeArchitect` command in `contributes.commands`, and add a `menus['view/item/context']` entry that exposes the command on `viewItem == workspace-architect-sibling` only. Update the existing `codev.openArchitectTerminal` command contribution to accept an argument
- [ ] Right-click context menu: add "Remove Architect" action on architect TreeItem with `contextValue: 'workspace-architect-sibling'`; main's TreeItem uses `contextValue: 'workspace-architect-main'` (no remove menu). The remove action calls the new `codev.removeArchitect` command which invokes the REST endpoint from Phase 4
- [ ] `codev.referenceIssueInArchitect` — always injects to `main`. Document this decision in the code comment
- [ ] When a sibling is removed while its VSCode terminal is open, the existing PTY exit-handling path closes the terminal gracefully (per spec MUST). No additional code needed; verify in test

#### Implementation Details
- **TreeView refactor**: `WorkspaceProvider.getChildren(element?)` becomes hierarchical. When `element === undefined` (root), return `[architectsRoot, openWebInterface, spawnBuilder, ...]` where `architectsRoot` is a collapsible TreeItem. When `element === architectsRoot`, fetch architects (via Tower API call), return one TreeItem per architect.
- **Right-click menu**: in `package.json` (the VSCode extension's), add a `menus` entry for `view/item/context` with `when: viewItem == workspace-architect-sibling` and `command: codev.removeArchitect`. Register the command in `extension.ts` to call the RPC. Show a confirmation dialog in VSCode (`vscode.window.showInformationMessage` with modal).
- **Terminal-slot keying**: search & replace `'architect'` (the literal string) with `architect:${name}` in `terminal-manager.ts`. Update all three sites (open, inject, group-routing).

#### Acceptance Criteria
- [ ] Open VSCode in a workspace with 1 architect (just main): sidebar shows "Architects" expandable section; expanding reveals "main" entry; clicking opens main's terminal
- [ ] Add a sibling via CLI: sidebar refreshes (or after manual refresh) to show the sibling as a child of "Architects"; clicking opens its terminal
- [ ] Right-click on sibling entry: "Remove Architect" appears; clicking triggers confirmation; confirm → architect removed
- [ ] Right-click on main entry: no "Remove Architect" option
- [ ] `codev.referenceIssueInArchitect` (Backlog inline button): always targets main, regardless of how many architects exist
- [ ] When a sibling is removed, the VSCode terminal showing its PTY transitions to closed state gracefully

#### Test Plan
- **Unit Tests**: 
  - `workspace.ts` — mock the architect list; assert tree structure
  - `terminal-manager.ts` — assert per-name keying (open `main` and `sibling` → two separate terminal slots; opening same architect twice → reuses)
- **Integration Tests** (against a live Tower):
  - VSCode extension test: spawn workspace, add sibling, refresh tree, verify children
- **Manual Testing**: 
  - Visual inspection of VSCode sidebar at N=1, N=2, N=3
  - Right-click remove flow end-to-end
  - Backlog inline button injects to main even with siblings active

#### Rollback Strategy
Revert the commit. The VSCode extension changes are isolated to the extension package and don't affect the rest of the system.

#### Risks
- **Risk**: The VSCode TreeView API may not refresh cleanly when architects are added/removed. The existing `changeEmitter` pattern from `workspace.ts:40` should handle it, but verify.
  - **Mitigation**: hook into the same envelope-update path that other workspace updates use. Test add/remove → refresh end-to-end.
- **Risk**: Right-click remove UX (architect plan-time note — not yet confirmed) — architect may want a different shape (modal, command palette, etc.).
  - **Mitigation**: confirm with architect at plan-approval gate before implementing.
- **Risk**: `codev.referenceIssueInArchitect` decision (always-main) may surprise users who explicitly want the inline button to target an active sibling.
  - **Mitigation**: document the choice in the code comment and the CHANGELOG. If users complain, file a follow-up to add a chooser. For #786 ship, always-main is the conservative call.

---

### Phase 7: Documentation + verify-phase scaffolding
**Dependencies**: Phase 6 (everything implemented; docs reflect actual behaviour)

#### Objectives
- Update user-facing docs to describe the new lifecycle commands and persistence model.
- Add a manual verify-phase scenario document so future maintainers can re-run the headline round-trip.
- Update arch.md to capture the multi-architect lifecycle.

#### Deliverables
- [ ] `codev/resources/commands/agent-farm.md` — new sections for `workspace add-architect` and `workspace remove-architect` with examples; document the `architect:<name>` address grammar; document `autoNumberArchitectName` behaviour
- [ ] `codev/resources/arch.md` — update the Tower / architect section to describe multi-architect lifecycle, persistence (graceful-stop vs permanent-exit), identity preservation on restart, and the right-pane vs left-pane vs architect-strip distinctions
- [ ] CLI `--help` text for `workspace remove-architect` (and any flag additions to `workspace add-architect` — none expected)
- [ ] `CHANGELOG.md` — entry under the next release describing the new lifecycle commands and persistence behaviour change. Note breaking-ish change: `commands/stop.ts` now preserves architects across stops (callers depending on the old wipe behaviour need to switch to `workspace stop-all` or call `clearState()` directly)
- [ ] `codev/projects/786-multi-architect-feature-is-und/verify-scenarios.md` — manual verify-phase script with each scenario, expected output, and a checklist (the headline round-trip, persistence round-trip, crash recovery, permanent exit, naming validation, architect-to-architect, surface enumeration, dashboard UX, VSCode UX)

#### Implementation Details
- Docs are text-only; no code changes.
- Verify-scenarios doc should be runnable: a builder reading it should be able to walk through each scenario with shell commands and visual checks.

#### Acceptance Criteria
- [ ] All docs updated to reflect current state (post-#786)
- [ ] CHANGELOG entry written
- [ ] Verify-scenarios document committed and referenced from the review

#### Test Plan
- Docs review: read each updated doc end-to-end; check for consistency
- No automated tests for docs; this is the verify-phase preparation

#### Rollback Strategy
Revert the commit. Docs revert to pre-#786 state.

#### Risks
- **Risk**: Docs diverge from code if someone changes code after this phase without updating docs.
  - **Mitigation**: that's a general repo hygiene concern; not specific to this phase.

## Dependency Map

```
Phase 1 (utilities) ────┐
                         ├─→ Phase 3 (graceful stop) ──→ Phase 4 (remove + UX + #764) ──→ Phase 5 (surface enum) ──→ Phase 6 (VSCode) ──→ Phase 7 (docs)
Phase 2 (identity)  ────┘
```

Phase 1 and Phase 2 are independent and could be done in parallel; the plan lists them sequentially for commit-ordering simplicity.

## Resource Requirements
### Development Resources
- **Engineers**: builder for #786 (this plan)
- **Environment**: standard codev dev workspace

### Infrastructure
- No new services
- No schema migration (the `architect` table schema is v9 from Spec 755 and is correct)
- No configuration updates required

## Integration Points
### External Systems
- None (single-workspace scope holds)

### Internal Systems
- **Tower**: in-memory architect map + lifecycle handlers
- **state.db**: architect + terminal_sessions tables
- **Shellper**: auto-restart env path (Phase 2)
- **Dashboard**: useTabs, ArchitectTabStrip, TabBar
- **VSCode extension**: workspace TreeView, terminal-manager, commands
- **CLI**: workspace add/remove/stop, status

## Risk Analysis
### Technical Risks
| Risk | Probability | Impact | Mitigation | Owner |
|------|------------|--------|------------|-------|
| Intentional-stop flag leaks (not cleared on error) | Medium | Medium | try/finally + tests | builder |
| `launchInstance` reconciliation races with `reconcileTerminalSessions` startup | Medium | Medium | idempotent checks; document ordering | builder |
| v1 collapse removal breaks an unknown consumer | Low | Medium | grep all `/status` consumers before change | builder |
| VSCode TreeView refresh on add/remove flakes | Medium | Low | use existing changeEmitter pattern; test add+remove cycle | builder |
| Existing useTabs tests break on N=1 label change (#764 fold-in) | High | Low | update tests as part of Phase 4 | builder |
| Tower API contract extension breaks an external consumer | Low | Medium | additive optional fields only | builder |

### Schedule Risks
- No time estimates per SPIR. Schedule risk is per-phase: Phase 3 is the largest and most likely to surface integration issues; Phase 6 is constrained by the architect's plan-approval call on the remove-UX shape.

## Validation Checkpoints
1. **After Phase 1**: utilities are pure and unit-tested; no behaviour change yet
2. **After Phase 2**: identity-on-restart verified via the builder-spawning test
3. **After Phase 3**: full headline round-trip works (add sibling, stop+start, builder→sibling routing intact). This is the highest-leverage checkpoint
4. **After Phase 4**: remove-architect end-to-end works, dashboard close button works, #764 label fix is visible
5. **After Phase 5**: `afx status` shows all architects
6. **After Phase 6**: VSCode sidebar parity
7. **Before Production (Verify phase)**: manual verify-scenarios run on a real workspace per `verify-scenarios.md`

## Monitoring and Observability
- No new metrics. The feature is debugged via existing dashboard + `afx status` + `state.db` inspection.

## Documentation Updates Required
- [x] CLI documentation (Phase 7)
- [x] Architecture documentation (Phase 7)
- [ ] API documentation (per Tower /status contract addition in Phase 5; covered in Phase 7)
- [x] CHANGELOG (Phase 7)
- [x] Manual verify-scenarios doc (Phase 7)

## Post-Implementation Tasks
- [ ] PR opened against `main` after Phase 7 commits land
- [ ] CMAP review of PR (`pr` gate via porch)
- [ ] Architect review at PR gate
- [ ] After merge: verify-phase execution on a real workspace (the manual round-trip and all spec test scenarios)

## Expert Review

**Iter-1 CMAP (2026-05-22)**:
- **Gemini**: APPROVE. Endorsed three implementation choices: VSCode right-click context menu for remove, Tower `/status` extension over a sibling endpoint, and `clearState` split via new `clearRuntime()` function. No key issues.
- **Codex**: REQUEST_CHANGES, all addressed in iter-2:
  1. Phase 3 `launchInstance` seam — `addArchitect()` rejects when N=0, so plan now pins explicit ordering: create `main` first via the existing in-line code, then iterate persisted siblings and call `addArchitect()` once `main` exists.
  2. Transport correction — REST routes (`DELETE /api/workspaces/:encoded/architects/:name`), not JSON-RPC envelopes. Plan now describes the actual route shape.
  3. Missing file deliverables added: `cli.ts` registration, `packages/codev/src/agent-farm/types.ts` `architects` field, `packages/types/src/api.ts` + `packages/core/src/tower-client.ts` status-response type updates, VSCode `package.json` command + menu contribution.
  4. Automated test coverage added explicitly for: architect-to-architect routing, Tower stop+start (distinct from workspace stop+start), crash recovery regression, non-functional timing assertions (<2s rebind, <100ms persistence). Previously some were manual-only.
- **Claude**: COMMENT, all addressed in iter-2:
  1. `ArchitectTabStrip.tsx` needs explicit close-button rendering — added to Phase 4 deliverables (component currently has no X render at all, unlike `TabBar.tsx:48-64`).
  2. Intentional-stop flag cross-module access — plan now pins exported-getter pattern from `tower-instances.ts` consumed by `tower-terminals.ts`.
  3. Phase 5 `main`-first ordering pinned in Phase 3's reconciliation loop (create `main` first, then siblings) — this also satisfies Spec 761's `architectTabId` bare-id convention.

## Approval
- [ ] Architect Review (plan-approval gate)
- [ ] Expert AI Consultation Complete

## Change Log
| Date | Change | Reason | Author |
|------|--------|--------|--------|
| 2026-05-22 | Initial plan draft | First version after spec approval | builder/spir-786 |

## Notes

**Open question for architect at plan-approval gate (carried from spec phase):**
- **VSCode remove-architect UX path** — spec mentions the expandable Architects section but doesn't pin how a user removes a sibling from VSCode. Plan recommends right-click context menu on the architect entry → "Remove Architect" action; `main` gets no remove menu item. Confirm at plan-approval.

**Implementation order recommendation**: builder may freely reorder Phase 1 and Phase 2 (independent). Other phases must execute in listed order.

**PR strategy** (per builder-role guidance): all phases ship in a single PR by default. The cumulative branch is opened as one PR after Phase 7. The architect may request a mid-implementation PR for review — the natural mid-checkpoint is after Phase 3 (the highest-leverage server-side change is done; remaining work is user-facing surfaces).
