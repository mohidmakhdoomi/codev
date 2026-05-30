# PIR Plan: VSCode builder row legibility — phase prefix + gate-specific icons

## Understanding

The Builders tree (`packages/vscode/src/views/builders.ts`) renders each builder as a row with a state-dispatched label and a state-dispatched icon. Issue #810 identifies two at-a-glance legibility gaps and asks for two compositional fixes in the same file:

- **Gap 1 — phase not visible at a glance.** The phase name (`[implement]`) only appears for *active* builders, as a trailing suffix that long titles truncate off-screen. Blocked and idle rows hide the phase entirely.
- **Gap 2 — gate type not visible at a glance.** Every blocked row shows the same `bell` icon regardless of which gate (`spec-approval`, `plan-approval`, `dev-approval`, `pr`) is pending. The icon — the most pre-attentive signal in the row — carries zero gate-type information.

The fix:
- **Change A** — move the phase from a trailing suffix to a leading prefix right after the issue number, so it survives end-truncation and shows across all three states.
- **Change B** — dispatch the blocked-row codicon by gate name (color stays uniform warning-yellow), with a `bell` fallback for unknown/future gates.

### Critical finding — the issue's proposed icon-map key is wrong

The issue's Change B snippet keys the gate-icon map off `b.blocked`:

```ts
const blockedIcon = (b.blocked && GATE_ICONS[b.blocked]) || 'bell';
```

This is a **defect**. Per `packages/codev/src/agent-farm/servers/overview.ts:410-455` and the type docs at `packages/types/src/api.ts:148-160`:

- `b.blocked` is a **human-readable label** — `detectBlocked()` returns values like `"plan review"`, `"dev review"`, `"PR review"` (from the `GATE_LABELS` map).
- `b.blockedGate` is the **canonical gate name** — `detectBlockedGate()` returns `"plan-approval"`, `"dev-approval"`, `"pr"`, etc.

So `GATE_ICONS['plan-approval']` would never match `b.blocked === 'plan review'`; every blocked row would fall through to `bell` and Change B would silently do nothing. The icon map **must key off `b.blockedGate`**, not `b.blocked`. (The issue's label examples like `blocked on plan-approval` are also inaccurate — the actual rendered label is `blocked on plan review` — but that's pre-existing display text I am not changing.)

### Second finding — `verify-approval` gate is missing from the issue's map

The issue's `GATE_ICONS` map lists only `spec-approval`, `plan-approval`, `dev-approval`, `pr`. But `GATE_LABELS` in `overview.ts` includes a fifth gate, `verify-approval` (the post-merge SPIR/ASPIR verify gate, #927). A `verify-approval`-blocked builder would fall through to `bell`. That's acceptable as a fallback, but since it's a known, real gate I'll add an explicit mapping so the signal is complete.

## Proposed Change

Both changes land in `packages/vscode/src/views/builders.ts:166-211` (`makeBuilderRow`). For testability (the acceptance criteria require unit tests on the label variants, the empty-phase edge case, and the gate-icon mapping), I'll extract two **pure, vscode-free helpers** into a new module `packages/vscode/src/views/builder-row.ts`, mirroring the existing `backlog-filter.ts` pattern (pure helpers tested under `__tests__/` with vitest, no Electron harness needed):

```ts
// packages/vscode/src/views/builder-row.ts
import type { OverviewBuilder } from '@cluesmith/codev-types';
import { isIdleWaiting } from '@cluesmith/codev-core/builder-helpers';
import { timeSince } from '...';   // wherever timeSince currently lives

/**
 * Gate → codicon name. Keyed off the CANONICAL gate name (`b.blockedGate`),
 * NOT the human-readable `b.blocked` label. Color is applied by the caller
 * and stays uniform warning-yellow across all gates — the shape encodes WHAT
 * kind of review, the color stays "needs your attention". Unknown / future
 * gates fall back to `bell` so new protocols never break rendering.
 *
 * To add a new gate: add one entry here. Keep in sync with GATE_LABELS in
 * packages/codev/src/agent-farm/servers/overview.ts (the source of gate names).
 */
const GATE_ICONS: Record<string, string> = {
  'spec-approval': 'book',
  'plan-approval': 'checklist',
  'dev-approval': 'play',
  'pr': 'git-pull-request',
  'verify-approval': 'verified',
};

export function gateIconFor(blockedGate: string | null): string {
  return (blockedGate && GATE_ICONS[blockedGate]) || 'bell';
}

/**
 * The row label, with the phase as a LEADING prefix (survives end-truncation)
 * and the existing state-dispatched suffix for blocked/idle duration.
 */
export function builderRowLabel(b: OverviewBuilder, now: number): string {
  const isBlocked = !!b.blocked;
  const isIdle = !isBlocked && isIdleWaiting(b, now);
  const waitTime = isBlocked && b.blockedSince ? ` [${timeSince(b.blockedSince)}]` : '';
  const idleTime = isIdle && b.lastDataAt ? ` [${timeSince(b.lastDataAt)} silent]` : '';
  const stateLabel = isBlocked
    ? ` blocked on ${b.blocked}${waitTime}`
    : isIdle
    ? ` waiting on input${idleTime}`
    : '';
  const phasePrefix = b.phase ? `[${b.phase}] ` : '';
  return `#${b.issueId ?? b.id} ${phasePrefix}${b.issueTitle ?? ''}${stateLabel}`;
}
```

`makeBuilderRow` then consumes them:

```ts
const item = new BuilderTreeItem(b.id, builderRowLabel(b, now));
...
item.iconPath = isBlocked
  ? new vscode.ThemeIcon(gateIconFor(b.blockedGate), new vscode.ThemeColor('notificationsWarningIcon.foreground'))
  : isIdle
  ? new vscode.ThemeIcon('comment-discussion', new vscode.ThemeColor('notificationsInfoIcon.foreground'))
  : new vscode.ThemeIcon('circle-filled', new vscode.ThemeColor('testing.iconPassed'));
