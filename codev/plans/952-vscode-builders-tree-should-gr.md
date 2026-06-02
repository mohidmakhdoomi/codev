# PIR Plan: Builders tree groups by phase (action axis), area becomes the row prefix

## Understanding

Today the VSCode **Builders** tree groups rows by their `area/*` label (`groupByArea(ordered, b => b.area)` in `packages/vscode/src/views/builders.ts:147`), and each row's label leads with the phase: `[<phase>] #<id> <title>` (`builderRowLabel` in `packages/vscode/src/views/builder-row.ts:149-160`). That mirrors the Backlog tree (#811/#818), which was a deliberate "one mental model across views" call.

The issue argues the two views answer different questions:

- **Backlog** = "what should I pick up next?" → grouping by **domain** (area) is right.
- **Builders** = "what's blocking me / where do I act?" → grouping by **phase** is right ("show me everything at plan-approval", "everything sitting at implement", "everything waiting on a PR merge"). Area-grouping forces a reverse scan: open every area group and read each row's `[<phase>]` prefix to mentally collect a phase.

**The swap**: group the Builders tree by `protocolPhase`; move `area` into the row prefix (`[<area>] #<id> <title>`). Backlog stays area-grouped. The state-color/gate-icon system from #810 (`gateIconFor`, `BUILDER_STATE_GLYPH`, `rollupGroupState`) composes orthogonally and is preserved.

### Data facts that shape the design

- `OverviewBuilder.protocolPhase` (`packages/types/src/api.ts:148`) is the coarse protocol phase — the raw `phase:` from `status.yaml`. Phase ids by bundled protocol: **spir/aspir** = `specify/plan/implement/review/verify`; **pir** = `plan/implement/review`; **air** = `implement/pr`; **bugfix** = `investigate/fix/pr`; **maintain** = `maintain/review`; **experiment** = `hypothesis/design/execute/analyze`; **research** = `scope/investigate/synthesize/critique`; **spike** = `spike`. Terminal status values that also surface as `protocolPhase`: `verified` / `complete`. Empty string when no live status exists.
- `OverviewBuilder.area` wire values are lowercase (`vscode`, `tower`, `cross-cutting`), with the `Uncategorized` sentinel (`UNCATEGORIZED_AREA`, `packages/core/src/constants.ts:14`) when the builder's issue has no `area/*` label.
- The Builders dashboard has **no** builders-by-area grouping (`grep` of `packages/dashboard/src` finds no `groupByArea`/`protocolPhase`) — so this is genuinely VSCode-only; there is no parallel dashboard view to keep in sync.

## Proposed Change

### 1. New pure core helper `groupByPhase` (lifecycle-ordered)

Add `packages/core/src/phase-grouping.ts` — sibling to `area-grouping.ts`. It buckets items by a phase key and returns groups in an **explicit total order over every phase id authored across all 9 bundled protocols** (not alphabetical, and not just the mainline lifecycle — see "Phase coverage" below). The order, kept as one curated constant `PHASE_DISPLAY_ORDER`:

```
specify · plan · implement · review · pr · verify · verified      # mainline lifecycle (spir/aspir/pir/air)
investigate · fix · scope · synthesize · critique                  # bugfix / research
hypothesis · design · execute · analyze · maintain · spike         # experiment / maintain / spike
```

Rules:
- Phases present in `PHASE_DISPLAY_ORDER` emit in that fixed order.
- **`complete` is normalized to `verified` before bucketing** (it is the backward-compat synonym; `overview.ts:384-385` already collapses the two). Without this, a `complete` builder would render as a stray `COMPLETE` group apart from `VERIFIED`.
- Any **unrecognized future** phase (not in the list, non-empty) is appended after the known set, sorted alphabetically — a graceful fallback so a new protocol's phase never renders order-less.
- A builder whose `protocolPhase` is empty/whitespace is bucketed under a trailing **`unknown`** sentinel group (so transient init-state builders still have a home), appended last.
- **Empty groups are omitted** — a bucket exists only if ≥1 builder is in it. This satisfies the "hide empty phase groups" acceptance criterion automatically.

Signature mirrors `groupByArea` for consistency:

```ts
export function groupByPhase<T>(
  items: T[],
  getPhase: (item: T) => string,
): Array<{ phase: string; items: T[] }>
```

