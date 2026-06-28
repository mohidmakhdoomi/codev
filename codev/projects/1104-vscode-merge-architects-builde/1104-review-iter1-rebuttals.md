# PIR #1104 — Review iteration 1 rebuttals

Consultation verdicts: **codex = REQUEST_CHANGES**, **claude = COMMENT**.

PIR is single-pass (`max_iterations: 1`): this is not re-reviewed by the models. Real
defects below are fixed + regression-tested; plan-deviation findings are rebutted because they
were deliberate decisions the human made at the `dev-approval` gate. All of this is escalated to
the human at the `pr` gate (the only remaining reviewer of these dispositions).

## Codex (REQUEST_CHANGES)

Codex's first four points all reduce to "the implementation deviates from the approved plan."
That is true and **intentional**: the plan described a *nested adaptive architect tier*, and at
the `dev-approval` gate the human reviewed it running and explicitly redirected the design to a
*flat 3-way group-by axis*. The review file documents this pivot (Summary + "Things to Look At");
the builder thread records the live decisions. PIR's `dev-approval` gate exists precisely to let
"seeing it running changes the design" happen — so a plan/implementation divergence here is the
gate working as intended, not a regression.

1. **"Flat axis instead of nested architect-rooted tree."** Deliberate. The human directed
   "pivot to the flat 3-way toggle" after reviewing the running nested tree (duplication with
   Workspace > Architects, single-architect collapse awkwardness, and an icon-collision problem
   drove it). The nested-tier code was fully removed. **No change** — rebutted.

2. **"Childless architects dropped (should stay as interactive leaf rows)."** Deliberate. The
   human's exact objection to the nested tree was that childless architects duplicated
   Workspace > Architects. In the flat model a group exists only when it owns work, so childless
   architects naturally don't appear — which is the requested behavior. The full roster remains
   in Workspace > Architects. **No change** — rebutted.

3. **"View id renamed `codev.builders` → `codev.agents` (plan said keep it)."** Deliberate and
   human-directed ("rename the codev.builders ID to codev.agents for consistency"). All internal
   `when`-clauses, `createTreeView`, and tests were updated together; there are no external
   consumers of the id (it's our own extension). The only cost is that a user who manually
   repositioned the old view returns to the default position once — acceptable, and the human
   chose it knowingly. **No change** — rebutted.

4. **"Add Architect `+` missing from the Agents title bar."** Deliberate. The human explicitly
   rejected an Agents title-bar `+`: a `+` there is ambiguous (add-builder vs add-architect), so
   Add Architect stays on Workspace > Architects only. **No change** — rebutted.

5. **"No-workspace `/api/overview` branch returns a payload missing `recentlyClosed` /
   `architects`, violating the declared contract."** **Valid — real defect, fixed.** `OverviewData`
   now declares `architects` required ("never undefined"), but the early `if (!workspaceRoot)`
   return in `handleOverview` emitted only `{ builders, pendingPRs, backlog }`. Fixed to emit all
   collection fields empty (`recentlyClosed: []`, `architects: []`). Added a regression assertion
   to the existing "returns empty data when no workspace is known" test in `tower-routes.test.ts`
   (now checks `recentlyClosed`/`architects` === `[]`). Pinning test fails without the fix.

## Claude (COMMENT)

Both of Claude's points are real doc-staleness bugs introduced by my own pivot (not plan
deviations). Both fixed.

1. **"README.md Agents description still describes the retired nested tier."** **Valid — fixed.**
   The paragraph ("builders nest under the architect… passive architect appears as a leaf row…")
   predated the pivot. Rewritten to describe the flat 3-way group-by axis and the
   architects-with-work-only behavior.

2. **"`buildersGroupBy` setting description references a 'pressed' button state that doesn't
   exist."** **Valid — fixed.** VS Code toolbar buttons have no pressed state (the very lesson this
   PR recorded). Rewritten to describe the single cycling group-by button (icon shows the next
   axis; cycles stage → area → architect).

## Net

- 3 real fixes (1 code + regression test, 2 docs), committed on the PR branch.
- 4 plan-deviation findings rebutted as deliberate `dev-approval`-gate decisions.
- Escalated to the human at the `pr` gate per PIR single-pass design.
