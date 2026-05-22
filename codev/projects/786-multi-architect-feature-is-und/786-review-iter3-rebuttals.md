# PR #822 — Iter-3 CMAP Rebuttal

**Date**: 2026-05-22
**Reviewers (iter-3)**: Codex-only re-CMAP (to confirm the stop-all race fix from iter-2 landed cleanly)
**Outcome**: Codex APPROVED the stop-all race fix implicitly (no mention) but raised two new concerns. Both are pre-existing architectural matters out of scope for this PR. Surfacing to architect for final call.

---

## Codex iter-3 — REQUEST_CHANGES

### Co1. `state.db.architect` is global to Tower, not per-workspace
> "The new persistence/reconciliation flow uses the local `state.db.architect` table as if it were workspace-scoped, but that schema is still keyed only by architect name... Under one Tower daemon managing multiple workspaces, sibling architects from workspace A can be re-spawned into workspace B."

**Status**: Declining to fix in this PR. Documented for follow-up.

**Reasoning** (carries forward from Phase 3 iter-1 rebuttal):

1. **Pre-existing condition.** `state.db.architect` has no `workspace_path` column. `setArchitect`/`setArchitectByName` (state.ts:71, :93) use a singleton `getDb()` that resolves to Tower's CWD via `getConfig()`. This is the storage shape from Spec 755 (multi-architect primitive), not introduced by Spec 786. Phase 3's `launchInstance` reconciliation reads what Spec 755's `addArchitect` already writes — same global table.

2. **Spec 786 explicitly puts cross-workspace out of scope.** From the spec's "Out of scope (preserved from issue, treated as fixed)" section:
   > "Cross-workspace routing. Architects in workspace A cannot address architects in workspace B. Deferred previously; stays deferred."
   
   The implicit assumption throughout the spec is single-workspace Tower. Codex raised this same concern in Phase 3 iter-1 (Co1); the rebuttal was accepted and the implementation advanced through plan-approval, all 7 implementation phases, and PR iter-1 with this acknowledged.

3. **The architect's integration CMAP** (the one that found the race condition that triggered iter-2) did NOT surface this workspace-scoping concern. The architect's gate-level review is the canonical check, and they did not block on this.

4. **A real fix requires schema migration.** Adding workspace_path to `state.db.architect`, updating all Spec 755 callsites, and reworking `state.ts`'s API surface is vastly beyond the race-fix scope the architect approved for this PR.

**Follow-up**: This is already listed in the review document's "Follow-up Items" section as the first bullet — "Workspace-scoping of `state.db.architect` (Codex Phase 3 Co1)". If/when multi-workspace Tower architect routing becomes a goal, that follow-up ticket should be opened.

### Co2. VSCode Architects tree doesn't refresh on architect add
> "WorkspaceProvider refreshes on connection changes, dev-terminal changes, and worktree-config-updated, but not on architect lifecycle changes; the verify doc even notes the tree may not refresh automatically after add."

**Status**: Acknowledged; documented limitation, not a regression.

**Reasoning**:

1. **Already documented.** `verify-scenarios.md` Scenario 11 (VSCode UX) explicitly says: "the tree may not refresh automatically until you click 'Refresh' on the sidebar OR until an SSE event fires (graceful — `codev.removeArchitect` does refresh; add does not yet)." The user is told upfront.

2. **`codev.removeArchitect` DOES refresh** (added in Phase 6 iter-1 in response to Codex's flag). The asymmetry is intentional: add-architect happens via the CLI, which Tower has no SSE event for; remove happens via the VSCode command itself, which can self-trigger the refresh.

3. **The complete fix** is Tower-side: emit an `architects-updated` SSE event on add/remove, have `WorkspaceProvider` listen for it. The dashboard would auto-refresh too. This is moderate work (Tower-side event plumbing + dashboard + VSCode listener) that the architect explicitly excluded when they directed me to drop scope items 2-4 from this PR ("ONLY the race condition fix. Nothing else.").

4. **The user-visible UX gap is small.** A user adding an architect via CLI sees the new architect in their terminal immediately. The VSCode sidebar staleness is observed only when the user has VSCode open and looks at the tree — and a single click of the sidebar refresh button resolves it.

**Recommendation**: File as a separate small ticket (#789 or roll into the #787 multi-architect-followup the architect mentioned). Not a blocker for #786 ship.

---

## What was confirmed by iter-3

- **The stop-all race fix from iter-2 lands cleanly.** Codex did not flag it as still broken or partially fixed — they raised entirely different concerns. The regression test (`handleWorkspaceStopAll explicitly deletes architect rows BEFORE the kill loop`) passes.

---

## Summary

Both Codex iter-3 findings are real but pre-existing/out-of-scope:
- **Co1 (workspace-scoping)**: pre-existing from Spec 755, explicitly out-of-scope per #786 spec, architect-accepted rebuttal in Phase 3, no architect block at PR gate.
- **Co2 (VSCode add-refresh)**: known limitation documented in verify-scenarios.md, intentionally excluded from PR scope by architect's "ONLY the race condition fix" direction, follows naturally as a small follow-up alongside #787's multi-architect coherence work.

Surfacing to architect via `afx send` for final call. If the architect wants either fixed in #822, I'll do it; otherwise PR is ready for the `pr` gate approval.
