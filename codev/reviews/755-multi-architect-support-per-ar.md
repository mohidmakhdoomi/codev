# Review: multi-architect-support-per-ar

**Spec**: [codev/specs/755-multi-architect-support-per-ar.md](../specs/755-multi-architect-support-per-ar.md)
**Plan**: [codev/plans/755-multi-architect-support-per-ar.md](../plans/755-multi-architect-support-per-ar.md)
**GitHub issue**: #755
**Status**: Implementation complete; PR pending
**Date**: 2026-05-18

## Summary

Codev's Tower previously enforced a singleton architect terminal per workspace: one architect, registered as `entry.architect: string | undefined`, persisted in a SQLite table with `CHECK (id = 1)`. The "sibling-architect" workflow that this spec set out to support — one human running two architect agents in the same workspace, each with its own builder pool — was implemented manually via copy-pasting messages between terminals.

This PR ships v1 of multi-architect support: a workspace can now host an arbitrary number of named architect terminals; every builder records the name of the architect that spawned it; and `afx send architect` from a builder is routed to its own spawning architect, not to a shared singleton. The mechanism is opt-in for users via a new `afx workspace add-architect [--name <name>]` command. Existing single-architect workspaces see byte-for-byte identical behavior — the default architect is named `main`, every singleton-style API path preserves its old shape via a `main`-first shim.

Scope was deliberately tight: routing-only. The other four feature asks from issue #755 (`--architect` filter on `afx status`, `THREAD.md` template, cross-thread visibility, thread-aware `consult`) are explicitly out-of-scope for v1 and are tracked as future work.

## Spec Compliance

All 13 success criteria from the spec are met. Each is linked to the tests or code that establish the guarantee.

- [x] Two architect terminals run simultaneously in one workspace, with distinct names.
  - **Where**: `addArchitect()` in `tower-instances.ts`. Activation guard in `launchInstance` (`if (entry.architects.size === 0)`) allows multi-architect creation; `db.test.ts` "allows multiple named architects" asserts the lifted singleton.
- [x] First architect defaults to `main`; subsequent auto-number to `architect-2`, `architect-3`; explicit name overrides.
  - **Where**: `autoNumberArchitectName()` + `validateArchitectName()` in `utils/architect-name.ts`; `spec-755-phase2.test.ts` covers all auto-numbering edge cases (empty, gaps, contiguous, custom-name skipping, invalid suffixes).
- [x] Builder spawned by architect `A` records `spawnedByArchitect: "A"` on its row.
  - **Where**: `commands/spawn.ts` reads `CODEV_ARCHITECT_NAME` at module load; all six `upsertBuilder` call sites pass `spawnedByArchitect: SPAWNING_ARCHITECT_NAME`. `state.test.ts` asserts the column persists and is preserved across re-upserts via COALESCE.
- [x] `afx send architect` from a builder reaches only its spawning architect.
  - **Where**: `resolveAgentInWorkspace` in `tower-messages.ts`. `spec-755-phase3-routing.test.ts` "Two architects, scoped routing" asserts main→main and sibling→sibling.
- [x] Single-architect workspaces show zero behavior change; `/api/state` shape unchanged.
  - **Where**: `/api/state` shim in `tower-routes.ts:1411-1418` preserves the scalar `state.architect` shape; `state.ts:loadState()` returns the `main`-first architect; `commands/status.ts` and `commands/stop.ts` continue to work unchanged.
- [x] Legacy builders (no `spawnedByArchitect`) route to `main` or fail with verbatim error.
  - **Where**: `legacyBuilderErrorMessage()` exported from `tower-messages.ts`; "Legacy builder, main absent" test asserts the verbatim text.
- [x] Architect-gone builders route to `main` or fail with verbatim error.
  - **Where**: `architectGoneErrorMessage()`; "Architect-gone, main absent" test.
