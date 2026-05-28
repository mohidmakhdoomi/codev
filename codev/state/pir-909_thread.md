# PIR #909 — area/* labels as first-class organizing concept

## 2026-05-28 — plan phase

Drafted `codev/plans/909-architect-treat-area-labels-as.md`. Key design calls made (these are the items the plan-approval gate is for):

- **Placement**: subsection under `## Quick Start`, directly after `### Project Tracking`. Topical adjacency > another top-level heading.
- **Vocabulary rendering**: mini-table (label / one-line scope), 10 rows. Bulleted list and paragraph-per-area rejected.
- **Codev / skeleton split**: codev file has the concrete 10-label table inline; skeleton files contain zero codev area names (framework-neutral discipline). Skeleton teaches the pattern via `<prefix>/<value>` placeholders.
- **Live list inline + pointer**: codev file has both (inline table for zero-memory ops, `gh label list --search area/` as the source of truth). Skeleton has only the pointer.
- **gh recipes**: group / edit / audit / bulk-move, one-liner each, ~10 lines total. Same shape in codev and skeleton, different vocabulary level.
- **`codev-skeleton/roles/architect.md`**: new `## Working with project labels` section after `## Project Tracking`.

Live label inventory captured from `gh label list --search area/` (10 labels). No mention of `area/agent-farm` — `area/tower` covers afx/agent-farm work (confirmed already in personal memory and consistent with the issue body).

Awaiting `plan-approval`.
