# Builder thread — spir-1134 (afx whoami + ship /arch-init)

## Specify phase

- No pre-existing spec; drafted `codev/specs/1134-afx-whoami-ship-arch-init-comm.md`
  directly from issue #1134 (issue body was detailed enough — design notes,
  precedence rules, acceptance criteria — that clarifying questions weren't needed).
- Key grounding decisions made while drafting:
  - `/arch-init` ships as a **skill** (`.claude/skills/arch-init/SKILL.md`), not a
    `.claude/commands` file — the scaffold (`init.ts:98`, `adopt.ts:134`,
    `update.ts:223`) only copies `.claude/skills/` into adopting projects.
  - `whoami` reuses `detectCurrentBuilderId()` (send.ts) +
    `lookupBuilderSpawningArchitect()` (state.ts) + `CODEV_ARCHITECT_NAME` env;
    `BuilderIdResolutionError` inside a worktree is terminal (no env fallthrough).
  - Workspace display name from `known_workspaces` in global.db, basename fallback
    (informational field only; fail-loud applies to type/name).
- Open question flagged for reviewers: whether to cross-check `CODEV_ARCHITECT_NAME`
  against the `architect` table (default: trust env, no cross-check).
