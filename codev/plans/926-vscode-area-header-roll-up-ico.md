# PIR Plan: VSCode area-header roll-up icons (Backlog & Builders views)

## Understanding

The Backlog and Builders sidebar trees group rows under `area/*` headers
(e.g. `VSCODE (3)`). Today those headers carry **no icon** — the shared base
`AreaGroupTreeItem` (`area-group-tree-item.ts`) sets only `id` and
`contextValue`. An engineer scanning the collapsed tree can't tell, without
expanding each group, which areas have live builders (Builders view) or which
areas are open to spawn into vs. already being worked (Backlog view).

Issue #926 asks for a **roll-up status icon on each area header** — a summary of
the children's icons. The unifying rule is "the header summarizes what's
inside it," but the rollup *function* differs per view because the children
differ:

- **Backlog children are issues** → binary question "is anyone working this
  area?" → green filled dot vs. grey outline dot.
- **Builders children are builders** → worst-of-three rollup over the existing
  three builder-row states (blocked / idle / active), reusing the exact icons +
  color tokens already on individual builder rows.

No new colors or glyphs are introduced — every icon keeps the one meaning it
already has on a builder row. The detail (counts) lives in the header tooltip.

This is purely a VSCode-extension, client-side change. The overview payload
already carries `builders[]` (each with `.area`, `api.ts:182`) alongside
`backlog[]` (each with `.area`, `api.ts:222`), so both rollups are computed in
the tree providers from data already in the `OverviewCache`. No server /
overview-payload change is needed.

## Proposed Change

### Backlog view (binary rollup)

In `backlog.ts`, derive a per-area **active-builder count** from
`data.builders` (the same cache the provider already reads). A builder counts
toward an area when its `.area` matches the header's area. Pass that count into
`BacklogGroupTreeItem`; the subclass sets:

| State | Icon | Color token |
|---|---|---|
| count ≥ 1 (area has a live builder) | `circle-filled` | `testing.iconPassed` (green) |
| count = 0 (open to spawn) | `circle-outline` | `disabledForeground` (grey) |

Tooltip: `"<n> builder(s) active in <area>"` when count ≥ 1; `"No active
builders in <area>"` when count = 0.

The green dot is the *same* dot that means "live builder" on a builder row, so
its meaning is reinforced rather than overloaded; grey/idle areas stay muted so
the eye skims for spawn targets.

### Builders view (worst-of-three rollup)

In `builders.ts`, the provider already knows each group's builders and already
computes `isBlocked` / `isIdle` per builder (via `isIdleWaiting`,
`builders.ts:168`). Compute a `{ blocked, idle, active }` count triple per group
and pass it into `BuilderGroupTreeItem`; the subclass picks the **worst** state
present and reuses the row icons from `builders.ts:206-210`:

| If the area has… | Icon | Color token |
|---|---|---|
| any **blocked** builder | `bell` | `notificationsWarningIcon.foreground` (yellow) |
| else any **idle/silent** builder | `comment-discussion` | `notificationsInfoIcon.foreground` (blue) |
| else (all active) | `circle-filled` | `testing.iconPassed` (green) |

This matches the existing within-group sort order (blocked → idle → active), so
the header icon always equals the topmost row's icon in the group.

Tooltip: `"<b> blocked · <i> waiting · <a> active"` (all three segments shown,
matching the issue's example, so the format is predictable regardless of which
states are present).

### Rollup logic placement & testability

Mirror the existing pattern of exported pure helpers (`orderForDisplay`,
`spawnableBacklog`) that are unit-tested directly:

- `backlog.ts` — add exported pure `activeBuilderCountByArea(builders): Map<string, number>`.
- `builders.ts` — add exported pure `rollupGroupState(builders, now): { blocked: number; idle: number; active: number }` (reuses `isIdleWaiting`).

The providers call these and feed the result into the subclass constructors.
The **icon/tooltip assignment lives in the subclasses** (`BacklogGroupTreeItem`,
`BuilderGroupTreeItem`), per the issue's explicit instruction — *not* in the
shared `AreaGroupTreeItem` base, because the rollup differs per view.

The degenerate single-`Uncategorized` flatten branch (both providers) renders
no headers, so it needs no rollup and is untouched.

## Files to Change

- `packages/vscode/src/views/backlog.ts`
  - Add exported `activeBuilderCountByArea(builders: OverviewBuilder[]): Map<string, number>`.
  - In `rootChildren()` (L96-102), compute the map once and pass each group's
    count into `new BacklogGroupTreeItem(g.area, g.items.length, state, activeCount)`.
