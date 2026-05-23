# Plan: Multi-Architect Coordination — Builder Attribution, Messaging Docs, Builder Thread State, VSCode Add-Refresh

## Metadata
- **ID**: plan-2026-05-22-823-multi-architect-coordination-b
- **Status**: draft
- **Specification**: [codev/specs/823-multi-architect-coordination-b.md](../specs/823-multi-architect-coordination-b.md)
- **Created**: 2026-05-22

## Executive Summary

Spec Approach 1 — all four deliverables in one SPIR PR with phase-level commits. Four phases ordered to put #786-independent work first (so the builder has maximum runway before needing #786 to merge): **Phase 1** (Item 1 — dashboard builder attribution, code), **Phase 2** (Item 3 — per-builder thread state, role files), **Phase 3** (Item 2 — inter-agent messaging docs, five markdown files), **Phase 4** (Item 4 — VSCode Architects tree auto-refresh, **#786-dependent**). Each phase is one atomic git commit on this builder branch; the cumulative branch ships as one PR per the architect's PR-strategy guidance (no per-phase PRs unless the architect requests).

Key design choices baked into the plan from the spec's locked decisions and OQ recommendations:

- **OQ-A** — `BuilderCard` learns architect count via a `architectCount` prop computed once in `WorkView` from `state.architects.length`.
- **OQ-B (locked to (a))** — attribution tag is `<builder-id> · <architect-name>` with NO "spawned by" prefix; hover-tooltip in COULD.
- **OQ-C** — instruction lands in `codev/roles/builder.md` (project-local copy) AND `codev-skeleton/roles/builder.md` (npm-shipped source of truth).
- **OQ-D** — thread file created lazily on builder's first write; Write tool's `mkdir -p` semantics handle the missing `codev/state/` directory.
- **OQ-E** — builder resolves its own `<builder-id>` via `basename "$(pwd)"`.
- **OQ-F** — SSE event named `architects-updated`, payload `{ workspace: <workspacePath> }`, rides the existing `notification` channel (no new `SSEEventType` union entry).
- **OQ-G** — event emitted only on add and remove paths; **not** from `launchInstance` (subscribers re-fetch on activate).
- **NQ-A** — `codev/state/` not gitignored (default-commit behavior per Item 3's commit/retention MUST).

## Success Metrics

- [ ] All MUSTs from the spec satisfied (12 Item 1 + 8 Item 2 + 11 Item 3 + 7 Item 4 + non-functional).
- [ ] No reduction in test coverage on touched files.
- [ ] SSE event round-trip (add-architect → VSCode tree refresh) <1s on local Tower.
- [ ] N=1 dashboard DOM identical to pre-823 (snapshot test).
- [ ] All 13 functional + 3 non-functional test scenarios from the spec pass.
- [ ] Manual verify-phase round-trip exercised on a real workspace with 2 architects (per [[feedback_e2e_headline_path]]).
- [ ] Playwright visual smoke at N=1, N=2, N=3 architects (per [[feedback_ui_visual_verification]]).

## Phases (Machine Readable)

<!-- REQUIRED: porch uses this JSON to track phase progress. -->

```json
{
  "phases": [
    {"id": "phase_1_attribution", "title": "Dashboard builder attribution (type + SQL + BuilderCard + WorkView prop threading + tests + Playwright)"},
    {"id": "phase_2_thread_file", "title": "Per-builder thread file (codev-skeleton/roles/builder.md + codev/roles/builder.md updates; lazy create on first write)"},
    {"id": "phase_3_messaging_docs", "title": "Inter-agent messaging documentation (five markdown files: CLAUDE.md, AGENTS.md, agent-farm.md, two skeleton templates)"},
    {"id": "phase_4_vscode_refresh", "title": "VSCode Architects tree auto-refresh on add (#786-dependent — Tower SSE emit + VSCode subscribe)"}
  ]
}
```

## Phase Breakdown

### Phase 1: Dashboard builder attribution
**Dependencies**: None

#### Objectives

- Surface `spawned_by_architect` from `state.db.builders` through the existing overview enrichment block so each `OverviewBuilder` carries its spawning architect.
- Render an inline tag `<builder-id> · <architect-name>` on each `BuilderCard` row when there are 2 or more architects in the workspace (per locked baked decision 2b — separator + name, no "spawned by" prefix label).
- Maintain N=1 visual parity (no DOM change, no extra spacing) so existing single-architect dashboards look identical to today.

#### Deliverables

- [ ] `OverviewBuilder` (in `packages/types/src/api.ts`) gains `spawnedByArchitect: string | null`.
- [ ] `BuilderOverview` (in `packages/codev/src/agent-farm/servers/overview.ts`) gains the same field.
- [ ] `discoverBuilders()` initializes the new field to `null` on every builder it constructs (both the soft-mode and strict-mode paths around `overview.ts:570-700`).
- [ ] SQL enrichment block at `overview.ts:781-797`:
  - Drops the `WHERE issue_number IS NOT NULL` clause.
  - Adds `spawned_by_architect` to the `SELECT` column list.
  - Applies each enrichment field conditionally on whether the row's column is non-null (`if (row.issue_number != null) builder.issueId = ...`; `if (row.spawned_by_architect != null) builder.spawnedByArchitect = ...`).
- [ ] `WorkView` computes `architectCount = state?.architects?.length ?? 0` once (null-safe per iter-4 Claude observation) and passes it to each `BuilderCard` as a prop.
- [ ] `BuilderCard.tsx` accepts new `architectCount: number` prop and conditionally renders, inside the existing `builder-col-id` `<td>`, a `<span className="builder-attribution">  · {builder.spawnedByArchitect}</span>` after `displayId` when `architectCount > 1 && builder.spawnedByArchitect`.
- [ ] CSS for `.builder-attribution` — small (≈90% font-size of the cell), de-emphasized color (gray, e.g. `var(--text-secondary)` or equivalent), `title` attribute on the `<span>` set to `spawned by {builder.spawnedByArchitect}` (the COULD hover-tooltip lifted into MUST because it's free at this point).
- [ ] Unit tests:
  - `BuilderCard` at `architectCount=1` — no `builder-attribution` span in the rendered output (snapshot OR explicit absent-assertion; plan-phase Claude note: confirm whether pre-823 snapshot exists; if not, establish one in this phase).
  - `BuilderCard` at `architectCount=2`, `spawnedByArchitect='ob-refine'` — `.builder-attribution` span present, contains ` · ob-refine`, `title` attribute equals `spawned by ob-refine`.
  - `BuilderCard` at `architectCount=2`, `spawnedByArchitect=null` (legacy / pre-#755 row) — no span rendered.
  - SQL enrichment unit test (covers iter-1 Gemini's soft-mode finding): mock `state.db.builders` rows with mixed `(issue_number, spawned_by_architect)` cells, including `(null, 'ob-refine')` for soft-mode + spawned-by-sibling. After enrichment, the soft-mode row's `spawnedByArchitect` is populated.
- [ ] Playwright smoke at N=1 (1 architect, 3 builders), N=2 (2 architects, 4 builders mixing spawning architects + 1 legacy null), N=3 (3 architects, 6 builders). Visual assertion: tag absent at N=1; tag present and correct at N≥2; no column shift; layout stable.

#### Implementation Details

**Type field plumbing** (`packages/types/src/api.ts:100-138`):

Add an optional field after the existing `lastDataAt: string | null` (keeping the field comment consistent with neighboring docstrings):

```ts
/**
 * Name of the architect that spawned this builder (Spec 755 / 823). `null` for
 * legacy rows from before #755, for builders the DB doesn't contain a row for,
 * or when state.db is unavailable. Used by the dashboard to render an inline
 * attribution tag when the workspace hosts more than one architect.
 */
spawnedByArchitect: string | null;
```

The mirror field on `BuilderOverview` in `overview.ts:35-74` uses the same name and JSDoc — the two types are kept in sync per the existing convention.

**SQL enrichment** (`overview.ts:781-797`):

Current code:
```ts
const rows = db.prepare(
  'SELECT worktree, issue_number FROM builders WHERE issue_number IS NOT NULL',
).all() as Array<{ worktree: string; issue_number: string }>;
for (const row of rows) {
  const builder = builders.find(b => b.worktreePath === row.worktree);
  if (builder) {
    builder.issueId = String(row.issue_number);
  }
}
```

Replace with:
```ts
const rows = db.prepare(
  'SELECT worktree, issue_number, spawned_by_architect FROM builders',
).all() as Array<{ worktree: string; issue_number: string | null; spawned_by_architect: string | null }>;
for (const row of rows) {
  const builder = builders.find(b => b.worktreePath === row.worktree);
  if (!builder) continue;
  if (row.issue_number != null) builder.issueId = String(row.issue_number);
  if (row.spawned_by_architect != null) builder.spawnedByArchitect = row.spawned_by_architect;
}
```

Both enrichment fields are applied conditionally — soft-mode builders (issue_number=null) are no longer excluded from the result set, so their spawned_by_architect populates correctly per iter-1 Gemini's finding.

**`discoverBuilders` initialization** (`overview.ts:570-700`): both the soft-mode push at `:570-588` and the strict-mode push at `:622-642` need `spawnedByArchitect: null` in the literal. The enrichment loop then overrides it for rows that have non-null values.

**`WorkView` prop threading** (`packages/dashboard/src/components/WorkView.tsx:87-93`):

The current `BuilderCard` render loop at `WorkView.tsx:87` is:
```tsx
{overview.builders.map(builder => (
  <BuilderCard
    key={builder.id}
    builder={builder}
    onOpen={handleOpenBuilder}
  />
))}
```

`WorkView` already takes `state: DashboardState | null` as a prop. Compute `architectCount` once outside the loop:
```tsx
const architectCount = state?.architects?.length ?? 0;
```

Then pass to each card:
```tsx
<BuilderCard ... architectCount={architectCount} />
```

The null-safe `?? 0` handles the loading state (per iter-4 Claude observation Cl-4.1) — when `architectCount` is 0, the conditional `architectCount > 1` in `BuilderCard` is false, so the span is never rendered, which is the correct loading-state behavior.

**`BuilderCard` render** (`packages/dashboard/src/components/BuilderCard.tsx:56`):

Current cell:
```tsx
<td className="builder-col-id">{displayId}</td>
```

Updated cell:
```tsx
<td className="builder-col-id">
  {displayId}
  {architectCount > 1 && builder.spawnedByArchitect && (
    <span className="builder-attribution" title={`spawned by ${builder.spawnedByArchitect}`}>
      {' · '}{builder.spawnedByArchitect}
    </span>
  )}
</td>
```

The leading `{' · '}` is preserved as a JSX text node (not concatenated) so React's whitespace handling renders a true ` · ` with surrounding spaces.

**CSS** — pinned by plan iter-1 Codex to `packages/dashboard/src/index.css` (`.builder-col-id` at line 1081-1086). Add the new class adjacent to the existing `.builder-col-id` block:

```css
.builder-attribution {
  font-size: 0.9em;
  color: var(--text-secondary);
}
```

Single class, no media query, no responsive variant — matches the "minimum DOM change" framing. The fallback `#888` is dropped (plan iter-1 Claude verified `--text-secondary` exists at `index.css:10` and is used 30+ times across the dashboard).

**Column-width caveat** (plan iter-1 Claude): `.builder-col-id` currently sets `width: 60px` with `white-space: nowrap`. Adding ` · ob-refine` (~12 extra characters) to a cell sized for 4-character builder IDs will overflow the 60px constraint. The cell will expand because `white-space: nowrap` prevents wrapping, potentially shifting downstream columns. Two correct options for the builder:

- **Option (preferred)**: change `width: 60px` to `min-width: 60px` so the cell can grow when attribution renders without forcing a fixed width that overflows.
- **Option (fallback)**: expand `width` to a value that accommodates `<id> · <name>` for realistic architect-name lengths (e.g. `width: 160px` for `#0823 · architect-2`-style names up to ~12 chars).

The Playwright visual smoke at N=1/N=2/N=3 (acceptance criterion) catches any regression here. Builder picks Option (preferred) unless a layout reason emerges to fix the column width.

#### Acceptance Criteria

- [ ] `OverviewBuilder` and `BuilderOverview` have matching `spawnedByArchitect: string | null` fields.
- [ ] Overview SQL enrichment populates the field for every row in `state.db.builders` (including `issue_number=null` rows per iter-1 Gemini).
- [ ] `BuilderCard` snapshot at `architectCount=1` matches the pre-823 baseline (establish baseline first if missing).
- [ ] `BuilderCard` at `architectCount=2` + `spawnedByArchitect='ob-refine'` renders the inline span with ` · ob-refine` and the `title` attribute.
- [ ] `BuilderCard` at `architectCount=2` + `spawnedByArchitect=null` renders identically to the N=1 baseline.
- [ ] WorkView's `architectCount` derivation is null-safe (`state?.architects?.length ?? 0`).
- [ ] Playwright smoke passes at N=1, N=2, N=3 with no layout shift between N=1 and N=2.

#### Test Plan

- **Unit Tests**:
  - `BuilderCard.test.tsx` (or whichever file already tests `BuilderCard`) — three test cases as enumerated above.
  - `overview.test.ts` SQL enrichment — assert soft-mode row enrichment.
- **Integration Tests**: none required; the type plumbing is exercised by existing dashboard tests that hit `/api/overview`.
- **Manual Testing**:
  - Spawn this codev workspace's dashboard with `afx workspace add-architect --name ob-refine`.
  - Spawn a builder from each architect.
  - Confirm the Work view shows ` · ob-refine` next to one builder ID, ` · main` next to the other.
  - Run `afx workspace remove-architect ob-refine`. After dashboard polls (≤3s), the attribution tag disappears from all cards.
- **Playwright**: 3 scenarios per the visual smoke acceptance criterion.

#### Rollback Strategy

Revert the commit. No persisted state mutations introduced by this phase — type/SQL changes are read-only from `state.db.builders`, the schema is untouched, and existing rows already carry `spawned_by_architect` from prior writes.

#### Risks

- **Risk**: Dropping `WHERE issue_number IS NOT NULL` changes which rows participate in the existing `issueId` enrichment. If a builder somehow has `issue_number` set in the DB but `worktreePath` doesn't match any in-memory builder, it's silently dropped (today and after the change — no regression).
  - **Mitigation**: the `if (row.issue_number != null) builder.issueId = ...` conditional preserves the existing semantics for rows that DO match. Regression test in the unit suite asserts the N=1 `issueId` rendering at parity.
- **Risk**: `BuilderCard` is also used elsewhere (e.g., another dashboard view) and gets a missing-prop warning when the new `architectCount` prop is required.
  - **Mitigation**: per iter-5 Gemini's verification, `NeedsAttentionList` does NOT render `BuilderCard` (it builds `AttentionItem`s natively). Plan-phase grep for `BuilderCard` consumers: `grep -rn 'BuilderCard' packages/dashboard/src/` should turn up only `WorkView.tsx`. If others exist, default the prop to `0` (so the span never renders) and update each call site to pass the correct count where relevant.
- **Risk (RETIRED by plan iter-1 Claude verification)**: `--text-secondary` was hypothesized as possibly absent. Verified present at `packages/dashboard/src/index.css:10` and used 30+ times. No fallback needed.
- **Risk**: `.builder-col-id` is `width: 60px` with `white-space: nowrap` — adding ` · ob-refine` overflows the fixed width and may shift downstream columns.
  - **Mitigation**: change `width` to `min-width: 60px` so the cell grows naturally when attribution renders (preferred); or expand to ~160px to fit realistic name lengths. Playwright visual smoke at N=1/N=2/N=3 is the safety net.

---

### Phase 2: Per-builder thread file
**Dependencies**: None (independent of Phase 1)

#### Objectives

- Teach every builder (regardless of protocol or strict/soft mode) to maintain `codev/state/<builder-id>_thread.md` as a free-text markdown log.
- Land the instruction in both the npm-shipped source of truth (`codev-skeleton/roles/builder.md`) and the project-local copy (`codev/roles/builder.md`) atomically.
- No porch changes, no protocol-prompt changes — the instruction reaches every builder via the existing spawn-time prompt `"You are a Builder. Read codev/roles/builder.md for your full role definition"` (verified at `packages/codev/src/agent-farm/commands/spawn.ts:448, :515, :520, :817`).

#### Deliverables

- [ ] New "Thread file" section in `codev-skeleton/roles/builder.md` (the source of truth for external adopters; copied to `packages/codev/skeleton/roles/builder.md` at build time via the `copy-skeleton` script in `packages/codev/package.json:29`).
- [ ] Identical section in `codev/roles/builder.md` (this repo's project-local copy).
- [ ] Both files updated atomically in the same commit.
- [ ] No protocol-prompt-file changes. No porch code changes.
- [ ] No tests (the thread is freeform LLM output — verify-phase manual exercise is the fidelity check, per the spec).

#### Implementation Details

The "Thread file" section to insert into both `roles/builder.md` files (location: near the top, after the existing "Two Operating Modes" / "Strict Mode" sections, before the "Notifications" section — plan-phase reads the current file structure to confirm the exact insertion point):

```markdown
## Thread file

You maintain a free-text markdown log at `codev/state/<builder-id>_thread.md` (relative to your worktree). This is the cohort's collective situational-awareness surface — architects and sibling builders can read it via plain file I/O.

**Path resolution**: `<builder-id>` is the basename of your worktree path. Resolve it once with `basename "$(pwd)"`. Example: this builder's worktree basename is `spir-823`, so the path is `codev/state/spir-823_thread.md`.

**Directory creation**: `codev/state/` likely doesn't exist when you start (it's greenfield). Your first write creates it — the Write tool's `mkdir -p` semantics handle this transparently.

**What to write**: phase transitions, decisions, blockers, anything worth recording for the cohort. Trust your own judgement about what's useful. There is no required schema, no required sections, no timestamp format. The thread is yours.

**When to write**: at phase boundaries and at any other moment you think a future reader would want to know what happened. Don't over-engineer cadence — append when there's something to say.

**Discovery**:
- **In-flight**: while you're active, your thread lives in your worktree at `.builders/<builder-id>/codev/state/<builder-id>_thread.md` (from the main workspace root). Architects read it with `cat .builders/<id>/codev/state/<id>_thread.md`; they discover threads with `ls .builders/*/codev/state/*.md`.
- **Sibling builders**: read each other's threads via `cat ../<sibling-id>/codev/state/<sibling-id>_thread.md` from your own worktree (the parent `.builders/` directory is shared).
- **Post-merge**: after your PR merges, your thread lands in `codev/state/` on `main` (parallel to `codev/reviews/`) and becomes part of the historical review record.

**Commit/retention rule**: **the default disposition is COMMIT.** Stage and commit your thread file as part of your PR. The rare exception — when your thread turned out to be noise rather than useful narrative — is an explicit decision to strip it before PR (via gitignore for the PR or by not staging the file). Silently leaving the thread uncommitted by accident is a bug, not an exercise of the exception. The cohort's situational-awareness goal depends on threads surviving to `main`.

**Scope reminder**: this is for the cohort's situational awareness, not porch's tracking. Porch does not read this file. There are no hooks, no validation, no enforcement.
```

#### Acceptance Criteria

- [ ] Both `codev-skeleton/roles/builder.md` and `codev/roles/builder.md` contain the new "Thread file" section.
- [ ] The two files remain byte-identical to each other (same content, same heading levels, same wording) — sanity-checkable with `diff codev/roles/builder.md codev-skeleton/roles/builder.md` (should report no differences).
- [ ] **Build-output validation (iter-2 Codex)**: after editing `codev-skeleton/roles/builder.md`, run `pnpm build` (or at minimum `pnpm --filter @cluesmith/codev run copy-skeleton`) and verify `packages/codev/skeleton/roles/builder.md` contains the new "Thread file" section. This is the file that ships to npm; the copy step in `packages/codev/package.json:29` regenerates `packages/codev/skeleton/` from `codev-skeleton/` on every build. The MUST is satisfied only when the npm-shipped artifact carries the change.
- [ ] No other files modified in this phase's commit.
- [ ] Verify-phase manual exercise (deferred to the Review phase per SPIR): spawn a fresh builder for any protocol; confirm the builder creates and writes meaningful content to `codev/state/<builder-id>_thread.md` at its first phase boundary, without being explicitly prompted to.

#### Test Plan

- **Unit Tests**: none. Freeform markdown instruction — nothing to assert programmatically.
- **Integration Tests**: none.
- **Manual Testing** (verify phase):
  - Spawn a fresh strict-mode SPIR builder for a small test issue.
  - Confirm the file appears at `.builders/<builder-id>/codev/state/<builder-id>_thread.md` after the first phase boundary.
  - Confirm at least one meaningful entry has been written.
  - Confirm the architect can `cat .builders/<id>/codev/state/<id>_thread.md` from the main workspace and read the content.

#### Rollback Strategy

Revert the commit. The role-file instruction is purely additive and idempotent — removing it doesn't affect builders that already wrote threads.

#### Risks

- **Risk**: A spawned builder ignores the instruction (LLM noncompliance).
  - **Mitigation**: per the spec, this is an explicit accepted risk. If the verify-phase exercise shows the instruction isn't reliably followed, the wording is sharpened in a follow-up TICK. No structural change in this phase.
- **Risk**: Section insertion at the wrong location creates a confusing role file.
  - **Mitigation**: plan-phase Read of both files before insertion; pick the location with the cleanest neighboring context. The spec is agnostic about exact location — the constraint is the section exists and is discoverable in a normal top-to-bottom read.
- **Risk**: `codev/roles/builder.md` and `codev-skeleton/roles/builder.md` drift apart over time (already identical today; this phase keeps them identical, but future edits may not).
  - **Mitigation**: out of scope for #823 — the drift-prevention infrastructure (e.g., a `codev doctor` check) would be a separate spec. The MUST is just "both files edited atomically in the same commit for this phase."

---

### Phase 3: Inter-agent messaging documentation
**Dependencies**: None (independent of Phases 1 and 2)

#### Objectives

- Surface the existing messaging primitives (`<builder-id>`, `architect`, `architect:<name>`, `<workspace>:architect`) in the documentation that builders, architects, and external adopters actually read.
- Distinguish architect-sender vs builder-sender behavior on `architect:<name>` per the verified spoofing-check semantics at `tower-messages.ts:196-218`.
- Mention the per-builder thread file (Phase 2) in the same messaging section so a user reading the messaging docs also discovers the cohort's narrative log.
- Five markdown files: this repo's `CLAUDE.md` + `AGENTS.md`, the skeleton's `codev-skeleton/templates/CLAUDE.md` + `codev-skeleton/templates/AGENTS.md`, and the agent-farm reference `codev/resources/commands/agent-farm.md`.

#### Deliverables

- [ ] New "Inter-agent messaging" section in `CLAUDE.md` documenting the four addressing forms + spoofing-check + sibling example + thread-file mention.
- [ ] Identical content in `AGENTS.md`.
- [ ] Equivalent content (adopter-context wording differences acceptable; same primitives covered) in `codev-skeleton/templates/CLAUDE.md` and `codev-skeleton/templates/AGENTS.md`.
- [ ] `codev/resources/commands/agent-farm.md` `afx send` section extended with the same four forms; `architect:<name>` added to the "Target terminal" argument list at the top.
- [ ] All five files edited atomically in the same commit.
- [ ] No code changes; markdown only.

#### Implementation Details

**Insertion location candidates** (plan-phase final choice based on current file structure; corrected per iter-2 Gemini):

- `CLAUDE.md` / `AGENTS.md`: insert a new `## Inter-agent messaging` section between the existing `## Architect-Builder Pattern` (line ~470) and `## Porch - Protocol Orchestrator` (line ~528). The current `## Architect-Builder Pattern` section contains the operational `afx send` workspace-root rule at line ~497 inside the `### 🚨 ALWAYS Operate From the Main Workspace Root 🚨` subsection — that's operational guidance for the architect; the new section is reference material for inter-agent addressing. They sit naturally side-by-side. **Note (iter-2 Gemini correction)**: an earlier draft of this plan said "after the Agent Responsiveness section (around line ~497)" — that conflated two distinct locations. `## Agent Responsiveness` is at line ~139; the afx-send reference at line ~497 is inside a different section. The plan's chosen insertion point is line ~528, under a top-level `## Inter-agent messaging` heading.
- `codev/resources/commands/agent-farm.md`: extend the existing `afx send` subsection (currently at the section after `afx status`). Add an `architect:<name>` row to the Target terminal table; add a new subsection "Inter-architect messaging" with the sibling example.
- Skeleton templates: insert at the equivalent structural position. Adopter context wording acceptable (e.g., the codev-self-hosted skeleton may not have the same "Agent Responsiveness" section nearby).

**Section content** (CLAUDE.md / AGENTS.md primary form):

```markdown
## Inter-agent messaging

Agents within a workspace communicate through `afx send`. Four addressing forms are supported:

### Addressing forms

| Form | Meaning | Allowed from |
|---|---|---|
| `afx send <builder-id> "msg"` | Send to a specific builder (e.g. `afx send 0823 "..."`). | Any sender. |
| `afx send architect "msg"` | From a builder: routes to the spawning architect via affinity (per #774). From an architect: routes to the architect named `main`. | Any sender. |
| `afx send architect:<name> "msg"` | Explicit per-architect addressing. | **Architects**: open address grammar — any architect (including `main`) can address any other architect. This is the sibling-architect messaging form. **Builders**: allowed ONLY when `<name>` matches the builder's own `spawnedByArchitect`. Mismatches are rejected by the spoofing check at `tower-messages.ts:213-218`. From a builder, this is an explicit form of the affinity routing, NOT an override. |
| `afx send <workspace>:architect "msg"` | Cross-workspace addressing (e.g. `afx send marketmaker:architect "..."`). | Any sender. |

### Sibling-architect messaging

When a workspace hosts more than one architect (added via `afx workspace add-architect --name <name>`), sibling architects message each other via the `architect:<name>` form. Example: `main` running `afx send architect:ob-refine "PR-iter-2 feedback ready"` lands on the `ob-refine` architect's terminal. This works because sender = architect bypasses the spoofing check.

### Builder spoofing-check (verified at `tower-messages.ts:213-218`)

Builder `spir-823` running `afx send architect:ob-refine "..."` is rejected unless its `spawnedByArchitect == 'ob-refine'`. A builder cannot use `architect:<name>` to address an architect other than its spawning architect — that's an attempted spoof.

### Discovering active agents

- `afx status` lists all architects (post-#786) alongside builders, with names, terminal IDs, and PIDs.
- Each active builder maintains a free-text narrative log at `codev/state/<builder-id>_thread.md` (relative to its worktree, so `.builders/<id>/codev/state/<id>_thread.md` from the main workspace root). Discover with `ls .builders/*/codev/state/*.md`; read with `cat .builders/<id>/codev/state/<id>_thread.md`. After a builder merges, its thread lands in `codev/state/` on `main`.
```

**Agent-farm.md afx send section extension**:

The current `agent-farm.md` `afx send` "Target terminal" bullet list does not include `architect:<name>`. Add it:

```markdown
**Arguments:**
- `builder` - Target terminal. Can be:
  - Builder ID: `0042`
  - The literal `architect` (workspace's main architect; from a builder, the spawning architect via affinity)
  - `architect:<name>` — a specific architect by name. From a builder, only allowed when `<name>` matches the builder's spawning architect.
  - `<workspace>:architect` — cross-workspace addressing.
  - `--all` — broadcast to every builder in the current workspace.
```

And the existing examples block gains an "Inter-architect messaging" example:

```bash
# From main to a sibling architect (within the workspace)
afx send architect:ob-refine "PR-iter-2 feedback ready"
```

#### Acceptance Criteria

- [ ] `grep -l "architect:<name>"` returns ≥5 hits across the five files (one per file at minimum).
- [ ] `grep -l "spoofing"` returns ≥3 hits (CLAUDE.md, AGENTS.md, agent-farm.md — the user-facing surfaces; skeleton templates can defer the spoofing detail if it'd clutter adopter onboarding, but plan-phase recommends including for parity).
- [ ] `grep -l "codev/state/"` returns ≥3 hits (CLAUDE.md, AGENTS.md, agent-farm.md).
- [ ] `diff CLAUDE.md AGENTS.md` shows them as identical (per existing convention).
- [ ] Skeleton template messaging content is equivalent (same primitives covered) but not necessarily byte-identical to the repo-root files.
- [ ] **Build-output validation (iter-2 Codex)**: after editing `codev-skeleton/templates/CLAUDE.md` and `codev-skeleton/templates/AGENTS.md`, run `pnpm build` (or `pnpm --filter @cluesmith/codev run copy-skeleton`) and verify `packages/codev/skeleton/templates/CLAUDE.md` and `packages/codev/skeleton/templates/AGENTS.md` contain the new messaging section. The shipped templates are what external adopters receive via `codev init`; npm-shipped output must carry the change.
- [ ] No code files modified in this phase's commit.

#### Test Plan

- **Unit Tests**: none.
- **Integration Tests**: none.
- **Manual Testing**: scan each markdown file for the messaging section; verify a fresh reader (e.g. external adopter) would discover all four primitives + spoofing-check + sibling example + thread file.

#### Rollback Strategy

Revert the commit. Documentation is fully additive.

#### Risks

- **Risk**: CLAUDE.md / AGENTS.md drift (already a hazard).
  - **Mitigation**: phase commit edits both atomically. Post-phase drift is a generic project concern, not a #823 deliverable.
- **Risk**: Skeleton templates accumulate adopter-irrelevant content (e.g., `tower-messages.ts:213-218` is a repo-private code reference that an adopter doesn't have).
  - **Mitigation**: skeleton template wording soft-pedals the code references (e.g., "the spoofing check in Tower's message router" rather than the file:line). The principle is to cover the same primitives without leaking codev-internal paths.

---

### Phase 4: VSCode Architects tree auto-refresh on add
**Dependencies**: Phases 1, 2, 3 (sequencing, not technical) — and CRITICALLY **#786**.

#### Objectives

- Close the gap noted at #786 PR-iter-3 Codex finding Co2 (and tracked as Scenario 11 in #786's verify-scenarios artifact): the VSCode Architects tree does NOT auto-refresh when `afx workspace add-architect --name <name>` is run from a shell outside VSCode.
- Emit a new SSE event `architects-updated` from Tower on every successful add and remove path. Payload: `{ workspace: <workspacePath> }` — matching `worktree-config-updated`'s shape exactly.
- Subscribe to the event in the VSCode `WorkspaceProvider`. On receipt, fire its existing `changeEmitter` (the same trigger used today by `codev.removeArchitect`).
- The dashboard does NOT explicitly subscribe — its existing polling picks up architect changes within its existing poll interval (verify only, no dashboard code change).

#### Deliverables

- [ ] Tower-side SSE event `architects-updated` emitted from:
  - The successful add seam (today: at the end of `addArchitect` in `tower-instances.ts`, or — per iter-4 Gemini's architectural note — equivalently from the `handleAddArchitect` route handler in `tower-routes.ts`, since `addArchitect` is invoked from there).
  - The successful remove seam introduced by #786 (analogous location — plan-phase reads #786's exact remove path once #786 has merged).
- [ ] Emit is NOT done from `launchInstance` (per spec OQ-G — subscribers re-fetch on VSCode activate).
- [ ] Event payload is `{ workspace: <workspacePath> }` — minimum-shape, matching `worktree-config-updated` per `worktree-config-watcher.ts:60-65`.
- [ ] The event rides the existing `'notification'` channel of the `SSEEventType` union (no new union entry) — same pattern `worktree-config-updated` uses. Plan-phase confirms by reading `packages/types/src/sse.ts` and the existing broadcast helper.
- [ ] `WorkspaceProvider` in `packages/vscode/src/views/workspace.ts` subscribes to the new event via `connectionManager.onSSEEvent()` (existing subscription mechanism per iter-1 Claude + iter-5 Claude verification). On match, fires `this.changeEmitter.fire()` (its existing refresh trigger).
- [ ] Tower-side unit test in `packages/codev/src/agent-farm/__tests__/tower-routes.test.ts` (pinned by iter-2 Codex — existing route-test file, not a new `servers/__tests__/` directory): `handleAddArchitect` and the remove route handler each call `ctx.broadcastNotification` with `type: 'architects-updated'` and `body: JSON.stringify({ workspace })` on success; do NOT call it on failure. Mock `ctx` and the underlying `addArchitect`/remove helper.
- [ ] VSCode-side unit test in `packages/vscode/src/test/` (vscode-test harness per `packages/vscode/package.json` — NOT vitest, plan iter-1 Codex correction): subscriber callback fires `changeEmitter` on a synthetic `architects-updated` envelope; does NOT fire on unrelated envelope types or malformed JSON. Mock the `connectionManager.onSSEEvent` event source and deliver `{ data: '{"type":"architects-updated"}' }`.
- [ ] Verify-phase manual exercise: with VSCode open, `afx workspace add-architect --name <name>` from a shell causes the tree to refresh within ~1s.

#### Implementation Details

**Note on #786 dependency**: this phase requires #786's `removeArchitect` seam to exist on this branch. Two implementation strategies the builder should consider, in priority order:

1. **Preferred**: wait for #786 (PR #822) to merge to `main`, then rebase this branch onto `main`. The phase reads #786's actual code and pins the emit locations accordingly. This is the cleanest path.
2. **Fallback**: if #822 has not merged by the time the builder reaches this phase, branch this implementation off #786's HEAD (`builder/spir-786`) for the Phase 4 work only. Phases 1-3 land first on `main`-based commits; Phase 4 commits are then rebased onto post-merge `main` once #786 lands. This keeps Phases 1-3 unblocked at the cost of a mid-branch rebase.

**SSE emit pattern** (iter-4 Gemini's architectural guidance):

`broadcastNotification` is the existing helper that emits an SSE notification with the `'notification'` event type and a JSON body. The pattern used by `worktree-config-watcher.ts:60-65`:

```ts
broadcast({
  type: 'worktree-config-updated',
  body: JSON.stringify({ workspace: workspacePath }),
  workspace: workspacePath,
});
```

The new emit mirrors this shape:

```ts
broadcast({
  type: 'architects-updated',
  body: JSON.stringify({ workspace: workspacePath }),
  workspace: workspacePath,
});
```

**Seam location** — plan-phase final pick:

- **Option A**: emit from inside `addArchitect` / remove helper in `tower-instances.ts`. Pros: every caller is covered (including future direct invocations). Cons: requires passing the broadcast notifier into `tower-instances.ts` (today it lives in `tower-server.ts` and is passed to `worktree-config-watcher.ts` via `setWorktreeConfigNotifier()`). The plan adds a similar setter (`setArchitectsUpdatedNotifier()`) OR threads `broadcast` into `InstanceDeps`.
- **Option B**: emit from `handleAddArchitect` / `handleRemoveArchitect` route handlers in `tower-routes.ts` using the route context's `ctx.broadcastNotification(...)`. Pros: zero new wiring — `broadcastNotification` is already on `RouteContext` (`tower-routes.ts:128`). Cons: emit happens at the HTTP-route layer, not the data-mutation layer — direct invocations of `addArchitect` (rare; today none) wouldn't trigger; and **`handleAddArchitect`'s current signature does not accept `ctx`**.

**Plan recommendation: Option B with the signature refactor.** Today, `addArchitect` / `removeArchitect` are only called from their route handlers. Option B is cleaner and matches the existing emit pattern.

**Required refactor for Option B** (per plan iter-1 Gemini):

The current `handleAddArchitect` (and the analogous `handleRemoveArchitect` introduced by #786) does NOT take `ctx: RouteContext`. Today:

```ts
// tower-routes.ts:300
async function handleAddArchitect(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  match: RegExpMatchArray,
): Promise<void> { ... }
```

And it's called from the dispatch table at `tower-routes.ts:230`:

```ts
return await handleAddArchitect(req, res, architectsMatch);
```

**Phase 4 implementation MUST extend the signature** to accept `ctx: RouteContext` and thread `ctx` through from the dispatch site:

```ts
// tower-routes.ts:300 — updated signature
async function handleAddArchitect(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  match: RegExpMatchArray,
  ctx: RouteContext,
): Promise<void> { ... }
```

And the dispatch update at `tower-routes.ts:230`:

```ts
return await handleAddArchitect(req, res, architectsMatch, ctx);
```

Same refactor applied to the remove route handler (whichever name #786 lands it as). The emit then happens after the successful `addArchitect`/`removeArchitect` call returns, before writing the 200 response:

```ts
// inside handleAddArchitect, after the successful addArchitect() return:
if (result.success) {
  ctx.broadcastNotification({
    type: 'architects-updated',
    title: 'Architects updated',
    body: JSON.stringify({ workspace: workspacePath }),
    workspace: workspacePath,
  });
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ success: true, name: result.name, terminalId: result.terminalId }));
} else { ... }
```

Failed calls do NOT emit — only successful adds/removes.

**VSCode-side subscriber** (`packages/vscode/src/views/workspace.ts:37-46`):

The existing `worktree-config-updated` subscriber lives there. **Actual pattern** (verified directly during plan iter-1 — earlier spec-phase iter-1 Claude misrepresented this; all three plan-iter-1 reviewers caught the divergence):

```ts
connectionManager.onSSEEvent(({ data }) => {
  try {
    const envelope = JSON.parse(data) as { type?: unknown };
    if (envelope.type === 'worktree-config-updated') {
      this.changeEmitter.fire();
    }
  } catch {
    // benign — malformed envelope
  }
});
```

Key facts (from the existing comment block at `workspace.ts:33-36`):
- Tower emits events as a JSON envelope on the SSE `data:` field with **no `event:` name**.
- The SSE-client-level `type` is always `''`; the real type sits inside the JSON envelope at `envelope.type`.
- The callback signature destructures `{ data }`, not `event`. There is no `event.type` or `event.payload`.
- The existing subscriber fires `changeEmitter` **unconditionally** for the matching envelope type — it does NOT filter by workspace.

**The plan's extension MUST add a second `envelope.type` branch inside the same subscriber callback** (preferred — single parse, two checks):

```ts
connectionManager.onSSEEvent(({ data }) => {
  try {
    const envelope = JSON.parse(data) as { type?: unknown };
    if (envelope.type === 'worktree-config-updated' || envelope.type === 'architects-updated') {
      this.changeEmitter.fire();
    }
  } catch {
    // benign — malformed envelope
  }
});
```

**Workspace filtering decision**: the existing `worktree-config-updated` subscriber fires unconditionally — it does NOT filter by workspace path. The plan **MIRRORS this existing behaviour** for `architects-updated`: fire unconditionally, no workspace filter. Rationale: VSCode is opened against one workspace at a time; the `WorkspaceProvider` instance is workspace-scoped at construction. Filtering at the SSE-subscriber level adds complexity without benefit in single-workspace VSCode usage. Multi-workspace Tower still emits the event with the `workspace` field in the body for dashboards or other listeners that DO care to filter.

**Tower-side emit shape** — uses the existing `NotifyFn` interface (`worktree-config-watcher.ts:19-24`):

```ts
type NotifyFn = (notification: {
  type: string;
  title: string;
  body: string;
  workspace?: string;
}) => void;
```

The emit:

```ts
ctx.broadcastNotification({
  type: 'architects-updated',
  title: 'Architects updated',
  body: JSON.stringify({ workspace: workspacePath }),
  workspace: workspacePath,
});
```

`ctx.broadcastNotification` is already available on `RouteContext` (`tower-routes.ts:128`) — no new wiring or setter needed (unlike `worktree-config-watcher.ts` which has its own one-shot setter because it lives outside the route handler).

**SSE union (`packages/types/src/sse.ts:5-10`)**: **no change needed** — confirmed by reading `worktree-config-updated`'s precedent. It does NOT add itself to the `SSEEventType` union. The TypeScript union covers the *outer* SSE event types (`'notification'`, `'overview-changed'`, `'builder-spawned'`, etc.); custom envelope-type strings (`'worktree-config-updated'`, `'architects-updated'`) live inside the JSON body and are matched by the subscriber's runtime `envelope.type === '...'` check. The plan recommendation to "ride the notification channel" in iter-1 of the spec phase was based on a misreading; the actual pattern is "tower emits a generic SSE event with custom envelope-type strings in the body" — no union entry at any level.

**Dashboard verify-only** (no code change):

The dashboard polls `/state` on its existing interval. Adding an architect via CLI causes the dashboard's next poll to pick it up and re-render. Plan-phase confirms this remains true via the Phase 4 verify exercise; no dashboard code changes.

#### Acceptance Criteria

- [ ] `addArchitect` and the remove-seam both emit `architects-updated` notifications with `{ workspace: <path> }` payload.
- [ ] `launchInstance` does NOT emit (regression check).
- [ ] VSCode `WorkspaceProvider` fires `changeEmitter` on event receipt — unconditionally, no workspace filter at the SSE-subscriber layer (mirrors existing `worktree-config-updated` behaviour per the Implementation Details Workspace-filtering decision; iter-2 Codex internal-consistency fix).
- [ ] Manual verify: `afx workspace add-architect --name <name>` → VSCode tree updates within ~1s without manual user action.
- [ ] Manual verify: `afx workspace remove-architect <name>` (positional per #786) → VSCode tree updates within ~1s.
- [ ] Manual verify regression: right-click `<name>` in tree → Remove (via `codev.removeArchitect`) → tree still refreshes (existing self-trigger behavior preserved).
- [ ] Update the #786 verify-scenarios artifact (`codev/projects/786-multi-architect-feature-is-und/verify-scenarios.md` Scenario 11) to note that #823 closes the gap (once #786 has merged and the artifact path lands).

#### Test Plan

- **Unit Tests**:
  - Tower-side: mock `broadcastNotification`; assert `addArchitect` and the remove-seam call it with the correct event-type and workspace.
  - VSCode-side: mock `connectionManager.onSSEEvent`; deliver a `architects-updated` notification; assert `WorkspaceProvider.refresh()` (or equivalent `changeEmitter.fire()`) is called.
- **Integration Tests**: none in-process; verify via the manual exercise.
- **Manual Testing**: the three manual scenarios above (add, remove, regression).

#### Rollback Strategy

Revert the commit. SSE event is additive; absent subscribers (dashboard already polls) see no behavioral change.

#### Risks

- **Risk (HIGH)**: #786 has not merged when the builder reaches this phase.
  - **Mitigation**: dual strategy above (wait + rebase, or branch off #786 with mid-branch rebase). Builder picks based on #786's status at phase-start. Builder notifies architect via `afx send` if Phase 4 is blocked pending #786.
- **Risk**: Event payload schema collides with a future architect-related event.
  - **Mitigation**: namespace is fine (`architects-updated` is specific to this concern, distinct from `architect-spawned`, `architect-removed`, etc., which we explicitly chose NOT to use per OQ-F option (c)).
- **Risk**: Subscriber refresh causes UI churn under high architect-add/remove rate.
  - **Mitigation**: realistic rate is ≤1/s (user-driven). No throttle needed. If a pathological rate emerges, the plan-phase Tower-side emit can debounce by ID, but this is not introduced in the initial implementation.
- **Risk**: SSE connection drops between Tower-side emit and VSCode receipt — the add is silently missed.
  - **Mitigation (verified by iter-3 Gemini + iter-4 Gemini + iter-5 Claude)**: `WorkspaceProvider` already subscribes to `connectionManager.onStateChange()` which fires `changeEmitter` on reconnect. The tree self-heals after any SSE disconnection — no new defensive logic needed.

---

## Dependency Map

```
Phase 1 (attribution)  ── independent ──→ ships as commit 1
Phase 2 (thread file)  ── independent ──→ ships as commit 2
Phase 3 (messaging docs) ── independent ──→ ships as commit 3
Phase 4 (VSCode refresh) ── #786-dependent ──→ ships as commit 4 (may require rebase)
```

The four phases have no technical dependencies on each other (each touches distinct files). Phase ordering is by risk: #786-independent code (Phase 1), then independent role-file change (Phase 2), then documentation (Phase 3), then the #786-dependent VSCode work (Phase 4) last so the builder has maximum runway before needing #786 to merge.

## Resource Requirements

### Development Resources
- One builder (this one). No additional roles needed.

### Infrastructure
- No database changes.
- No new services.
- No configuration updates (the new SSE event rides the existing channel; no new env vars).
- No monitoring additions beyond the SSE event itself (visible via existing Tower logs).

## Integration Points

### External Systems
None — all changes are within the codev repo.

### Internal Systems

- **state.db.builders** (Phase 1): read-only. Existing schema; no migration.
- **Tower SSE broadcast** (Phase 4): existing `broadcast()` helper; new event type rides the `notification` channel.
- **VSCode `connectionManager`** (Phase 4): existing subscription mechanism (`onSSEEvent`).

## Risk Analysis

### Technical Risks

| Risk | Probability | Impact | Mitigation |
|------|------------|--------|------------|
| Phase 4's #786 dependency forces mid-build rebase | Medium | Low | Dual strategy (wait/rebase or branch off #786); builder notifies architect at phase start. |
| Phase 1 Playwright N=1 baseline drift breaks the regression snapshot | Low | Low | Establish baseline as the first Playwright commit in the phase; subsequent diffs are intentional. |
| Phase 3 markdown drift between CLAUDE.md / AGENTS.md | Low | Low | Phase commit edits both atomically; `diff` check in acceptance criteria. |
| Phase 2 LLM noncompliance with thread instruction | Medium | Low | Spec-accepted risk; verify-phase exercise; sharpen wording in a follow-up TICK if rate is bad. |
| Phase 4 SSE event collides with concurrent dashboard polling | Very Low | Very Low | Existing pattern (`worktree-config-updated`) co-exists with polling fine; same shape used here. |

### Schedule Risks

| Risk | Probability | Impact | Mitigation |
|------|------------|--------|------------|
| #786 PR #822 stalls in review past #823 implementation | Medium | Low | Phases 1-3 are #786-independent; ship those first; defer Phase 4. |

## Validation Checkpoints

1. **After Phase 1**: Playwright smoke passes at N=1/2/3; SQL enrichment unit tests pass; manual dashboard browser-test confirms tag rendering and N=1 baseline parity.
2. **After Phase 2**: Both role files updated identically (`diff` confirms); freshly-spawned builder writes to its thread file unprompted (verify-phase exercise).
3. **After Phase 3**: Five markdown files contain the messaging section; user-discoverability `grep` checks pass.
4. **After Phase 4**: SSE event round-trip verified manually with VSCode open; tree refresh time <1s; remove-via-CLI regression check passes; #786 verify-scenarios artifact updated.
5. **Before PR**: All four phase commits land; tests pass; verify-phase manual exercises documented in the Review.

## Monitoring and Observability

### Metrics to Track
- SSE event emit rate (existing Tower logs cover this; no new metric needed).
- `BuilderCard` render count at N>1 architects (dashboard performance is already monitored).

### Logging Requirements
- Tower emits `architects-updated` events to its existing log stream (same as `worktree-config-updated`).
- No new log levels or retention requirements.

### Alerting
- None required — none of the new code paths are blocking or critical.

## Documentation Updates Required

- [x] (Phase 3) `CLAUDE.md` + `AGENTS.md` + `codev/resources/commands/agent-farm.md` + two skeleton templates (the bulk of the doc work IS Phase 3).
- [x] (Phase 4) `codev/projects/786-multi-architect-feature-is-und/verify-scenarios.md` Scenario 11 (post-#786-merge note).
- [ ] (Review phase) `codev/reviews/823-multi-architect-coordination-b.md` — lessons learned, consultation feedback summary.
- [ ] (Review phase) `codev/resources/arch.md` and `codev/resources/lessons-learned.md` — only if anything novel surfaced; otherwise no update.
- [ ] CHANGELOG (Unreleased section) — Phase 1 builder attribution, Phase 4 VSCode auto-refresh user-facing notes. Phases 2-3 are likely not CHANGELOG-worthy individually but plan-phase confirms via the existing CHANGELOG conventions.

## Post-Implementation Tasks

- [ ] PR opened on builder branch (one PR for the cumulative four phases per architect guidance).
- [ ] PR-level CMAP (Gemini, Codex, Claude — per SPIR's PR consultation pattern).
- [ ] Architect review at PR gate.
- [ ] Merge via `gh pr merge --merge` (NOT squash, per project convention).

## Expert Review

**Date**: 2026-05-22 (iter-1)
**Models Consulted**: Gemini, Codex, Claude (via porch CMAP)
**Verdicts**: REQUEST_CHANGES (Gemini), REQUEST_CHANGES (Codex), COMMENT (Claude — same core finding, framed as COMMENT)

**Sections updated** based on plan iter-1 feedback:

- **Phase 4 VSCode subscriber code** (all three reviewers — unanimous): the original snippet `connectionManager.onSSEEvent((event) => { if (event.type === 'notification' && event.payload?.type === '...') ... })` was hallucinated from a misreading during the spec phase. **Actual pattern at `workspace.ts:37-46`** destructures `{ data }` from the callback, JSON-parses the SSE `data` field, then checks `envelope.type === '...'`. Tower emits with no `event:` name; the type sits inside the JSON envelope. Phase 4 implementation now mirrors the actual pattern exactly — single subscriber with two type-checks (`worktree-config-updated || architects-updated`), unconditional `changeEmitter` fire (matching existing behaviour, no workspace filter at the SSE layer).
- **Phase 4 `handleAddArchitect` signature** (plan iter-1 Gemini): the current `handleAddArchitect(req, res, match)` does NOT accept `ctx: RouteContext`. Phase 4 implementation MUST extend the signature to accept `ctx` and thread it through from the dispatch site at `tower-routes.ts:230`. The same refactor applies to the remove route handler from #786.
- **Phase 4 Tower-side emit** (clarified): uses `ctx.broadcastNotification` directly from the route handler — no new setter wiring needed (unlike `worktree-config-watcher.ts` which has its own one-shot setter because it lives outside the route handler).
- **Phase 4 `SSEEventType` union** (clarified, plan iter-1 Claude): no change needed. The plan now explicitly says the union covers the outer SSE event types; custom envelope-type strings (`'architects-updated'`) live inside the JSON body and are matched by the subscriber's runtime check. Mirrors `worktree-config-updated`'s precedent exactly.
- **Phase 4 VSCode test harness** (plan iter-1 Codex): corrected from "vitest, per #786 phase 6's new setup" to "`vscode-test` harness per `packages/vscode/package.json`". VSCode tests live under `packages/vscode/src/test/` and use `@vscode/test-cli`. No vitest setup exists.
- **Phase 1 CSS file pinned** (plan iter-1 Codex): from "whichever CSS file currently defines `.builder-col-id`" to "pinned to `packages/dashboard/src/index.css`, `.builder-col-id` at line 1081-1086." Concrete file/line.
- **Phase 1 `.builder-col-id` 60px column-width caveat added** (plan iter-1 Claude): the column is `width: 60px` with `white-space: nowrap`. Adding ` · ob-refine` overflows. Plan now specifies the fix (change to `min-width: 60px` or expand `width` to ~160px) and notes the Playwright smoke is the safety net.
- **Phase 1 `--text-secondary` risk retired** (plan iter-1 Claude): verified the variable exists at `index.css:10` and is used 30+ times. The fallback `#888` is dropped from the CSS snippet, and the risk row is marked RETIRED.
- **Phase 1 Risks updated**: new "column width overflow" risk added with mitigation; old `--text-secondary` risk marked RETIRED.

**Iter-2 verdicts (convergence)**:

- **Gemini**: APPROVE. Plan verified against the codebase: `.builder-col-id` width confirmed, `DashboardState.architects` confirmed, `handleAddArchitect` signature gap confirmed, `RouteContext.broadcastNotification` confirmed, `copy-skeleton` script confirmed. One minor observation: the original Phase 3 CLAUDE.md insertion-point reference conflated "Agent Responsiveness" (line ~139) with the `afx send` operational note at line ~497 (which is inside `## Architect-Builder Pattern`, not `## Agent Responsiveness`). Corrected: insertion goes at line ~528 between `## Architect-Builder Pattern` and `## Porch - Protocol Orchestrator`, under a new `## Inter-agent messaging` heading.
- **Codex**: COMMENT (no REQUEST_CHANGES) with three findings — all addressed:
  - **C-P2-1** (Phase 4 internal contradiction): Implementation Details said unconditional fire (mirroring `worktree-config-updated`), but acceptance criterion said "for matching workspace." Resolved by aligning the acceptance criterion to unconditional fire with an explicit cross-reference to the Workspace-filtering decision in Implementation Details.
  - **C-P2-2** (Tower test path): plan said `packages/codev/src/agent-farm/servers/__tests__/`, but the existing route test harness is at `packages/codev/src/agent-farm/__tests__/tower-routes.test.ts`. Corrected to the actual path.
  - **C-P2-3** (copy-skeleton validation): Phases 2 and 3 edit `codev-skeleton/...` source files but didn't explicitly require validating the shipped artifact at `packages/codev/skeleton/...`. Added a Build-output validation acceptance criterion to both phases — run `pnpm build` (or the `copy-skeleton` script directly) and verify the npm-shipped path carries the new content.
- **Claude**: APPROVE. Three non-blocking COMMENTs:
  - `onOpenBuilder` cosmetic — actual variable is `handleOpenBuilder` per `WorkView.tsx:32, :91`. Cosmetic; corrected in plan via global replace.
  - Phase 2 insertion point has more sections between named anchors than the plan implied — plan already defers exact insertion to the builder ("plan-phase reads the current file structure to confirm"). No change needed.
  - Column header "Issue" with attribution content — semantically fine, baked-decision-locked, no change.

## Approval

- [ ] Architect Review (plan-approval gate)
- [x] Expert AI Consultation iter-1 complete (Gemini REQUEST_CHANGES + Codex REQUEST_CHANGES addressed — both flagged the same Phase 4 SSE pattern divergence; Claude COMMENT same finding plus minor observations)
- [x] Expert AI Consultation iter-2 complete — UNANIMOUS APPROVE/COMMENT (no REQUEST_CHANGES). Gemini APPROVE, Codex COMMENT (3 findings addressed), Claude APPROVE. Plan converged; ready for plan-approval gate.

## Notes

- The four phases are deliberately small. Phase 1 is the largest by line count (type, SQL, render, prop threading, CSS, tests, Playwright); Phases 2 and 3 are pure markdown; Phase 4 is one SSE emit + one subscriber.
- Phase ordering is by #786-independence (1-3 first, 4 last), not by item-number order from the issue. The issue body order (1, 2, 3, 4) doesn't bind the implementation order — the architect's PR-strategy guidance and the #786-dependency constraint do.
- All four phases ship as commits on this builder branch in one PR per the spawn prompt's PR Strategy section: "Do not autonomously open a PR per implementation phase. Plan phases ship as git commits within a single PR, not as separate PRs."
- Spec OQ-A through OQ-G are all resolved in this plan; no plan-level OQs remain open. Locked baked decisions (1, 2, 2b, 3-8) are honored throughout.
- Manual verify-phase exercises are the fidelity check for Phase 2 (LLM compliance) and Phase 4 (SSE round-trip on real Tower). Automated tests are necessary but not sufficient.

---

## Amendment History

<!-- TICK amendments tracked here if needed in future. None at draft time. -->
