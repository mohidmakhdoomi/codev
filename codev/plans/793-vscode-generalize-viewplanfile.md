# PIR Plan: vscode — generalize viewPlanFile to siblings (viewSpecFile, viewReviewFile)

## Understanding

`codev.viewPlanFile` opens the on-disk plan markdown for a builder via the Builders tree context menu. It's currently PIR-only because the menu `when` clause restricts it (`viewItem =~ /^(builder|blocked-builder|awaiting-builder)-pir$/`), and there are no sibling commands for the other two artifact kinds (`codev/specs/` and `codev/reviews/`) — even though SPIR/ASPIR ship specs and SPIR/ASPIR/AIR/PIR ship reviews of identical shape (`<id>-<slug>.md` in the matching subdir).

The internal dispatcher in `packages/vscode/src/commands/view-artifact.ts:33-111` is already protocol-agnostic — it takes a generic `kind: ArtifactKind` and resolves `ARTIFACT_SUBDIR[kind]` against the builder's worktree. The work needed is mostly declarative: widen the `ArtifactKind` union, fill the subdir map, register two new commands, and update the menu `when` clauses to express the visibility table.

The one piece of *new* logic is for PIR review files: PIR builders only have a `codev/reviews/<id>-<slug>.md` after the `review` phase commits one. Before that, the `viewReviewFile` menu entry must hide on PIR rows (the issue rejects a "fall back to PR URL" branch). This means encoding "review file exists on disk" in the row's `contextValue` so the menu's `when` regex can gate visibility.

For non-PIR protocols the file is always present once the relevant phase has emitted it; the existing missing-file toast in `view-artifact.ts:88-93` handles the rare absence (e.g. mid-phase), so no menu hiding is needed there.

Related context (not in scope, but informs the design): issue #792 wants expandable phase children that reveal artifacts via these commands — `viewSpecFile`/`viewReviewFile` need to exist before that work can start.

## Proposed Change

### 1. Generalize the dispatcher (`packages/vscode/src/commands/view-artifact.ts`)

- Widen `ArtifactKind` to `'plan' | 'spec' | 'review'`.
- Extend `ARTIFACT_SUBDIR` to cover all three: `{ plan: 'codev/plans', spec: 'codev/specs', review: 'codev/reviews' }`.
- Add two thin wrappers next to the existing `viewPlanFile`: `viewSpecFile` and `viewReviewFile`, each delegating to `viewArtifact(...)` with the matching kind.
- Rewrite the file's docblock: drop the PIR-specific framing and the stale "View Review File was intentionally not added" paragraph; replace with a one-line note that the PIR-specific menu-hide rule for missing review files lives in `views/builders.ts` (where `contextValue` is composed) and `package.json` (where the `when` clause consumes it), not here. The dispatcher itself remains kind-agnostic.

The existing pickBuilder quick-pick already interpolates `kind` into its prompt (`Select builder whose ${kind} file to open`), so it works for the new kinds with zero change.

### 2. Register the two new commands (`packages/vscode/src/extension.ts`)

Next to the existing `codev.viewPlanFile` registration at `extension.ts:602-603`:

- `codev.viewSpecFile` → `viewSpecFile(connectionManager!, extractBuilderId(arg))`
- `codev.viewReviewFile` → `viewReviewFile(connectionManager!, extractBuilderId(arg))`

Update the `import` at line 18 to pull all three named exports.

### 3. Declare the commands in `packages/vscode/package.json`

Add two new entries to `contributes.commands` (alongside the existing `codev.viewPlanFile` entry at line 191-194):

- `codev.viewSpecFile` → "Codev: View Spec File"
- `codev.viewReviewFile` → "Codev: View Review File"

### 4. Encode review-file presence in the contextValue (`packages/vscode/src/views/builders.ts`)

In the root-builder mapping branch (lines 89-136), after computing `b.protocol`, sync-check whether `<worktreePath>/codev/reviews/` contains any file matching the builder's prefix (same prefix logic as `view-artifact.ts:79-86`: `<b.id>-*.md` or `<b.id>.md`).

If present, suffix the protocol token in `contextValue` with `-review`. The contextValue becomes one of:

