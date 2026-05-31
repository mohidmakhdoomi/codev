---
approved: 2026-05-31
validated: [gemini, codex, claude]
---

# PIR Plan: Show issue # + title in the two outlier builder Quick Picks

## Understanding

Issue #925 asks to bring two command-palette Quick Pick pickers — **Codev: Open Builder Terminal** (`packages/vscode/src/extension.ts:539-542`) and **Codev: Send Message to Builder** (`packages/vscode/src/commands/send.ts:22-25`) — in line with the seven other builder pickers, which render each row as `#<issueId> <issueTitle>` instead of the internal builder name (`pir-1333`).

**The issue's literal fix does not compile, because its central premise is factually wrong.** The issue states the two outliers source their builders "from the same `client.getWorkspaceState(workspacePath)` endpoint the seven correct pickers use, so the fields should already be populated." That is not the case:

- The **seven correct pickers all call `client.getOverview(workspacePath)`**, which returns `OverviewData.builders: OverviewBuilder[]`. `OverviewBuilder` *has* `issueId`, `issueTitle`, and `phase` (`packages/types/src/api.ts:129-170`). Verified each: `approve.ts:69`, `cleanup.ts:32`, `view-diff.ts:312`, `run-worktree-setup.ts:34`, `run-worktree-dev.ts:29`, `open-worktree-window.ts:32`, `open-worktree-folder.ts:25` — all `getOverview`.
- The **two outliers call `client.getWorkspaceState(workspacePath)`**, which returns `DashboardState.builders: Builder[]` (`packages/types/src/api.ts:71-94`). The `Builder` interface (`api.ts:25-46`) has `phase` but **no `issueId` and no `issueTitle`**.

So `b.issueId` / `b.issueTitle` on a `getWorkspaceState` builder is a TypeScript error — the issue's drop-in snippet would fail `tsc`. This is exactly the design ambiguity that makes #925 a PIR rather than a BUGFIX: the fix is not a mechanical field swap; the two outliers read the *wrong endpoint* for the data they now need.

Why the outliers can't simply switch wholesale to `getOverview`: both depend on fields that live **only on the `getWorkspaceState` `Builder`**, not on `OverviewBuilder`:
- `extension.ts` filters on `b.terminalId` and passes `picked.terminalId` + `picked.id` into `terminalManager.openBuilder(terminalId, builderId, label)` (`terminal-manager.ts:160`). `OverviewBuilder` has no `terminalId`.
- `send.ts` filters on `b.terminalId` and passes `picked.id` into `client.sendMessage(id, ...)`.

`OverviewBuilder.id` and `Builder.id` are also **different in shape** and can't be compared with strict `===` — this is documented at `run-worktree-dev.ts:51-54`, which is the exact precedent: a picker that needs both the overview display fields *and* a `getWorkspaceState`-only runtime field. It fetches `getOverview` (primary, for the label) **and** `getWorkspaceState`, joining the two via `resolveAgentName(overviewBuilder.id, workspaceState.builders)` (`packages/core/src/agent-names.ts:40`), which does case-insensitive exact + tail-match (`'109'` matches `'builder-spir-109'`).

## Proposed Change

Mirror the `run-worktree-dev.ts` precedent exactly: **`getOverview` as the display source, joined to `getWorkspaceState` via `resolveAgentName` for the `Builder`-only fields** (`terminalId`, canonical `Builder.id`, `Builder.name`).

To avoid duplicating the join in two call sites — and following the existing `prune-builder-terminals.ts` precedent of extracting a pure, unit-tested helper used by command code — I'll add one small pure function:

```ts
// packages/vscode/src/builder-pick-rows.ts (new)
export interface BuilderPickRow {
  label: string;          // `#<issueId|id> <issueTitle>`
  description: string;    // phase
  id: string;             // workspace Builder.id (load-bearing for the action)
  name: string;           // workspace Builder.name (for the terminal tab title)
  terminalId?: string;    // workspace Builder.terminalId (Open Terminal only)
}

// Pairs each overview builder with its workspace Builder via resolveAgentName,
// keeps only those with a live terminal, and formats the row.
export function buildBuilderPickRows(
  overviewBuilders: Array<{ id: string; issueId: string | null; issueTitle: string | null; phase: string }>,
  workspaceBuilders: Array<{ id: string; name: string; terminalId?: string }>,
): BuilderPickRow[]
```

Both call sites become: fetch `getOverview` + `getWorkspaceState`, call `buildBuilderPickRows`, show the rows. The label is `#${issueId ?? id} ${issueTitle ?? ''}` — byte-identical to the seven correct pickers, with the same `issueId ?? id` degenerate-state fallback. `description` is the phase, matching Cleanup Builder.

