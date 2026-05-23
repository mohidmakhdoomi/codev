# Plan 823 — iter-1 CMAP Rebuttal

**Date**: 2026-05-22
**Reviewers**: Gemini (REQUEST_CHANGES), Codex (REQUEST_CHANGES), Claude (COMMENT — same core finding)

---

## Summary

All three reviewers converged on the same Phase 4 finding: the VSCode SSE subscriber snippet in the plan was based on a misreading from the spec phase. The actual pattern destructures `{ data }`, JSON-parses the SSE body, and checks `envelope.type` — not `event.type`/`event.payload`. Plan iter-1 corrects this and three other Phase 4 / Phase 1 details (handler signature refactor, test harness correction, CSS file pin, column-width caveat). One Phase 1 risk retired. No findings rejected.

---

## Gemini (REQUEST_CHANGES) — both findings addressed

### G-P1-1. VSCode SSE subscriber pattern (hallucinated snippet)

**Finding**: The plan's Phase 4 subscriber code:
```ts
this.connectionManager.onSSEEvent((event) => {
  if (event.type === 'notification' && event.payload?.type === 'worktree-config-updated') { ... }
});
```
is factually incorrect. Reading `packages/vscode/src/views/workspace.ts` lines 31-46 directly shows the actual pattern destructures `{ data }` and parses a JSON envelope:
```ts
connectionManager.onSSEEvent(({ data }) => {
  try {
    const envelope = JSON.parse(data) as { type?: unknown };
    if (envelope.type === 'worktree-config-updated') {
      this.changeEmitter.fire();
    }
  } catch {
    // benign — malformed envelope
  }
});
```
Because `broadcastNotification` sends the event as `data:` without an `event:` name, the SSE client wrapper always emits the raw JSON payload in the `data` field. The builder must parse `data` and check `envelope.type === 'architects-updated'`. Using the plan's snippet would result in the VSCode extension silently dropping the event.

**Verification**: Confirmed by reading `workspace.ts:37-46` directly. The existing comment at `workspace.ts:33-36` explicitly says: *"Tower emits events as a JSON envelope on the SSE `data:` field with no `event:` name."* The plan's snippet was a misreading carried over from a hallucinated iter-1 Claude note during the spec phase.

**Resolution**: Rewrote Phase 4's "VSCode-side subscriber" implementation details:
- Showed the actual `{ data }`-destructuring + JSON.parse + `envelope.type` pattern.
- Folded the new check into a single subscriber callback with two type matches (`worktree-config-updated || architects-updated`) — single parse, two checks.
- Documented the workspace-filtering decision: **mirror the existing unconditional-fire behavior** (no workspace filter at the SSE layer), since VSCode is opened against one workspace and `WorkspaceProvider` is workspace-scoped at construction. The `workspace` field stays in the event body for dashboards/other listeners that DO want to filter.
- Dropped the "rides the notification channel" framing — the actual pattern doesn't ride a notification channel at all. The `SSEEventType` union covers the outer SSE event types; custom envelope-type strings (`'worktree-config-updated'`, `'architects-updated'`) live inside the JSON body.

**Where in plan**: Phase 4 "VSCode-side subscriber" section (rewritten), "Tower-side emit shape" (clarified `NotifyFn` interface), "SSE union" section (clarified no change needed and why).

### G-P1-2. `handleAddArchitect` signature refactor needed

**Finding**: `handleAddArchitect` (`tower-routes.ts:300`) does NOT currently accept `ctx: RouteContext`. The plan's "Option B" (emit from the route handler using `ctx.broadcastNotification`) requires updating the signature and threading `ctx` from the dispatch site (`tower-routes.ts:230`).

**Verification**: Confirmed via direct read. Current signature is `async function handleAddArchitect(req, res, match)`; dispatch is `return await handleAddArchitect(req, res, architectsMatch)`.

**Resolution**: Added a dedicated "Required refactor for Option B" subsection to Phase 4 implementation details. Shows the updated signature (`(req, res, match, ctx)`), the updated dispatch (`return await handleAddArchitect(req, res, architectsMatch, ctx)`), and the emit code inside the handler (after successful `addArchitect()` return, before writing the 200 response). The same refactor applies to the remove route handler from #786.

**Where in plan**: Phase 4 "Seam location" section (extended with the explicit refactor block).

---

## Codex (REQUEST_CHANGES) — three findings addressed

### C-P1-1. Same SSE pattern finding as Gemini

**Finding**: `WorkspaceProvider` consumes `connectionManager.onSSEEvent(({ data }) => ...)` and parses a JSON envelope from `data` (`workspace.ts:37-43`); `ConnectionManager` exposes `{ type, data }`, not `event.type/payload` (`connection-manager.ts:29-30`). The plan's pseudocode and acceptance language should be rewritten to match the real transport shape.

**Resolution**: Same as G-P1-1 — addressed by rewriting Phase 4's VSCode subscriber implementation details. Acceptance criteria and test wording also updated to reference the envelope-type check rather than the `event.payload?.type` pattern.

