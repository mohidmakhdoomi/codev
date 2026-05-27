# pir-885 — vscode: capitalize area group header labels

## Plan phase (2026-05-28)

Drafted `codev/plans/885-vscode-capitalize-area-group-h.md`.

Picked **sentence-case** over the per-repo override map. Reasons in the plan: codev's actual `area/*` set has zero acronyms, `'Uncategorized'.charAt(0).toUpperCase() + slice(1)` is a no-op so one rule covers everything including the fallback, and a config override is a clean follow-up if real acronym pain surfaces later.

Helper lives in `packages/core/src/area-grouping.ts` next to `groupByArea` (pure, no vscode dep, reusable by future dashboard equivalent).

Application point is the single line `area-group-tree-item.ts:23` — both `BacklogGroupTreeItem` and `BuilderGroupTreeItem` route through it, so one wrap covers both views. `areaName` field, `id`, and `contextValue` stay raw; only the displayed label changes. Expansion state survives unchanged.

Tests append to `packages/vscode/src/test/area-grouping.test.ts` (core has no test infra of its own; that's where `groupByArea` tests live).

Plan committed (830aafe4) and pushed. Sitting at `plan-approval` gate.

### Revision 2026-05-28 (a031721e)

User reopened the acronym question. Walked through why no general heuristic works (length-based, vowel-pattern all have false positives in codev's own set). User picked **title-case + replace `-`/`_` with space**: `cross-cutting → Cross Cutting`, `front_end → Front End`. Single-word acronyms still mangle (`api → Api`) — accepted as a known cost; config override remains the clean follow-up.

Updated plan's Proposed Change, Files to Change (test cases), Alternatives Considered, and Test Plan sections. `Uncategorized` is still a no-op under the new rule, so the single uniform path through `AreaGroupTreeItem` constructor is preserved.

## Implement phase (2026-05-28)

Plan approved. Commits:
- `534d94e7` — `formatAreaForDisplay` helper exported from `packages/core/src/area-grouping.ts`; `AreaGroupTreeItem` constructor wraps the displayed label via the helper. `areaName` field, `id`, `contextValue` all keep using the raw wire value.
- `325ead6d` — 7 new tests covering single-word, hyphenated, underscored, mixed, the Uncategorized sentinel no-op, empty string, and consecutive-separator collapse.

Build ✓, all 97 vscode tests pass (49 vitest + 48 mocha — area-grouping tests in the mocha suite). Sitting at `dev-approval` gate.

## Review phase (2026-05-28)

`dev-approval` approved. Retrospective written to `codev/reviews/885-vscode-capitalize-area-group-h.md` (commit `114b940d`). Both arch and lessons-learned sections justify "no changes needed" — single helper next to an existing function, no new pattern, no consumer-facing API shift.

PR #893 opened against `main`. Recorded with porch. Ran the 3-way consultation per porch's verify task list.

3-way verdicts (all APPROVE):
- gemini: APPROVE — implementation matches plan, thorough test coverage
- codex: APPROVE — raw area values stay stable, solid review artifact
- claude: APPROVE — flagged one cosmetic JSDoc nit (line 20 of `area-group-tree-item.ts` said "sentence-case" but the rule is title-case). Fixed in `5f6a30a9` — one-word doc change.

Architect notified. Sitting at `pr` gate.