#### Phase coverage (all 9 protocols)

| Protocol | Phases | Terminal |
|---|---|---|
| spir / aspir | specify · plan · implement · review · verify | verified (`complete` = synonym) |
| pir | plan · implement · review | verified |
| air | implement · pr | verified |
| bugfix | investigate · fix · pr | verified |
| maintain | maintain · review | verified |
| experiment | hypothesis · design · execute · analyze | verified |
| research | scope · investigate · synthesize · critique | verified |
| spike | spike | verified |

`experiment` / `maintain` / `research` / `spike` are confirmed spawnable as builders (`spawn.test.ts`, `agent-names.test.ts`), so their phases really can appear in this tree — `PHASE_DISPLAY_ORDER` covers each in its natural per-protocol sequence rather than scrambling them alphabetically. Shared ids (`implement`, `review`, `pr`, `investigate`) merge cross-protocol into one bucket by design (the triage question "everything at implement" is protocol-agnostic). **Distinct buckets possible: 17 authored ids + `verified` + `unknown` ≈ 19** (with `complete` normalized away); realistically 1–7 live at once.

> **Design call #1 (phase order) — locked**: explicit total order per `PHASE_DISPLAY_ORDER` above (mainline lifecycle, then auxiliary protocols each in natural order); `complete`→`verified` normalized; unrecognized future phases alphabetical; `unknown` (empty) last. Note: `verify` (active SPIR verify phase) sorts before `verified` (terminal) intentionally — they are distinct `protocolPhase` values. **Revised from the first draft** (which appended all non-mainline phases alphabetically) after auditing that alphabetical scrambles experiment/research/bugfix's internal sequences — reintroducing exactly the nonsense this design call rejects.
>
> **Design call #2 (empty groups) — locked**: hidden entirely (a bucket only exists if it has members).

Display label reuses the existing uppercase convention (`uppercaseAreaName` is a pure `.toUpperCase()` — it works for phase strings unchanged; no new display helper needed). `IMPLEMENT (3)`, `PLAN (1)`, etc.

### 2. `builders.ts` — group by phase

- Swap `groupByArea(ordered, b => b.area)` → `groupByPhase(ordered, b => b.protocolPhase)` in both `rootChildren()` (line 147) and `rowsForGroup()` (line 179).
- `rowsForGroup` matches on `g.phase` instead of `g.area`; its param is renamed `phaseName`.
- Group-item construction passes the phase string: `new BuilderGroupTreeItem(g.phase, g.items.length, state, rollupGroupState(g.items, now))`.
- **Remove the single-`Uncategorized` flatten special case** (lines 153-156). That branch existed because an Uncategorized-only result means "this repo doesn't use the area axis at all" — grouping adds nothing. The phase axis always applies (every live builder has a phase), so there is no analogous "axis absent" degenerate. Builders always render under a phase-group header. `getParent`/`groupParentByBuilderId` therefore always populate (simplifies the accordion path — no flatten branch to special-case).
  - Edge note: if every builder has empty `protocolPhase`, the result is a single `UNKNOWN` group. We accept the header in that rare transient case rather than reintroducing a flatten — it's self-describing ("nothing has a phase yet").

> **Design call #4 (blocked builders) — locked**: blocked builders stay in their **semantic phase group** (no synthetic `BLOCKED` group). A builder blocked on `plan-approval` is still `protocolPhase: plan` → lands in the `PLAN` group with its warning-yellow `checklist` gate icon. The icon color conveys state; the group conveys phase. This is already how `protocolPhase` behaves at a pending gate (the phase doesn't advance until the gate is approved), so no extra logic is needed.

### 3. `builder-row.ts` — `builderRowLabel`: area prefix instead of phase prefix

Replace the `phasePrefix` with an `areaPrefix`:

