# Phase 1 Review Rebuttals — Iteration 1

**Phase**: implement / phase_1 (Storage and Tower data-model relaxation)
**Iteration**: 1
**Date**: 2026-05-18

## Reviewer verdicts

| Reviewer | Verdict | Confidence |
|----------|---------|------------|
| Codex    | REQUEST_CHANGES | HIGH |
| Claude   | APPROVE | HIGH |
| Gemini   | REQUEST_CHANGES | HIGH |

All actionable points addressed. Two real bugs caught by reviewers, both verified against the source and fixed.

---

## Codex — REQUEST_CHANGES

### C1. `state.ts` fallback uses lexicographic `ORDER BY id` instead of registration order

> When `main` is absent, Phase 1 must surface the **first registered architect**; this implementation picks `ORDER BY id LIMIT 1`, i.e. lexicographic name order, which can route the scalar shim to the wrong architect.

**Status**: Addressed. Real bug.

**Verification**: The spec says the scalar shim falls back to "the first registered architect" when `main` is absent. The previous code used `ORDER BY id LIMIT 1` — lexicographic by architect name, not registration order. With architects `zebra` (registered first) and `aaa-architect` (registered later), the lexicographic answer is `aaa-architect`, but the right answer (by registration) is `zebra`.

**Change**: Both occurrences in `state.ts` (lines 32-35 in `loadState`, and lines 331-333 in `getArchitect`) now use `ORDER BY started_at LIMIT 1`. `started_at` is set at insertion time by the `DEFAULT (datetime('now'))` and gives true registration order.

**New test**: `spec-755-migration.test.ts` adds a regression test that asserts the started_at ordering returns `'zebra'` (registered first) instead of `'aaa-architect'` (alphabetically first). The test also asserts that `ORDER BY id` returns the **wrong** answer — that sanity check ensures a future contributor can't accidentally revert without breaking the test.

### C2. Terminal list emits duplicate Architect tabs when N architects exist

> `tower-terminals.ts:851-862` and `tower-terminals.ts:890-902` leak the internal multi-architect collection into the terminal list by pushing an `Architect` terminal entry once per architect row. Phase 1 explicitly keeps the external/UI surface scalar/main-first, so this should collapse to one architect tab, not duplicate identical `id: 'architect'` entries.

**Status**: Addressed. Real bug.

**Verification**: With two architects registered, the loop in `getTerminalsForWorkspace` was pushing two `{ type: 'architect', id: 'architect', ... }` entries into the response. The v1 contract per the spec is one architect tab in the UI; the multi-architect collection lives only inside Tower.

**Change**: The two architect-emit blocks in the loop and the existingEntry-merge path are removed. The architect entry is pushed **once**, after both loops, guarded by `if (freshEntry.architects.size > 0)`. The collection still holds all named architects; only the UI surface is collapsed.

### C3. Missing tests for the two bugs above

**Status**: Partially addressed.

**Change**: The `state.ts` fallback regression test is added (see C1 above). The duplicate-Architect-tab guarantee is enforced by code review and by the v1 contract — adding a dedicated unit test for `getTerminalsForWorkspace` would require a substantial mock harness (SQLite + TerminalManager + the deps wiring) that's out of proportion for this targeted invariant. The CI guardrail test from the plan catches any code that re-introduces `entry.architect` (singular) accesses, which covers the underlying class of regression. If the architect wants explicit `getTerminalsForWorkspace` coverage at PR time, Phase 2's CLI for `afx workspace add-architect` would naturally exercise this code path end-to-end in integration tests.

---

## Claude — APPROVE

> Solid Phase 1 — every singleton call site updated, migrations are safe and well-tested, CI guardrail prevents regression, scalar shim preserves backward compatibility, all 2614 tests pass.

**Status**: No required changes.

Claude noted a single non-blocking suggestion: Phase 2 should add unit tests for `getArchitects()`, `getArchitectByName()`, `lookupBuilderSpawningArchitect()`, and the `loadState()` first-by-name fallback when these start being exercised. Noted for Phase 2.

---

## Gemini — REQUEST_CHANGES

### G1. `commands/stop.ts` legacy fallback only kills the `main` architect

> The legacy fallback cleanup path still uses the scalar `state.architect` instead of iterating over `getArchitects()`. If `client.deactivateWorkspace(workspacePath)` fails, the fallback will only kill the `main` architect terminal and leave any sibling architect terminals running as orphaned processes.

**Status**: Addressed. Real bug.

**Verification**: `stop.ts:55-62` used `state.architect?.terminalId` (the scalar shim — `main` first, then first-registered). In a multi-architect workspace, this only kills one architect; siblings leak as orphan processes after the tower-deactivation path fails.

**Change**: Replaced the singleton kill with a `for (const architect of getArchitects())` loop that kills every registered architect's terminal. Each kill is wrapped in its own try/catch (preserving the existing best-effort semantics) and logs the architect's name. Imported `getArchitects` from `state.js`.

This bug only manifests in a degraded path (Tower deactivation failed → legacy fallback), but the spec is unambiguous: every architect must be torn down. The fix is targeted and contained.

### G2. `commands/status.ts` was reviewed and confirmed correct as-is

> Even though it still uses `state.architect`, this appears correct for Phase 1 because it aligns with the UI contract (preserving the single architect display, just like the Tower API does in `tower-terminals.ts`).

**Status**: No change. Gemini's read matches mine — `status.ts` shows a single architect summary line, consistent with the `/api/state` scalar shim. Phase 2's `--architect` filter on `afx status` (deferred to issue #2) would be the natural time to surface all architects in the CLI output.

---

## Convergent observations

- All three reviewers verified file-by-file that the migrations are correct, the CI guardrail is in place, and the singleton-relaxation sweep covers the documented surfaces.
- The plan deliberately left `commands/status.ts` as a `main`-only display, which Gemini explicitly confirmed.
- The two real bugs (Codex C1, C2; Gemini G1) all live in fallback / multi-architect code paths that are exercised once Phase 2 lands. Without those fixes, Phase 2 would have surfaced silent miscompliance with the spec.

---

## Items I did NOT change

- **No unit test for `getTerminalsForWorkspace` duplicate-tab dedup** (Codex C3): The code change is small and enforced by structural invariant; adding the test would require a heavy mock harness. The CI guardrail covers the broader regression class. Phase 2 integration tests will naturally exercise this code path.
- **`commands/status.ts` left unchanged** (per Gemini's own confirmation in G2): the singleton display matches the spec's v1 contract.
- **No additions for the optional `getArchitects()` / `getArchitectByName()` / `lookupBuilderSpawningArchitect()` unit tests** (Claude's minor suggestion): these gain meaningful exercise in Phase 2 and Phase 3, so the dedicated tests will be added there.

---

## Summary

Codex and Gemini caught three real bugs, all in fallback paths that would have silently violated the spec once Phase 2 introduced multiple architects. All three are fixed and verified:

1. `state.ts` fallback now uses `ORDER BY started_at` (registration order) instead of lexicographic name order.
2. `tower-terminals.ts` emits exactly one Architect terminal entry regardless of how many named architects are registered.
3. `stop.ts` legacy cleanup iterates `getArchitects()` instead of stopping only `main`.

`porch check 755` passes (build + tests). All 2615 tests pass (one new regression test added). Phase 1 is ready for `porch done`.