This is in scope: the issue's "out of scope" excludes a *full* shared `pickBuilder` helper across **all nine** call sites (which would restructure the seven good ones). A tiny pure helper shared between **only the two being fixed** restructures nothing in the seven and is the same shape as the existing `prune-builder-terminals.ts` helper — it is the cleanest way to not write the `resolveAgentName` join twice.

**Behavior preserved deliberately:**
- The "only builders with a live terminal" filter is kept (now expressed as "overview builder whose joined workspace `Builder` has a `terminalId`"), preserving the current "no builder terminals / no active builders" empty-state messages.
- The downstream action is fed from the **workspace `Builder`** (`id`, `terminalId`) exactly as today — the join resolves back to the same object, so `openBuilder(...)` and `sendMessage(...)` receive identical values. Zero change to the action path.
- The resulting **terminal tab title** stays `Codev: <builder name>` by passing `row.name` (not the new friendly label) into `openBuilder`'s `label` arg — matching `terminal-manager.ts:204`. Only the *picker row* changes; the tab name is untouched. (#925 scope is the picker row only.)

## Files to Change

- `packages/vscode/src/builder-pick-rows.ts` — **new**. Pure `buildBuilderPickRows()` helper + `BuilderPickRow` type. Imports `resolveAgentName` from `@cluesmith/codev-core/agent-names`.
- `packages/vscode/src/extension.ts:532-545` — in `codev.openBuilderTerminal`: also fetch `getOverview`, build rows via the helper, keep the empty-state guard, and call `openBuilder(picked.terminalId, picked.id, \`Codev: ${picked.name}\`, true)`.
- `packages/vscode/src/commands/send.ts:15-34` — also fetch `getOverview`, build rows via the helper, keep the empty-state guard, send via `picked.id`; input-box / success messages reference `picked.label`.
- `packages/vscode/src/__tests__/builder-pick-rows.test.ts` — **new**. Unit tests for the helper.

## Risks & Alternatives Considered

- **Risk: `resolveAgentName` returns `null` or ambiguous for a builder** (id shapes don't match, or multiple tail matches). Mitigation: such builders are dropped from the picker (no terminal join → not actionable anyway), mirroring how `run-worktree-dev.ts` already tolerates the join. Unit-tested explicitly.
- **Risk: `issueId` genuinely missing** (degenerate state). Mitigation: `#${issueId ?? id}` fallback — identical to the seven correct pickers and called out in the acceptance criteria. Unit-tested.
- **Alternative A — keep `getWorkspaceState` as primary, reverse-join to `getOverview` for `issueId`/`issueTitle`.** Smaller diff, but it enriches the "wrong" source and inverts the established `getOverview`-primary pattern the seven pickers and `run-worktree-dev` all follow — worse for consistency. Rejected.
- **Alternative B — add `issueId`/`issueTitle` to the `Builder` wire type and populate them in Tower's `/api/state` handler.** Changes a wire contract + server for a VSCode-only display concern, and `getOverview` already carries these fields. Out of proportion. Rejected.
- **Alternative C — literal issue snippet (`b.issueId` on `getWorkspaceState` builders).** Does not compile. Rejected.

## Test Plan

- **Build / typecheck**: `pnpm --filter @cluesmith/codev-vscode check-types` (or the package's `tsc --noEmit`) — must pass. This is the gate that proves the issue's literal snippet was wrong and the join approach is sound.
- **Unit** (`pnpm --filter ... test:unit`, vitest), in `builder-pick-rows.test.ts`:
  - Happy path: overview builder with `issueId`/`issueTitle`/`phase` joined to a workspace builder with `terminalId` → row label `#<id> <title>`, description = phase, correct `id`/`name`/`terminalId`.
  - Fallback: `issueId: null` → label `#<id> ...`.
  - Filter: overview builder whose join resolves to a workspace builder with **no** `terminalId` → excluded.
  - Filter: overview builder with **no** matching workspace builder (resolveAgentName null) → excluded.
  - Id-shape mismatch: overview id `pir-925` vs workspace id `builder-pir-925` → still joins via tail-match.
- **Manual** (at the `dev-approval` gate, via `afx dev pir-925` and the VSCode extension built from this branch):
  - Run **Codev: Open Builder Terminal** → rows show `#<id> <title>` with `<phase>` in the description; picking one opens the correct terminal (tab title unchanged: `Codev: <builder name>`).
  - Run **Codev: Send Message to Builder** → rows show the same format; picking + sending delivers to the correct builder.
  - Sanity-check one of the seven (e.g. **Cleanup Builder**) still renders correctly — no regression.
