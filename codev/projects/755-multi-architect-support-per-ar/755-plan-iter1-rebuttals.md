# Plan Review Rebuttals — Iteration 1

**Plan**: `codev/plans/755-multi-architect-support-per-ar.md`
**Phase**: plan
**Iteration**: 1
**Date**: 2026-05-17

## Reviewer verdicts

| Reviewer | Verdict | Confidence |
|----------|---------|------------|
| Codex    | REQUEST_CHANGES | HIGH |
| Claude   | COMMENT | HIGH |
| Gemini   | COMMENT (no key issues) | HIGH |

All actionable points addressed in commit `44d7266b` ("[Spec 755] Plan with multi-agent review"). The plan's Expert Review section also captures this rebuttal in condensed form. Where convergent findings were raised by multiple reviewers, this rebuttal cross-references them to avoid duplication.

---

## Codex — REQUEST_CHANGES

### C1. Phase 2 CLI plan conflicts with the actual codebase

> `afx architect` already exists in `packages/codev/src/agent-farm/cli.ts` and `commands/architect.ts`, and it starts a local architect session in the current terminal, not a Tower-managed architect terminal. The plan treats this as a new subcommand/new file, which is inaccurate and leaves the migration path for current behavior unclear.

**Status**: Addressed. This was a real error — I missed the existing file.

**Change**: Phase 2 has a dedicated subsection ("The existing `afx architect` command — IMPORTANT") explaining:
- The existing `afx architect` runs a local Claude session with `stdio: 'inherit'` and explicitly disclaims Tower involvement (so it works in any directory, even outside a workspace).
- That contract is load-bearing for current users — we cannot break it by adding `--name` semantics that require Tower.
- Phase 2 commits to introducing a **separate** Tower-aware subcommand: working name **`afx workspace add-architect [--name <name>]`**. This puts architect-management under the same `workspace` noun that already owns `start`/`stop`/`rename`.
- A "Files explicitly NOT touched" list at the end of Phase 2 includes `commands/architect.ts` so the builder won't accidentally edit it.

**Verification**: I read the existing `commands/architect.ts` (69 lines) and confirmed Codex's read. The file uses `child_process.spawn` with `stdio: 'inherit'`, calls `getResolvedCommands().architect`, and has zero Tower dependency.

### C2. Local state APIs evolution is under-specified

> `state.ts` still has singleton semantics (`loadState()` reads `WHERE id = 1`, `setArchitect()` writes only one row), so "round-trip the new fields" is not enough. The builder needs explicit guidance on whether these APIs become `main`-only shims or whether new multi-architect read/write APIs are introduced.

**Status**: Addressed. This was actionable — my hand-waving would have left the builder to invent the semantics themselves.

**Change**: Phase 1 deliverables now explicitly enumerate the four hardcoded-singleton lines in `state.ts` with the chosen semantics for each:
- `:27` (`loadState`) — becomes a `main`-only shim: `SELECT * FROM architect WHERE id = 'main'`. Preserves the `DashboardState.architect` scalar shape per spec item 7.
- `:54` (`setArchitect`) — kept as the `main`-only setter for backward-compat with existing callers (`workspace start`, `stop`). A new `setArchitectByName(name, state)` is added for the multi-architect path that Phase 2's CLI uses.
- `:275` (`DELETE FROM architect`) — stays as-is; bulk-clear is already correct for a multi-row table.
- `:289` — duplicate `WHERE id = 1` lookup; same shim as `:27`.

### C3. Rollback strategy isn't grounded in the actual migration machinery

> The checked-in `db/migrate.ts` is a one-way JSON→SQLite migration helper, not a reversible SQL migration framework with `_migrations` rollbacks. The plan should either drop rollback promises or describe the actual migration mechanism that will be added.

**Status**: Addressed. The rollback claim was invented; the actual framework is forward-only.

**Verification**: I read `db/index.ts:130-204` and confirmed: there is a `_migrations` table for version tracking, but migrations are forward-only. `v3` and `v4` use the `CREATE TABLE new` → `INSERT SELECT` → `DROP/RENAME` pattern with **no reverse SQL**. This is the project's established convention.

