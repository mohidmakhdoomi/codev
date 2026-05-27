# PIR-818: Group Builders Tree by Area

## 2026-05-27 — plan phase

Drafted `codev/plans/818-vscode-group-builders-in-the-t.md`.

Key reconciliation point with the merged #819: the wire is `OverviewBuilder.area: string` (single, projected via `parseArea` — first-alphabetical-area wins), **not** the `areas: string[]` shape the original #818 description assumed. Consequences captured in the plan:

- Each builder lives in exactly one area at the parser level → grouping is a simple `groupBy(b.area)`.
- The original `cross-cutting` *resolution-time privilege* is gone (per #819's final design — parser is policy-free). Honoured the *intent* at the **group-ordering** layer instead: when a `cross-cutting` group exists because at least one builder projects to it, its header sorts first. Documented as a deliberate inheritance from #819, flagged in Risks for review.
- "Render only non-empty groups" chosen as default (issue mock shows `Uncategorized (0)` as a teaching aid; treating that literally would be UI noise). Flagged for review override.

Sharing extracted to `@cluesmith/codev-core`: a `sortAreaGroups(areas: string[])` helper so the same ordering rule is byte-shared with #811 (backlog) when it lands — not just byte-described.

Awaiting plan-approval gate review.
