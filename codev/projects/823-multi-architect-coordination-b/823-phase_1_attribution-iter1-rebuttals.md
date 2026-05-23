# Phase 1 — iter-1 CMAP Rebuttal

**Date**: 2026-05-22
**Reviewers**: Gemini (APPROVE), Codex (REQUEST_CHANGES), Claude (APPROVE)

---

## Summary

Iter-1 caught a real plan gap — Codex correctly noted the plan's Phase 1 deliverables include Playwright visual smoke at N=1/N=2/N=3 and a stronger N=1 baseline parity, but the initial implementation deferred Playwright as "verify-phase only." Claude argued for the verify-phase deferral, but reading the plan carefully, the Playwright tests are explicit Phase 1 deliverables and acceptance criteria — not verify-phase. Both findings addressed; no findings rejected.

---

## Gemini (APPROVE) — clean

No findings. The type plumbing, SQL enrichment (including the soft-mode WHERE fix), BuilderCard render, WorkView prop threading, and CSS all match the plan's prescriptions.

---

## Codex (REQUEST_CHANGES) — both findings addressed

### C-P1.1-1. Missing Playwright visual coverage

**Finding**: The plan/spec explicitly require N=1/N=2/N=3 Playwright visual verification (Plan Phase 1 Deliverables: "Playwright smoke at N=1, N=2, N=3..." / Acceptance Criteria: "Playwright smoke passes at N=1, N=2, N=3 with no layout shift between N=1 and N=2.") The initial commit had unit tests but no Playwright artifact.

**Verification**: Confirmed. Re-read the plan's Phase 1 Deliverables checklist — Playwright is item 7 with explicit N=1/N=2/N=3 scenarios listed.

**Resolution**: Added a new Playwright test at `packages/codev/src/agent-farm/__tests__/e2e/spec-823-builder-attribution.test.ts` covering four scenarios:

1. **N=1**: zero `.builder-attribution` spans rendered, even when every builder carries a non-null `spawnedByArchitect` (baseline parity).
2. **N=2**: three attribution spans render (one per non-null `spawnedByArchitect` builder); legacy null row contributes none; hover-tooltip `title` attribute carries the full "spawned by ..." text.
3. **N=3**: six spans render across three sibling architects; each architect name appears in at least one row.
4. **Layout transition (N=1 → N=2)**: builder table doesn't collapse; `.builder-col-id` cells have non-zero width and height; cell text content includes both `#NN` and ` · <architect-name>` (separator preserved with surrounding spaces).

The test mocks both `/api/state` (for the architects collection that drives `architectCount` in `WorkView`) and `/api/overview` (for builders with `spawnedByArchitect`) via `page.route()`. Pattern mirrors the existing `architect-pane-layout.test.ts` (#766 regression guard), which already validates this is the correct approach for layout-invariant tests at controlled cardinalities.

The Playwright test runs against the same Tower webServer the existing e2e suite uses (port 4100). It's not in the unit-test default run because Playwright tests in this repo are kept under `src/agent-farm/__tests__/e2e/` and invoked via `pnpm exec playwright test` (per `packages/codev/package.json:test:e2e:playwright`).

**Where**: New file at `packages/codev/src/agent-farm/__tests__/e2e/spec-823-builder-attribution.test.ts`.

### C-P1.1-2. N=1 regression assertion weaker than plan/spec call for

**Finding**: The original N=1 test in `BuilderCard.test.tsx` only checks that `.builder-attribution` is absent; it does not implement the stronger pre-823 baseline/snapshot parity the phase acceptance criteria call for.

**Verification**: Plan Acceptance Criterion: "`BuilderCard` snapshot at `architectCount=1` matches the pre-823 baseline (establish baseline first if missing)." The original test had only `expect(document.querySelector('.builder-attribution')).toBeNull()` — which is necessary but not sufficient. A future regression that introduces extra whitespace, hidden DOM, or a placeholder element inside the id cell would not be caught.

**Resolution**: Strengthened the N=1 baseline test in `packages/dashboard/__tests__/BuilderCard.test.tsx`. The first test now also asserts:

```ts
const idCell = document.querySelector('.builder-col-id');
expect(idCell).not.toBeNull();
expect(idCell!.textContent).toBe('#823');
// ID cell has no child element beyond the text — no <span> introduced.
expect(idCell!.children.length).toBe(0);
```

`textContent === '#823'` is the strict parity check — no extra whitespace, no separator, no trailing architect-name. `children.length === 0` confirms no DOM child was introduced (e.g. a hidden `<span>` waiting to be styled). Combined, these match the pre-823 DOM shape exactly.

I considered using Vitest's snapshot serializer (`toMatchSnapshot()`), but textContent + child count is more diff-friendly in review (a future intentional change is one-line obvious vs. a serialized snapshot blob).

**Where**: First test case in `packages/dashboard/__tests__/BuilderCard.test.tsx` (the `architectCount === 1` baseline test).

---

## Claude (APPROVE) — Playwright disagreement addressed

Claude argued: "Playwright deferred to verify phase (consistent with SPIR's verify phase being separate from implement)." This conflicts with Codex.

**Resolution**: Sided with Codex. Re-read the plan: Phase 1 Deliverables checklist item 7 is "Playwright smoke at N=1 (1 architect, 3 builders), N=2 (2 architects, 4 builders mixing spawning architects + 1 legacy null), N=3 (3 architects, 6 builders). Visual assertion: tag absent at N=1; tag present and correct at N≥2; no column shift; layout stable." That's an in-phase deliverable, not a verify-phase exercise.

Claude's reasoning ("the dashboard package has no existing Playwright infrastructure") is also incorrect — `packages/codev` has full Playwright infrastructure (`playwright.config.ts`, `src/agent-farm/__tests__/e2e/`), and the existing `architect-pane-layout.test.ts` is exactly the right precedent. The dashboard package itself doesn't need Playwright config; the e2e tests live under codev's tree and exercise the dashboard via Tower's served HTML.

---

## Net Phase 1 change summary (iter-1)

- **1 new Playwright test file** (4 scenarios covering N=1/N=2/N=3 + layout transition).
- **1 strengthened unit-test assertion** (N=1 baseline parity via textContent + children.length).
- **No findings rejected.** Sided with Codex on the Playwright requirement; Claude's verify-phase argument doesn't match the plan text.

## Iter-2 readiness

Phase 1 is ready for iter-2 CMAP. Both Codex findings addressed; Gemini's APPROVE is already met. The Playwright test follows the established e2e pattern in this repo. Unit tests pass (6/6). Iter-2 should converge to APPROVE across all three reviewers.
