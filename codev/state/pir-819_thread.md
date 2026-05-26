# pir-819 thread

## Plan phase — 2026-05-26

Drafted `codev/plans/819-core-parsearealabels-helper-fl.md` and pushed.

### Scope this PIR

Pure scaffolding for the `area/*` namespace — no UI consumers in this issue (those land in #811 backlog grouping and #818 builders tree grouping). Lands:

- `parseAreaLabels` helper in `packages/codev/src/lib/github.ts`
- `areas: string[]` field on `BacklogItem`, `BuilderOverview` (server-internal) and `OverviewBacklogItem`, `OverviewBuilder` (wire contracts) — required, never undefined
- `resolvePrimaryArea` policy helper in `packages/core/src/builder-helpers.ts`
- Unit tests in `packages/codev/src/__tests__/github.test.ts` + new builder-helpers test

### Non-obvious finding for the reviewer

Issue body §B (defensive `??= []` at cache serve-out OR cache invalidation on restart) is **already structurally satisfied** — `OverviewCache` only holds raw forge responses (`ForgePR[]`, `ForgeIssueListItem[]`), never derived `BacklogItem` / `BuilderOverview` objects. Those shapes are reconstructed fresh from raw cache entries on every `getOverview` call. No code added for §B; called out in the plan's Risks section so the reviewer knows where to look (and isn't surprised by its absence in the diff).

Awaiting `plan-approval`.

## Plan phase — follow-up

User flagged the mixed-separator state (`type:` / `priority:` colon vs `area/` slash) as a real concern. Chose option D: ship #819 as the spec calls for, file a follow-up to relitigate separators globally. Filed **#869** ("Label namespace separator: resolve mixed colon-vs-slash convention") — unassigned, `area/core` label, lays out options A (all-slash), B (all-colon), C (stay mixed) plus a "verify the web-dashboard pathway compatibility constraint" callout. Plan revised to reference #869 under Risks & Alternatives → Open question.