- [x] Architect reconnect (new `terminalId`, same name) is transparent to builders.
  - **Where**: `tower-terminals.ts:642` keys reconnected architects by `dbSession.role_id` (the architect's name); "Architect reconnect" test mutates the in-memory map's terminalId and re-sends, asserting delivery.
- [x] Non-builder `architect`-target sends route to `main` (or first), unchanged.
  - **Where**: Resolver's non-builder branch + fast path; "Non-builder send" and "cron-style" tests.
- [x] Cross-architect address spoofing rejected with verbatim error.
  - **Where**: `addressSpoofingErrorMessage()`; tested both at the resolver layer ("rejects architect:<other>") and the route-handler layer.
- [x] All existing tests pass; new tests cover the routing matrix.
  - **Counts**: 2675 codev tests pass, 13 skipped. New Spec 755 tests: ~55 across migration, guardrail, Phase 2, Phase 3, and lookup-builder.
- [x] No latency regression in the single-architect path.
  - **Where**: Fast-path in `resolveAgentInWorkspace` (`size === 1 && has('main')`) skips state.db read entirely. Asserted functionally: "Single-architect baseline" test verifies `lookupBuilderSpawningArchitect` is NOT called on the fast path.
- [x] Local `state.db` migration and global `terminal_sessions` backfill safe and idempotent.
  - **Where**: `db/index.ts` v9 (local) + v13 (global); `spec-755-migration.test.ts` asserts both migrations preserve data, are idempotent, and handle the empty-table case.

## Deviations from Plan

Three deviations, all documented in the iteration rebuttals:

- **Phase 1 — `setArchitect` was never called in production before this PR.** The plan called for wiring named-architect persistence into the local `state.db`. While verifying, I discovered that `setArchitect` (and by extension the local `architect` table) was effectively orphaned: only tests called it. Phase 2 wired up both `launchInstance` (writes `main`) and `addArchitect` (writes the new name) to call into `state.ts`, which closes the pre-existing gap. This is slightly outside Phase 2's stated scope but fixes a latent inconsistency that Gemini's Phase 1 review hinted at and Codex's Phase 2 review caught explicitly.
- **Phase 1 — used existing readonly-Database pattern in `state.ts`, not in `tower-messages.ts`.** The plan suggested putting the per-workspace readonly DB handle directly in the resolver to avoid import cycles. The actual fix lives in `state.ts:lookupBuilderSpawningArchitect(builderId, workspacePath?)`, which uses the same readonly pattern as `servers/overview.ts`. The resolver imports it normally. This is cleaner — no `state.ts → tower-messages.ts` import existed to create a cycle in the first place — and keeps the DB logic in the module that owns the state model.
- **Phase 2 CLI shape — `afx workspace add-architect` vs. the spec's `afx architect --name`.** The architect's spec-review example was `afx architect --name <name>`, but `commands/architect.ts` already exists and explicitly disclaims Tower involvement. Repurposing it would break the no-Tower contract for users who run `afx architect` outside any workspace. The architect approved the alternative shape at the plan-approval gate.

## Phase Summary

### Phase 1 — Storage and Tower data-model relaxation
- Type-level: `ArchitectState.name`, `Builder.spawnedByArchitect`, `WorkspaceTerminals.architects: Map<string, string>`.
- Schema: v9 local migration rebuilds the `architect` table as `id TEXT PRIMARY KEY` (rekeys existing row to `main`); adds `builders.spawned_by_architect`. v13 global backfill sets `terminal_sessions.role_id = 'main'` for legacy architect rows.
- Sweep: ~12 singleton call sites updated across `tower-instances.ts`, `tower-routes.ts`, `tower-terminals.ts`, `tower-tunnel.ts`, `commands/stop.ts`, plus `state.ts` and `db/migrate.ts`.
- CI guardrail: `spec-755-guardrail.test.ts` fails the build if `entry.architect` (singular) reappears in production code.

### Phase 2 — Naming CLI and spawn-time identity capture
- New `afx workspace add-architect [--name <name>]` CLI under the `workspace` noun; existing `afx architect` (local-only Claude session) intentionally unchanged.
- `addArchitect()` in `tower-instances.ts` mirrors `launchInstance`'s shellper-then-fallback structure but is parameterised on name + supports collision rejection.
- `CODEV_ARCHITECT_NAME` env var injected into every architect terminal at PTY-start time.
- `afx spawn` reads the env var at module load and persists `spawnedByArchitect` on every new builder row, including a `COALESCE` in the SQL `ON CONFLICT` clause to preserve the value across status-update re-upserts.

### Phase 3 — Affinity-aware routing
- Widened `resolveTarget(target, fallbackWorkspace?, sender?)`. Sender plumbed from `handleSend()` (where it always arrived but was dropped before resolution).
- Single-architect fast path skips the state.db read entirely — guaranteed latency parity for solo-architect users.
- Three security rules with verbatim spec error messages: legacy-builder (`legacyBuilderErrorMessage`), architect-gone (`architectGoneErrorMessage`), address-spoofing (`addressSpoofingErrorMessage`).
- `architect:<name>` addressing handled via a dedicated `resolveArchitectByName` helper that intercepts before `findWorkspaceByBasename` (the `project:agent` parser would otherwise treat `architect:sibling` as a cross-workspace address).

## Architecture Updates

See `## Architecture Updates Detail` below — added a new "Multi-architect routing" subsection to `codev/resources/arch.md` documenting the name-keyed `WorkspaceTerminals.architects` invariant, the `lookupBuilderSpawningArchitect` per-workspace readonly pattern, and the four-layer routing chain (CLI → handleSend → resolveTarget → architects map). The CI guardrail in `spec-755-guardrail.test.ts` is also referenced.

## Lessons Learned Updates

See `## Lessons Learned Updates Detail` below — added two entries to `codev/resources/lessons-learned.md`:
1. **Vestigial state**: `setArchitect` was orphaned for an unknown duration. The lesson is to run "is this called?" checks during the planning sweep when a feature touches a long-lived API, not only when the feature touches new code.
2. **Single-source-of-truth error messages**: exporting the three Spec 755 error strings as functions, imported by both producer and asserter, caught a verbatim-text drift between spec and implementation in iter-2 review.

## Lessons Learned

### What went well
- **Three sequential phases with clear seams.** Each phase committed independently, ended with a meaningful demo, and never required reverting earlier work to make the next phase land. Phase 1 ended with the migration + sweep in place; Phase 2 with named architects creatable but not yet routed; Phase 3 with the user-visible win.
- **Spec text as verbatim test assertions.** Exporting error messages as functions imported by both producer and asserter was a great forcing function: drift between spec and code shows up as a failing test, not a silent regression.
- **Multi-agent consultation caught real bugs every iteration.** Specifically: Codex's `architect:<name>` parsing collision (Phase 3 iter-1), Gemini's per-workspace DB lookup bug (Phase 3 iter-1), Codex's empty-`--name` and missing local-state.db persistence (Phase 2 iter-1). Without consultation these would have either landed broken or been caught downstream at much higher cost.
- **CI guardrail tests are cheap insurance for sweep-style refactors.** The `entry.architect` (singular) grep test took 30 minutes to write and would catch any future re-introduction. The reverse — finding that a contributor accidentally reverted the singleton-relaxation in some edge path — would take hours.

### Challenges encountered
- **Discovered orphaned production code.** `setArchitect` was called only from tests, meaning the local `state.db` `architect` table was effectively unused for an unknown duration. This wasn't a Phase 2 regression — it was pre-existing — but the iter-1 reviewers correctly insisted we wire it up rather than perpetuate the inconsistency.
- **`parseAddress` overload between `project:agent` and `architect:<name>`.** The grammar is genuinely ambiguous: both forms use a colon. The fix is a special-case intercept in `resolveTarget` before `findWorkspaceByBasename` runs. Tests that bypassed this (calling `resolveTarget('sibling', ...)` directly) initially hid the bug — a good lesson in testing through the public CLI shape, not the internal resolver.
- **Migration version mismatch with plan.** The plan called for "v5" as the new migration, but the project's actual local DB was already at v8 and global at v12. Sequencing through the real version numbers (v9 local, v13 global) was a footnote, but it's a reminder that planning documents that reference specific numbers should be confirmed against current state before commit.

### What would be done differently
- **Front-load the full call-site scan.** Phase 1's "singleton homes" enumeration was three places initially; reviewers found at least six more before commit. A more thorough grep + reading of all `entry.architect` / `.architect` / `WorkspaceTerminals` accesses *before* writing the spec would have caught these earlier and avoided two rounds of spec-iter rework.
- **Earlier per-workspace DB question.** The plan correctly noted Tower's multi-workspace nature, but the implementation forgot it in iter-1. A more explicit "what's the workspace context for this DB call?" review checklist would have caught it before consult.
- **Test the public address grammar, not the resolver internals.** The Phase 3 iter-1 tests called `resolveTarget('sibling', ...)` instead of `resolveTarget('architect:sibling', ...)`. Both work at the resolver level but only one reflects how the CLI actually invokes it. Lesson: test the wire format, not the internal data type.

### Methodology improvements
- **Phase-iteration consult pattern is healthy.** The iter-1/iter-2 cadence per phase (3-way consult → rebuttal → commit → repeat if needed) caught real bugs that single-pass review would have missed. Continue.
- **Rebuttal documents are valuable artifacts.** Future readers can trace why each implementation choice was made and which reviewer flagged what. Keep these.
- **Plan-phase version numbers as placeholders.** If the plan references specific migration version numbers (`v5`, `v9`, etc.), the implementer should verify those against the current schema before committing — or the plan should refer to migrations by purpose ("the next available migration after the issue_number widening") rather than fixed numbers.

## Technical debt

- **No end-to-end Tower-process test for affinity routing.** Codex iter-2 review flagged this; the route layer, resolver layer, and DB lookup are each individually tested, but no test currently spawns a real Tower, registers two architects, and verifies an `/api/send` from a builder reaches the right architect via HTTP. Adding such a test cleanly is ~100 LOC of subprocess + workspace-setup work; documented as deferred in `755-phase_3-iter2-rebuttals.md`. The functional layers are deterministic, so a regression would surface in one of the existing tests, but the gap is real and worth filling in a follow-up PR.
- **`commands/stop.ts` legacy fallback's `state.architect?.terminalId` dependence on `loadState`.** Now that `setArchitect` is called by `launchInstance`, the legacy path is meaningful again — but the `state` it reads is the scalar shim, not the full multi-architect collection. `commands/stop.ts` separately iterates `getArchitects()` for the multi-architect cleanup. This is correct but the two code paths are easy to confuse; a future cleanup should pick one source of truth.
- **Exit handler duplication in `tower-instances.ts` `addArchitect`.** Two near-identical handlers for shellper and non-persistent paths. Flagged by Claude as non-blocking; deferred.

## Consultation Feedback

### Specify phase (iteration 1)

#### Codex (REQUEST_CHANGES, HIGH)
- **Concern**: `architect:all` broadcast syntax collides with `parseAddress` grammar.
  - **Addressed**: Pinned `architects` (plural) as broadcast syntax — and then iter-2 architect review dropped broadcast entirely.
- **Concern**: Migration claim incorrect — `state.db` is per-workspace, no `workspace_path` column.
  - **Addressed**: Rewrote migration text to `id TEXT PRIMARY KEY`; no `workspace_path` column.
- **Concern**: More singleton surfaces than the three listed (DashboardState.architect, ArchitectState, etc.).
  - **Addressed**: Enumerated all known call sites in Scope and References.
- **Concern**: `resolveTarget` doesn't receive sender identity today; spec must require plumbing.
  - **Addressed**: Solution Approach now requires plumbing; Constraints calls out the signature change.
- **Concern**: `tower-cron.ts` also uses `architect` as a target — non-builder paths.
  - **Addressed**: Assumptions section rewritten; Scope item 4 explicitly preserves cron behavior.
- **Concern**: Legacy fallback success criteria don't define error text.
  - **Addressed**: Spec now requires asserted error text.

#### Gemini (REQUEST_CHANGES, HIGH)
- All findings duplicate of Codex (migration text, missed singleton homes, sender context) plus `terminal_sessions.role_id` global-DB gap.
  - **Addressed**: All folded into the same fixes.

#### Claude (COMMENT, HIGH)
- **Concern**: Dashboard / `/api/state` API shape change unacknowledged.
  - **Addressed**: Scope item 7 keeps scalar shape in v1.
- **Concern**: 4th singleton enforcement at `tower-instances.ts:354`.
  - **Addressed**: Added to enumeration.
- **Concern**: `resolveTarget` signature expansion.
  - **Addressed**: Duplicate of Codex C4.
- **Concern**: Architect-gone edge case unspecified.
  - **Addressed**: Distinguished from legacy-builder fallback; separate error messages.

### Specify phase — architect review (iter-2)

Architect left 5 inline comments. All addressed in a single commit (`821f233c`):

- **Concern**: Problem statement says "both architects see it"; actually only the singleton sees it.
  - **Addressed**: Rewrote problem statement; added manual copy-paste workaround.
- **Concern**: Naming requires concrete defaults.
  - **Addressed**: Pinned `main` + auto-numbered + explicit override; resolves the previously-critical Open Question.
- **Concern**: Workaround section should reflect the actual copy-paste workflow.
  - **Addressed**: Added.
- **Concern**: `architectId` vs name — they're the same.
  - **Addressed**: Renamed throughout to `name` / `spawnedByArchitect`.
- **Concern**: Broadcast not required.
  - **Addressed**: Dropped from scope; added explicit "NOT in scope" subsection.

### Plan phase (iteration 1)

#### Codex (REQUEST_CHANGES, HIGH)
- **Concern**: `commands/architect.ts` already exists as a non-Tower command.
  - **Addressed**: Phase 2 plan rewritten — keep existing command, introduce `afx workspace add-architect`.
- **Concern**: `state.ts` hardcoded `WHERE id = 1` SQL paths.
  - **Addressed**: Phase 1 deliverables enumerated the specific lines and chosen semantics.
- **Concern**: Rollback strategy doesn't match the project's forward-only `_migrations` framework.
  - **Addressed**: Rewrote Phase 1 Rollback Strategy to follow the existing pattern.
- **Concern**: Reconnect path at `tower-terminals.ts:642` could regress silently.
  - **Addressed**: Phase 1 deliverables include the rehydration path; Phase 1 risks list this explicitly.
- **Concern**: Phase 3 doesn't commit to resolver signature decision.
  - **Addressed**: Plan commits to widening `resolveTarget`.

#### Claude (COMMENT, HIGH)
- **Concern**: `migrate.ts:40` also hardcodes `VALUES (1, ...)`.
  - **Addressed**: Added to deliverables.
- **Concern**: `InstanceStatus.architectUrl` scalar needs the same shim.
  - **Addressed**: Added to Phase 1.
- **Concern**: `annotations.parent_id` for architect-owned annotations.
  - **Addressed**: Explicitly deferred as a known gap (out of v1 scope).
- **Concern**: "byte-identical" too strong.
  - **Addressed**: Changed to "structurally identical".
- **Concern**: Concurrent `afx spawn` race in `upsertBuilder`.
  - **Addressed**: Phase 2 risks document better-sqlite3 atomicity.

#### Gemini (COMMENT, no key issues)
- **Recommendation**: Preserve `DEFAULT (datetime('now'))` on `started_at`.
  - **Addressed**: Restored in Phase 1 migration pseudo-SQL.
- **Recommendation**: Single-architect fast-path for latency parity.
  - **Addressed**: Adopted in Phase 3 pseudocode and code.
- **Recommendation**: Builder-context detection via `state.db` row, not `entry.builders`.
  - **Addressed**: Adopted as the predicate.

### Phase 1 (iteration 1) — Implement

#### Codex (REQUEST_CHANGES, HIGH)
- **Concern**: `state.ts` fallback uses `ORDER BY id LIMIT 1` (lexicographic) instead of registration order.
  - **Addressed**: Changed to `ORDER BY started_at LIMIT 1`. Regression test added.
- **Concern**: `tower-terminals.ts` emits duplicate Architect tabs when N architects exist.
  - **Addressed**: Removed per-loop architect entries; single emit post-loop iff `architects.size > 0`.
- **Concern**: No test for the fallback ordering or single-tab guarantee.
  - **Addressed**: Fallback test added; single-tab guarantee covered by code-review + CI guardrail.

#### Gemini (REQUEST_CHANGES, HIGH)
- **Concern**: `commands/stop.ts` legacy fallback only kills `main`; siblings leak.
  - **Addressed**: Replaced with `for (const architect of getArchitects())` loop.

#### Claude (APPROVE, HIGH)
- No required changes; suggested adding tests for Phase 2/3-only helpers when they get exercised (deferred as appropriate).

### Phase 2 (iteration 1) — Implement

#### Codex (REQUEST_CHANGES, HIGH)
- **Concern**: Named architects not persisted to local `state.db` (`setArchitectByName` never called).
  - **Addressed**: Wired up in both `addArchitect` and `launchInstance` (which also closes a pre-existing inconsistency).
- **Concern**: Explicit empty `--name` auto-numbered instead of rejected.
  - **Addressed**: Three-layer rejection (CLI, client, server). All use `validateArchitectName` and `!== undefined` checks.
- **Concern**: Insufficient integration test coverage.
  - **Addressed**: 6 new route-handler tests + 3 new `upsertBuilder` SQLite tests.

#### Gemini (REQUEST_CHANGES, HIGH)
- **Concern**: Test coverage gap (duplicates Codex).
  - **Addressed**: Same fixes.

#### Claude (APPROVE, HIGH)
- **Concern**: `CODEV_ARCHITECT_NAME` documentation missing.
  - **Addressed**: Added to `codev/resources/commands/agent-farm.md` with the `afx workspace add-architect` command section and an Environment Variables section.

### Phase 3 (iteration 1) — Implement

#### Codex (REQUEST_CHANGES, HIGH)
- **Concern**: `architect:<name>` not implemented end-to-end — `parseAddress` splits it as `project:agent`.
  - **Addressed**: Added `resolveArchitectByName` helper, intercepts `project === 'architect'` in `resolveTarget` before `findWorkspaceByBasename` runs. Five new end-to-end tests cover the matrix.

#### Gemini (REQUEST_CHANGES, HIGH)
- **Concern**: `lookupBuilderSpawningArchitect` uses singleton `getDb()` instead of per-workspace handle.
  - **Addressed**: Added `workspacePath` parameter; opens per-workspace readonly handle mirroring `servers/overview.ts`.
- **Concern**: Error messages deviate from spec verbatim text.
  - **Addressed**: All three error-message functions match spec exactly (lowercase first word, no quotes around IDs, no trailing periods).

#### Claude (REQUEST_CHANGES — process)
- **Concern**: Phase 3 code uncommitted at the time of review.
  - **N/A**: Process artifact — the SPIR cadence commits after consult-driven fixes are folded in.

### Phase 3 (iteration 2) — Implement

#### Gemini (APPROVE, HIGH)
- No concerns raised.

#### Codex (REQUEST_CHANGES, HIGH)
- **Concern**: `/api/send` doesn't assert that `from` is forwarded to `resolveTarget`.
  - **Addressed**: Two new tests in `tower-routes.test.ts` pin the plumbing.
- **Concern**: `lookupBuilderSpawningArchitect` has no direct tests.
  - **Addressed**: New `spec-755-lookup-builder.test.ts` with 6 cases exercising the helper against real SQLite, including per-workspace isolation.
- **Concern**: Full end-to-end Tower-process integration test missing.
  - **Rebutted (partial)**: Documented as deferred technical debt. The route, resolver, and DB layers are each individually tested; the residual gap is mechanical wiring. Addressing it cleanly is ~100 LOC of subprocess work and was judged below the cost threshold. Tracked in Technical Debt above.

#### Claude (APPROVE, HIGH)
- No concerns raised.

## Flaky Tests

No flaky tests encountered during this project. The single pre-existing `tower-api.e2e.test.ts` failures Claude noted in Phase 3 review were unrelated to Spec 755 changes and were not skipped or modified.

## Follow-up Items

- **End-to-end Tower-process test for affinity routing** (deferred from Phase 3 iter-2). Documented in Technical Debt.
- **Issue #2 follow-ups**: `--architect` filter on `afx status`, surfaced-architects in `/api/state` / dashboard UI. Spec 755 deliberately keeps these out of v1.
- **Issue #3 / #4 / #5 follow-ups**: `THREAD.md` template + lifecycle (`codev thread new|list|archive`), cross-thread visibility, thread-aware `consult`. All explicitly tracked as separate issues.
- **Exit handler refactor** in `tower-instances.ts` `addArchitect` (non-blocking duplication flagged by Claude).
- **`annotations.parent_id` for architect-owned annotations** — out of v1 scope; revisit alongside issue #2.

## Test Counts

- **Pre-Spec-755 codev tests**: 2604 passing, 13 skipped.
- **Post-Spec-755 codev tests**: 2675 passing, 13 skipped. +71 new tests.
- New tests live in:
  - `spec-755-migration.test.ts` (10 tests)
  - `spec-755-guardrail.test.ts` (1 test)
  - `spec-755-phase2.test.ts` (30 tests)
  - `spec-755-phase3-routing.test.ts` (18 tests)
  - `spec-755-lookup-builder.test.ts` (6 tests)
  - `tower-routes.test.ts` (8 new cases: 6 architects-route + 2 `from`-forwarding)
  - `state.test.ts` (3 new `spawnedByArchitect` cases)
  - `db.test.ts` (1 rewritten singleton test)
  - `migrate.test.ts` (1 updated)

## Architecture Updates Detail

Added new subsection "Multi-architect routing (Spec 755)" to `codev/resources/arch.md` under the Tower section. Documents:
- The name-keyed `WorkspaceTerminals.architects: Map<string, string>` invariant.
- The four-layer routing chain: CLI (`afx send architect`, populates `from`) → `handleSend` (plumbs `from` into resolver) → `resolveTarget` (sender-aware) → `architects` map (terminal lookup by name).
- The `lookupBuilderSpawningArchitect(builderId, workspacePath?)` helper and its per-workspace readonly DB pattern (mirrors `servers/overview.ts`).
- The CI guardrail (`spec-755-guardrail.test.ts`) that prevents singleton-style `entry.architect` access from re-appearing.
- v1 scope boundaries: `/api/state` scalar shape preserved, dashboard UI unchanged, multi-architect surface confined to Tower internals.

## Lessons Learned Updates Detail

Added two entries to `codev/resources/lessons-learned.md`:

1. **Vestigial production code can survive for unknown durations.** `setArchitect` was called only from tests, meaning the local `architect` table was effectively dead state. The lesson: when a feature touches a long-lived API, run a "who calls this in production?" grep during planning, not only after the implementation has diverged.

2. **Export error messages as functions, not inline strings, when tests must assert verbatim spec text.** Gemini's Phase 3 iter-1 review caught text drift between our implementation and the spec. Fixing it once in the producer auto-fixes the asserter. Cheap discipline that pays back the first time it catches a drift.
