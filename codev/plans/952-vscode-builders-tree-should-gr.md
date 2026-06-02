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

### 1. New pure core helper `groupByStage` (closed canonical stage set)

Add `packages/core/src/phase-grouping.ts` — sibling to `area-grouping.ts`. Rather than minting one group per raw phase id (which produces a ~19-wide vocabulary across 9 protocols), it maps every protocol's phase ids onto a **closed, fixed set of 6 canonical lifecycle stages**, then buckets by stage. **This caps the tree at 7 groups maximum (6 stages + `unknown`), permanently — independent of how many protocols/phases Codev ever adds.** A new protocol's phases route into an existing stage (or fall to `unknown` until mapped); the group count never grows with the protocol catalog.

The closed stage set, in fixed display order:

```
SPECIFY → PLAN → IMPLEMENT → REVIEW → PR → VERIFIED        (+ UNKNOWN, last)
```

#### Phase → stage mapping (`PHASE_TO_STAGE`)

Every phase id authored across all 9 bundled protocols folds into one stage:

| Canonical stage | Phase ids that map to it | Source protocols |
|---|---|---|
| **specify** | specify · hypothesis · scope | spir/aspir · experiment · research |
| **plan** | plan · design · investigate | spir/aspir/pir · experiment · bugfix/research |
| **implement** | implement · fix · execute · maintain · spike | spir/aspir/pir/air · bugfix · experiment · maintain · spike |
| **review** | review · synthesize · analyze · critique | spir/aspir/pir/maintain · research · experiment · research |
| **pr** | pr | air · bugfix |
| **verified** | verify · verified · complete | spir/aspir · (terminal, all) |
| *(unknown)* | `""` + any unrecognized future phase id | catch-all |

Rules:
- A builder's `protocolPhase` is looked up in `PHASE_TO_STAGE`; the resulting stage is its bucket.
- **`verify`, `verified`, and `complete` all fold into the `verified` stage** — this subsumes the earlier `complete`→`verified` normalization *and* merges SPIR's in-progress `verify` phase into the same terminal bucket (the row's state icon still distinguishes an active verify from a done builder).
- **Empty `protocolPhase` OR any unrecognized future phase id → `unknown`** (a single bounded catch-all, not a per-phase tail). Keeps the cap fixed; a new protocol whose phase isn't yet mapped surfaces under UNKNOWN rather than silently vanishing or expanding the group set.
- Stages emit in the fixed order above; **empty stages are omitted** (a bucket exists only if ≥1 builder maps into it) — satisfies the "hide empty groups" acceptance criterion.
- Within a stage, input order is preserved (display-order sort already applied upstream).

Signature (mirrors `groupByArea`; the getter still extracts the raw phase, the mapping happens inside):

```ts
export type BuilderStage = 'specify' | 'plan' | 'implement' | 'review' | 'pr' | 'verified' | 'unknown';

export function groupByStage<T>(
  items: T[],
  getPhase: (item: T) => string,
): Array<{ stage: BuilderStage; items: T[] }>
```

`PHASE_TO_STAGE`, the `STAGE_ORDER` array, and `BuilderStage` are all exported so the mapping/order is testable and documented in one place.

#### Why a closed set (vs the issue's "append protocol-specific phases after VERIFIED")

The issue's design-call #1 said to append protocol-specific phases (`INVESTIGATE`, `FIX`, …) as their *own* groups after VERIFIED. Auditing the full phase inventory showed that produces up to ~19 distinct groups (every phase across all 9 protocols), which defeats the at-a-glance triage goal. **Per architect direction, this plan supersedes that**: protocol-specific phases fold into the 6 canonical stages instead. See "Acceptance criteria delta" below — the issue's bullet about appended protocol phases is replaced.

