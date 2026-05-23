# spir-823 thread

## 2026-05-22 — Project kickoff

Spawned for #823 (multi-architect coordination follow-up to #786). Four deliverables: dashboard builder attribution, inter-agent messaging docs, per-builder thread file, VSCode Architects tree auto-refresh on add.

## 2026-05-22 — Spec phase (5 iterations to convergence)

Spec took 5 CMAP rounds. Highlights:

- **Iter-1** (Gemini REQUEST_CHANGES, Codex REQUEST_CHANGES, Claude APPROVE): caught a SQL `WHERE issue_number IS NOT NULL` clause that would have excluded soft-mode builders from the attribution enrichment, a spoofing-check semantics error (builders can't override their spawning architect via `architect:<name>`), the wrong CLI flag form (`--name <name>`, not positional), the wrong `#786` verify-scenarios path (didn't exist on this branch), and the SSE event needing workspace scoping.
- **Iter-2** (Codex REQUEST_CHANGES on Item 3): three findings — strict-mode delivery rationale, in-flight thread path (lives in `.builders/<id>/codev/state/`, not `main/codev/state/`), skeleton-MUST promotion.
- **Iter-3** (Codex REQUEST_CHANGES): skeleton templates MUST for item 2, explicit commit/retention rule for item 3, removeArchitect wording hedge.
- **Iter-4** (Codex REQUEST_CHANGES): internal-contradiction fixes I introduced in iter-3 (Item 2 scope "three vs five markdown files", Item 3 commit-default reconciliation).
- **Iter-5**: UNANIMOUS APPROVE. Convergence.

Architect locked OQ-B (visual style `#0042 · ob-refine`) pre-approval. Spec-approval gate approved.

## 2026-05-22 — Plan phase (2 iterations to convergence)

Plan took 2 CMAP rounds:

- **Iter-1** (unanimous on Phase 4 SSE pattern): I'd carried a hallucinated VSCode SSE subscriber snippet from the spec phase's iter-1 Claude review. Actual pattern at `workspace.ts:37-46` destructures `{ data }`, parses JSON envelope, checks `envelope.type` — not the `event.type/event.payload` I'd written. All three reviewers flagged. Also caught: `handleAddArchitect` doesn't currently take `ctx` (signature refactor required), wrong test harness reference (`src/test/` + vscode-test instead of `src/__tests__/` + vitest — though this turned out to be over-specific itself; see Phase 4 iter-1 note below), CSS file path could be pinned (`packages/dashboard/src/index.css:1081`), `.builder-col-id` 60px column-width caveat, `--text-secondary` already exists.
- **Iter-2**: APPROVE/COMMENT/APPROVE. Codex's COMMENT-level findings (Phase 4 acceptance-criterion alignment, Tower test path correction, copy-skeleton validation gap) all addressed. Convergence.

Plan-approval gate approved.

## 2026-05-22 — Phase 1 (dashboard builder attribution)

Type field on OverviewBuilder + BuilderOverview, SQL enrichment update (drop WHERE, conditional assignment), BuilderCard render, WorkView prop threading, CSS. 6 unit tests + 4 overview enrichment tests passed first run.

Iter-1 CMAP REQUEST_CHANGES from Codex: missing Playwright + weaker N=1 baseline assertion. Both addressed in iter-1 corrections: added `spec-823-builder-attribution.test.ts` (4 scenarios mocking /api/state + /api/overview at N=1/2/3 + layout-transition), strengthened N=1 baseline with `textContent === '#823'` + `children.length === 0`.

## 2026-05-22 — Phase 2 (per-builder thread file)

Atomic edit of both `codev-skeleton/roles/builder.md` and `codev/roles/builder.md`. Inserted between `## Communication / ### Checking Status` and `## Notifications`. Build-output validation via `pnpm run copy-skeleton` verified shipped artifact at `packages/codev/skeleton/roles/builder.md`.

UNANIMOUS APPROVE on iter-1 CMAP. No corrections needed.

## 2026-05-22 — Phase 3 (inter-agent messaging docs)

Five markdown files: CLAUDE.md, AGENTS.md, codev/resources/commands/agent-farm.md, codev-skeleton/templates/CLAUDE.md, codev-skeleton/templates/AGENTS.md. CLAUDE/AGENTS byte-identical; skeleton templates equivalent (adopter-friendly variant).

Iter-1 Codex REQUEST_CHANGES: agent-farm.md said `afx send architect` from non-builder routes to `main`, but actual code falls back to first registered architect if `main` absent; post-merge discovery missing explicit `ls codev/state/` command. Both addressed in iter-1 corrections.

## 2026-05-22 — Discovered #786 had merged to main

Mid-implementation discovery: PR #822 (#786 multi-architect lifecycle) had merged to main while I was on Phases 1-3. My branch was made from pre-#786 main, so I'd been building blind to the post-merge surfaces. Notified the architect; they confirmed the rebase plan was fine — continue 1-3, rebase before Phase 4.

## 2026-05-22 — Rebase onto current main (clean)

Rebased before Phase 4. Git auto-resolved every conflict:
- `packages/types/src/api.ts`: my OverviewBuilder.spawnedByArchitect lives alongside #786's Builder.spawnedByArchitect (different types, same name).
- `packages/dashboard/src/index.css`: my `.builder-attribution` + `min-width` change alongside #786's `.remove-architect-modal-*` rules.
- `codev/resources/commands/agent-farm.md`: both #786 (Phase 7 docs) and my Phase 3 touched the file; auto-merge clean.
- Force-pushed with `--force-with-lease` per architect approval.

## 2026-05-22 — Phase 4 (VSCode add-refresh SSE)

Tower: extended `handleAddArchitect` and `handleRemoveArchitect` signatures to accept `ctx`, emit `architects-updated` on success. VSCode: extended existing `connectionManager.onSSEEvent` callback to match both `worktree-config-updated || architects-updated`. Initial commit had source-grep tests only (followed #786 Phase 6 pattern).

Iter-1 CMAP REQUEST_CHANGES from both Gemini and Codex:
- **Codex**: other remove paths (`tower-routes.ts:1489` and `:2148`) weren't emitting. Found two more sites — dashboard close-button modal flow + mobile TabBar close. Both addressed.
- **Gemini + Codex**: source-grep tests don't catch runtime regressions. The plan iter-1 had said "NOT vitest" but that turned out to be over-specific (`src/__tests__/` IS vitest per `vitest.config.ts`; the explicit comment says "mock the vscode module entirely" — exactly the runtime-behavior pattern I should have used). Added `workspace-sse-subscriber.test.ts` with 9 behavior tests using `vi.mock('vscode', ...)` to capture the subscriber callback and exercise it with synthetic envelopes.

## Final stats

- 4 implementation phases, all green at the build + test gate.
- 5 spec CMAP iterations + 2 plan CMAP iterations.
- 18 new test cases for Spec 823: 6 BuilderCard + 4 overview enrichment + 4 Playwright (Phase 1), 5 Tower-routes + 4 source-grep + 9 runtime behavior (Phase 4).
- All five files for Phase 3 + both role files for Phase 2 atomically updated with `copy-skeleton` validation.
- Verified the SSE event emit fires on all four remove paths (handleRemoveArchitect, handleWorkspaceRoutes /api/architects/, handleWorkspaceTabDelete, plus the dashboard close-button reaches via /api/architects/).
