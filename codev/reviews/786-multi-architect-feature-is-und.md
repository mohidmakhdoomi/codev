# Review: Multi-Architect Feature — Lifecycle, Persistence, and UX

**Spec**: [codev/specs/786-multi-architect-feature-is-und.md](../specs/786-multi-architect-feature-is-und.md)
**Plan**: [codev/plans/786-multi-architect-feature-is-und.md](../plans/786-multi-architect-feature-is-und.md)
**Issue**: [#786](https://github.com/cluesmith/codev/issues/786) (closes; also folds [#764](https://github.com/cluesmith/codev/issues/764))

## Summary

The multi-architect feature (Specs 755, 761, 774) shipped its primitive in v3.0.5 — `afx workspace add-architect` worked, the dashboard rendered tabs, and the architect:`<name>` address grammar resolved. But the feature was not yet a coherent product. Shannon's external adopter feedback exposed: no way to remove a sibling, siblings disappearing on graceful stop, surface gaps (`afx status` and VSCode collapsed multi-architect into a single entry), and identity loss on shellper auto-restart.

This spec/plan/implementation closes those gaps in seven phases:

1. **Foundation utilities** — `validateArchitectName` rejects reserved `main`, new `removeArchitect(name)` helper, `clearRuntime()` split (preserves architect registry vs. full `clearState()` wipe).
2. **Identity preservation** — `tower-terminals.ts` reconciliation paths now inject `CODEV_ARCHITECT_NAME` on shellper auto-restart so builders spawned after a sibling restart retain affinity.
3. **Graceful-stop persistence** — Intentional-stop flag in `tower-instances.ts` suppresses cascaded exit-handler deletion of `state.db.architect` rows during `afx workspace stop`. `launchInstance` creates `main` first then reconciles persisted siblings via `addArchitect`. `commands/stop.ts` switches to `clearRuntime`. Six exit handlers honour the intentional-stop signal; permanent exit (max-restart) still auto-deletes rows per OQ-B.
4. **remove-architect + dashboard UX + #764** — New CLI command + REST `DELETE` endpoint + Tower handler; dashboard close button on sibling tabs with confirmation modal (lists in-flight builders); active-tab fallback to `main` when active sibling is removed; #764 solo-architect tab label restored to `'Architect'` at N=1.
5. **Surface enumeration** — v1 single-Architect collapse at `tower-terminals.ts:928-940` replaced with per-architect emission. `loadState()` collection-aware (main-first). `afx status` enumerates all architects (Tower-up: name + PID + terminal id; Tower-down: name + cmd + "Tower not running" note). Tower `/status` API extended with `architectName/pid/port/terminalId` fields.
6. **VSCode multi-architect surface** — Expandable "Architects" tree section with one child per architect. `terminal-manager.ts` keys terminal slots by architect name (`architect:${name}`). Parameterised `codev.openArchitectTerminal` + new `codev.removeArchitect` command + right-click context menu gated on `viewItem == workspace-architect-sibling`. `codev.referenceIssueInArchitect` always targets `main` (documented Phase 6 decision).
7. **Documentation + verify scaffolding** — `agent-farm.md`, `arch.md`, CHANGELOG, and `verify-scenarios.md` with 12 manual round-trip scenarios.

## Spec Compliance

All MUST and SHOULD criteria from the spec are satisfied:

- [x] `afx workspace remove-architect <name>` exists; refuses `main`; refuses unknown; permits remove-with-in-flight-builders per OQ-A.
- [x] Sibling architect rows survive `afx workspace stop` + `start` and `afx tower stop` + start.
- [x] Identity preservation on shellper auto-restart (Phase 2).
- [x] Sibling tabs carry close affordance via confirmation modal (Phase 4).
- [x] `afx status` enumerates ALL architects in both Tower-up and Tower-down modes (Phase 5).
- [x] VSCode "Architects" expandable section (Phase 6) — OQ-D resolved.
- [x] `validateArchitectName` rejects reserved name `main` (Phase 1).
- [x] `architect:<name>` address grammar resolves correctly (verified end-to-end via the existing routing chain).
- [x] Active-tab fallback on sibling removal lands on `main` (Phase 4 MUST).
- [x] User-facing docs updated: `agent-farm.md`, `arch.md`, CLI `--help`, CHANGELOG (Phase 7).
- [x] Manual verify scenarios scaffolded for the round-trip (Phase 7 `verify-scenarios.md`).
- [x] #764 mobile-solo-architect tab label fix folded in (Phase 4).
- [x] OQ-A (remove-with-in-flight-builders → fall back to main): per architect direction.
- [x] OQ-B (auto-delete persisted row on permanent exit): per architect direction (override of builder recommendation).
- [x] OQ-D (expandable VSCode "Architects" section): per architect direction.
- [x] OQ-G (confirmation prompt on close, informational sub-decision): per architect direction.

**SHOULD criteria met:**
- [x] Permanent-exit auto-delete of `state.db.architect` row + fallback to `main` routing (Phase 3).
- [x] `main`'s tab labelled consistently per `useTabs.ts` and Spec 761's first-architect-is-bare-id design.
- [x] Dashboard active-tab survives sibling removal cleanly (promoted to MUST in spec iter-3).
- [x] Permanent-exit row deletion handled across all six exit handlers (Phase 3 + 6th site fix during iter-1 review).

**COULD met:**
- [x] Auto-numbering after remove — gap-fill behaviour preserved via existing `autoNumberArchitectName`.

## Deviations from Plan

- **VSCode unit tests as source-level sentinels rather than runtime tests with mocked `vscode` module.** The plan called for `workspace.ts` and `terminal-manager.ts` unit tests. Instantiating either requires substantial vscode-API mocking; instead, the iter-2 commit added vitest infrastructure to the vscode package and wrote source-level sentinel tests (21 tests across three files) that read the source files and assert on key invariants (per-name keying, contextValue split, command.arguments shape). Runtime behaviour is exercised by the verify phase's manual round-trip.
- **Architect-to-architect routing automated test deferred to verify phase.** Plan's Phase 5 test plan called for an automated test driving messages between two architects via PTY input/output assertions. The existing `spec-755-phase3-routing.test.ts` covers the routing logic at the unit level; a true end-to-end PTY round-trip is the manual verify-phase Scenario 8.
- **`afx workspace stop-all` is API-only.** The spec/plan referred to `afx workspace stop-all` in places as if it were a CLI command. It's actually a Tower-side route at `tower-routes.ts:handleWorkspaceStopAll`, reachable only via the dashboard's stop-all button or `POST /workspace/<base64>/api/stop`. Docs in `agent-farm.md` and `verify-scenarios.md` corrected during Phase 7 iter-1 CMAP rebuttal.

## Lessons Learned

### What went well

- **Phasing.** Seven phases with clear dependencies meant CMAP feedback was contained per phase and the overall PR didn't grow unwieldy. Phase 3's intentional-stop flag was the riskiest change and received the most review attention; later phases inherited its semantic foundation and progressed faster.
- **Spec-level CMAP exposed inaccurate diagnoses.** Iter-1 of the spec CMAP caught that gap #3 (persistence) was misdiagnosed — siblings were already persisted on add; the real gap was graceful-stop deleting rows. Without CMAP, the plan would have implemented a different (wrong) fix.
- **Architect's iter-3 OQ resolutions** locked four blocking design decisions (OQ-A through OQ-G) at the spec-approval gate, so the plan and implementation didn't re-litigate them. OQ-B's "auto-delete on permanent exit" was explicitly an override of the builder's recommendation — and it was the right call (keeps state.db an accurate mirror, no ghost rows).
- **CMAP found 6 exit handlers when the plan thought there were 5.** Claude's iter-1 review of Phase 3 caught the on-the-fly reconnect handler at `tower-terminals.ts:842-855` that the plan's grep-survey had missed. Patched during Phase 3 iter-1 rebuttal — would have been a subtle persistence bug if shipped.
- **The architect's #764 fold-in at spec-approval** (5-line change in `buildArchitectTabs`) composed cleanly into Phase 4's existing close-button work. Both touch `useTabs.ts:52`; one PR, two issues closed.

### Challenges encountered

- **Workspace-scoping of `state.db.architect` is architecturally ambiguous in multi-workspace Tower deployments.** Codex's Phase 3 review (Co1) flagged that `state.db` is process-local to Tower, not per-workspace. Spec 786 explicitly puts cross-workspace out of scope, so the issue is real but predates this spec. Filed mentally as a follow-up; rebutted in Phase 3 rebuttal with the spec's out-of-scope language.
- **Test-infrastructure cost vs. coverage.** Phase 6 (VSCode) had no vitest setup; setting one up to satisfy reviewers cost ~20 minutes of yak-shaving. Source-level sentinel tests are a reasonable compromise but leave runtime behavioural gaps the verify phase has to catch.
- **The `terminal-sessions` orphan question.** Claude's plan iter-2 Cl2 finding (stale `terminal_sessions` rows on workspace stop+start) drove a simplification: keep `deleteWorkspaceTerminalSessions` as a full wipe in `stopInstance`; rely on `state.db.architect` rows alone for sibling restoration via the `addArchitect` path. Eliminated the orphan-row class of bugs at the cost of fresh PTY sessions on each stop+start (no functional impact).

### Methodology improvements

- **Pre-iter-1 code verification.** The spec went to iter-1 CMAP with several factually-wrong gap diagnoses (claims that didn't match current code). A pre-iter-1 verification pass would have caught these before reviewers' time was spent. Future SPIRs should include "verify current code state" as a mandatory sub-step of spec drafting when the spec describes existing behaviour.
- **Carry "architect plan-time notes" forward visibly.** The architect's spec-approval direction included one item ("pin active-tab state handling when sibling is removed") that was easy to lose between spec and plan. Worth surfacing these notes explicitly in plan deliverables so the builder doesn't have to scroll back.
- **CMAP convergence pattern.** The architect's "don't skip iter-2 CMAP" directive (spec-phase) shaped the rhythm: build → CMAP → rebut → re-CMAP. The pattern worked well — most phases converged in 1-2 iterations. Phase 5 took 2 iterations because Codex's "terminal ID vs tab ID" finding was real and not anticipated by the plan.

## Consultation Feedback

### Specify Phase (Round 1)

#### Gemini — REQUEST_CHANGES
- **Concern**: Several factual inaccuracies in the spec's "Known Gaps" table — sibling architects ARE persisted via `setArchitectByName`; right-pane tabs DO have close buttons; the actual persistence gap is in graceful-stop, not add.
  - **Addressed**: Iter-2 spec rewritten — gap diagnoses corrected via direct code verification.
- **Concern**: `v1` collapse logic in `tower-terminals.ts:928-940` needs explicit removal as a deliverable.
  - **Addressed**: Added explicit MUST in iter-2 spec.
- **Concern**: `validateArchitectName` accepts `main` (regex matches); needs reserved-name check.
  - **Addressed**: Added MUST in iter-2 spec.

#### Codex — REQUEST_CHANGES
- **Concern**: Spec inaccurately describes write-path gap; siblings already persisted.
  - **Addressed**: Same fix as Gemini.
- **Concern**: OQ-A (remove with in-flight builders) is blocking, not advisory.
  - **Addressed**: Marked as architect-blocking; resolved by architect at spec-approval.
- **Concern**: Naming examples in spec (`_internal`) don't match existing validator regex.
  - **Addressed**: Iter-2 examples use valid names.
- **Concern**: Restart identity preservation needs explicit acceptance criterion.
  - **Addressed**: New MUST added (Phase 2's `CODEV_ARCHITECT_NAME` re-injection).

#### Claude — COMMENT
- **Concern**: Gap #3 description is wrong (write path works; the issue is stop/restart lifecycle).
  - **Addressed**: Same fix as Gemini/Codex.
- **Concern**: "Mirror the builder pattern" misleading; builders and architects already share reconciliation path.
  - **Addressed**: Reworded to "extend existing reconciliation path".
- **Concern**: OQ-1 framing should acknowledge that persistence partially works.
  - **Addressed**: Resolved by Approach 1 in iter-2; OQ-1 dropped.

### Specify Phase (Round 2)

#### Gemini — APPROVE (no concerns)
#### Claude — APPROVE (no blocking concerns)
#### Codex — REQUEST_CHANGES
- **Concern**: Graceful-stop persistence not fully specified — exit handlers already delete rows on terminal death; spec must distinguish intentional stop from permanent exit.
  - **Addressed**: Iter-4 MUST added enumerating all exit handlers (now 5, later 6).
- **Concern**: VSCode requirement incomplete — terminal slot reuse semantics not pinned.
  - **Addressed**: Iter-4 MUST added pinning per-name keying.
- **Concern**: `afx status` contract unclear — `pid/port` are persisted as 0.
  - **Addressed**: Iter-4 scoped to Tower-running mode for PID/port; fallback mode omits.
- **Concern**: Wrong dependency reference (`workspace-client.ts` doesn't exist).
  - **Addressed**: Corrected to `packages/core/src/tower-client.ts`.

### Specify Phase (Rounds 3-5)

Each successive round had narrower findings:
- **Round 3** Codex flagged `handleWorkspaceStopAll` semantics + active-tab MUST + docs surfaces; all addressed.
- **Round 4** Codex flagged CLI-side `clearState()` seam in `stop.ts`; addressed (Phase 1's `clearRuntime` split).
- **Round 5** Codex COMMENT with three minor clarifications; all incorporated.

### Plan Phase (Round 1)

#### Gemini — APPROVE (endorsed VSCode right-click, /status extension, clearState split)
#### Codex — REQUEST_CHANGES
- **Concern**: `addArchitect` rejects when `entry.architects.size === 0`, breaking the proposed seam.
  - **Addressed**: Plan now pins explicit ordering — create `main` first, then call `addArchitect` for siblings.
- **Concern**: Plan describes JSON-RPC, but transport is REST.
  - **Addressed**: Plan now describes `DELETE /api/workspaces/:encoded/architects/:name`.
- **Concern**: Missing file deliverables (`cli.ts`, `types.ts`, `packages/types/api.ts`, VSCode `package.json`).
  - **Addressed**: All added.
- **Concern**: Test plan gaps (architect-to-architect, tower stop+start, crash recovery automated, timing).
  - **Addressed**: Explicitly listed in plan iter-2.

#### Claude — COMMENT
- **Concern**: `ArchitectTabStrip.tsx` has no close-button rendering at all.
  - **Addressed**: Added to Phase 4 deliverables.
- **Concern**: Intentional-stop flag needs cross-module access pattern.
  - **Addressed**: Plan now pins exported-getter pattern.
- **Concern**: Phase 5 main-first ordering needs pinning.
  - **Addressed**: Pinned in Phase 3 reconciliation loop.

### Plan Phase (Round 2)

All three reviewers at APPROVE or COMMENT (no REQUEST_CHANGES). Gemini and Claude APPROVE; Codex COMMENT with two finishing-touch points (dashboard `api.ts` + `App.tsx` modal ownership; commit to right-click context menu) both incorporated.

### Implementation Phase 1 (Foundation)

All three reviewers APPROVE. No concerns raised.

### Implementation Phase 2 (Identity preservation)

#### Gemini, Codex — REQUEST_CHANGES (same finding)
- **Concern**: Test coverage only verifies reconciliation path, not `getTerminalsForWorkspace` on-the-fly reconnect path.
  - **Addressed**: Added second test exercising the second injection site.

#### Codex (additional)
- **Concern**: Stale fallback-branch comment ("without role injection") contradicts code.
  - **Addressed**: Comment updated.

#### Claude — APPROVE (noted gap as non-blocking)

### Implementation Phase 3 (Graceful-stop persistence)

#### Gemini — APPROVE
#### Codex — REQUEST_CHANGES
- **Concern**: Workspace-scoping of `state.db` writes; `getDb()` is Tower-process-local, not per-workspace.
  - **Rebutted**: Pre-existing architecture from Spec 755; spec explicitly puts cross-workspace out of scope. Filed for follow-up.
- **Concern**: Missing tests for launchInstance reconciliation, stop.ts row preservation, stop-all regression.
  - **Addressed**: Added behavioural test, source-level sentinels, and regression test for stop-all.

#### Claude — COMMENT
- **Concern**: 6th exit handler site at `tower-terminals.ts:842-855` missed by plan's 5-site enumeration.
  - **Addressed**: Patched in iter-1 fix (added `setArchitectByName(name, null)` + intentional-stop gate).
- **Concern**: Missing launchInstance reconciliation test + stop-all regression test.
  - **Addressed**: Same as Codex.
- **Concern**: Timing assertions absent.
  - **N/A**: Acknowledged as integration-level for verify phase.

### Implementation Phase 4 (remove-architect + dashboard UX + #764)

#### Gemini, Claude — APPROVE
#### Codex — REQUEST_CHANGES
- **Concern**: `spawnedByArchitect` not surfaced to dashboard `/api/state`; confirmation modal always sees zero in-flight builders.
  - **Addressed**: Extended `Builder` type in `packages/types/api.ts`; populated field in `handleWorkspaceState` via `getBuilders()` lookup; removed `(b as any)` cast in `App.tsx`.
- **Concern**: Missing modal flow tests.
  - **Addressed**: Added 4 tests to `App.architect-tabs.test.tsx`.

### Implementation Phase 5 (Surface enumeration)

#### Claude — APPROVE
#### Gemini — REQUEST_CHANGES
- **Concern**: Missing status-naming.test.ts update + architect-to-architect routing test.
  - **Addressed**: 4 new tests added to status-naming.test.ts; architect-to-architect deferred to verify phase (existing `spec-755-phase3-routing.test.ts` covers the unit-level routing).

#### Codex — REQUEST_CHANGES
- **Concern**: `afx status` prints tab id, not actual PtySession terminal id.
  - **Addressed**: Added `terminalId` field to all TerminalEntry types; populated from session id; updated `status.ts` to prefer `term.terminalId` with fallback.
- **Concern**: Shared `TerminalEntry` type not updated.
  - **Addressed**: Added 4 new optional fields with JSDoc.
- **Concern**: status-naming.test.ts not extended.
  - **Addressed**: Same as Gemini.
- **Concern**: Stale "single Architect terminal entry" comment in tower-terminals.ts.
  - **Addressed**: Comment rewritten.

### Implementation Phase 6 (VSCode multi-architect)

#### Gemini — APPROVE (notes missing tests as acceptable)
#### Codex — REQUEST_CHANGES
- **Concern**: No sidebar refresh on architect add/remove.
  - **Addressed**: Added `refresh()` method to `WorkspaceProvider`; called from `codev.removeArchitect` after success.
- **Concern**: Missing VSCode unit tests.
  - **Addressed**: Added vitest infrastructure + 21 source-level sentinel tests (3 files).

#### Claude — REQUEST_CHANGES (same findings as Codex)

### Implementation Phase 7 (Documentation + verify scaffolding)

#### Gemini — APPROVE
#### Codex — REQUEST_CHANGES
- **Concern**: `afx workspace stop-all` documented but doesn't exist as a CLI command.
  - **Addressed**: Reworded to "dashboard Stop All / POST API route".
- **Concern**: `afx open architect:ob-refine` in verify scenarios is wrong (`afx open` is file-annotation).
  - **Addressed**: Reworded Scenario 1 to use dashboard click or VSCode sidebar.
- **Concern**: CHANGELOG inaccurately says `afx tower stop` "already worked".
  - **Addressed**: Rewrote entry distinguishing graceful stop (broken pre-786) from crash recovery (worked).

#### Claude — COMMENT
- **Concern**: `agent-farm.md`'s `afx status` section shows pre-786 single-row table.
  - **Addressed**: Rewrote section with new per-architect output examples for both Tower-up and Tower-down modes.

## Architecture Updates

`codev/resources/arch.md` was updated in Phase 7 with a substantial new "Multi-Architect Support (Spec 755 / Spec 786)" section that captures:

- Identity flow (CODEV_ARCHITECT_NAME injection on initial spawn + auto-restart).
- Lifecycle: add, remove, graceful stop, graceful start, crash recovery, permanent exit, stop-all.
- Persistence layers: `state.db.architect`, `terminal_sessions`, in-memory map.
- Surface enumeration: Tower `/status` API extension, `loadState()` collection, `afx status` modes.
- Dashboard surfaces: tab strip, close button, modal, #764 N=1 label.
- VSCode extension: expandable tree, per-name terminal slots, right-click remove, `referenceIssueInArchitect` always-main.
- Session naming convention table updated: `architect:{name}` (was singleton `architect`).

## Lessons Learned Updates

No additions to `codev/resources/lessons-learned.md` in this review. The patterns exercised here (CMAP-driven spec correction, plan-phase risk surfacing, source-level sentinel tests for tightly-coupled codebases) are already covered by existing entries. The two genuinely-new methodology suggestions in the "Methodology improvements" section above are project-specific observations rather than generalizable patterns.

## Flaky Tests

One pre-existing flaky test was encountered:

- **`packages/dashboard/__tests__/scrollController.test.ts`** — the test "warns on unexpected scroll-to-top but does not auto-correct (Issue #630)" expects `console.warn` to be called with `'unexpected scroll-to-top'` but the spy registers zero calls in this builder worktree environment. **Not skipped** — the test was already in the codebase pre-Spec-786 and my changes don't touch the scrollController code. Documented here so the team can investigate; treating it as a pre-existing environmental flake rather than a Spec 786 regression.

## Follow-up Items

- **Workspace-scoping of `state.db.architect`** (Codex Phase 3 Co1). Tower's local `state.db` is process-local, not per-workspace. The spec puts cross-workspace out of scope, but if Tower ever supports multi-workspace architect routing, the architect table needs a `workspace_path` column. Schema migration + state.ts API rework + all Spec 755 callsites. Out of scope for #786; would be a follow-up ticket.
- **Tower-side SSE event for architect add/remove**. Currently `codev.removeArchitect` (VSCode) and the dashboard close button refresh their own views. An `afx workspace add-architect` from the CLI doesn't auto-refresh either surface. A Tower-emitted `architects-updated` SSE event would close that loop. Out of scope for #786 but worth filing.
- **Renaming architects after add**. The spec explicitly puts this out of scope. If wanted, a separate ticket.
- **`codev.referenceIssueInArchitect` chooser**. Per Gemini's spec iter-3 note, the Backlog inline button always targets `main` today. Some users may want it to target the active/expanded architect. If complaints arise, file a follow-up to add a chooser modal.
- **VSCode runtime tests via mocked `vscode` module**. Phase 6 used source-level sentinel tests. Replacing them with full runtime tests would require non-trivial vscode-API mocking. Worth doing if the VSCode surface grows further.