**Change**: Phase 1's Rollback Strategy is rewritten to follow the project's actual convention:
- Pre-merge: revert the commit; manually drop the new `_migrations` row if needed for re-testing.
- Post-merge: code revert; `state.db` row was rekeyed from `1` to `'main'`, so the reverted code's `WHERE id = 1` queries fail to find it. Recovery is either re-apply the feature's code or recreate `state.db` (which Tower re-populates on next workspace start).

The plan now also explicitly cites `v3` and `v4` as the migration-pattern precedent in Phase 1's Implementation Details.

### C4 (minor). Reconnect/rehydration path

> Architect naming must flow through terminal rehydration/reconnect paths in `tower-terminals.ts`, not just create-time paths, or reconnect will regress silently.

**Status**: Addressed.

**Change**: Phase 1 deliverables now explicitly include `tower-terminals.ts:642` (the reconnect/re-attach path). Phase 1 risks add this as a named risk with the spec scenario #9 (architect reconnect) as the mitigation/detection.

### C5 (minor). Phase 3 resolver-signature commitment

> The plan mentions both possibilities without committing.

**Status**: Addressed.

**Change**: Phase 3's first deliverable now commits explicitly to widening `resolveTarget(target, fallbackWorkspace?, sender?)` rather than a parallel wrapper. Rationale captured: single resolution code path, optional `sender` param keeps non-builder callers unchanged.

---

## Claude — COMMENT

Claude returned COMMENT (not REQUEST_CHANGES) but the feedback is high-quality and actionable. I treated all five points as if they were REQUEST_CHANGES.

### Cl1. `commands/architect.ts` already exists

Same as Codex's C1. Addressed there.

### Cl2. `state.ts:loadState()` and `setArchitect()` hardcode `id = 1`

Same as Codex's C2. Addressed there with line-level enumeration.

### Cl3. `migrateLocalFromJson()` at `migrate.ts:40` also hardcodes `VALUES (1, ...)`

> Not in the Phase 1 files-touched list.

**Status**: Addressed. Claude found a singleton enforcement point that I (and Codex/Gemini) missed.

**Verification**: I read `db/migrate.ts:38-46` and confirmed — the JSON→SQLite migration inserts `VALUES (1, @pid, @port, @cmd, @startedAt)`. With the schema change in Phase 1, this would insert a literal `1` into a `TEXT PRIMARY KEY` column, which would survive but be the wrong identifier.

**Change**: Phase 1 deliverables explicitly include the `migrate.ts:40` rewrite to insert `'main'` instead of `1`.

### Cl4. `InstanceStatus.architectUrl` scalar needs the same shim as `/api/state`

> The plan mentions the `/api/state` shim but doesn't mention `InstanceStatus.architectUrl`. This interface is returned by Tower's instance listing — if the tunnel layer (`tower-tunnel.ts:74`) also reads it, the omission could cause a bug.

**Status**: Addressed. Another singleton surface I missed.

**Verification**: `tower-types.ts:69` defines `architectUrl: string`; `tower-instances.ts:199` populates it as `${proxyUrl}?tab=architect`.

**Change**: Phase 1 deliverables now include the `InstanceStatus.architectUrl` shim — same `main`-first strategy as `/api/state`. Surfacing all architect URLs is deferred to issue #2.

### Cl5. `annotations.parent_id` for architect-parented annotations

> May be fine to defer but should be explicitly noted as a known gap.

**Status**: Acknowledged and explicitly deferred.

**Change**: Plan's Expert Review section calls this out as a known gap. No annotation behavior changes in v1. When issue #2 lands, a follow-up amendment can populate `parent_id` with the architect's name for architect-owned annotations. Documented honestly rather than swept aside.

### Cl6 (minor). "byte-identical" → "structurally identical"

**Status**: Addressed.

**Change**: Phase 1 deliverables now say "structurally identical to today's response (key shape and types unchanged)."

### Cl7 (minor). Reference `af-architect.test.ts` for Phase 2 tests