```

Note: `isBlocked` / `isIdle` are still computed inline in `makeBuilderRow` (they're needed for `contextValue` family dispatch and the icon ternary). The label helper recomputes them internally — a tiny, cheap duplication that keeps the label fully pure and independently testable. The alternative (threading the booleans in) couples the helper's signature to the caller's internals for no real gain.

### Why extract rather than inline (deviation from the issue's ~15 LOC sketch)

The issue sketches inline edits (~15 LOC). I'm extracting two helpers instead because the acceptance criteria explicitly require unit tests covering label variants, the empty-phase edge case, and the gate-icon mapping — and `makeBuilderRow` returns a `vscode.TreeItem`, which can only be exercised under the heavier `src/test/` Electron harness. Pulling the pure logic into a vscode-free module lets a vitest `__tests__/` test assert on plain strings, exactly as `backlog-filter.test.ts` does today. Net new LOC is modestly higher but the testing requirement makes extraction the right call.

## Files to Change

- `packages/vscode/src/views/builder-row.ts` — **new file**. Pure helpers `gateIconFor(blockedGate)` and `builderRowLabel(b, now)` plus the `GATE_ICONS` map. No `vscode` import.
- `packages/vscode/src/views/builders.ts:166-211` — `makeBuilderRow`: replace inline label construction with `builderRowLabel(b, now)`; replace the blocked-icon `'bell'` literal with `gateIconFor(b.blockedGate)`. Add the import. Remove the now-dead inline `phaseLabel`/`waitTime`/`idleTime` locals that moved into the helper (keep `isBlocked`/`isIdle` — still used by `contextValue` + icon ternary).
- `packages/vscode/src/__tests__/builder-row.test.ts` — **new file**. Vitest unit tests (see Test Plan).

I'll confirm where `timeSince` is defined during implement and import it into `builder-row.ts` from the same place `builders.ts` gets it (it's used at `builders.ts:168-169`).

## Risks & Alternatives Considered

- **Risk: keying the icon map off `b.blocked` (as the issue wrote it) would no-op Change B.** Mitigated by keying off `b.blockedGate` — the documented finding above. I'll add a test asserting `gateIconFor` maps the canonical gate names, which would catch any regression back to the label-string key.
- **Risk: `timeSince` import location.** If `timeSince` is a local (non-exported) helper in `builders.ts`, I'll export it (or lift it alongside the new helpers). Minor; resolved at implement time.
- **Risk: `b.phase` empty-string transient.** Handled by `b.phase ? ... : ''` — row reads `#<id> <title>` with no `[] ` literal. Covered by a test.
- **Alternative: inline everything per the issue sketch (no extraction).** Rejected — can't satisfy the unit-test acceptance criteria without the Electron harness; extraction matches the existing `backlog-filter.ts` precedent.
- **Alternative: a single combined helper returning `{label, iconName}`.** Rejected — two narrowly-scoped pure functions are easier to test in isolation and read more clearly at the call site.
- **Out of scope (per issue):** `FileDecorationProvider` badge, color-coding the phase prefix or per-gate icon colors, idle/active icon changes, tooltip changes, localization. The tooltip, `contextValue`, and stable `b.id` are all left untouched.

## Test Plan

### Unit (vitest, `packages/vscode/src/__tests__/builder-row.test.ts`)

`builderRowLabel`:
- **Active** builder (`phase: 'implement'`, not blocked, not idle) → `#882 [implement] <title>` (no trailing state label).
- **Blocked** builder (`blocked: 'plan review'`, `blockedSince` set, `phase: 'plan'`) → `#791 [plan] <title> blocked on plan review [<elapsed>]`.
- **Idle** builder (`isIdleWaiting` true, `phase: 'implement'`) → `#794 [implement] <title> waiting on input [<elapsed> silent]`.
- **Empty-phase** edge (`phase: ''`) → no `[] ` literal; row is `#<id> <title>`.
- Falls back to `b.id` when `issueId`/`issueTitle` are null.

`gateIconFor`:
- `'spec-approval'` → `'book'`
- `'plan-approval'` → `'checklist'`
- `'dev-approval'` → `'play'`
- `'pr'` → `'git-pull-request'`
- `'verify-approval'` → `'verified'`
- unknown gate (`'some-future-gate'`) → `'bell'`
- `null` → `'bell'`
- **Regression guard for the issue's bug:** assert `gateIconFor('plan review')` (the human-readable *label*, not the gate name) → `'bell'`, documenting that the function keys off the canonical gate name.

### Build / lint
- `pnpm --filter @cluesmith/codev-vscode build` (or the package's configured build) passes with no TS errors.
- Existing vitest suite still green.

### Manual (at the `dev-approval` gate — reviewer runs VSCode against the worktree)
- Open the Codev Builders sidebar. Confirm every row shows `[<phase>]` immediately after `#<id>`, before the title.
- Confirm a blocked row's phase stays visible when the sidebar is narrowed (truncation cuts the title tail, not the phase).
- Confirm blocked-row icons differ by gate: a `plan-approval` builder shows the checklist glyph, a `pr`-gate builder shows the pull-request glyph, both in warning-yellow.
- Confirm idle rows still show `comment-discussion` (info color) and active rows still show `circle-filled` (passed color).
- Confirm a row's phase prefix and icon both re-render on an SSE tick when the underlying field changes (e.g. a builder transitioning into a gate).
