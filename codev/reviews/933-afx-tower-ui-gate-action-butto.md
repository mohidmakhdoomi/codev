# PIR Review: Neutral inline gate-action icon on the VSCode Builders tree

Fixes #933

## Summary

The VSCode Builders tree showed a checkmark (`$(check)`) on the inline action button of every blocked builder, implying "approve" regardless of which gate the builder was at. This change swaps that glyph for a neutral arrow (`$(arrow-right)`) so the button no longer over-promises "approve." It is a one-line, behavior-preserving change to the `codev.approveGate` command's declared icon in `package.json` — clicking the button still opens the same approve flow; the context menu and `Cmd+K G` are untouched. Per-gate triage at a glance is already provided by the row's *leading* icon (`gateIconFor`), which was not modified.

## Files Changed

- `packages/vscode/package.json` (+1 / -1) — `codev.approveGate` icon `$(check)` → `$(arrow-right)`
- `codev/plans/933-afx-tower-ui-gate-action-butto.md` (+44 / -0) — the approved plan
- `codev/state/pir-933_thread.md` (+30 / -0) — builder thread log
- `codev/projects/933-afx-tower-ui-gate-action-butto/status.yaml` (+22 / -0) — porch state (managed automatically)

## Commits

- `e093d8c8` [PIR #933] Builders tree: neutral inline gate-action icon (arrow, not checkmark)
- `89338131` [PIR #933] Thread: implement notes (icon-only)
- `31d09e87` [PIR #933] Plan draft (icon-only)

(plus porch-managed `chore(porch)` state-transition commits)

## Test Results

- `pnpm --filter codev-vscode check-types`: ✓ pass
- `pnpm --filter codev-vscode lint`: ✓ pass
- `pnpm --filter codev-vscode test:unit`: ✓ pass (197 tests)
- porch `build` / `tests` checks: ✓ pass
- Manual verification: approved by the human at the `dev-approval` gate (inline button renders the arrow instead of the checkmark; approve flow, context menu, and Cmd+K G unchanged).

## Architecture Updates

No arch changes — this is a single declarative icon-string swap in `package.json`. It introduces no new module, command, pattern, or boundary, so `codev/resources/arch.md` needs no update.

## Lessons Learned Updates

No new lesson added to `codev/resources/lessons-learned.md`. The one takeaway from this work was process, not architecture, and is already captured by existing guidance: **scope an issue to what it literally asks for.** This issue read "change the icon," but its acceptance criteria also implied a per-gate *action* change; an earlier iteration built that (a runtime dispatcher) and it was reverted as scope creep before re-doing it as the one-line icon swap. The existing `feedback_match_protocol_to_scope` / surgical-scope guidance already covers this; no durable doc change warranted.

## Things to Look At During PR Review

- Confirm the glyph only renders where intended: `codev.approveGate`'s icon appears solely on the inline `blocked-builder` menu action. Its context-menu entry (`1_primary@2`) renders the command *title*, and the gate-pending toast (`gate-toast.ts`) uses its own button labels — neither uses the command icon. So the only visible effect is the inline button.
- This is deliberately icon-only: the button's command and behavior are unchanged. If a reviewer expected the inline action to *do* something different per gate (open the plan / run dev), that was explicitly de-scoped — see the issue's "Out of scope" section.

## How to Test Locally

For reviewers pulling the branch:

- **View diff**: VSCode sidebar → right-click builder `pir-933` → **View Diff** (or the one-line `package.json` diff on the PR).
- **Run the extension**: open the `pir-933` worktree as a workspace → Run & Debug → "Run Codev Extension" (F5) → inspect a blocked builder row in the Builders tree.
- **What to verify**:
  - The inline action button on a blocked builder shows **→**, not **✓**.
  - Clicking it still opens the approve confirmation (behavior unchanged).
  - Right-click "Approve Gate" and **Cmd+K G** still approve.
  - The gate-pending toast's buttons are unchanged.