- `packages/vscode/src/views/backlog-tree-item.ts`
  - `BacklogGroupTreeItem` constructor gains an `activeBuilderCount: number`
    param; sets `this.iconPath` (circle-filled/green vs circle-outline/grey) and
    `this.tooltip` from it.
- `packages/vscode/src/views/builders.ts`
  - Add exported `rollupGroupState(builders, now): { blocked; idle; active }`.
  - In `rootChildren()` (L141-151), compute the triple per group and pass into
    `new BuilderGroupTreeItem(g.area, g.items.length, state, rollup)`.
- `packages/vscode/src/views/builder-tree-item.ts`
  - `BuilderGroupTreeItem` constructor gains a rollup-counts param; sets
    `this.iconPath` (worst-of bell/comment-discussion/circle-filled) and
    `this.tooltip`.
- `packages/vscode/src/views/area-group-tree-item.ts` — **no change** (rollup
  stays in subclasses, per the issue).
- Tests (new / extended):
  - `packages/vscode/src/test/backlog.test.ts` — unit-test
    `activeBuilderCountByArea` (empty, single area, multi-area, Uncategorized).
  - `packages/vscode/src/test/builders.test.ts` — unit-test `rollupGroupState`
    (all-active → active; one idle → idle; one blocked → blocked;
    blocked-dominates-idle; mixed counts).

## Risks & Alternatives Considered

- **Risk: builder `.area` and backlog `.area` projected independently.** Both
  use the same `parseArea` projection server-side (per the type docs), so an
  area string from `builders[]` matches the header key from
  `groupByArea(backlog)`. Mitigation: key the map on the raw `.area` wire value
  (exactly what `groupByArea` keys on) — no re-normalization in the client.

- **Risk: "active builder" semantics.** The Backlog rollup treats *any* builder
  in the area as "active" (the issue's heading question is "is anyone working
  this area?"). A builder blocked at a gate still counts — it's still occupying
  that area. This matches the issue's binary intent; the Builders view is where
  blocked/idle nuance is surfaced. Documented so a reviewer can object at the
  plan gate if they want "active" to exclude blocked builders.

- **Known limitation (accepted, from the issue):** an area that's busy but has
  **no remaining spawnable backlog items** renders no Backlog header at all, so
  it can't show "working" there. Fine for the "where do I spawn?" goal.

- **Alternative: pass a boolean (not a count) into `BacklogGroupTreeItem`** (as
  the issue's impl-notes suggest). Rejected: the tooltip needs the count, and
  passing the count subsumes the boolean (`count > 0`) with no extra plumbing.

- **Alternative: put rollup in the shared base.** Rejected per the issue — the
  two rollups differ (binary vs worst-of-three), so they belong in the
  subclasses.

- **Alternative: omit zero-count tooltip segments** ("3 active" instead of
  "0 blocked · 0 waiting · 3 active"). Rejected for predictability — the issue's
  example shows the full triple; a fixed format is easier to scan.

## Test Plan

- **Unit (`vitest`/vscode-test, the existing suites):**
  - `activeBuilderCountByArea`: empty builders → empty map; builders across two
    areas → correct per-area counts; multiple builders same area → summed;
    Uncategorized builders counted under `Uncategorized`.
  - `rollupGroupState`: all active → `{0,0,n}`; contains one idle → idle wins
    over active; contains one blocked → blocked wins over idle+active;
    blocked+idle+active mix → counts correct and blocked is the worst.
  - Run: `cd packages/vscode && pnpm test` (and/or `pnpm test:unit`).
- **Build:** `pnpm --filter @cluesmith/codev-vscode build` (and the full
  `pnpm build` from root) — confirm no TS errors from the new constructor params.
- **Manual (at the `dev-approval` gate, in the VSCode Extension Host):**
  - Backlog view: an area with a spawnable issue **and** a live builder shows a
    green filled dot; an area with only spawnable issues shows a grey outline
    dot. Hover → tooltip shows the builder count.
  - Builders view: a group with a builder blocked at a gate shows the yellow
    bell; a group whose worst builder is idle shows the blue comment-discussion;
    an all-active group shows the green filled dot. Header icon matches the
    topmost row in the group. Hover → "b blocked · i waiting · a active".
  - Collapse/expand still works; single-`Uncategorized` repos render flat rows
    with no header (unchanged).
- **Cross-platform:** N/A (VSCode extension; web dashboard explicitly out of
  scope per the issue).
