# Spec Review Rebuttals — Iteration 1

**Spec**: `codev/specs/755-multi-architect-support-per-ar.md`
**Phase**: specify
**Iteration**: 1
**Date**: 2026-05-17

## Reviewer verdicts

| Reviewer | Verdict | Confidence |
|----------|---------|------------|
| Codex    | REQUEST_CHANGES | HIGH |
| Gemini   | REQUEST_CHANGES | HIGH |
| Claude   | COMMENT | HIGH |

The spec has been updated to address every actionable issue. The updates are captured in commit `62446542` ("[Spec 755] Specification with multi-agent review"). The spec's "Expert Consultation" section now mirrors this rebuttal in summarized form for future readers.

---

## Codex — REQUEST_CHANGES

### C1. `architect:all` syntax conflicts with the existing address parser

> The proposed `architect:all` broadcast syntax conflicts with the existing address parser: `parseAddress()` treats `x:y` as `{ project: x, agent: y }`, so `architect:all` currently means project=`architect`, agent=`all`, not a special architect address. Pick a syntax that fits current grammar or explicitly require grammar changes.

**Status**: Addressed.

**Change**: Pinned broadcast syntax to `architects` (plural, no colon) in Scope item 5. The Open Question is marked Resolved. Moving the decision into the spec rather than deferring it to the plan removes a parser-level surprise that could derail implementation.

### C2. Migration claim incorrect against the actual schema

> The spec says the architect-table migration should add uniqueness on `(workspace_path, architect_id)`, but the verified local `architect` table in `packages/codev/src/agent-farm/db/schema.ts` has no `workspace_path` column because `state.db` is already per-workspace. That migration requirement is currently incorrect and should be rewritten against the actual schema.

**Status**: Addressed. Codex is correct — `state.db` is per-workspace.

**Change**: Scope item 2 now specifies: drop `CHECK (id = 1)`, change `id` to `TEXT PRIMARY KEY` storing the `architectId`. No `workspace_path` column. The Constraints section explicitly calls this out as a correction of the prior draft. Success Criteria includes a migration test that rekeys the existing row's `id` to `"main"`.

### C3. More singleton surfaces beyond the three named

> Multi-architect support affects more than the three singleton points named in the spec. Verified singleton surfaces also include `DashboardState.architect`, `ArchitectState`, `loadState()/setArchitect()`, `InstanceStatus.architectUrl`, and terminal list generation that hardcodes tab/id `'architect'`. The spec should either include these as in-scope compatibility surfaces or explicitly declare the intended v1 behavior for UI/state APIs.

**Status**: Addressed.

**Change**: Scope item 2 now enumerates **all** known singleton call sites (in-memory map, local SQLite, global SQLite `terminal_sessions`, activation guard, multiple teardown paths, dashboard state, tunnel map, CLI commands, migration code). References section mirrors the list with file/line citations. Scope item 7 makes an explicit decision: `/api/state` response shape stays scalar in v1 (collapsed to `"main"` or first architect), so the dashboard and VSCode extension do not need updates. Multi-architect UI is deferred to issue #2.

### C4. Routed resolution underspecified at the API boundary

> Verified `resolveTarget(to, workspace)` does not currently receive sender identity, while `handleSend()` does receive `from`. The spec should state whether sender-aware routing is a requirement on the resolver contract itself or whether routing may happen one layer up.

**Status**: Addressed.

**Change**: Solution Approach (layer 3) now explicitly says v1 plumbs `from` from `handleSend` into the resolution layer, and acknowledges that whether to widen `resolveTarget`'s signature or add a sibling builder-context resolver is a **plan-phase decision**. Constraints reinforces this. The spec commits to the requirement (sender identity reaches the resolver) without over-specifying the API shape.

### C5. "No other code path uses `architect` as a target" assumption is false

> The "no other code path uses literal `architect` as a resolution target" assumption is not true in the repo as written; there are other architect-targeted flows such as cron/task routing. The spec should clarify that only builder-originated sends become architect-affinity-aware, while non-builder `architect` sends keep resolving to the default/main architect unless explicitly broadcast.

**Status**: Addressed. The original Assumptions bullet was inaccurate.