> **Design call #1 (stage set & order) — locked**: closed 6-stage set `SPECIFY → PLAN → IMPLEMENT → REVIEW → PR → VERIFIED` (+ `UNKNOWN` last), with `PHASE_TO_STAGE` folding all 17 phase ids in. `investigate → plan` (treats it as pre-build diagnosis — correct for the common BUGFIX case; RESEARCH's investigate approximates here). `verify`/`verified`/`complete → verified`. Unrecognized/empty → `unknown`. **PR and VERIFIED stay separate** (not merged): PR is an *action-needed* stage ("needs a merge" — one of the issue's headline triage queries), VERIFIED is terminal/no-action; conflating them would defeat the merge-triage query for a one-group saving against an already-low cap.
>
> **Design call #2 (empty groups) — locked**: hidden entirely (a bucket only exists if it has members).

Display label reuses the existing uppercase convention (`uppercaseAreaName` is a pure `.toUpperCase()` — works on stage strings unchanged; no new display helper needed): `IMPLEMENT (3)`, `PLAN (1)`, etc.

### 2. `builders.ts` — group by stage

- Swap `groupByArea(ordered, b => b.area)` → `groupByStage(ordered, b => b.protocolPhase)` in both `rootChildren()` (line 147) and `rowsForGroup()` (line 179).
- `rowsForGroup` matches on `g.stage` instead of `g.area`; its param is renamed `stage`.
- Group-item construction passes the stage string: `new BuilderGroupTreeItem(g.stage, g.items.length, state, rollupGroupState(g.items, now))`.
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

