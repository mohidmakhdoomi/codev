# PIR Plan: `parseAreaLabels` helper + `areas[]` on `BacklogItem` and `BuilderOverview`

## Understanding

Issue #819 introduces the `area/*` label namespace as Codev's grouping axis for two upcoming consumers — backlog grouping by area (#811) and the builders tree grouping by area (#818). Both consumers need the same primitives:

1. A parser that extracts `area/*` label values (slash-separated, per Kubernetes / Terraform / CNCF convention) — currently no helper exists; `parseLabelDefaults` only knows about `type:*` and `priority:*` (colon-separated).
2. The parsed `areas: string[]` flowing through the server-side `BacklogItem` and `BuilderOverview` shapes and across the wire on `OverviewBacklogItem` / `OverviewBuilder` so the downstream consumers (dashboard `BacklogList`, dashboard `WorkView`, vscode `backlog` view, vscode `builders` view) can group without a second fetch.
3. A shared `resolvePrimaryArea(areas)` policy helper in `packages/core/src/builder-helpers.ts` so both UI surfaces resolve `area/cross-cutting → 'cross-cutting'`, single-area → that area, multi-area → first alphabetical, no-area → `'Uncategorized'` identically.

This is the scaffolding-only landing — the consumers (#811, #818) ship in follow-up issues and will assume `areas` is always present.

### Codebase landmarks (verified at this commit)

- **Parser anchor**: `packages/codev/src/lib/github.ts:468` — `parseLabelDefaults`. New helper lands directly below this function so the two parsers sit together. Both share the same defensive non-array coercion pattern (Gitea / Forgejo return `null` / `""` for empty labels; only GitHub returns `[]`).
- **Server shapes**: `packages/codev/src/agent-farm/servers/overview.ts:35` (`BuilderOverview`), `:95` (`BacklogItem`). Both gain `areas: string[]`.
- **BacklogItem construction**: `packages/codev/src/agent-farm/servers/overview.ts:736` inside `deriveBacklog`. Populated alongside the existing `parseLabelDefaults(issue.labels, issue.title)` call.
- **BuilderOverview construction**: 4 sites — `discoverBuilders` at lines ~578 (no-projectId soft-mode branch), ~632 (strict-mode branch), ~666 (status.yaml-missing soft-mode branch); each must initialize `areas: []`. Enrichment from issue labels happens in `getOverview` around line ~870, alongside the existing `issueTitleMap` enrichment loop.
- **Wire contracts**: `packages/types/src/api.ts:130` (`OverviewBuilder`), `:187` (`OverviewBacklogItem`). Both gain `areas: string[]`. Re-exported via `packages/types/src/index.ts:18-29` (no change needed — re-exports propagate the new field automatically).
- **Policy helper**: `packages/core/src/builder-helpers.ts` — sits next to `isIdleWaiting` (same "UI policy that both vscode and dashboard need" niche).
- **Tests**: `packages/codev/src/__tests__/github.test.ts:89` — `parseLabelDefaults` test block. New `parseAreaLabels` tests added in a sibling `describe` block.

### Cache discipline §B — already satisfied structurally

Issue #819 amendment §B asks for defensive `entry.areas ??= []` at the cache serve-out point OR cache invalidation on Tower restart. Verified at `packages/codev/src/agent-farm/servers/overview.ts:763-769`: `OverviewCache` only holds **raw** forge responses (`prCache: ForgePR[]`, `issueCache: ForgeIssueListItem[]`, `closedCache`, `mergedPRCache`, `currentUserCache`) — it does **not** cache derived `BacklogItem` or `BuilderOverview` objects. Those shapes are reconstructed fresh from raw cache entries on every `getOverview` call via `deriveBacklog` and `discoverBuilders`, so `areas` is computed from current label data each request. The "stale cache entry missing `areas`" failure mode the amendment defends against is not reachable in this codebase as currently structured. **No defensive coercion needed at serve-out, no cache invalidation needed at Tower restart.** Logged here explicitly because the issue body presents §B as a mandatory acceptance item — the criterion is *met* by the existing architecture (no derived-shape cache), not by code we wrote.

## Proposed Change

### 1. `parseAreaLabels` helper in `packages/codev/src/lib/github.ts`

Add directly below `parseLabelDefaults` (~line 510, after its closing brace):

```ts
/**
 * Extract `area/*` label values (Codev convention for grouping by product area).
 * Returns sorted, deduplicated area names (without the `area/` prefix).
 * Returns `[]` when no `area/*` labels are present.
 *
 * Mirrors `parseLabelDefaults`'s defensive non-array coercion: Gitea/Forgejo
 * return `""` or `null` for empty labels instead of `[]`.
 */
export function parseAreaLabels(
  labels: Array<{ name: string }> | null | undefined | string,
): string[] {
  const names = Array.isArray(labels) ? labels.map(l => l.name) : [];
  return [...new Set(
    names
      .filter(n => n.startsWith('area/'))
      .map(n => n.slice(5)),
  )].sort();
}
```

### 2. Server-side shape additions in `packages/codev/src/agent-farm/servers/overview.ts`

**Import** (line 19, alongside `parseLabelDefaults`):
```ts
parseLabelDefaults,
parseAreaLabels,
```

**`BuilderOverview` interface (line 35)** — add the field with a docstring keyed to the join site:
```ts
/**
 * `area/*` label values for this builder's issue (sorted, deduplicated,
 * prefix stripped). `[]` when the builder has no issue or the issue has
 * no `area/*` labels. Populated by `getOverview` via the issue-cache join
 * after `discoverBuilders` returns — `discoverBuilders` itself sets it
 * to `[]` since it has no access to the issue payload.
 */
areas: string[];
```

**`BacklogItem` interface (line 95)** — add the field:
```ts
/**
 * `area/*` label values for this issue (sorted, deduplicated, prefix
 * stripped). `[]` when the issue has no `area/*` labels.
 */
areas: string[];
```

**`discoverBuilders` (~lines 578, 632, 666)** — initialize `areas: []` at each of the 3 builder construction sites. (Each `builders.push({...})` block.)

**`deriveBacklog` (line 736)** — populate from `parseAreaLabels`:
```ts
const item: BacklogItem = {
  // ...existing fields...
  areas: parseAreaLabels(issue.labels),
  hasSpec: !!specFile,
  // ...
};
```

**`getOverview` (~line 870)** — extend the existing issue→builder enrichment block:
```ts
const issueTitleMap = new Map(issues.map(i => [String(i.number), i.title]));
const issueLabelsMap = new Map(issues.map(i => [String(i.number), parseAreaLabels(i.labels)]));
for (const b of builders) {
  if (b.issueId !== null) {
    if (issueTitleMap.has(b.issueId)) b.issueTitle = issueTitleMap.get(b.issueId)!;
    if (issueLabelsMap.has(b.issueId)) b.areas = issueLabelsMap.get(b.issueId)!;
  }
}
```

(The existing block already gates on `b.issueId !== null && issueTitleMap.has(b.issueId)`; I'm splitting the inner condition so a builder whose issue is in the map for one lookup but not the other still gets the available enrichment. In practice both maps are populated from the same `issues` array, so this is a no-op divergence — but it makes the intent clearer than nesting.)

### 3. Wire contract additions in `packages/types/src/api.ts`

Add `areas: string[]` to **both**:
- `OverviewBuilder` (line 130, after `spawnedByArchitect`)
- `OverviewBacklogItem` (line 187, after `priority`)

Same docstrings as the server-internal shapes. Required field with `[]` default discipline applies — never optional, never `undefined`.

`packages/types/src/index.ts` does not need changes — both types are already re-exported as namespace types, so the new field propagates automatically. `packages/dashboard/src/lib/api.ts:70-72` re-exports from `@cluesmith/codev-types`, so the new field flows to the dashboard for free.

### 4. `resolvePrimaryArea` helper in `packages/core/src/builder-helpers.ts`

Add below `isIdleWaiting`:

```ts
/**
 * Pick the single group an issue / builder belongs to, per the area-grouping
 * convention shared by the dashboard backlog view (#811) and the vscode
 * builders tree (#818).
 *
 * Resolution order:
 *  - `'cross-cutting'` if `area/cross-cutting` is present (multi-area work
 *    by intent — never bucketed under one of its areas)
 *  - the first alphabetical area otherwise (`areas` is already sorted by
 *    `parseAreaLabels`, so `areas[0]` is the lexicographically smallest)
 *  - `'Uncategorized'` if no `area/*` labels at all
 *
 * Lives here (not in `@cluesmith/codev-types`) because it's *application
 * policy* — the rule the UI applies when projecting a `string[]` of areas
 * to a single grouping bucket. Co-locating the policy here prevents silent
 * drift where the dashboard says "Auth" and vscode says "cross-cutting"
 * for the same multi-area builder.
 */
export function resolvePrimaryArea(areas: string[]): string {
  if (areas.includes('cross-cutting')) return 'cross-cutting';
  return areas[0] ?? 'Uncategorized';
}
```

No new file — extends the existing `builder-helpers.ts`.

### 5. Tests

**`packages/codev/src/__tests__/github.test.ts`** — add `parseAreaLabels` to the import block, then a sibling `describe('parseAreaLabels', ...)` after the `parseLabelDefaults` block. Cases (per acceptance criteria):

- empty array → `[]`
- `null` → `[]` (Gitea/Forgejo defensive coercion)
- `undefined` → `[]` (Gitea/Forgejo defensive coercion)
- empty string → `[]` (Gitea/Forgejo defensive coercion)
- single `area/auth` → `['auth']`
- mixed `area/*` + `type:*` + `priority:*` + bare → only `area/*` extracted, prefix stripped
- `area/cross-cutting` alongside other areas → present in result, alphabetically sorted with the rest
- multi-area, unsorted input → deduplicated and alphabetically sorted in output
- duplicate `area/auth` entries → single output
- bare `area` (no slash, just the word) → excluded (must have `/` separator)

**`packages/core/__tests__/builder-helpers.test.ts`** (or equivalent — confirm test layout, may need creating) — `resolvePrimaryArea`:
- `[]` → `'Uncategorized'`
- `['auth']` → `'auth'`
- `['auth', 'core']` → `'auth'` (first alphabetical)
- `['cross-cutting']` → `'cross-cutting'`
- `['auth', 'cross-cutting', 'tower']` → `'cross-cutting'` (cross-cutting wins over alphabetical first)

## Files to Change

- `packages/codev/src/lib/github.ts` — add `parseAreaLabels` (~510, after `parseLabelDefaults`)
- `packages/codev/src/agent-farm/servers/overview.ts:19` — import `parseAreaLabels`
- `packages/codev/src/agent-farm/servers/overview.ts:35` — add `areas: string[]` to `BuilderOverview`
- `packages/codev/src/agent-farm/servers/overview.ts:95` — add `areas: string[]` to `BacklogItem`
- `packages/codev/src/agent-farm/servers/overview.ts:~578,~632,~666` — initialize `areas: []` in 3 `discoverBuilders` push sites
- `packages/codev/src/agent-farm/servers/overview.ts:736` — populate `areas: parseAreaLabels(issue.labels)` in `deriveBacklog`
- `packages/codev/src/agent-farm/servers/overview.ts:~870` — extend issue→builder enrichment to populate `b.areas`
- `packages/types/src/api.ts:130` — add `areas: string[]` to `OverviewBuilder`
- `packages/types/src/api.ts:187` — add `areas: string[]` to `OverviewBacklogItem`
- `packages/core/src/builder-helpers.ts` — add `resolvePrimaryArea` below `isIdleWaiting`
- `packages/codev/src/__tests__/github.test.ts` — add `parseAreaLabels` import + `describe` block with 10 cases listed above
- `packages/core/__tests__/builder-helpers.test.ts` (or wherever existing helper tests live; confirmed during implement) — add `resolvePrimaryArea` test block with 5 cases listed above

**Estimated diff size**: ~80 lines of production code, ~80 lines of tests. ~12 files touched, but most edits are one or two lines.

## Risks & Alternatives Considered

### Risk: Cache shape discipline §B

The issue body presents discipline §B (defensive `??= []` at cache serve-out, or restart-time invalidation) as a mandatory acceptance criterion. The current architecture makes this structurally satisfied — `OverviewCache` only holds raw forge responses, never derived shapes — so no defensive coercion is added. **Verified at `overview.ts:763-769`.** Recording this here so a reviewer who reads the issue and expects to see `??= []` somewhere in the diff knows where to look (and confirms it's not needed).

If a future change *did* add a derived-shape cache (e.g. caching the full `OverviewData` between requests), the discipline would need to be re-applied at that point. Out of scope for this PIR.

### Risk: Downstream consumer breakage

Adding a required field to a wire contract is a forward-compatible change for new clients (always present) but a *breaking* change for any existing serialized payloads that lack the field. The only such surface in this codebase is the in-memory cache discussed above — no on-disk serialization of `OverviewBacklogItem` / `OverviewBuilder` exists (verified via `grep -rn "OverviewBacklogItem\|OverviewBuilder" packages/`, all hits are type-level only). Safe to land as required.

### Alternative: `areas?: string[]` (optional)

Rejected per discipline §A in the issue body. The required-with-default form forces every construction site to populate the field explicitly, which prevents the "I forgot one branch of `discoverBuilders` and it's `undefined` in prod" failure mode. The four consumer call sites (`BacklogList.tsx`, dashboard `api.ts`, vscode `backlog.ts`, vscode `builders.ts` — to be touched in #811 / #818) can rely on `areas.length` without null guards.

### Alternative: parse `area/*` inside `parseLabelDefaults`

Rejected. `parseLabelDefaults` returns `{type, priority}` — adding `areas` would couple two unrelated namespaces and force every caller to destructure an unused field. Separate helper keeps each parser single-purpose.

### Open question (tracked separately): mixed-separator convention

This PIR ships `area/*` on slash while keeping `type:*` and `priority:*` on colon, per the issue body's stated Kubernetes-alignment rationale. The resulting mixed-separator state across Codev's label namespaces is a legitimate engineering concern (cognitive load, two near-identical parsers, no principled rule for future namespaces) — but not one to resolve inside this PIR.

Tracked as **#869** ("Label namespace separator: resolve mixed colon-vs-slash convention") with three options laid out (A: all-slash, B: all-colon, C: stay mixed) and the "web dashboard pathway compatibility" constraint flagged for verification. Whichever way #869 resolves, the changes from #819 are forward-compatible — the `parseAreaLabels` helper would either stay (option C), get its `area/` literal swapped for `area:` (option B), or get merged into a unified slash-based parser alongside renamed `type/` and `priority/` (option A).

### Alternative: `resolvePrimaryArea` in `@cluesmith/codev-types`

Rejected — types package is wire contracts only (per existing convention; see `packages/core/src/builder-helpers.ts:13-19` docstring on `IDLE_WAITING_THRESHOLD_MS` which spells this out). Policy / implementation goes in `@cluesmith/codev-core`.

### Alternative: read GitHub Issue Types instead of labels

Explicitly out of scope per the issue body — labels are the universal cross-forge primitive; Issue Types are GitHub-only.

## Test Plan

### Unit tests

- `pnpm --filter @cluesmith/codev test src/__tests__/github.test.ts` — verifies the new `parseAreaLabels` block (10 cases).
- `pnpm --filter @cluesmith/codev-core test` — verifies `resolvePrimaryArea` (5 cases).

### Integration / type-check

- `pnpm -w build` — full workspace build. Must succeed. Required-field discipline means TypeScript will flag any unpopulated `areas` site at compile time, so a green build is strong evidence that all construction sites were touched.
- `grep -rn "areas:" packages/codev/src/agent-farm/servers/overview.ts` — manual check that all 3 `discoverBuilders` push sites + `deriveBacklog` + `getOverview` enrichment all populate the field.

### Manual / dev-approval gate

The reviewer at `dev-approval` should verify:

1. `pnpm -w build` is green — confirms wire-contract field propagated to all four downstream consumers without compile errors. (Critically, this PIR adds the field but doesn't *yet* touch the consumers, so the build passing is the primary evidence that nothing existing broke.)
2. `pnpm --filter @cluesmith/codev test` — github.test.ts new block passes.
3. `pnpm --filter @cluesmith/codev-core test` — builder-helpers test passes.
4. Inspect `/api/overview` payload on a running Tower (`afx dev main`, then hit `http://localhost:<port>/api/overview` or use the dashboard's network tab):
   - Every `backlog[]` entry has `"areas": [...]` (may be `[]`).
   - Every `builders[]` entry has `"areas": [...]` (may be `[]`).
   - This issue itself (#819) carries `area/core` — when filtered against the live backlog, its entry should show `"areas": ["core"]`.
5. Optionally, manually exercise `resolvePrimaryArea`:
   ```ts
   import { resolvePrimaryArea } from '@cluesmith/codev-core';
   resolvePrimaryArea(['core']);                              // 'core'
   resolvePrimaryArea(['cross-cutting', 'tower']);            // 'cross-cutting'
   resolvePrimaryArea([]);                                    // 'Uncategorized'
   ```

### Cross-platform / dashboard

No UI changes in this PIR — the consumers (#811 backlog grouping, #818 builders tree grouping) ship in follow-up issues. The wire field landing here is invisible to end users until those consumers wire it through.

### How to test locally at the `dev-approval` gate

```bash
# Build everything
pnpm -w build

# Unit tests
pnpm --filter @cluesmith/codev test src/__tests__/github.test.ts
pnpm --filter @cluesmith/codev-core test

# Spin up Tower against this branch (optional — only needed to inspect live payload)
afx dev main
# Then in the dashboard or via curl, inspect /api/overview and look for "areas" on every backlog + builder entry.
```