### C-P1-2. Test harness correction (vscode-test, not Vitest)

**Finding**: The plan said "VSCode-side unit test (vitest, per #786 phase 6's new setup)" — but `packages/vscode` uses the VSCode test harness `vscode-test` (`packages/vscode/package.json`), with tests under `packages/vscode/src/test/`. No vitest setup exists.

**Verification**: Confirmed. `packages/vscode/package.json` declares `"test": "vscode-test"` and depends on `@vscode/test-cli` + `@vscode/test-electron`. Existing tests at `packages/vscode/src/test/*.test.ts` use the `vscode-test` harness.

**Resolution**: Corrected the test-harness reference in Phase 4 deliverables and Implementation Details. Test now specified as living in `packages/vscode/src/test/` and using the `vscode-test` harness. The test approach (mock `connectionManager.onSSEEvent`, deliver synthetic `architects-updated` envelope, assert `changeEmitter` fires) is unchanged — only the framework name.

### C-P1-3. Pin dashboard CSS file path

**Finding**: The plan said "whichever CSS file currently defines `.builder-col-id` — plan-phase check via grep." This is already known: `packages/dashboard/src/index.css`, `.builder-col-id` at line 1081-1086. Pinning the exact file makes the plan more executable.

**Verification**: Confirmed at `packages/dashboard/src/index.css:1081-1086`. There's no separate `styles/` directory or per-component CSS file for `BuilderCard` — all dashboard CSS lives in `index.css`.

**Resolution**: Replaced the grep instruction with the pinned file/line reference. The new `.builder-attribution` class lives adjacent to the existing `.builder-col-id` block.

---

## Claude (COMMENT) — same core finding plus two minor observations

### Cl-P1-1. Same SSE pattern finding (framed as COMMENT, not REQUEST_CHANGES)

Same finding as G-P1-1 and C-P1-1. Claude framed it as COMMENT-level because "the core approach is correct" but acknowledged "a builder following the plan's code literally will produce non-functional subscriber code." Treated as REQUEST_CHANGES-equivalent given the unanimous agreement; resolution identical to G-P1-1.

### Cl-P1-2. `.builder-col-id` 60px column-width caveat

**Finding**: `.builder-col-id` is `width: 60px` with `white-space: nowrap`. Adding ` · ob-refine` (~12 extra characters) to a cell sized for 4-character builder IDs overflows the 60px constraint. The cell will expand because `white-space: nowrap` prevents wrapping, potentially shifting downstream columns. The plan's Playwright smoke would catch this, but the builder should know upfront so they can adjust `width` proactively rather than discovering it via a failing test.

**Verification**: Confirmed at `packages/dashboard/src/index.css:1081-1086` — the cell IS 60px with nowrap.

**Resolution**: Added a "Column-width caveat" subsection to Phase 1 Implementation Details. Two options for the builder:
- **Preferred**: change `width: 60px` to `min-width: 60px` so the cell grows naturally.
- **Fallback**: expand `width` to ~160px to fit realistic name lengths.

Updated Phase 1 Risks: new "column width overflow" row with the mitigation.

### Cl-P1-3. `--text-secondary` risk retired

**Finding**: The plan listed "CSS variable `--text-secondary` doesn't exist" as a risk. It exists — declared at `index.css:10` and used 30+ times across the dashboard. The fallback `#888` in the plan snippet is unnecessary.

**Verification**: Confirmed.

**Resolution**: Dropped the `#888` fallback from the `.builder-attribution` CSS snippet. Marked the corresponding Risks row as RETIRED with the verification note.

---

## Net plan change summary (iter-1)

- **1 hallucinated snippet rewritten** (Phase 4 VSCode subscriber — now mirrors actual `{ data }` + JSON.parse + `envelope.type` pattern).
- **1 new required refactor documented** (Phase 4 — `handleAddArchitect` signature extension + dispatch update).
- **1 framework correction** (Phase 4 tests use `vscode-test`, not vitest).
- **1 file path pinned** (Phase 1 CSS at `packages/dashboard/src/index.css:1081-1086`).
- **1 new caveat with mitigation** (Phase 1 — `.builder-col-id` 60px column-width overflow).
- **1 risk retired** (Phase 1 — `--text-secondary` verified present).
- **0 spec-level changes** (all findings are plan-level implementation detail; the spec's MUST surface remains intact).
- **No findings rejected.** No disagreements with reviewers.

## Iter-2 readiness

Plan is ready for iter-2 CMAP. The unanimous Phase 4 SSE pattern finding is resolved; the secondary observations (signature refactor, test harness, CSS path, column width) are all addressed with concrete code/file references. Iter-2 should converge to APPROVE across all three reviewers; if any reviewer surfaces new findings, those will be addressed in iter-2 corrections.

The architect's "don't skip iter-2 CMAP at plan phase" direction is honored — iter-2 will run before plan-approval gate per the same discipline used during the spec phase.