- In `builders.ts`, change the store's storage key from `codev.buildersGroupExpansion` → **`codev.buildersStageGroupExpansion`**. Old area-keyed entries under the old key become stale and harmless (never read again) — exactly the issue's "old `BuilderGroupExpansion` entries become stale and harmless" outcome.
- `persistAreaGroupExpansion` wires `view.onDidExpand/Collapse` → `store.set(e.element.areaName, …)`. Since `BuilderGroupTreeItem` now carries the **stage** string in its `areaName` field (see #5 below), expansion persists keyed by stage with no change to the helper.

> **Design call #6 (persistence) — locked**: reuse the generic store with a new key (the DRY equivalent of the issue's "parallel `PhaseGroupExpansionStore`" — same outcome: a separate storage namespace keyed by stage, old area entries orphaned). A full class rename is avoided to keep churn surgical. **#913 coordination**: #913 (make builder group-expansion ephemeral) is still OPEN/unmerged; this plan proceeds with persistence as-is. If #913 lands first, it converts this store to ephemeral — the new key is forward-compatible with that change (it just becomes the in-memory key).

### 5. `BuilderGroupTreeItem` / `AreaGroupTreeItem` — pass stage into the existing slot

Per the issue's explicit guidance ("The `BuilderGroupTreeItem` shape stays the same; just receives a phase name instead of an area name"), the base `AreaGroupTreeItem` is **not** renamed. `BuilderGroupTreeItem` receives the stage string in its first constructor arg (currently named `areaName`). Mechanically:

- `id` becomes `builder-group:<stage>` (e.g. `builder-group:implement`) — still stable per group, so VSCode persists expansion across cache ticks.
- `contextValue` stays `builder-group` (menu scoping unchanged).
- Label is `uppercaseAreaName(stage)` → `IMPLEMENT (3)`.

A clarifying comment is added to `BuilderGroupTreeItem` noting its `areaName` slot now carries a stage (the base remains shared with the genuinely-area-keyed Backlog header). The base field name stays `areaName` to avoid a cross-view rename touching Backlog; this is a deliberate surgical-scope call (the field is the generic "group key" — Backlog's is an area, Builders' is a stage).

#### Group header icon — keep the worst-of-state rollup (unchanged behavior)

`BuilderGroupTreeItem` keeps its #926 **worst-of-state rollup icon**: any member blocked → yellow `bell`; else any idle → blue `comment-discussion`; else green `circle-filled`; tooltip `"<b> blocked · <i> waiting · <a> active"`. `builders.ts` already passes `rollupGroupState(g.items, now)` into the constructor; that line is unchanged.

> **Design call #7 (group header icons) — locked**: header icon stays the worst-of-**state** rollup, NOT a per-stage identity icon. Rationale: the header *label* already names the stage; the *icon* must carry the orthogonal "does this group need attention" signal (the action-axis payload). A static stage icon would be redundant with the label and would discard the at-a-glance blocked signal. Generic `bell` (not a gate-specific shape) because a stage can hold builders blocked at different gates — the warning *color* is the group-level signal, the row icons carry per-gate shape. The only header change is **cosmetic**: rename the "area-group" prose/JSDoc in `builder-tree-item.ts` to "stage-group". Edge: the `VERIFIED` stage's finished builders roll up green/active — accepted (matches current behavior; not worth special-casing).

### 6. Backlog tree — untouched

`backlog.ts` keeps `groupByArea`. No changes. Acceptance criterion "Backlog tree's `area/*` grouping is unaffected" is met by not touching it.

## Acceptance criteria delta (vs the issue text)

The issue's acceptance list predates the architect's "reduce max groups" direction. Two bullets change:

- **REPLACED** — issue: *"Phase groups render in lifecycle order: SPECIFY → … → VERIFIED; protocol-specific phases (e.g. INVESTIGATE, FIX) appended after VERIFIED."* → now: *"Builder rows group into a closed set of 6 canonical stages (SPECIFY → PLAN → IMPLEMENT → REVIEW → PR → VERIFIED) in that fixed order; every protocol's phase ids fold into these stages via `PHASE_TO_STAGE` (no per-phase groups); unmapped/empty phases fall to a trailing UNKNOWN group. Max 7 groups regardless of protocol count."*
- **UNCHANGED** — group by porch phase not `area/*`; empty groups hidden; row label `[<area>] #<id> <title>`; blocked builders stay in their semantic stage (no synthetic BLOCKED); backlog unaffected; counts accurate.

All other acceptance criteria carry over verbatim.

## Files to Change

- `packages/core/src/phase-grouping.ts` — **new**. `groupByStage` + `PHASE_TO_STAGE` map + `STAGE_ORDER` + `BuilderStage` type. Folds all 17 phase ids into the 6 canonical stages (+ `unknown`). Pure, generic, vscode-free.
- `packages/core/src/index.ts` (or the package's export map) — export the new module so VSCode can import `@cluesmith/codev-core/phase-grouping` (mirror how `area-grouping` is exported). *Verify the actual export mechanism before editing — package.json `exports` map vs. barrel file.*
- `packages/vscode/src/views/builders.ts` — `groupByArea`→`groupByStage` at lines 147 & 179; `rowsForGroup(stage)`; group-item construction with `g.stage`; remove the Uncategorized-flatten branch (153-156); new storage key `codev.buildersStageGroupExpansion` (line 86); update class-level JSDoc (55-69) to describe stage-grouping.
- `packages/vscode/src/views/builder-row.ts:149-160` — `builderRowLabel`: `phasePrefix`→`areaPrefix`; import `UNCATEGORIZED_AREA`; rewrite JSDoc (124-148).
- `packages/vscode/src/views/builder-tree-item.ts:43-55` — clarifying comment that `BuilderGroupTreeItem`'s `areaName` slot now carries a stage; rename "area-group" prose/JSDoc → "stage-group" (27-55). Header rollup-icon behavior unchanged (design call #7).
- `packages/core/src/__tests__/phase-grouping.test.ts` (or wherever core unit tests live) — **new** tests for `groupByStage` / `PHASE_TO_STAGE`.
- `packages/vscode/src/__tests__/builder-row.test.ts` — update `builderRowLabel` expectations (phase-prefix → area-prefix) and add area-prefix cases (labeled / Uncategorized-omitted / cross-cutting).

## Risks & Alternatives Considered

- **Risk: `protocolPhase` empty/transient state.** Mitigation: the `unknown` sentinel bucket gives those builders a stable trailing home rather than dropping them. Acceptance criterion "builder counts per group are accurate" still holds because every builder lands in exactly one bucket.
- **Risk: `pr`/`verified` builders linger in the tree.** They render in `PR`/`VERIFIED` groups until `afx cleanup` removes the worktree — which matches today's behavior (they show under their area group now). No regression; arguably clearer.
- **Risk: removing the flatten branch changes the unlabeled-repo experience.** For unlabeled repos, today's tree is flat (no headers); after this change a single-builder unlabeled repo sees an `IMPLEMENT (1)` header. This is intentional — phase is the point of the view. Called out so the reviewer expects it at the dev-approval gate.
- **Behavior change (NEW): rows relocate between sections over a builder's life.** Under area-grouping the group key (`area/*`) is *static*, so rows never moved between groups — only the in-place `[<phase>]` text changed. Stage is *time-varying*, so a builder advancing PLAN→IMPLEMENT→… now **jumps** to the new section on the next SSE refresh (VSCode `TreeView` has no node-move animation — it's a discrete re-render, not a slide). Mitigations/notes: (a) the row's stable `item.id` (builder id) lets VSCode reconcile it as the same item, preserving its expanded changed-files sublist and selection across the move; (b) empty-group-hiding means whole headers blink in/out at low counts (`PLAN (1)` disappears, `IMPLEMENT (1)` appears) — more visible than an in-list shift; (c) if the destination stage was collapsed by the user, the advancing builder moves into a folded section and isn't visible until expanded. Frequency is low (phase transitions are rare per builder; gated phases sit still), so motion is occasional and meaningful, not churn. Accepted as inherent to the action axis — flagged for the dev-approval walkthrough.
- **Alternative: synthetic `BLOCKED` group** (rejected, design call #4) — would double-encode the state already carried by icon color and split a phase's builders across two groups.
- **Alternative: rename `AreaGroupTreeItem`/`areaName` to generic `groupKey`** (rejected) — cleaner naming but sprawls into Backlog + base + tests for no behavioral gain; the issue explicitly endorses reusing the slot. Surgical scope preferred.
- **Alternative: keep alphabetical phase order** (rejected, design call #1) — `IMPLEMENT, PLAN, PR, REVIEW, SPECIFY, VERIFIED` is nonsensical for lifecycle triage.

## Test Plan

- **Unit (core `groupByStage` / `PHASE_TO_STAGE`)**:
  - stages returned in fixed `specify → plan → implement → review → pr → verified` order regardless of input order;
  - every phase id maps to the expected stage: assert each of the 17 ids resolves to its `PHASE_TO_STAGE` bucket (e.g. `hypothesis,scope → specify`; `design,investigate → plan`; `fix,execute,maintain,spike → implement`; `synthesize,analyze,critique → review`);
  - `investigate → plan` specifically (the architect-confirmed ambiguous call);
  - `verify`, `verified`, `complete` all fold into the single `verified` stage;
  - an unrecognized future phase (e.g. `frobnicate`) → `unknown`, NOT its own group;
  - empty stages omitted (a stage with no members produces no group);
  - empty-string `protocolPhase` → `unknown` stage, last;
  - within-stage input order preserved (display-order sort already applied upstream).
- **Unit (`builderRowLabel`)**:
  - labeled area → `[vscode] #882 title`;
  - `Uncategorized` → prefix omitted (`#882 title`);
  - `cross-cutting` → `[cross-cutting] #882 title`;
  - blocked/idle state suffix still appended after the title.
- **Manual / running-worktree (dev-approval gate — PIR's killer move)**:
  - `afx dev pir-952` to run the worktree's VSCode build (or load the extension), with several builders live across different phases.
  - Confirm the Builders tree groups by stage, headers in fixed lifecycle order, empty stages hidden, counts accurate.
  - Confirm each row reads `[<area>] #<id> <title>`; Uncategorized rows have no prefix.
  - Confirm a builder sitting at `plan-approval` appears under `PLAN` with the yellow `checklist` icon (state-color preserved).
  - Confirm Backlog tree still groups by area (no regression).
  - Confirm group collapse/expand persists across a window reload (new storage key).
- **Build/typecheck**: `pnpm --filter @cluesmith/codev-core build` then `pnpm --filter @cluesmith/codev build` (no `check-types` script in vscode — full build is the typecheck); run the vitest unit suites.