**Status**: Addressed.

**Change**: Phase 2 deliverables reference this file as the precedent for test patterns.

### Cl8 (minor). Concurrent `afx spawn` race

**Status**: Addressed.

**Change**: Phase 2 risks include the concurrent-spawn risk with `better-sqlite3` synchronous-atomicity as the mitigation. Phase 2 test plan adds a concurrent-spawn scenario.

---

## Gemini — COMMENT (no key issues)

Gemini explicitly returned `KEY_ISSUES: None` with three implementation pointers. All three adopted.

### G1. Preserve `DEFAULT (datetime('now'))` on `started_at`

**Status**: Addressed.

**Verification**: I re-read `db/schema.ts:24` and confirmed the default. My original pseudo-SQL had omitted it.

**Change**: Phase 1's migration pseudo-SQL now includes `DEFAULT (datetime('now'))` on `started_at` in `architect_v2`. The deliverable also says "**Preserve every column default** ... especially `started_at TEXT NOT NULL DEFAULT (datetime('now'))` — Gemini's review caught that this was missing."

### G2. Phase 3 single-architect fast-path

> To strictly satisfy the spec's "Latency parity" requirement for single-architect workspaces, you can add a fast-path at the top of the `architect` resolution block.

**Status**: Adopted.

**Change**: Phase 3 resolver pseudocode now starts with:

```ts
if (entry.architects.size === 1 && entry.architects.has('main')) {
  return { terminalId: entry.architects.get('main')!, ... };
}
```

This bypasses the SQLite read entirely for solo-architect users. Since all fallback rules end at `main` anyway, this is functionally identical for the single-architect case and guarantees latency parity.

### G3. Builder-context detection via `state.db` row, not `entry.builders`

> If a human operator runs `afx send architect` from the worktree of a *completed* builder (whose terminal session has ended), `entry.builders` will no longer contain that ID. Instead of relying on live terminal state, you can rely purely on the `state.db` read.

**Status**: Adopted. Better predicate.

**Change**: Phase 3's builder-context detection now keys on `state.db` row presence — `lookupBuilderSpawningArchitect` returns:
- `string` — recorded `spawned_by_architect` (builder context with explicit name).
- `null` — row exists but `spawned_by_architect` is NULL (legacy row).
- `undefined` — no row exists (not a builder).

This three-valued return cleanly distinguishes "legacy builder" from "non-builder sender" without consulting live terminal state.

### G4 (implicit, from G3). Cycle avoidance

Gemini also pointed out that `lookupBuilderSpawningArchitect` can avoid a `tower-messages.ts` → `state.ts` import cycle by opening a read-only SQLite handle directly, mirroring `servers/overview.ts`.

**Change**: Phase 3's Implementation Details explicitly adopts this pattern.

---

## Items I did NOT change (and why)

- **Working name `afx workspace add-architect`.** The architect's spec example was `afx architect --name <name>`. I went a different direction (a new noun under `workspace`) because extending the existing local-mode `afx architect` would break its no-Tower contract. The plan is explicit about this trade-off and acknowledges the architect can adopt their original phrasing at PR time with a small contained refactor (Phase 2 Risks subsection).
- **Phase ordering (1 → 2 → 3).** No reviewer pushed back. The user-visible win lands last by design.
- **No new CLI for `afx status --architect <name>` filter.** Out of scope per the spec (deferred to issue #2). No reviewer requested adding it.
- **`annotations` table changes.** Explicitly out of scope per spec; Claude's flag was acknowledged as a known gap, not addressed.

---

## Summary

Codex raised one REQUEST_CHANGES verdict; Claude and Gemini commented but did not request changes. Every actionable point — including the three convergent findings (existing `afx architect`, hardcoded `id = 1` SQL, wrong rollback claim) — has been addressed in the updated plan. Single-reviewer findings have also been folded in. The plan is now grounded in verified codebase reality (every cited file/line confirmed), commits explicitly on previously-deferred plan-phase decisions (resolver signature, CLI shape), and follows the project's existing migration conventions.

Plan is ready for re-review.