**Change**: Assumptions section rewritten to state that builder-originated `afx send architect` is the affinity-aware path, while non-builder paths (cron-originated messages, `afx send architect` from the workspace root) keep the existing "route to `"main"` (or first registered)" semantics. Scope item 4 makes the same statement in normative form. Success Criteria adds a test scenario (#11) for non-builder architect-target sends.

### C6. Legacy fallback rule needs sharper success criteria

> The spec proposes "route legacy builders to `main` if present, else error," which is good, but the success criteria do not currently require that exact behavior, nor do they define the operator-facing error text/handling when `main` is absent.

**Status**: Addressed.

**Change**: Security Considerations now spells out three distinct fallback rules with their exact operator-facing error messages (legacy-builder-no-`main`, architect-gone-no-`main`, address-spoofing-rejection). Success Criteria now requires those error texts to be asserted by test. Test Scenarios includes both the present-`main` and absent-`main` variants of each failure mode (scenarios 4–7 and 10).

---

## Gemini — REQUEST_CHANGES

### G1. Incorrect local schema migration

> The `Constraints` section states the migration for the `architect` table needs a `(workspace_path, architect_id)` uniqueness constraint. This is technically incorrect... The migration should simply drop the `CHECK (id = 1)` constraint and redefine the primary key to hold the string identifier (e.g., `id TEXT PRIMARY KEY`).

**Status**: Addressed. Duplicate of C2; see that response. Both Gemini's and Codex's fix is what I adopted: `id TEXT PRIMARY KEY` after dropping the singleton check.

### G2. Missed 4th singleton home (global DB)

> The spec correctly identifies 3 singleton homes but misses a critical 4th: the `terminal_sessions` table in `global.db`... Currently, for rows where `type = 'architect'`, the `role_id` column is explicitly documented as `(null for architect)`. To support multiple architects and ensure Tower recovery doesn't collapse them, the `role_id` column must be updated to store the `architectId`.

**Status**: Addressed. This is a real gap that I missed in the first draft.

**Change**: Scope item 2 includes the `terminal_sessions.role_id` change explicitly: schema unchanged, but the data-shape contract changes to "`role_id` is no longer null for architect rows; it stores the `architectId`." Constraints describes this as a "data-shape contract change" rather than a schema change. Success Criteria adds a backfill migration test (non-functional test #3) that idempotently sets `role_id = 'main'` for existing architect rows where `role_id IS NULL` and leaves other rows untouched.

### G3. Missing sender context in routing

> While the Tower `/api/send` endpoint extracts the `from` field (the sender's identity), it drops it entirely when invoking `resolveTarget(to, workspace)`. The spec should explicitly note that the `from` identity must be plumbed into the routing layer.

**Status**: Addressed. Duplicate of C4; see that response.

**Change**: Current State section now includes a precise description of where `from` is dropped (line 854 of `tower-routes.ts`), so future readers see exactly the bug being fixed. Solution Approach and Constraints make the plumbing requirement normative.

### G4. (Minor) `architects` plural avoids parser ambiguity

> `architect:all` conflicts conceptually with the existing `[project:]agent` parser grammar... `architects` (plural) safely avoids this parser ambiguity.

**Status**: Addressed. Adopted Gemini's recommendation as the final decision. See C1.

---

## Claude — COMMENT

Claude returned COMMENT (not REQUEST_CHANGES), but its findings are all actionable and worth addressing. I treated them as if they were REQUEST_CHANGES.

### Cl1. Dashboard / VSCode extension API shape change unacknowledged

> The `/api/state` response currently returns `architect: { terminalId, persistent }` as a single object. Multiple architects will change this API surface. The spec should state whether the dashboard is updated in v1 or whether the API deliberately collapses to the "first/main" architect for backward compat.

**Status**: Addressed. This was a real gap.

**Change**: Scope item 7 makes an explicit decision: v1 deliberately keeps the existing scalar shape of `state.architect` in `/api/state`, populated with `main` (or first registered if `main` is absent). The dashboard and VSCode extension see one architect tab, identical to today. Multi-architect UI is deferred to issue #2. Risks table includes "Dashboard / VSCode extension breaks due to `/api/state` shape change" with the v1 decision as its mitigation.

### Cl2. Fourth singleton enforcement point at `tower-instances.ts:354`

> `tower-instances.ts:354` (`if (!entry.architect)`) prevents creating a second architect terminal at activation time. The spec lists three singleton homes but this guard is a fourth that must be relaxed in lockstep.

**Status**: Addressed.

**Change**: Scope item 2 explicitly enumerates `tower-instances.ts:354,416,452,529-532` (activation guard, create paths, teardown). I also walked the codebase further and added `tower-routes.ts:1411-1418,1853-1855,1882-1884`, `tower-terminals.ts:289-290,642`, `tower-tunnel.ts:74`, `commands/stop.ts:56-59`, `commands/status.ts:86-89`, `db/migrate.ts:38-46`. Risks adds a "singleton-relaxation sweep misses a call site" risk with a CI grep guardrail as mitigation.

### Cl3. `resolveTarget` signature expansion not called out

> The spec says routing will use `spawnedByArchitectId` but the current `resolveTarget(to, workspace)` has no sender context parameter. The spec should acknowledge that the resolver needs sender identity passed in.

**Status**: Addressed. Duplicate of C4 / G3; see those responses.

### Cl4. Architect-gone edge case unspecified

> What happens when a builder's spawning architect has disconnected/exited but the builder is still running? Differs from the legacy-builder case (no ID) — this is a builder with a valid `spawnedByArchitectId` pointing to an architect that's no longer present.

**Status**: Addressed.

**Change**: Scope item 6 now distinguishes the two cases. Both fall back to `"main"` if present; both fail with distinct error messages if `"main"` is absent. The error text differs between the two cases (legacy-builder vs. architect-gone) and is asserted by test (Test Scenarios 4–7).

### Cl5. Architect reconnect (terminalId changes)

> If A reconnects with a *different* terminal ID (which happens on shellper reconnect), the routing must resolve by `architectId` → current terminal ID, not by a stale terminal ID.

**Status**: Addressed.

**Change**: Scope item 1 now explicitly states `architectId` is stable across reconnects; routing keys on `architectId`, not `terminalId`. Solution Approach (layer 1) repeats this. Test Scenarios #8 ("Architect reconnect") covers it: a builder spawned from `sibling` keeps reaching `sibling` after `sibling`'s terminal is killed and recreated.

### Cl6. Workspace stop with multiple architects

> `tower-routes.ts:1882-1884` ... workspace teardown iterates the architect as a single value. This needs to become a loop.

**Status**: Addressed.

**Change**: Cited in Scope item 2 as part of the call-site enumeration. Test Scenarios #12 ("Workspace stop with multiple architects") added to cover the iterated teardown.

### Cl7. Annotations parent_id (forward-looking)

Claude flagged that the `annotations` table's `parent_type CHECK(parent_type IN ('architect', 'builder', 'util'))` may eventually need `parent_id` populated for architect-owned annotations.

**Status**: Acknowledged; out of scope for v1.

**Rationale**: Architect-scoped annotations are not part of the message-routing problem this spec addresses. They are adjacent to the multi-architect identity feature but separable. If issue #2 (per-architect identity in spawn + status) lands, that's a more natural time to update annotation parentage. For v1, no annotation behavior changes.

---

## Items I did NOT change (and why)

- **Open Question on `architectId` mechanism** (env var vs. config vs. API parameter): kept open. The spec commits to *some* mechanism existing, with `"main"` as the default; the choice is a plan-phase decision. None of the reviewers pushed back on this deferral.
- **No explicit `--architect` CLI flags in `afx spawn` / `afx status`**: kept out of scope per the architect's explicit instruction at spawn time. All three reviewers respected this scope and did not request it.
- **No `THREAD.md` template or `codev thread` commands**: out of scope, will be follow-up issue. No reviewer requested its inclusion.

---

## Summary

Codex and Gemini both flagged REQUEST_CHANGES with substantive technical issues; Claude flagged COMMENT with the same caliber of feedback. All actionable items have been addressed in the updated spec. The spec is now firmly grounded in the actual codebase (verified call sites, accurate schema, correct routing pipeline), and the v1 product decisions that were previously deferred (broadcast syntax, dashboard shape, fallback semantics) are now pinned.

I believe the spec is ready for re-review.
