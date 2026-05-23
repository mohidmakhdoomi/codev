# Plan 823 — iter-2 CMAP Rebuttal

**Date**: 2026-05-22
**Reviewers**: Gemini (APPROVE), Codex (COMMENT), Claude (APPROVE)

---

## Summary

Iter-2 reached convergence. No REQUEST_CHANGES. Codex surfaced three valid COMMENT-level findings (Phase 4 acceptance/Implementation contradiction, Tower test path, copy-skeleton validation gap) — all addressed. Gemini's APPROVE included one minor section-reference correction (Phase 3 insertion point). Claude's APPROVE was clean with three non-blocking informational notes.

---

## Gemini (APPROVE) — minor correction folded in

### G-P2-1. Phase 3 CLAUDE.md insertion-point reference

**Finding**: The plan said "after the 'Agent Responsiveness' section (around line ~497 where the existing `afx send` reference lives)". Line ~497 is indeed where `afx send` examples live, but the section header there is `### 🚨 ALWAYS Operate From the Main Workspace Root 🚨` (a subsection of `## Architect-Builder Pattern`, not `## Agent Responsiveness`). `## Agent Responsiveness` is much higher up at line ~139.

**Verification**: Confirmed by reading CLAUDE.md section structure. The conflation was an editing artifact — the plan author meant to point at the `afx send` reference but mislabeled the surrounding section.

**Resolution**: Updated Phase 3 Implementation Details to specify the correct insertion point: between `## Architect-Builder Pattern` (line ~470) and `## Porch - Protocol Orchestrator` (line ~528), under a new top-level `## Inter-agent messaging` heading.

**Where in plan**: Phase 3 "Insertion location candidates" subsection.

---

## Codex (COMMENT) — three findings addressed

### C-P2-1. Phase 4 internal contradiction (workspace filter)

**Finding**: Implementation Details explicitly choose unconditional `changeEmitter.fire()` (mirroring `worktree-config-updated`), but the Acceptance Criteria said the emitter fires "for matching workspace." Pick one.

**Verification**: Confirmed — the plan had drifted between iter-1 corrections. Implementation Details correctly states "unconditional, no workspace filter at the SSE layer"; the acceptance bullet had not been updated to match.

**Resolution**: Updated the Acceptance Criterion to explicitly say "unconditionally, no workspace filter at the SSE-subscriber layer" with a cross-reference to the Implementation Details Workspace-filtering decision. Both now align: VSCode subscriber fires `changeEmitter` for any matching envelope type without per-workspace filtering, since `WorkspaceProvider` is workspace-scoped at construction.

**Where in plan**: Phase 4 Acceptance Criteria (updated).

### C-P2-2. Tower test path correction

**Finding**: Plan said `packages/codev/src/agent-farm/servers/__tests__/`. The actual route test file is at `packages/codev/src/agent-farm/__tests__/tower-routes.test.ts`. Pin the exact existing file.

**Verification**: Confirmed via `find` — there is NO `agent-farm/servers/__tests__/` directory; the existing route tests live at `agent-farm/__tests__/tower-routes.test.ts`.

**Resolution**: Updated Phase 4 Deliverables to specify the existing route-test file as the test location, not a new (nonexistent) directory.

**Where in plan**: Phase 4 Deliverables (Tower-side unit test bullet).

### C-P2-3. copy-skeleton validation gap

**Finding**: Phases 2 and 3 correctly edit `codev-skeleton/...` source files, but the plan never explicitly calls out validating the shipped artifact at `packages/codev/skeleton/...` after the `copy-skeleton` build step. The MUST is incomplete without that validation — external adopters get content from `packages/codev/skeleton/`, not `codev-skeleton/`.

**Verification**: Confirmed via `packages/codev/package.json:29`:
```json
"copy-skeleton": "rm -rf skeleton && cp -r ../../codev-skeleton skeleton"
```

`packages/codev/skeleton/` is fully regenerated from `codev-skeleton/` on every build. If the build isn't run, the npm-shipped artifact doesn't carry the edit.

**Resolution**: Added a new Acceptance Criterion to both Phase 2 and Phase 3 that requires running `pnpm build` (or `pnpm --filter @cluesmith/codev run copy-skeleton` directly) and verifying the shipped path contains the new content. The MUST is satisfied only when the npm-shipped artifact carries the change.

**Where in plan**: Phase 2 Acceptance Criteria + Phase 3 Acceptance Criteria.

---

## Claude (APPROVE) — three non-blocking observations addressed where applicable

### Cl-P2-1. `onOpenBuilder` cosmetic

**Finding**: Plan's code snippet showed `onOpen={onOpenBuilder}` but the actual `WorkView.tsx:32, :91` uses `handleOpenBuilder`. Cosmetic.

**Resolution**: Global replace in the plan.

**Where in plan**: Phase 1 Implementation Details (`WorkView` prop threading snippet).

### Cl-P2-2. Phase 2 insertion point precision

**Finding**: Plan says "after 'Two Operating Modes' / 'Strict Mode', before 'Notifications'" — but the actual section sequence is: Two Operating Modes → Strict Mode → Soft Mode → Deliverables → Communication → Notifications. The builder has 5 sections between the named anchors.

**Resolution**: No change. The plan already defers exact insertion to the builder ("plan-phase reads the current file structure to confirm the exact insertion point"). The builder has the role file available at implementation time and will pick the cleanest location based on the actual neighboring context.

### Cl-P2-3. Column header "Issue" with attribution content

**Finding**: The `<th>Issue</th>` column header will now contain `#issueId · architect-name` in N>1 cases. Semantically fine but the header doesn't signal the attribution.

**Resolution**: No change. The spec's baked decision 2b locks the visual to inline-adjacent in the ID cell; the column header is not part of the attribution surface. This is informational only.

---

## Net plan change summary (iter-2)

- **1 acceptance-criterion fix** (Phase 4 — workspace filter alignment with Implementation Details).
- **1 file-path correction** (Phase 4 Tower test → `agent-farm/__tests__/tower-routes.test.ts`).
- **2 new acceptance criteria** (Phase 2 + Phase 3 build-output validation via `copy-skeleton`).
- **1 insertion-point clarification** (Phase 3 — `## Inter-agent messaging` between `## Architect-Builder Pattern` and `## Porch - Protocol Orchestrator`).
- **1 cosmetic snippet fix** (`onOpenBuilder` → `handleOpenBuilder`).
- **No findings rejected.** No disagreements with reviewers.

## Convergence

- **Iter-1**: REQUEST_CHANGES/REQUEST_CHANGES/COMMENT (all three flagged the same Phase 4 SSE pattern).
- **Iter-2**: APPROVE/COMMENT/APPROVE — no REQUEST_CHANGES anywhere. Codex's COMMENT findings are all internal-consistency / build-validation fixes, fully addressed.

Plan is ready for plan-approval gate per the architect's "iter-2 lands all APPROVE/COMMENT (no REQUEST_CHANGES)" criterion.
