# Specification: Multi-Architect Feature — Lifecycle, Persistence, and UX

## Metadata
- **ID**: spec-2026-05-20-786-multi-architect-feature
- **Status**: draft
- **Created**: 2026-05-20
- **GitHub Issue**: [#786](https://github.com/cluesmith/codev/issues/786)
- **Predecessors**: #755 (v3.0.5 primitive), #761 (v3.0.6 dashboard tabs), #774 (v3.0.8 routing fix)

## Clarifying Questions Asked
Issue #786 is itself the result of clarifying work done by the architect after Shannon's external adoption exposed gaps. No additional clarification was sought before drafting; the issue body enumerates confirmed gaps with code references and pins the out-of-scope set. Where the issue marks an item as "probable" or "to confirm," this spec resolves it under **Open Questions** so the architect can settle it at the `spec-approval` gate.

## Problem Statement

The multi-architect feature lets a workspace host more than one "architect" terminal — the headline use case is letting a second architect (e.g. `ob-refine`) drive a focused workflow without monopolising the primary `main` architect. The primitive shipped in v3.0.5 (#755), dashboard tab rendering in v3.0.6 (#761), and a critical routing fix in v3.0.8 (#774).

But the feature is not yet a coherent product. The pieces that exist work in isolation; trying to actually *drive* the feature exposes gaps that an end user encounters in their first ten minutes:

- They can add a sibling architect, but they cannot remove one — short of killing the entire workspace.
- Their sibling architect vanishes the next time Tower restarts, because it lives only in process memory.
- The dashboard tab strip surfaces sibling architects but offers no close affordance on the tab itself.
- The headline value proposition — "messages routed to the right architect" — only started working end-to-end in v3.0.8, because no one had ever exercised the round-trip before shipping.
- CLI surfaces (`afx status`) and the VSCode extension sidebar don't yet acknowledge that siblings exist.

The result is an external adopter (Shannon) running the feature in production with an unstable foundation and recurring workarounds.

## Current State

### What works today

| Capability | Code path | Status |
|---|---|---|
| `afx workspace add-architect <name>` CLI | `packages/codev/src/agent-farm/commands/workspace-add-architect.ts` | Functional |
| Tower in-memory map of architects | `packages/codev/src/agent-farm/servers/tower-instances.ts` (`WorkspaceTerminals.architects`) | Functional |
| Builder→architect routing with `spawningArchitect` affinity | `packages/codev/src/agent-farm/servers/tower-messages.ts:320-342` | Functional (post-#774) |
| Dashboard renders one tab per architect | `packages/dashboard/src/components/ArchitectTabStrip.tsx` | Functional |
| `architect` DB table schema (id, pid, port, cmd, started_at, terminal_id) | `packages/codev/src/agent-farm/db/schema.ts:18-26` | Schema present |
| `main` architect row written on `workspace start` | `packages/codev/src/agent-farm/servers/tower-instances.ts:326-337` | Functional |

### Known gaps

| # | Gap | Evidence |
|---|---|---|
| 1 | No `remove-architect` CLI or dashboard affordance | No file matches `remove-architect`; only workaround is killing the terminal (left-pane only) or Tower restart |
| 2 | Architect tabs have no close UI; right-pane (builder/shell) tabs also lack a close button | `ArchitectTabStrip.tsx` hardcodes `closable: false`; `TabBar.tsx:48-64` gates the X behind `tab.closable` but right-pane tabs never set it |
| 3 | Sibling architects are not persisted; only the in-memory map holds them | `state.db.architect` table empty for Shannon's workspace despite Tower having both `main` and `ob-refine`. `addArchitect()` path skips `setArchitectByName()` for siblings, while `workspace start` writes the `main` row |
| 4 | Routing was broken end-to-end v3.0.5 → v3.0.7 | #774 root-caused the issue: detection code never opened workspace `state.db`. Symptom of "never exercised end-to-end before shipping" |
| 5 | Crash recovery is undefined | `tower-messages.ts:336` falls back to `main` when the spawning architect is gone, but a stale `terminal_id` pointing at a dead PID is not detected — behaviour is implementation-defined rather than spec'd |
| 6 | Naming constraints undocumented | `validateArchitectName()` exists in `workspace-add-architect.ts` but its rules aren't documented and special cases (`main`, empty, spaces, `:`) aren't tested |
| 7 | Architect-to-architect messaging unverified | `architect:<name>` address grammar shipped in v3.0.5 but not exercised between two architects |
| 8 | VSCode extension shows only one Architect entry | `packages/vscode/src/views/workspace.ts:56-64` exposes a single "Open Architect" tree item — no sibling parity |
| 9 | `afx status` doesn't enumerate siblings | `packages/codev/src/agent-farm/commands/status.ts:86-92` reads only `state.architect` scalar in fallback mode; Tower path doesn't iterate `state.architects` collection |

## Desired State

A user can add, manage, evict, and recover sibling architects with the same fluency they have with builders. Concretely:

1. **Lifecycle parity.** Adding *and removing* a sibling architect is a first-class CLI operation with a corresponding dashboard affordance. The `main` architect remains undeletable.
2. **Persistence parity.** Sibling architects survive Tower restarts. The architect re-binds to a fresh shellper PTY the same way builders do, via the persisted `cmd` and `terminal_id`.
3. **UX parity.** Tabs for closable entities (sibling architects, right-pane builders/shells when sensible) carry a discoverable close affordance.
4. **Surface parity.** `afx status` enumerates sibling architects with their PIDs and terminal IDs. The VSCode extension sidebar shows all architects, not just one.
5. **Documented semantics.** Naming rules, the `architect:<name>` address grammar (including architect-to-architect messaging), and the crash-recovery behaviour are all documented and tested.
6. **End-to-end verification.** The verify phase exercises the headline value prop manually: add a sibling, spawn a builder from it, send `afx send architect`, observe routing. Repeat for remove, crash, and restart paths.

## Stakeholders

- **Primary Users**: Codev users who run multiple architects in one workspace. Two known concrete users today: the codev project's own architect, and Shannon's external adopter setup running `main` + `ob-refine`.
- **Secondary Users**: Future external adopters who hit the feature when scaling a single-workspace workflow into focused architect roles.
- **Technical Team**: The codev maintainer (architect). The builder spawned for #786 implements; the architect reviews at spec-approval, plan-approval, and PR gates.
- **Business Owners**: The codev maintainer. v3.0.6 promoted multi-architect as a headline feature; coherence of that headline is reputationally important.

## Success Criteria

### Functional (MUST)
- [ ] `afx workspace remove-architect <name>` exists, removes the named sibling from Tower's in-memory map, deletes the persisted row, and terminates the architect's terminal cleanly. Refuses to remove `main`.
- [ ] Sibling architect rows are written to `state.db` on add and deleted on remove. Tower restart auto-rebinds siblings the same way it rebinds builders (re-spawn from recorded `cmd`, re-register against a fresh shellper).
- [ ] Sibling-architect tabs in the dashboard's `ArchitectTabStrip` carry a close affordance. `main` does not.
- [ ] `afx status` enumerates sibling architects alongside `main`, showing name, PID, port, and terminal ID.
- [ ] VSCode extension Workspace sidebar exposes one "Open Architect" entry per architect (or equivalent collapsing UX) rather than a single hardcoded entry.
- [ ] Architect names are validated against documented rules. Reserved name `main` is rejected. Names containing `:` are rejected (address-grammar collision). Empty and whitespace-only names are rejected.
- [ ] `architect:<name>` address grammar resolves correctly when used from another architect — confirmed by integration test that exercises `main` → `architect:ob-refine` and the reverse.

### Functional (SHOULD)
- [ ] When a sibling architect's terminal crashes, the fallback to `main` (already in `tower-messages.ts:336`) is preserved, AND the in-memory map entry is cleared or marked stale so subsequent routing decisions reflect reality.
- [ ] Dashboard tab labelling is consistent and discoverable when there are siblings (e.g. `main`'s tab is clearly labelled "main" rather than appearing nameless next to named siblings).

### Functional (COULD)
- [ ] Right-pane (builder/shell) tabs gain a close affordance for tabs that represent closable entities. Scope is bounded — see Open Questions.

### Non-Functional
- [ ] No reduction in test coverage on touched files. New code adds unit tests for naming validation, the remove flow, and persistence round-trip; integration tests for cross-architect messaging and crash recovery.
- [ ] Persistence operations (write on add, delete on remove, read on restart) complete in <100ms per architect — bounded by SQLite I/O, no spinning waits.
- [ ] The verify phase manually exercises the headline round-trip (add → builder spawn → `afx send architect` → land on sibling) on a real workspace, not just in tests. This is the explicit lesson from #774 / [[feedback_e2e_headline_path]].

## Constraints

### Technical Constraints
- **No schema migration needed for the `architect` table.** The schema (`id, pid, port, cmd, started_at, terminal_id`) already accommodates siblings; only the write paths need to start using it for non-`main` rows.
- **Tower restart auto-rebind must mirror the builder pattern** (see `tower-instances.ts` builder rebind code) to keep the persistence story coherent. Don't invent a parallel mechanism.
- **The single-workspace assumption holds.** Cross-workspace architect routing remains out of scope (was deferred earlier; stays deferred per issue).
- **Address grammar `architect:<name>` is load-bearing.** Names with `:` break the grammar; validation must reject them.

### Business Constraints
- The next coherent release should ship this. v3.0.9 (publishing the #774 fix) is not blocked by #786, but #786 should be the headline of whatever comes after v3.0.9.
- No time estimates per SPIR convention. Progress is measured in phases completed.

### Out of Scope (from issue, treat as fixed)
- **Cross-workspace routing.** Architects in workspace A cannot address architects in workspace B. Deferred previously; stays deferred.
- **Renaming architects after add.** If wanted, file as a separate small ticket — not part of #786.

## Assumptions
- The `architect` DB table schema added in v9 (spec 755) is correct as-is for siblings. (Validate during plan phase by reading `db/schema.ts`.)
- Tower's builder auto-rebind machinery is generic enough to extend to architects with modest changes, not a rewrite.
- Shannon's `ob-refine` workflow is representative of how external adopters will use sibling architects (one or two siblings, named by role, long-lived).
- The `main` architect is structurally distinct (workspace-defining, undeletable, no close button) and that distinction is acceptable and desirable.

## Solution Approaches

### Approach 1: Full lifecycle + persistence parity (RECOMMENDED)
**Description**: Build out remove-architect, sibling persistence with auto-rebind, close affordances, and surface enumeration as a single coherent feature pass. Treat sibling architects as first-class persisted entities with the same lifecycle as builders.

**Pros**:
- Delivers the issue's stated goal verbatim ("the same fluency they have with builders").
- Closes all confirmed gaps in one PR (or one PR per logical phase) rather than dribbling fixes.
- Auto-rebind story is the natural extension of existing builder code, not net-new architecture.

**Cons**:
- Larger surface area to test. Verify phase needs manual round-trips for multiple scenarios.
- Tab close affordance touches dashboard CSS/React in a way that has historically been UI-sensitive (see [[feedback_ui_visual_verification]] — render in browser before approving).

**Estimated Complexity**: Medium
**Risk Level**: Medium — UI work + persistence work + Tower restart paths each carry their own risks. Mitigated by phasing.

### Approach 2: Ephemeral-by-design — document the limitation
**Description**: Decide siblings are explicitly ephemeral. Document that Tower restart clears them. Provide a one-shot script or `afx workspace restore-architects` command that replays the user's previous adds. Skip persistence work entirely.

**Pros**:
- Smaller implementation surface.
- Avoids the complexity of auto-rebind across restarts.

**Cons**:
- Inconsistent with builders, which DO persist. Cognitive overhead for the user.
- Documentation-only fix to gap #3 papers over the underlying asymmetry.
- Shannon's feedback suggests users *expect* persistence; documenting the absence is a worse UX than fixing it.

**Estimated Complexity**: Low
**Risk Level**: Low (small change, but the wrong shape)

### Approach 3: Persistence-only, defer UX and lifecycle to a follow-up
**Description**: Ship the persistence fix in one PR (gap #3 plus #5 crash recovery). File separate tickets for remove-architect (#1), close affordances (#2), and surface enumeration (#8/#9). Multiple small PRs, sequential.

**Pros**:
- Each PR is small and reviewable.
- Persistence is the highest-leverage fix and lands first.

**Cons**:
- Loses the "cohesive feature pass" goal of #786. Issue explicitly asks for the umbrella SPIR treatment.
- Each follow-up risks slipping; the cohesion gets lost across releases.

**Estimated Complexity**: Low per PR, Medium cumulative
**Risk Level**: Medium — cohesion risk

**Recommendation**: Approach 1. The issue scopes #786 as an umbrella SPIR exactly because the gaps interrelate (e.g., `remove-architect` and persistence share the DB write path; close affordance and `remove-architect` are the same user intent surfaced two ways). Splitting them re-creates the v3.0.5 → v3.0.8 problem of shipping pieces that don't compose.

## Open Questions

### Critical (Blocks Progress)
- [ ] **OQ-1: Persistence model.** Confirm Approach 1 (persist + auto-rebind) over Approach 2 (ephemeral-by-design). The plan and implementation are very different depending on the choice. *Architect call at spec-approval gate.*
- [ ] **OQ-2: Right-pane close affordance scope.** Gap #2 mentions builder/shell tabs in the right pane also lack a close button. Is that in scope for #786, or filed as a follow-up? The issue couples them ("architects make it salient"); the spec leans toward including a right-pane close affordance for builder/shell tabs that represent terminable entities, but the architect should pin scope. *Architect call at spec-approval gate.*
- [ ] **OQ-3: Removing a sibling with in-flight builders.** When `remove-architect ob-refine` runs and `ob-refine` spawned builders that are still active, what happens to those builders? Options: (a) refuse to remove until builders are cleaned up; (b) remove and let the existing `tower-messages.ts:336` fallback route their messages to `main`; (c) prompt the user. *Architect call at spec-approval gate.*

### Important (Affects Design)
- [ ] **OQ-4: Crash detection mechanism.** Should crash detection be passive (lazy — discover on next route attempt) or active (Tower polls/heartbeats architect terminals)? Passive is cheaper and matches the existing fallback; active is more responsive. Lean passive unless there's a use case for active.
- [ ] **OQ-5: VSCode extension shape.** Does VSCode get a tab-strip equivalent in the Workspace sidebar (one entry per architect with click-to-open), or a single "Architects" expandable section, or stay at one entry and require dashboard for multi-architect? Lean toward one-entry-per-architect for parity, but VSCode UX patterns may suggest the section approach.
- [ ] **OQ-6: Naming rules — full set.** Draft rules in the spec are: not `main`, no `:`, non-empty after trim, no whitespace. Plan should confirm against existing `validateArchitectName()` and align (or replace) it. Also: max length? Allowed character set (`[a-zA-Z0-9_-]`)? Lean toward kebab-case-friendly subset.

### Nice-to-Know (Optimization)
- [ ] **OQ-7: Should `afx status` show sibling architects by default, or behind a `--verbose` flag?** Avoiding output bloat in single-architect workspaces argues for default-show-only-when-N>1, but consistency argues for always-show. Lean toward always-show for predictability.
- [ ] **OQ-8: Dashboard tab labelling for `main` when siblings exist.** Today the `main` tab might appear unlabelled (or labelled "architect") next to a named sibling. Should it always say "main"? Cosmetic but worth pinning.

## Performance Requirements

- **Architect persistence I/O**: <100ms per write/delete (SQLite-bound, no network).
- **Tower restart auto-rebind**: rebinds N architects in <2s for N ≤ 8 (matches builder rebind ceiling).
- **`afx status` output time**: no regression vs current — the extra enumeration is a Tower-side query on already-loaded state.
- **Dashboard tab strip render**: no measurable regression for N ≤ 8 architects.

## Security Considerations

- **Address grammar collisions**: Names containing `:` would let a user spoof a different address (e.g. `architect:ob:something` could parse ambiguously). Validation rejects them.
- **Reserved name `main`**: Cannot be added or removed by user input. Hardcoded in validation.
- **Persistence file location**: `state.db` is already a workspace-private file with the existing trust model. No new exposure.
- **Architect-to-architect messaging**: Already exists via `architect:<name>` — this spec documents and tests it but does not change the trust model. All architects in a workspace are equally trusted; no per-architect ACLs.

## Test Scenarios

### Functional Tests
1. **Happy path — add, use, remove**: Add sibling `ob-refine`. Spawn a builder from it. `afx send architect` from the builder lands on `ob-refine`'s terminal. `remove-architect ob-refine`. Sibling gone from in-memory map, DB, and dashboard. Builder's subsequent `afx send architect` falls back to `main`.
2. **Persistence round-trip**: Add sibling, stop Tower (`afx tower stop`), restart Tower (`pnpm -w run local-install` or equivalent), verify sibling is back in the in-memory map and dashboard, with a working PTY.
3. **Crash recovery — sibling architect dies**: Kill the sibling's terminal process directly. Subsequent `afx send` from its builder falls back to `main` per the existing fallback chain; in-memory map entry is cleared or marked stale.
4. **Naming validation**: Reject `main`, empty string, whitespace-only, names with `:`, names with spaces. Accept `ob-refine`, `team-a`, `_internal`.
5. **Architect-to-architect**: From `main`'s terminal, send to `architect:ob-refine` — lands on ob-refine. From `ob-refine`'s terminal, send to `architect:main` — lands on main.
6. **Surface enumeration**: `afx status` lists `main` and any siblings with PID/port/terminal_id. VSCode sidebar shows one entry per architect.
7. **Dashboard close affordance**: Click X on sibling tab → architect is removed (same as CLI remove). Close button absent on `main` tab.
8. **Remove-with-in-flight-builders**: Behaviour per OQ-3 resolution. Test exercises the resolved behaviour.

### Non-Functional Tests
1. **Persistence performance**: Add 8 architects, restart Tower, time the rebind. Assert <2s total.
2. **No coverage regression**: Coverage report on touched files matches or exceeds pre-change baseline.
3. **UI smoke (Playwright)**: Render dashboard with N=1, N=2, N=3 architects. Visually verify tab strip, close button presence, labels per [[feedback_ui_visual_verification]].

## Dependencies

- **External Services**: None.
- **Internal Systems**: 
  - `packages/codev/src/agent-farm/db/schema.ts` (schema, no changes expected)
  - `packages/codev/src/agent-farm/state.ts` (`setArchitectByName`, `removeArchitect`)
  - `packages/codev/src/agent-farm/servers/tower-instances.ts` (rebind path, in-memory map)
  - `packages/codev/src/agent-farm/servers/tower-messages.ts` (fallback chain, stale detection)
  - `packages/codev/src/agent-farm/commands/workspace-add-architect.ts` (sibling write path)
  - `packages/codev/src/agent-farm/commands/status.ts` (enumeration)
  - `packages/dashboard/src/components/ArchitectTabStrip.tsx` (close affordance, labelling)
  - `packages/dashboard/src/components/TabBar.tsx` (right-pane close, if in scope per OQ-2)
  - `packages/dashboard/src/hooks/useTabs.ts` (`closable` flag wiring)
  - `packages/vscode/src/views/workspace.ts` (sibling surfacing)
- **Libraries/Frameworks**: None new.

## References

- Issue [#786](https://github.com/cluesmith/codev/issues/786) — umbrella issue, this spec is its formalisation
- PR #757 / Spec 755 — multi-architect primitive (v3.0.5)
- PR #762 / Spec 761 — dashboard tab strip (v3.0.6)
- PR #775 / Bugfix #774 — routing fix (v3.0.8)
- [[feedback_e2e_headline_path]] — the lesson that drove the verify-phase round-trip requirement
- [[feedback_ui_visual_verification]] — render-in-browser requirement for UI changes
- `codev/resources/arch.md` — Tower / shellper architecture overview

## Risks and Mitigation

| Risk | Probability | Impact | Mitigation Strategy |
|------|------------|--------|-------------------|
| Tower restart rebind path subtly differs from builder rebind, regressions in builder persistence | Medium | High | Plan phase reads existing builder rebind code carefully before designing the sibling architect equivalent; CMAP reviewers explicitly asked to check parallels |
| Close affordance changes ripple into right-pane tabs without intent | Medium | Medium | Scope explicitly per OQ-2 at spec-approval; CSS/React changes verified visually with Playwright at N=1/2/3 architects |
| Architect-to-architect messaging has unexpected behaviour discovered during testing (e.g. `main` is hardcoded somewhere) | Low | Medium | Verify-phase test exercises both directions; plan phase greps for hardcoded `'main'` usage |
| Naming validation breaks an existing user's workflow (e.g. they're using a name we now reject) | Low | Medium | Validation applies only to new adds, not on rebind from existing DB rows. Existing siblings keep their names |
| Persistence write fails silently during `add-architect` and leaves in-memory and on-disk state divergent | Low | High | Write to DB *before* returning success to CLI; if DB write fails, roll back the in-memory add and return error |
| Crash recovery path is implementation-defined and CMAP reviewers each propose different "correct" behaviours | Medium | Low | OQ-4 resolves this at spec-approval; CMAP reviewers operate against the resolved decision |

## Expert Consultation
<!-- Filled in after porch runs CMAP consultations -->
**Date**: TBD
**Models Consulted**: Gemini, Codex, Claude (per porch CMAP default)
**Sections Updated**:
- _Pending consultation_

## Approval
- [ ] Architect Review (spec-approval gate)
- [ ] Expert AI Consultation Complete (CMAP via porch)

## Notes

This spec deliberately leaves three things to the architect at the spec-approval gate (OQ-1, OQ-2, OQ-3), because each affects the plan phase materially. The other open questions can be resolved during planning.

The verify phase MUST include manual exercise of the headline value prop on a real workspace, per [[feedback_e2e_headline_path]]. Automated tests are necessary but not sufficient — the v3.0.5 → v3.0.7 routing break passed unit tests for 3 versions.

---

## Amendments

<!-- TICK amendments tracked here if needed in future. None at draft time. -->
