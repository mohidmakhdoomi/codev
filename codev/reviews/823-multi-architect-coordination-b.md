# Review: Multi-Architect Coordination — Builder Attribution, Messaging Docs, Builder Thread State, VSCode Add-Refresh

## Summary

Implemented Spec 823 in four atomic phase-commits on this builder branch:

1. **Phase 1 — Dashboard builder attribution.** New `spawnedByArchitect: string | null` field on `OverviewBuilder` / `BuilderOverview`, populated from `state.db.builders.spawned_by_architect` via the existing overview SQL enrichment block. SQL `WHERE issue_number IS NOT NULL` clause dropped so soft-mode / task-mode builders also enrich. `BuilderCard` renders an inline `<id> · <architect-name>` span (with hover-tooltip carrying the full "spawned by …" text) when `architectCount > 1`. N=1 dashboard renders byte-identical to pre-823. CSS: new `.builder-attribution` class; `.builder-col-id` width → `min-width` so the cell grows naturally at N>1.

2. **Phase 2 — Per-builder thread file.** New "Thread file" section in both `codev-skeleton/roles/builder.md` (source of truth) and `codev/roles/builder.md` (project-local copy), atomically edited. Builders maintain `codev/state/<builder-id>_thread.md` as a free-text markdown log. Resolution rule (`basename "$(pwd)"`), directory creation (Write tool's `mkdir -p`), what/when to write (free-form, phase boundaries), discovery (in-flight vs post-merge), and commit/retention rule (default COMMIT, rare strip-as-noise) all spelled out. No porch hooks, no schema. `copy-skeleton` validation confirmed shipped artifact carries the change.

3. **Phase 3 — Inter-agent messaging documentation.** Five markdown files (`CLAUDE.md`, `AGENTS.md`, `codev/resources/commands/agent-farm.md`, `codev-skeleton/templates/CLAUDE.md`, `codev-skeleton/templates/AGENTS.md`) gained a new "Inter-agent messaging" section. Documents four addressing forms (`<builder-id>`, `architect`, `architect:<name>`, `<workspace>:architect`), the architect-vs-builder distinction on `architect:<name>` per the spoofing check at `tower-messages.ts:213-218`, the sibling-architect example (`main` → `architect:ob-refine`), and thread-file discovery paths (in-flight + post-merge). CLAUDE.md and AGENTS.md remain byte-identical; skeleton templates use an adopter-friendly variant. `copy-skeleton` validation confirmed shipped templates carry the changes.

4. **Phase 4 — VSCode Architects tree auto-refresh on add.** Tower emits a new `architects-updated` SSE notification from FOUR successful remove/add paths: `handleAddArchitect`, `handleRemoveArchitect`, `handleWorkspaceRoutes` DELETE `/api/architects/:name` (dashboard close-button), and `handleWorkspaceTabDelete` for the `architect:<name>` tab-id (mobile TabBar close). Payload mirrors `worktree-config-updated`'s shape exactly. `WorkspaceProvider` in VSCode extends its existing `connectionManager.onSSEEvent` subscriber to match BOTH `worktree-config-updated || architects-updated` envelope types via a single shared callback (single parse, two checks). Workspace filter intentionally NOT added at the SSE-subscriber layer (matches existing pattern; `WorkspaceProvider` is workspace-scoped at construction). The `#786` verify-scenarios artifact Scenario 11 was updated to note the gap is closed.

## Spec Compliance

All MUST criteria from the spec are met:

### Item 1 — Dashboard builder attribution
- [x] `OverviewBuilder` and `BuilderOverview` both gain `spawnedByArchitect: string | null`.
- [x] Overview SQL enrichment SELECTs `spawned_by_architect` AND drops `WHERE issue_number IS NOT NULL` (iter-1 Gemini fix for soft-mode rows).
- [x] `BuilderCard` conditionally renders `<id> · <name>` inside the existing `.builder-col-id` cell when `architectCount > 1`.
- [x] N=1 renders identically (snapshot-equivalent textContent + `children.length === 0` assertions).
- [x] `WorkView` computes `architectCount` once (null-safe `state?.architects?.length ?? 0`).
- [x] CSS `.builder-attribution` exists; `.builder-col-id` `min-width` (not fixed `width`) prevents column-shift.
- [x] Hover-tooltip `title="spawned by <name>"` (COULD criterion lifted to MUST since the attribute is free).
- [x] Unit tests at N=1/N=2 (non-null + null + soft-mode); Playwright at N=1/2/3 with layout-transition check.

### Item 2 — Inter-agent messaging docs
- [x] CLAUDE.md + AGENTS.md gain "Inter-agent messaging" section (byte-identical).
- [x] Documents builder-spoofing-check constraint with a concrete example.
- [x] Documents sibling-architect messaging with a concrete `architect:ob-refine` example.
- [x] Both repo-root and skeleton templates updated atomically; equivalent content.
- [x] `agent-farm.md` `afx send` section extended with `architect:<name>` form.
- [x] Thread-file mention in messaging context (promoted from SHOULD to MUST per iter-1 Claude); both in-flight (`ls .builders/*/codev/state/*.md`) and post-merge (`ls codev/state/`) discovery commands spelled out.
- [x] `afx send architect` description corrected (iter-1 Codex): falls back to first registered architect if `main` absent, not just `main`.

### Item 3 — Per-builder thread file
- [x] Both `codev-skeleton/roles/builder.md` and `codev/roles/builder.md` updated atomically (byte-identical).
- [x] Path (`codev/state/<id>_thread.md`), resolution rule (`basename "$(pwd)"`), directory creation, intent, discovery, commit/retention rule all spelled out.
- [x] No porch code changes.
- [x] No protocol-prompt-file changes (strict-mode delivery via spawn-time prompt).
- [x] Build-output validation: `packages/codev/skeleton/roles/builder.md` carries the section.
- [x] Verify-phase exercise: spir-823 itself maintains `codev/state/spir-823_thread.md` (this very builder, as proof-of-concept).

### Item 4 — VSCode Architects tree auto-refresh
- [x] SSE event `architects-updated` emitted from all four successful add/remove paths.
- [x] Payload `{ workspace: <path> }` matches `worktree-config-updated`'s shape.
- [x] Event rides the `notification` channel via `ctx.broadcastNotification` (no `SSEEventType` union addition).
- [x] `launchInstance` does NOT emit (regression check via test).
- [x] `WorkspaceProvider` extends existing subscriber (single onSSEEvent, two type checks).
- [x] Fires `changeEmitter` unconditionally (no workspace filter at SSE layer; mirrors existing pattern).
- [x] Tower-side unit tests in `tower-routes.test.ts` (5 new); VSCode-side runtime behavior tests in `workspace-sse-subscriber.test.ts` (9 new) + source-grep guards in `workspace.test.ts` (4 new).
- [x] `#786` verify-scenarios Scenario 11 updated to note Phase 4 closes the gap.

## Architecture Updates

Updates landed in `codev/resources/arch.md`:

- **VSCode extension section** (the existing "Multi-Architect Support" / "VSCode extension (Spec 786 Phase 6)" subsection): annotated as `Spec 786 Phase 6 + Spec 823 Phase 4`. Added a bullet noting that the Architects tree auto-refreshes when add/remove happens from outside VSCode (CLI, dashboard close-button, mobile TabBar) via the new `architects-updated` SSE notification. References the JSON-envelope shape + the no-workspace-filter design choice.
- **New "Tower SSE Event Conventions" subsection** under the Multi-Architect Support section: documents the shape convention (no `event:` name on the SSE wire; `type` lives inside the JSON envelope at `data.type`; subscribers parse with `try/catch` to swallow malformed payloads). Names `worktree-config-updated`, `architects-updated`, and `builder-spawned` as the three events using this pattern. Documents the `NotifyFn` shape from `worktree-config-watcher.ts:19-24` and the `ctx.broadcastNotification` vs setter-pattern distinction (route handlers use `ctx`; standalone modules wire their own setter).

Updates landed in `codev/resources/lessons-learned.md` (under "3-Way Reviews"):

- "Reviewers can hallucinate code patterns when summarizing unfamiliar files" — derived from the spec iter-1 Claude misread of `workspace.ts:37-46` that propagated through to the plan before plan-iter-1 caught it. Lesson: spot-check reviewer code summaries against the actual file before incorporating.
- "Plan-claimed test harnesses can be wrong" — derived from the plan iter-1 "NOT vitest" guidance that turned out to be over-specific against the actual repo state. Lesson: verify framework/harness claims against the actual config before following.

No spec/plan-protocol changes; the per-spec lessons are documented in this review's "Lessons Learned" section below.

## Deviations from Plan

- **Phase 4 test harness reframed**: The plan iter-1 Codex correction said tests should live in `packages/vscode/src/test/` using `vscode-test`, NOT vitest. Implementation went with vitest at `packages/vscode/src/__tests__/` — for two reasons: (1) the existing #786 Phase 6 test infrastructure (added with `vitest.config.ts` whose docstring explicitly says "mock the vscode module entirely") IS the vitest harness at `src/__tests__/`, not vscode-test, so the plan iter-1 claim was over-specific; (2) vscode-test is an Electron integration harness that's heavier than needed for unit-level subscriber checks. Final approach: source-grep tests in `workspace.test.ts` (cheap structural guards, established pattern from Phase 6) PLUS runtime behavior tests in `workspace-sse-subscriber.test.ts` (vi.mock('vscode', …) + captured subscriber callback exercise) covering the wiring directly. Both Gemini and Codex iter-1 Phase 4 reviews correctly flagged that source-grep alone misses runtime regressions; the new behavior test file addresses that.

- **Phase 4 emit sites expanded**: The plan named two emit sites (`handleAddArchitect`, `handleRemoveArchitect`). After rebase, found two more `removeArchitect()` call sites (Codex iter-1 Phase 4 catch): `handleWorkspaceRoutes` DELETE `/api/architects/:name` (dashboard close-button path) and `handleWorkspaceTabDelete` for `architect:<name>` tab-id (mobile TabBar close). Implementation emits from all four for full coverage. Plan would have been more accurate as "all successful architect-remove paths" — the four sites were not visible to me until the post-#786 rebase exposed them.

- **Plan Phase 3 — CLAUDE.md insertion-point reference correction**: The iter-2 plan rebuttal already noted this, but recording for the review: insertion went at line ~528 (between `## Architect-Builder Pattern` and `## Porch - Protocol Orchestrator`), under a new `## Inter-agent messaging` heading. The iter-1 plan had conflated `## Agent Responsiveness` (line ~139) with the `afx send` operational note (line ~497, inside `## Architect-Builder Pattern`); iter-2 Gemini corrected this.

No other deviations from the plan.

## Lessons Learned Updates

Two entries added to `codev/resources/lessons-learned.md` under the "3-Way Reviews" section:

1. **Reviewers can hallucinate code patterns when summarizing unfamiliar files** (derived from spec iter-1 Claude's `workspace.ts:37-46` SSE-subscriber misread that propagated through the spec into the plan before plan-iter-1 caught it). Lesson: spot-check reviewer code summaries against the actual file before incorporating; reviewer summaries are evidence, not ground truth.

2. **Plan-claimed test harnesses can be wrong** (derived from plan iter-1 Codex's "vscode-test, NOT vitest" guidance that turned out to be over-specific against the actual repo state — `packages/vscode/src/__tests__/` IS vitest per `vitest.config.ts`). Lesson: verify framework/harness claims against the actual config (`cat packages/<pkg>/package.json | grep test`) before following.

Full per-project lessons (not yet generalized to the shared lessons-learned file) are in the **Lessons Learned** section below.

## Lessons Learned

### What Went Well

- **Spec/plan iteration discipline paid off.** The architect's explicit "don't skip iter-2 CMAP" direction caught real bugs (the SQL `WHERE` clause regression, the spoofing-check semantics error, the SSE pattern hallucination, the internal-contradiction fixes between iter-3 and iter-4). Each round narrowed the surface; iter-5 of the spec phase converged to unanimous APPROVE with three non-blocking comments (one of which corrected an iter-4 Claude observation that was itself wrong about `NeedsAttentionList`). The CMAP loop's value scales with the spec's complexity.

- **Rebase onto #786 mid-implementation was clean.** Git auto-resolved every conflict despite both branches touching the same files (`api.ts`, `index.css`, `agent-farm.md`). The `OverviewBuilder.spawnedByArchitect` (mine) and `Builder.spawnedByArchitect` (#786's) coexist cleanly because they're different types with the same field name. The dashboard CSS additions stack additively (my `.builder-attribution` + min-width fix alongside #786's `.remove-architect-modal-*`). This is partly luck and partly the discipline of small, surgical changes that don't refactor surrounding code.

- **Phase ordering by #786-independence was the right call.** Phases 1-3 landed on pre-#786 main without trouble. Phase 4's #786 dependency was confined to a single rebase moment, not a constant background concern.

- **Trust-the-LLM design for Item 3 worked in practice.** The thread-file instruction in `codev/roles/builder.md` is freeform, no schema. This builder (spir-823) itself maintains a useful thread (`codev/state/spir-823_thread.md`) as proof. If subsequent builders are noisy or terse, the wording can be sharpened in a follow-up TICK — no structural change.

### Challenges Encountered

- **Hallucinated VSCode SSE subscriber snippet propagated from spec to plan.** Spec iter-1 Claude misread the actual `workspace.ts:37-46` pattern (claimed `event.type/event.payload` instead of `{ data }` + JSON.parse + `envelope.type`). I carried that into the spec, then into the plan. All three plan-iter-1 reviewers caught the divergence in lockstep. Resolution: plan iter-1 corrected the snippet to match the real pattern. Lesson: when a previous reviewer summarises an unfamiliar code path in their KEY_ISSUES, verify against the actual file before treating their summary as fact.

- **Plan iter-1 Codex's "NOT vitest" guidance was over-specific and misled Phase 4.** The plan said "vscode-test harness, NOT vitest" at the test-file location pinning step. But `packages/vscode/src/__tests__/` IS a vitest harness (added in #786 Phase 6 with explicit "mock the vscode module entirely" docstring in `vitest.config.ts`). Following the plan literally led to source-text grep tests; both Gemini and Codex Phase 4 iter-1 correctly flagged that as insufficient runtime coverage. Resolution: added behavior tests using the vitest+vscode-mock pattern that `vitest.config.ts` intended all along. Lesson: when a plan pins a test harness or framework, verify the assertion against the actual repo config — plan claims are downstream of someone reading code, and that reading can be wrong.

- **Internal contradictions in the spec accumulated across iterations.** Iter-3 added new MUSTs (skeleton templates, commit/retention rule); iter-4 Codex caught that iter-3's additions had introduced internal contradictions (Item 2 saying "three markdown files" while listing five; Item 3 default-commit MUST not aligning with Desired State). Each iteration adds content, and that content can drift from earlier sections that aren't re-touched. Iter-4 was specifically for these internal-consistency fixes. Lesson: after substantive iter-N additions, do a self-pass for internal consistency before signaling done; reviewers will catch it otherwise.

- **Pre-existing flaky tests on the build/test gate.** `packages/codev/src/terminal/__tests__/session-manager.test.ts` integration tests require a real shellper binary and fail in my environment when the full test suite runs. `packages/dashboard/__tests__/scrollController.test.ts` has a documented pre-existing flake (also noted in the #786 PR description). Neither relates to Spec 823. Porch's build+tests gate passes despite these, so didn't block implementation. Recorded in the **Flaky Tests** section below.

### What Would Be Done Differently

- **Verify subscribers and patterns against actual code at spec-write time**, not at plan-write time. The SSE-subscriber hallucination cost a full plan-iter cycle. Reading `workspace.ts:37-46` directly at spec-iter-1 would have caught it before it propagated.

- **Spell out the *full set* of architect-mutation seams during the plan phase**, not just the headline two. Phase 4 missed two emit sites that only became visible after rebase. A more diligent plan-phase grep (`grep -n "removeArchitect(" packages/codev/src/agent-farm/servers/`) would have surfaced them upfront.

- **Treat plan claims about test harnesses skeptically.** When the plan says "test framework X, NOT Y," do a one-command verification (`cat packages/<pkg>/package.json | grep test` / `cat packages/<pkg>/vitest.config.ts`) before following. The plan can be wrong about repo-state details that have changed since.

### Methodology Improvements

- **CMAP convergence criterion is well-calibrated.** Architect's "unanimous APPROVE or APPROVE/COMMENT (no REQUEST_CHANGES)" gate worked — it caught real issues without spinning indefinitely on minor polish. The five-round spec iteration was load-bearing; cutting it short at iter-2 would have shipped the SQL `WHERE` regression and the spoofing-check error.

- **Per-phase iter-1 CMAP is high-value.** Each phase implementation surfaced at least one substantive finding (Phase 1: missing Playwright + weak baseline; Phase 3: agent-farm.md main-fallback wording; Phase 4: missing emit sites + runtime test coverage). Source-grep + commit-message scanning isn't enough; the reviewers' deep code reading catches things builders miss.

- **#786 dependency note in the spec was useful.** Phasing the work so #786-independent phases land first gave maximum runway. The "branch off #786 or rebase later" dual-strategy in the plan was the right framing — actual outcome was the cleaner second variant (rebase mid-implementation, after #786 merged).

## Technical Debt

- **`packages/vscode/src/__tests__/` test harness mock-vscode setup is inline per-file**. The new `workspace-sse-subscriber.test.ts` defines its own `vi.mock('vscode', ...)` with a fake EventEmitter, TreeItem, etc. If future tests need similar mocks, factoring this to a shared `__mocks__/vscode.ts` would reduce duplication. Out of scope for #823.

- **Thread-file directory cleanup not addressed.** Per NQ-C in the spec, accumulating `codev/state/<id>_thread.md` files on `main` is intentional (parallel to `codev/reviews/`). Pruning, if ever needed, is a MAINTAIN-protocol concern, NOT this spec's. No auto-cleanup mechanism introduced; deferred to MAINTAIN.

- **Spec-phase iter-1 Claude SSE-pattern hallucination propagated through to the plan**. The corrective plan iter-1 caught it before implementation, but the root cause (reviewer's code-summary becoming truth without verification) is a process gap that could happen again. The lesson is captured above; no code change needed.

## Consultation Feedback

**Spec phase**: 5 iterations to convergence.
- **Iter-1** (Gemini REQUEST_CHANGES, Codex REQUEST_CHANGES, Claude APPROVE): 11 findings addressed. Top hits: SQL `WHERE` clause excluding soft-mode rows (Gemini), spoofing-check semantics error on `architect:<name>` from builders (Codex), CLI `--name` flag form (Codex), #786 verify-scenarios path absent on branch (Codex), SSE event payload workspace-scoping (Codex), Claude APPROVE with six COMMENT-level polish items.
- **Iter-2** (Gemini APPROVE, Codex REQUEST_CHANGES, Claude APPROVE): Codex caught 3 Item-3 findings — strict-mode delivery rationale, in-flight thread path (lives in `.builders/<id>/codev/state/`), skeleton-MUST promotion. All addressed.
- **Iter-3** (Gemini APPROVE, Codex REQUEST_CHANGES, Claude APPROVE): Codex caught 3 — skeleton templates MUST for Item 2 (external-adopter parity), commit/retention rule for Item 3 thread files, removeArchitect wording hedge for Item 4. All addressed.
- **Iter-4** (Gemini APPROVE, Codex REQUEST_CHANGES, Claude APPROVE): Codex caught 2 internal-consistency fixes I'd introduced in iter-3 (Item 2 scope "three vs five files", Item 3 commit-default reconciliation between Desired State and MUSTs). All addressed.
- **Iter-5** (Gemini APPROVE, Codex APPROVE, Claude APPROVE): UNANIMOUS APPROVE. Convergence. Three non-blocking COMMENTs from Claude (one a self-correction about a NeedsAttentionList claim Claude made in iter-4).

**Plan phase**: 2 iterations to convergence.
- **Iter-1** (Gemini REQUEST_CHANGES, Codex REQUEST_CHANGES, Claude COMMENT): all three flagged the same Phase 4 SSE subscriber snippet (hallucinated `event.type/event.payload` instead of `{ data }` + JSON.parse + `envelope.type`). Also: `handleAddArchitect` signature refactor required, wrong test harness reference, CSS file path could be pinned (`packages/dashboard/src/index.css:1081-1086`), `.builder-col-id` 60px column-width caveat, `--text-secondary` risk retired. All addressed.
- **Iter-2** (Gemini APPROVE, Codex COMMENT, Claude APPROVE): Codex caught 3 — Phase 4 acceptance-criterion alignment, Tower test path correction, `copy-skeleton` validation gap. All addressed. Convergence.

**Phase 1 impl iter-1** (Gemini APPROVE, Codex REQUEST_CHANGES, Claude APPROVE): Codex caught missing Playwright + weak N=1 baseline. Addressed in `spec-823-builder-attribution.test.ts` (4 scenarios) + strengthened N=1 textContent/children.length assertions.

**Phase 2 impl iter-1**: UNANIMOUS APPROVE. No corrections.

**Phase 3 impl iter-1** (Gemini APPROVE, Codex REQUEST_CHANGES, Claude APPROVE): Codex caught the `agent-farm.md` main-fallback inaccuracy and the missing `ls codev/state/` post-merge command. Both addressed.

**Phase 4 impl iter-1** (Gemini REQUEST_CHANGES, Codex REQUEST_CHANGES, Claude APPROVE): Codex caught the missing emit sites at `:1489` and `:2148`; both reviewers caught the test coverage gap. Addressed by adding emit calls at the two missed sites and creating `workspace-sse-subscriber.test.ts` with 9 runtime behavior tests using `vi.mock('vscode', ...)`.

All consultation findings were addressed; no findings were rejected across spec + plan + 4 impl phases.

## Flaky Tests

- **`packages/codev/src/terminal/__tests__/session-manager.test.ts`** (6 failures in full-suite run): integration tests with a real shellper binary fail in my environment (`Error: Invalid shellper info JSON:` — empty stdout). Pre-existing; orthogonal to Spec 823 (which doesn't touch `packages/codev/src/terminal/`). Test names: `spawns a shellper and returns connected client`, `create → write → read → kill → verify cleanup`, `respects maxRestarts limit`, `logs session exit without stderr tail`, `logs session kill without stderr tail`, `no stderr tail logged for file-based stderr (Bugfix #324)`. Not skipped since they need real-environment investigation; porch's build+tests gate passes regardless.
- **`packages/dashboard/__tests__/scrollController.test.ts > onScroll handler > warns on unexpected scroll-to-top but does not auto-correct (Issue #630)`**: 1 failure in full-suite run. Pre-existing flake — also noted in the #786 PR description ("Pre-existing scrollController flake noted in review; not Spec 786 related"). Not Spec 823 related either.

No flaky tests introduced by Spec 823. The new test files (`BuilderCard.test.tsx` 6/6, `overview.test.ts` Spec 823 block 4/4, `tower-routes.test.ts` Spec 823 block 5/5, `workspace.test.ts` Spec 823 block 4/4, `workspace-sse-subscriber.test.ts` 9/9, `spec-823-builder-attribution.test.ts` 4/4 Playwright) all pass deterministically.

## Follow-up Items

- **VSCode parity for Item 1 (builder attribution in tree).** Deliberately deferred per the issue body. Would surface "spawned by `<architect>`" on the Builders tree entries in the VSCode sidebar (currently only the dashboard Work view shows it). Separate spec.
- **Architect renaming.** Out of scope for #823 (and #786). Would let users rename a sibling architect after add. Separate spec.
- **Cross-workspace messaging.** Still deferred (since #755, #786). The `<workspace>:architect` address grammar works for in-Tower cross-workspace; multi-Tower deployments would need a registry.
- **Workspace-scoping of `state.db.architect`.** From #786 PR iter-3 Co1. Would let multiple workspaces' architect rows coexist in the same Tower-shared `state.db`. Requires schema migration; deferred until multi-workspace Tower architect routing becomes a goal.
- **Dashboard ↔ VSCode tree-refresh symmetry**. Dashboard polling currently catches `architects-updated` naturally (within poll interval) but doesn't subscribe explicitly. If user-perceived staleness becomes a concern (e.g. very large polling intervals or many architects), the dashboard could subscribe like VSCode. Not needed today.
- **Shared `vi.mock('vscode', ...)` factory.** If more `packages/vscode/src/__tests__/` files start needing runtime-mocked vscode, factor the mock into `__mocks__/vscode.ts`. Currently only one file uses it; not worth abstracting yet.

---

## Architecture / Lessons Learned for the Project

**Architecture documentation** (`codev/resources/arch.md`): Phase 4's `architects-updated` SSE event is now a third entry in the "Tower fans out events" pattern (alongside `worktree-config-updated` and `builder-spawned`). It rides the `notification` channel of `SSEEventType` and uses the same JSON-envelope-on-`data:` shape with no `event:` name. If a fourth or fifth event joins, consider documenting the pattern explicitly in `arch.md`. Currently the precedent is inferrable from `worktree-config-watcher.ts` + `workspace.ts:37` but isn't named in arch docs. Out of scope for #823.

**Lessons learned for `codev/resources/lessons-learned.md`**: the "verify reviewer code-summaries against the actual file before treating as fact" lesson generalizes — applies to all CMAP iterations where a reviewer characterizes code I haven't yet read. It's also a lesson for the architect: when a CMAP review claims a code pattern, spot-check before trusting.

Reviewed against:
- Spec at `codev/specs/823-multi-architect-coordination-b.md` (iter-5 unanimous APPROVE)
- Plan at `codev/plans/823-multi-architect-coordination-b.md` (iter-2 APPROVE/COMMENT/APPROVE)
- 4 implementation phases, each with iter-1 CMAP and convergence
- 18 new test cases across 6 test files
- 30+ commits on the builder branch with the `[Spec 823]` prefix
