# air-1108 — Architect group-header click opens architect terminal

Issue #1108 (AIR, strict mode). Parity: in the Agents view's architect-axis
grouping mode, clicking an architect group header should open that architect's
terminal (like builder rows do), while the chevron keeps toggling expand/collapse.

## Implementation

- `packages/vscode/src/views/builders.ts` — `rootChildren()`: when the active
  grouping axis is `architect` (`grouping.id === 'architect'`), set
  `groupItem.command = { command: 'codev.openArchitectTerminal', title: ..., arguments: [g.key] }`
  on each group header. `g.key` is the architect name (null `spawnedByArchitect`
  folds into `main` per `architectGrouping()`). Stage/area headers stay
  command-less containers (they name no launchable entity).
- `codev.openArchitectTerminal` already accepts the optional name arg (#786
  Phase 6) and warns gracefully on a stale owner — no command-handler change.

## Tests

- New `packages/vscode/src/__tests__/builders-architect-header-command.test.ts`:
  architect headers carry the command with the right arg (incl. `main` fold for
  null owner); stage and area headers carry no command.

## Status

- `pnpm test:unit` (vscode): 43 files / 516 tests pass (after building
  types/core/artifact-canvas deps in the fresh worktree).
- `pnpm check-types` main tsc pass clean.
- Net diff well under 300 LOC — AIR is the right protocol.