```ts
const areaPrefix = b.area && b.area !== UNCATEGORIZED_AREA ? `[${b.area}] ` : '';
return `${areaPrefix}#${b.issueId ?? b.id} ${b.issueTitle ?? ''}${stateLabel}`;
```

- Phase is now implicit from group containment, so it leaves the row label entirely.
- The blocked/idle `stateLabel` suffix logic (`blocked on <label> [<elapsed>]` / `waiting on input [<elapsed> silent]`) is **unchanged**.
- The JSDoc block (currently describing the phase-prefix rationale) is rewritten to describe the area-prefix.

> **Design call #3 (prefix format) — locked**: `[vscode]` — lowercase, raw area echo, no `area/` prefix. Area wire values are already lowercase, so this is a direct echo. **`Uncategorized` is omitted** (no `[Uncategorized]` noise — mirrors today's empty-phase omission).
>
> **Design call #5 (cross-cutting) — locked**: keep `[cross-cutting]` verbatim (no `[shared]` shorthand — shorthand invites "is it the same as cross-cutting?" confusion).

This pulls `UNCATEGORIZED_AREA` into `builder-row.ts` (import from `@cluesmith/codev-core/constants`) — the module stays vscode-free, so it remains unit-testable under the vitest harness.

### 4. Expansion persistence — reuse the generic store with a new key

The existing `AreaGroupExpansionStore` (`area-group-expansion.ts`) is already generic: it stores `Record<string, boolean>` keyed by whatever string the caller passes (`set(name, expanded)`), defaulting untouched groups to expanded. Only its name says "Area".

- In `builders.ts`, change the store's storage key from `codev.buildersGroupExpansion` → **`codev.buildersPhaseGroupExpansion`**. Old area-keyed entries under the old key become stale and harmless (never read again) — exactly the issue's "old `BuilderGroupExpansion` entries become stale and harmless" outcome.
- `persistAreaGroupExpansion` wires `view.onDidExpand/Collapse` → `store.set(e.element.areaName, …)`. Since `BuilderGroupTreeItem` now carries the **phase** string in its `areaName` field (see #5 below), expansion persists keyed by phase with no change to the helper.

> **Design call #6 (persistence) — locked**: reuse the generic store with a new key (the DRY equivalent of the issue's "parallel `PhaseGroupExpansionStore`" — same outcome: a separate storage namespace keyed by phase, old area entries orphaned). A full class rename is avoided to keep churn surgical. **#913 coordination**: #913 (make builder group-expansion ephemeral) is still OPEN/unmerged; this plan proceeds with persistence as-is. If #913 lands first, it converts this store to ephemeral — the new key is forward-compatible with that change (it just becomes the in-memory key).

### 5. `BuilderGroupTreeItem` / `AreaGroupTreeItem` — pass phase into the existing slot

Per the issue's explicit guidance ("The `BuilderGroupTreeItem` shape stays the same; just receives a phase name instead of an area name"), the base `AreaGroupTreeItem` is **not** renamed. `BuilderGroupTreeItem` receives the phase string in its first constructor arg (currently named `areaName`). Mechanically:

- `id` becomes `builder-group:<phase>` (e.g. `builder-group:implement`) — still stable per group, so VSCode persists expansion across cache ticks.
- `contextValue` stays `builder-group` (menu scoping unchanged).
- Label is `uppercaseAreaName(phase)` → `IMPLEMENT (3)`.

A clarifying comment is added to `BuilderGroupTreeItem` noting its `areaName` slot now carries a phase (the base remains shared with the genuinely-area-keyed Backlog header). The base field name stays `areaName` to avoid a cross-view rename touching Backlog; this is a deliberate surgical-scope call (the field is the generic "group key" — Backlog's is an area, Builders' is a phase).

### 6. Backlog tree — untouched

`backlog.ts` keeps `groupByArea`. No changes. Acceptance criterion "Backlog tree's `area/*` grouping is unaffected" is met by not touching it.

## Files to Change

- `packages/core/src/phase-grouping.ts` — **new**. `groupByPhase` + `PHASE_DISPLAY_ORDER` (full 17-id curated order) + `complete`→`verified` normalization + an `UNKNOWN_PHASE` sentinel. Pure, generic, vscode-free.
- `packages/core/src/index.ts` (or the package's export map) — export the new module so VSCode can import `@cluesmith/codev-core/phase-grouping` (mirror how `area-grouping` is exported). *Verify the actual export mechanism before editing — package.json `exports` map vs. barrel file.*
- `packages/vscode/src/views/builders.ts` — `groupByArea`→`groupByPhase` at lines 147 & 179; `rowsForGroup(phaseName)`; group-item construction with `g.phase`; remove the Uncategorized-flatten branch (153-156); new storage key `codev.buildersPhaseGroupExpansion` (line 86); update class-level JSDoc (55-69) to describe phase-grouping.
- `packages/vscode/src/views/builder-row.ts:149-160` — `builderRowLabel`: `phasePrefix`→`areaPrefix`; import `UNCATEGORIZED_AREA`; rewrite JSDoc (124-148).
- `packages/vscode/src/views/builder-tree-item.ts:43-55` — clarifying comment that `BuilderGroupTreeItem`'s `areaName` slot now carries a phase; update the class JSDoc (27-42).
- `packages/core/src/__tests__/phase-grouping.test.ts` (or wherever core unit tests live) — **new** tests for `groupByPhase`.
- `packages/vscode/src/__tests__/builder-row.test.ts` — update `builderRowLabel` expectations (phase-prefix → area-prefix) and add area-prefix cases (labeled / Uncategorized-omitted / cross-cutting).

## Risks & Alternatives Considered

- **Risk: `protocolPhase` empty/transient state.** Mitigation: the `unknown` sentinel bucket gives those builders a stable trailing home rather than dropping them. Acceptance criterion "builder counts per group are accurate" still holds because every builder lands in exactly one bucket.
- **Risk: `pr`/`verified` builders linger in the tree.** They render in `PR`/`VERIFIED` groups until `afx cleanup` removes the worktree — which matches today's behavior (they show under their area group now). No regression; arguably clearer.
- **Risk: removing the flatten branch changes the unlabeled-repo experience.** For unlabeled repos, today's tree is flat (no headers); after this change a single-builder unlabeled repo sees an `IMPLEMENT (1)` header. This is intentional — phase is the point of the view. Called out so the reviewer expects it at the dev-approval gate.
- **Alternative: synthetic `BLOCKED` group** (rejected, design call #4) — would double-encode the state already carried by icon color and split a phase's builders across two groups.
- **Alternative: rename `AreaGroupTreeItem`/`areaName` to generic `groupKey`** (rejected) — cleaner naming but sprawls into Backlog + base + tests for no behavioral gain; the issue explicitly endorses reusing the slot. Surgical scope preferred.
- **Alternative: keep alphabetical phase order** (rejected, design call #1) — `IMPLEMENT, PLAN, PR, REVIEW, SPECIFY, VERIFIED` is nonsensical for lifecycle triage.

## Test Plan

- **Unit (core `groupByPhase`)**:
  - mainline phases returned in `specify → plan → implement → review → pr → verify → verified` order regardless of input order;
  - auxiliary phases returned in their natural per-protocol order (experiment `hypothesis → design → execute → analyze`; research `scope → investigate → synthesize → critique`; bugfix `investigate → fix`) — explicitly assert they are NOT alphabetized;
  - `complete` is bucketed together with `verified` (normalization), not as a separate group;
  - an unrecognized future phase (e.g. `frobnicate`) appears after the known set, alphabetically;
  - empty buckets omitted (a phase with no members produces no group);
  - empty-string `protocolPhase` → `unknown` bucket, last;
  - within-bucket input order preserved (display-order sort already applied upstream).
- **Unit (`builderRowLabel`)**:
  - labeled area → `[vscode] #882 title`;
  - `Uncategorized` → prefix omitted (`#882 title`);
  - `cross-cutting` → `[cross-cutting] #882 title`;
  - blocked/idle state suffix still appended after the title.
- **Manual / running-worktree (dev-approval gate — PIR's killer move)**:
  - `afx dev pir-952` to run the worktree's VSCode build (or load the extension), with several builders live across different phases.
  - Confirm the Builders tree groups by phase, headers in lifecycle order, empty phases hidden, counts accurate.
  - Confirm each row reads `[<area>] #<id> <title>`; Uncategorized rows have no prefix.
  - Confirm a builder sitting at `plan-approval` appears under `PLAN` with the yellow `checklist` icon (state-color preserved).
  - Confirm Backlog tree still groups by area (no regression).
  - Confirm group collapse/expand persists across a window reload (new storage key).
- **Build/typecheck**: `pnpm --filter @cluesmith/codev-core build` then `pnpm --filter @cluesmith/codev build` (no `check-types` script in vscode — full build is the typecheck); run the vitest unit suites.
