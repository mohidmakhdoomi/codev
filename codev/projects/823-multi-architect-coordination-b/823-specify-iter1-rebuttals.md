# Spec 823 — iter-1 CMAP Rebuttal

**Date**: 2026-05-22
**Reviewers**: Gemini (REQUEST_CHANGES), Codex (REQUEST_CHANGES), Claude (APPROVE)

---

## Summary

Iter-1 surfaced two correctness findings (Gemini's SQL WHERE clause + Codex's spoofing-check claim), three accuracy findings (Codex's CLI form + Codex's verify-scenarios path + Codex's SSE workspace-scoping), and four polish findings from Claude (tower-client path + sibling traversal + OQ-B visual intent + thread accumulation + SHOULD→MUST + SSE reconnect). All eleven findings are addressed in the iter-1 corrections commit. No findings rejected.

---

## Gemini (REQUEST_CHANGES) — addressed

### G1. SQL `WHERE` clause excludes soft-mode builders

**Finding**: `overview.ts:786` has `SELECT worktree, issue_number FROM builders WHERE issue_number IS NOT NULL`. Soft-mode / task-mode builders have `issue_number = NULL`, so they'd be excluded from the enriched result set, and their `spawnedByArchitect` would never be populated even if they were spawned by a sibling architect.

**Verification**: Confirmed at `packages/codev/src/agent-farm/servers/overview.ts:786`. The WHERE clause is exactly as Gemini described. Soft-mode spawn paths in `commands/spawn.ts` write `issue_number = NULL` for task-mode builders.

**Resolution**: Spec now MUSTs (1) dropping the `WHERE issue_number IS NOT NULL` clause (or replacing with `WHERE spawned_by_architect IS NOT NULL OR issue_number IS NOT NULL`), AND (2) applying each enrichment field conditionally based on whether its column is null in the row. Plan phase pins the exact form.

**Where in spec**: Current State / Item 1 (new "SQL `WHERE` clause caveat" paragraph) + Functional MUST / Item 1 (updated `SELECT` MUST).

### G2. Missing UI test for soft-mode-spawn-by-sibling

**Finding**: The test matrix should include a soft-mode builder whose `spawned_by_architect` is non-null, to validate the SQL fix flows through to the rendered attribution.

**Resolution**: Added Test Scenario 3b — N=2 architects, one soft-mode builder (`task-foo`) with `issue_number = NULL` but `spawned_by_architect = 'ob-refine'`. After the SQL fix, the builder MUST appear in the enrichment result and render its attribution tag. Plan phase will codify this as a dashboard unit test.

**Where in spec**: Test Scenarios / Functional Tests (new scenario 3b).

---

## Codex (REQUEST_CHANGES) — addressed

### C1. `architect:<name>` from a builder is NOT an affinity override

**Finding**: The spec described `architect:<name>` as "explicit per-architect addressing. Works from architects (sibling-architect messaging) and from builders (override the affinity routing)." This is incorrect. Per `tower-messages.ts:196-230` (`resolveArchitectByName`), when the sender is a builder, the address is allowed ONLY when `<name>` matches the builder's `spawnedByArchitect`. Mismatches are rejected by the spoofing check.

**Verification**: Confirmed at `tower-messages.ts:211-220`:
```ts
if (sender) {
  const spawningArchitect = lookupBuilderSpawningArchitect(sender, workspacePath);
  if (spawningArchitect !== undefined && spawningArchitect !== name) {
    return { code: 'NOT_FOUND', message: addressSpoofingErrorMessage(sender) };
  }
}
```

Builders cannot use `architect:<name>` to override their affinity routing. Architects (non-builder senders) bypass the spoofing check and can address any architect by name.

**Resolution**: Spec now distinguishes the two sender contexts everywhere `architect:<name>` is documented:
- From **architects** (including `main`): open address grammar; sibling-architect messaging.
- From **builders**: allowed only when `<name>` matches `spawnedByArchitect`; an explicit form of the affinity routing, NOT an override.

Added an explicit MUST that `CLAUDE.md` document this spoofing-check constraint with a concrete example (builder `spir-823` running `afx send architect:ob-refine "..."` is rejected unless its `spawnedByArchitect == 'ob-refine'`).

**Where in spec**: Current State / Item 2 (new "Spoofing-check note" paragraph) + Desired State (item 2 reworded) + Functional MUST / Item 2 (form descriptions rewritten + new MUST for spoofing-check documentation).

### C2. CLI is `--name <name>` flag, not positional

**Finding**: The spec used `afx workspace add-architect ob-refine` throughout. The actual CLI is `afx workspace add-architect --name ob-refine` per `packages/codev/src/agent-farm/cli.ts:110`.

**Verification**: Confirmed at `cli.ts:107-119`:
```ts
workspaceCmd
  .command('add-architect')
  .description('...')
  .option('--name <name>', 'Explicit architect name (default: auto-numbered architect-<N>)')
  .action(async (options: { name?: string }) => { ... });
```

`remove-architect` is positional per #786 (per the issue body's `afx send architect:<name>` examples and the spec's existing references).

**Resolution**: Fixed every `add-architect ob-refine` → `add-architect --name ob-refine` in the spec (Problem Statement / Desired State / Functional MUST / Test Scenarios). `remove-architect` left positional. Added a note in the consultation log.

**Where in spec**: Problem Statement (item 4 paragraph), Desired State (item 4), Functional MUST / Item 4 (two MUSTs + verify-phase exercises), Test Scenarios 9 & 10.

### C3. `codev/projects/786-.../verify-scenarios.md` doesn't exist on this branch

**Finding**: The spec required updating `codev/projects/786-multi-architect-feature-is-und/verify-scenarios.md` Scenario 11, but that file doesn't exist on the builder/spir-823 branch — it's on the `builder/spir-786` branch (PR #822, still open).

**Verification**: Confirmed via `ls codev/projects/` — no `786-*` directory exists on this branch. The file lives on the #786 branch.

**Resolution**: Relaxed the pin. Spec now says "after #786 merges and the artifact path lands" and instructs the plan phase to confirm the cross-reference shape post-merge. The Current State table is annotated to reflect that the file is on the #786 branch, not present here.

**Where in spec**: Current State / Item 4 (table annotation) + Functional MUST / Item 4 (relaxed pin) + Dependencies / Item 4 (relaxed pin).

### C4. SSE event payload needs `workspace` scoping

**Finding**: The spec proposed `architects-updated` with payload `{ architects: ArchitectState[] }`, omitting workspace context. The precedent `worktree-config-updated` includes `workspace` per `worktree-config-watcher.ts:60-65`. Multi-workspace Tower deployments need subscribers to disambiguate which workspace mutated.

**Verification**: Confirmed at `worktree-config-watcher.ts:60-65`:
```ts
broadcast({
  type: 'worktree-config-updated',
  body: JSON.stringify({ workspace: workspacePath }),
  workspace: workspacePath,
});
```

The event carries `workspace` both in the body and as an envelope field.

**Resolution**: OQ-F recommendation rewritten:
- (a) `{ workspace: string }` — subscriber re-fetches `/state` to get the new architect list.
- (b) `{ workspace: string, architects: ArchitectState[] }` — full collection (skip re-fetch).
- (c) Delta events — `architect-added` / `architect-removed`.

Recommendation: (a), matching `worktree-config-updated` exactly. The `workspace` field is **required** to support multi-workspace Tower. The Functional MUST is updated to make `workspace` mandatory in the payload.

**Where in spec**: OQ-F (rewritten) + Functional MUST / Item 4 (workspace field made mandatory).

---

## Claude (APPROVE) — minor polish addressed

### Cl1. Thread-file accumulation on `main` over time

**Finding**: After 50 features ship, `main` accumulates 50 `codev/state/<builder-id>_thread.md` files from builders whose worktrees no longer exist. Spec should acknowledge this even if the answer is "MAINTAIN's concern."

**Resolution**: Added NQ-C explicitly. Decision: leave accumulation as-is. Thread files are part of the historical review record (parallel to `codev/reviews/`). Pruning, if ever needed, is a MAINTAIN-protocol concern, NOT #823's scope. No auto-cleanup mechanism in this spec.

**Where in spec**: Open Questions / Nice-to-Know / NQ-C (new).

### Cl2. Tower-client path correction

**Finding**: Dependencies list pointed at `packages/vscode/src/tower-client.ts`. Actual location is `packages/core/src/tower-client.ts`. The VSCode SSE subscription mechanism is `connectionManager.onSSEEvent()` in `workspace.ts`, not the tower-client directly.

**Resolution**: Corrected the path in the Dependencies list. Added a note that `connectionManager.onSSEEvent()` is the actual subscription seam.

**Where in spec**: Dependencies / Item 4 (corrected path + subscription-seam note).

### Cl3. Sibling thread traversal path

**Finding**: `cat ../<sibling>/codev/state/<sibling-id>_thread.md` from a builder's worktree works because `.builders/<id-a>/` and `.builders/<id-b>/` share a parent. The instruction in `codev/roles/builder.md` should spell this out rather than leave it to the LLM.

**Resolution**: Updated the `codev/roles/builder.md` instruction MUST to include the cross-builder traversal pattern explicitly. Builder A reads builder B's thread at `../<sibling-id>/codev/state/<sibling-id>_thread.md` from A's worktree. Plan phase will check this exact wording.

**Where in spec**: Functional MUST / Item 3 (updated instruction text).

### Cl4. OQ-B visual intent clarification

**Finding**: OQ-B option (a) shows `#0042 · ob-refine`. Is the `·` the entire separator, or is there a "spawned by" prefix? The plan phase will pin CSS, but the spec's visual intent should be one sentence sharper.

**Resolution**: OQ-B rewritten with four options now:
- (a) `#0042 · ob-refine` — just the separator + name.
- (b) `#0042 [spawned by ob-refine]` — explicit prefix.
- (c) Subscript.
- (d) New column.

Recommendation stays (a). Spec now explicitly says: **just the separator + the architect name, no prefix label.** Hover-tooltip with full "spawned by `<name>`" text is the COULD nice-to-have.

**Where in spec**: OQ-B (rewritten) + Functional COULD (hover-tooltip added).

### Cl5. Item 3 mention in CLAUDE.md/AGENTS.md — SHOULD → MUST

**Finding**: The SHOULD criterion "Item 3: Add a one-line mention in CLAUDE.md/AGENTS.md that builders maintain thread files" should be a MUST, since item 2 is the natural documentation surface for thread-file discovery.

**Resolution**: Promoted to MUST. The MUST is added to Functional MUST / Item 2 (the messaging docs MUST). The old SHOULD is removed.

**Where in spec**: Functional MUST / Item 2 (new MUST line) + Functional SHOULD (item 3 mention removed).

### Cl6. SSE reconnect edge case

**Finding**: If Tower restarts between `addArchitect` Tower-side and the SSE event reaching VSCode, the add is invisible until the next poll. Risk table should acknowledge this even if the resolution is "reconnect re-fetches."

**Resolution**: Added a row to the risk table. Mitigation: `connectionManager.onSSEEvent()` already re-establishes on disconnect for `worktree-config-updated`; on reconnect, `WorkspaceProvider` should `refresh()` defensively to pick up any missed mutations. Plan phase confirms current reconnect behaviour and adds defensive refresh if missing.

**Where in spec**: Risks and Mitigation table (new row).

---

## Net spec change summary

- **2 new MUSTs** (spoofing-check documentation in item 2; CLAUDE.md thread-file mention in item 2 promoted from SHOULD).
- **1 new Test Scenario** (3b — soft-mode builder enrichment).
- **2 OQs rewritten** (OQ-B visual intent; OQ-F SSE payload).
- **1 new NQ** (NQ-C — thread accumulation).
- **2 new Risk rows** (SSE reconnect; SQL change ripple).
- **All CLI references corrected** (`--name` flag form throughout).
- **All `architect:<name>` references corrected** to distinguish architect vs builder senders.
- **2 path corrections** (`packages/core/src/tower-client.ts`; `connectionManager.onSSEEvent()` as subscription seam).
- **1 reference relaxation** (#786 verify-scenarios.md pinned post-merge).
- **No findings rejected.** No disagreements with reviewers.

## Iter-2 readiness

Spec is ready for iter-2 CMAP. Gemini and Codex's REQUEST_CHANGES findings are fully addressed. Claude's APPROVE is consolidated. Iter-2 should converge to APPROVE across all three reviewers; if any reviewer surfaces new findings, those will be addressed in iter-2 corrections.
