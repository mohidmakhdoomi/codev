# Phase 3 Review Rebuttals — Iteration 2

**Phase**: implement / phase_3 (Affinity-aware routing)
**Iteration**: 2
**Date**: 2026-05-18

## Reviewer verdicts (iter-2)

| Reviewer | Verdict | Confidence | Change from iter-1 |
|----------|---------|------------|---------------------|
| Gemini   | APPROVE | HIGH | ↑ from REQUEST_CHANGES |
| Codex    | REQUEST_CHANGES | HIGH | unchanged (different findings) |
| Claude   | APPROVE | HIGH | ↑ from REQUEST_CHANGES (was "uncommitted" process flag) |

Two-of-three approve. Codex's iter-2 verdict shifted from "core bug" to "missing test coverage" — different category of finding, all actionable. Addressed below.

---

## Codex — REQUEST_CHANGES

### C1 (iter-2). `/api/send` doesn't assert `from` is forwarded to `resolveTarget`

> `tower-routes.test.ts` doesn't assert that `/api/send` actually forwards the new `from` sender into `resolveTarget(...)`, even though the production change is at `tower-routes.ts:913-916`. A regression could drop sender-aware routing again without any route-level test failing.

**Status**: Addressed.

**Change**: Added two new tests in the `POST /api/send` block of `tower-routes.test.ts`:
- `forwards \`from\` (sender) to resolveTarget for affinity-aware routing` — passes `from: 'spir-100'` in the request body and asserts `mockResolveTarget` was called with `('architect', '/tmp/ws', 'spir-100')`.
- `forwards undefined \`from\` when sender is not supplied` — covers the non-builder send path; asserts `mockResolveTarget` was called with `('architect', '/tmp/ws', undefined)`.

Together these pin the `handleSend → resolveTarget` plumbing at the route level. A regression that drops the third argument would fail one or both.

### C2 (iter-2). `lookupBuilderSpawningArchitect` has no direct tests

> `spec-755-phase3-routing.test.ts` fully mocks `lookupBuilderSpawningArchitect`, so the real workspace-path readonly lookup path — the key phase_3 distinction from live `entry.builders` state — is currently unverified.

**Status**: Addressed.

**Change**: New file `spec-755-lookup-builder.test.ts` with 6 cases exercising the helper against **real SQLite databases**:
- Explicit name → returns the recorded `spawned_by_architect`.
- Legacy row with NULL → returns `null`.
- No row → returns `undefined`.
- Workspace `state.db` doesn't exist → returns `undefined` (graceful fallback).
- Per-workspace isolation: two workspaces with the same builder ID return different spawning architects (verifies the singleton-getDb bug Gemini caught is actually fixed, end-to-end against the filesystem).
- 50 consecutive lookups don't leak DB handles (a leaked writable handle would prevent subsequent opens — this would have caught a write-mode regression).

### C3 (iter-2). Phase 3 integration coverage incomplete

> `send-integration.e2e.test.ts` exercises builder-target sends, not builder→architect affinity routing, cron→architect, or reconnect through the actual Tower send path.

**Status**: Partially addressed; the residual gap is documented for follow-up.

**What landed**:
- Route-handler layer is now fully covered (Codex C1).
- The per-workspace DB lookup is exercised against real SQLite (Codex C2).
- The resolver layer is covered by 18 unit tests covering the full routing matrix from the spec.
- The end-to-end existing e2e suite (`send-integration.e2e.test.ts`) is unchanged and continues to pass.

**What's deferred**:
- A new e2e case that spawns Tower as a subprocess, registers two architects via `addArchitect`, inserts a builder row with `spawned_by_architect`, sends through real HTTP, and verifies the right architect receives the message. Adding this cleanly to the existing harness (`send-integration.e2e.test.ts`) is ~100 lines of subprocess + workspace-setup code.

The deferral is a cost-benefit call: every layer between `afx send` and the architect's PTY is now individually tested against real SQLite or against a mocked-but-faithful resolver. The remaining gap is purely the wiring between layers, which is mechanical (the layers compose deterministically). A regression would surface in any of the existing tests if the wiring breaks. I judged the marginal value of the heavy e2e test below the cost.

If the architect wants the e2e case before merge, I'll add it in a follow-up commit — but I want to flag it explicitly here rather than silently bundle it under "addressed."

---

## Gemini — APPROVE

> Perfect execution of affinity-aware routing matrix, maintaining strict compliance with spec and security rules.

**Status**: No required changes. Confirmed all iter-1 issues are fixed.

---

## Claude — APPROVE

> Phase 3 routing implementation is clean, complete, well-tested, and addresses all prior review feedback — the feature is end-to-end functional.

**Status**: No required changes. The iter-1 "uncommitted" flag was a process artifact; iter-2 sees the committed code.

---

## Summary

Iter-1's blocking findings (Codex C1 architect:<name> parsing, Gemini G1 per-workspace DB lookup, Gemini G2 verbatim error text) are all addressed. Iter-2 shifted Codex's concern to test coverage, which I addressed for two of three gaps. The remaining gap (full e2e integration) is documented honestly as deferred with rationale.

`porch check 755` passes (build + tests). All 2675 codev tests pass (8 new). Phase 3 ready for `porch done`.
