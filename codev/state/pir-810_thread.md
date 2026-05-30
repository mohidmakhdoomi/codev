# PIR #810 — vscode builder row legibility

## Plan phase

Wrote `codev/plans/810-vscode-builder-row-legibility.md`.

Two changes in `packages/vscode/src/views/builders.ts` (`makeBuilderRow`):
- **A** — phase as leading prefix `#<id> [<phase>] <title>...` (was trailing suffix, truncated off-screen).
- **B** — blocked-row codicon dispatched by gate (uniform warning-yellow), bell fallback.

### Key findings (corrections to the issue's proposed code)
1. **Icon map must key off `b.blockedGate`, not `b.blocked`.** `b.blocked` is a human-readable label (`"plan review"`) per `overview.ts:410-455`; `b.blockedGate` is the canonical name (`"plan-approval"`). The issue's snippet (`GATE_ICONS[b.blocked]`) would never match → Change B would silently no-op. Added a regression test asserting `gateIconFor('plan review') === 'bell'`.
2. **Added `verify-approval` → `verified`** to the icon map (a real gate from #927 the issue's map omitted).

### Design decision
Extracting two pure vscode-free helpers (`gateIconFor`, `builderRowLabel`) into new `builder-row.ts` (mirrors `backlog-filter.ts`) so the acceptance-criteria unit tests run under vitest `__tests__/` instead of the heavier Electron `src/test/` harness. Slightly more LOC than the issue's inline sketch, but the testing requirement makes extraction the right call.

Awaiting `plan-approval` gate.