- `builder-<protocol>` (current, no review file)
- `builder-<protocol>-review` (new, when the builder's review file is on disk)
- ...and the same suffix for `blocked-builder-` and `awaiting-builder-`.

Implementation:

```ts
import { existsSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';

function builderHasReviewFile(b: OverviewBuilder): boolean {
  if (!b.worktreePath) { return false; }
  const dir = resolve(b.worktreePath, 'codev/reviews');
  if (!existsSync(dir)) { return false; }
  const prefix = `${b.id}-`;
  try {
    return readdirSync(dir).some(
      f => f.endsWith('.md') && (f.startsWith(prefix) || f === `${b.id}.md`),
    );
  } catch { return false; }
}
```

Then in the row builder:

```ts
const protocol = b.protocol || 'unknown';
const reviewSuffix = builderHasReviewFile(b) ? '-review' : '';
item.contextValue = `${family}-${protocol}${reviewSuffix}`;
```

(Where `family` is one of `builder` / `blocked-builder` / `awaiting-builder`.)

Filesystem cost: one `readdirSync` per builder per render. The reviews dir is small (≤ a few files per branch worktree) and on local disk; this is the same kind of sync fs work `view-artifact.ts` already does at invocation time. Builder rows already do an async `getDiff` lookup via `BuilderDiffCache` on expansion — a single readdir on the root mapping is cheaper than that.

### 5. Update the menu `when` clauses in `packages/vscode/package.json`

Replace the existing entry at lines 291-295 (the PIR-only `codev.viewPlanFile`) with three entries that match the visibility table:

| Command | `when` (after `view == codev.builders &&`) |
|---|---|
| `codev.viewSpecFile` | `viewItem =~ /^(builder\|blocked-builder\|awaiting-builder)-(spir\|aspir)(-review)?$/` |
| `codev.viewPlanFile` | `viewItem =~ /^(builder\|blocked-builder\|awaiting-builder)-(spir\|aspir\|pir)(-review)?$/` |
| `codev.viewReviewFile` | `viewItem =~ /^(builder\|blocked-builder\|awaiting-builder)-((spir\|aspir\|air)(-review)?\|pir-review)$/` |

The `(-review)?` optional capture is there so the SPIR/ASPIR plan/spec entries still match rows that *also* have a review file on disk (e.g. a SPIR builder past its review phase). The `pir-review` alternative is non-optional — that's the gate: PIR rows without a review file on disk get `builder-pir` (no suffix) and the review entry hides; PIR rows with one get `builder-pir-review` and it shows.

Group ordering: keep `viewSpecFile` / `viewPlanFile` / `viewReviewFile` together as `1_primary@3`, `@4`, `@5` so they group naturally in the order specify → plan → review.

Add three `commandPalette` entries to hide these from the command palette: they're builder-row commands and need a tree-item arg. Match the existing `codev.openBuilderRow` pattern (`"when": "false"`).

### 6. Don't touch `gate-toast.ts` or `approve.ts`

The `GATE_ACTIONS` / `GATE_SIDE_ACTIONS` maps in `notifications/gate-toast.ts:104-107` and `commands/approve.ts:22-25` use `viewPlanFile` for the `plan-approval` gate's side button. The mapping is gate-keyed, not protocol-keyed, so they keep working unchanged. There is no `spec-approval` or post-PR review gate that surfaces a side-button today, so we don't add review/spec mappings.

## Files to Change

- `packages/vscode/src/commands/view-artifact.ts:1-31` — widen `ArtifactKind`, add `viewSpecFile`/`viewReviewFile` wrappers, rewrite docblock.
- `packages/vscode/src/extension.ts:18` — import the two new wrappers alongside `viewPlanFile`.
- `packages/vscode/src/extension.ts:602-603` — register `codev.viewSpecFile` and `codev.viewReviewFile` next to the existing `codev.viewPlanFile`.
- `packages/vscode/src/views/builders.ts:89-136` — add the `builderHasReviewFile` helper and suffix the protocol token in `contextValue` accordingly.
- `packages/vscode/package.json:191-194` — declare the two new commands in `contributes.commands`.
- `packages/vscode/package.json:223-269` — add three `commandPalette` `when: false` entries for the builder-only commands.
- `packages/vscode/package.json:291-295` — replace the single PIR-only `viewPlanFile` menu entry with three entries (spec / plan / review) matching the visibility table.

## Risks & Alternatives Considered

**Risk: `readdirSync` per render hot-loops.** The Builders tree re-renders on every `overview-changed` SSE event, which can fire frequently during active work. We're adding one `readdirSync` per builder. The dir is local, typically empty or 1-file, and is on the same filesystem as the worktree the IDE is rooted in. Mitigation: bench it; if it shows up in profiling, memoize per builder ID with a TTL or invalidate when the builder's `worktreePath` or `phase` changes. Initial assessment: not worth pre-optimizing — the existing diff-cache work on expansion is heavier.

**Risk: `when`-clause regex drift.** Three separate regexes that need to stay in sync if a new protocol is added (e.g. a future protocol that ships a spec). Mitigation: a single test in `packages/vscode/tests/unit/menu-when-clauses.test.ts` enumerates the expected (protocol, family, has-review) tuples and asserts the regex matches the expected set. The regex strings live in `package.json` — the test reads them via `JSON.parse(readFileSync(...))` and applies them as `RegExp`.

**Risk: `-review` suffix collides with a future protocol named `review`.** No such protocol exists, but the contextValue token namespace is shared. The PIR-specific suffix encodes a *state* (file present), not a protocol. Mitigation: keep the suffix narrow (`-review`, used only for the review-file-exists signal) and document it next to the `contextValue` assignment in `builders.ts`. If a new protocol token ever conflicted we'd switch to a less collidable marker like `+hasReview`.

**Alternative: use `vscode.commands.executeCommand('setContext', 'codev.builderHasReviewFile.<id>', true)`.** Rejected: VSCode's `setContext` is global, not per-row, so we'd have to set one key per builder ID and write a more complex `when` clause that interpolates the row's id. The `contextValue` suffix is the idiomatic per-row mechanism.

**Alternative: open the PR URL when the PIR review file is missing.** Explicitly rejected by the issue ("intentionally rejected in favor of menu-hiding for PIR"). Menu-hiding is the cleaner UX — the entry simply isn't there until the artifact is.

**Alternative: ship `viewSpecFile` for BUGFIX/AIR/MAINTAIN.** Out of scope per the issue. These protocols don't produce spec files; surfacing a command that would always say "no spec file" is worse than not surfacing it.

**Alternative: a generic "View Artifact" picker that prompts the user for kind.** Out of scope per the issue. Two extra clicks on the most common path (open the plan) is a regression versus today's direct command.

## Test Plan

### Unit / static

- `pnpm --filter @cluesmith/codev-vscode build` — type-check the new exports and registrations.
- (New) `packages/vscode/tests/unit/menu-when-clauses.test.ts` — parse `package.json`, extract the three `viewItem =~` regexes, assert visibility for the matrix of (protocol × family × has-review-file):
  - SPIR + builder + no-review → spec ✓, plan ✓, review ✓ (SPIR always-show)
  - SPIR + builder + review     → spec ✓, plan ✓, review ✓
  - ASPIR + blocked + no-review → spec ✓, plan ✓, review ✓
  - PIR + builder + no-review   → spec ✗, plan ✓, review ✗  ← key case
  - PIR + builder + review      → spec ✗, plan ✓, review ✓  ← key case
  - PIR + blocked-builder + no-review → spec ✗, plan ✓, review ✗
  - AIR + builder + no-review   → spec ✗, plan ✗, review ✓ (AIR has no plan/spec on disk, only review)
  - AIR + builder + review      → spec ✗, plan ✗, review ✓
  - BUGFIX + builder + no-review → all ✗
  - awaiting-builder family matches the same way as builder/blocked-builder for all three commands.

### Manual

In a workspace with at least four builders simultaneously (SPIR mid-implement, ASPIR mid-implement, PIR mid-plan, AIR mid-implement):

1. **PIR before review file**: Right-click the PIR builder row → menu shows "View Plan File" but **not** "View Review File" or "View Spec File".
2. **PIR after review file**: Touch `codev/reviews/<pir-id>-anything.md` in the PIR worktree, trigger a refresh (the SSE will fire on next phase/state change; you can force it via "Codev: Refresh Overview" command). Right-click the same row → "View Review File" now appears.
3. **SPIR**: Right-click the SPIR row → all three appear: spec / plan / review.
4. **ASPIR**: Same as SPIR.
5. **AIR**: Right-click → only "View Review File" appears (no spec, no plan).
6. **BUGFIX**: Right-click → none of the three appear (BUGFIX is in the "unchanged" set).
7. **Click each entry**: For a builder with the relevant file on disk, clicking the menu entry opens the file in a non-preview editor tab. For SPIR/ASPIR/AIR rows whose corresponding file isn't on disk yet (e.g. plan menu on a SPIR that's still in `specify`), the existing missing-file info toast fires ("Codev: No plan file for builder ... yet — the builder hasn't written one").

### Cross-protocol regression

8. Existing `codev.viewPlanFile` invocations from `notifications/gate-toast.ts:105` (plan-approval gate toast → "View Plan" button) and `commands/approve.ts:23` (approve confirmation dialog → "View Plan" side-button) keep working unchanged for PIR. Verify by triggering a PIR plan-approval gate and clicking through both surfaces.

## Out of Scope

- Wiring these commands into the expandable phase children (that's #792).
- Adding `viewSpecFile` / `viewPlanFile` for BUGFIX/AIR/MAINTAIN/TICK — these protocols don't produce those artifacts.
- A generic "View Artifact" picker.
- A fallback path that opens the GitHub PR URL when the PIR review file is missing — intentionally rejected.
- Touching `gate-toast.ts` or `approve.ts` GATE_ACTIONS maps. No gate currently surfaces a spec or review side-button.
