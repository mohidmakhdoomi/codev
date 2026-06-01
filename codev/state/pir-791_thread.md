# PIR #791 — vscode startup preflight (codev CLI install/version check)

## Plan phase

**Investigation findings:**
- Only existing CLI preflight: `tower-starter.ts:27-30` resolves `afx`, logs to OutputChannel on failure. No version check, no codev check, no UX.
- `codev --version` prints bare `X.Y.Z` (commander `program.version()`, `cli.ts:47`).
- Extension version source-of-truth: `context.extension.packageJSON.version` (currently 3.1.5).
- No `semver` dep in the vscode package → hand-rolled numeric compare.
- No `contributes.walkthroughs` today → must add one + markdown step bodies.
- vitest tests (`src/__tests__/`) cover pure/vscode-free logic + package.json invariants; vscode glue is reviewed via the vscode-test suite / manual. → split testable core into a vscode-free module.

**Design:** `preflight/preflight-core.ts` (pure: parseSemver/compareSemver/parseCliVersion/resolveCodevPath/decidePreflight) + `preflight/preflight.ts` (vscode glue: runPreflight, cache, walkthrough trigger, outdated notification, command guard). Fire-and-forget on activate (400ms timeout, session-cached). `guard()` wrapper applied to CLI-dependent commands only — split enumerated in plan for gate review.

Plan written to `codev/plans/791-vscode-startup-preflight-verif.md`.

**Plan revision (recheck design):** reviewer asked how versions are obtained + whether a recheck concept exists. Versions: extension's own via `context.extension.packageJSON.version` (truth); CLI via `spawn(codev, ['--version'])` (bare X.Y.Z, commander). Recheck consolidated into one command `codev.recheckCli` with 4 entry points: persistent **Status sidebar row** (`codev.status`, renders even when Tower offline, inline recheck button on non-ok states), instance-matched + exit-code-gated terminal-close re-verify after `Update via npm` (falls back to explicit `Recheck` toast on failed install), walkthrough Verify step link, and the `Run Setup` toast. Added `views/status.ts` + package.json command/menu to Files to Change.

Plan approved by human; advanced to implement.

## Implement phase

Implemented per approved plan. 5 logical commits (2b87f216..a7ee702d):
- `src/preflight/preflight-core.ts` — pure: parseSemver/compareSemver/parseCliVersion/resolveCodevPath/decidePreflight.
- `src/preflight/preflight.ts` — glue: 400ms-timeout probe, session cache, walkthrough/notification dispatch, `codev.recheckCli`, instance-matched + exit-code-gated re-verify after `Update via npm`, isCliReady/showSetupRequiredToast.
- `extension.ts` — fire-and-forget runPreflight on activate; `guard()` on 15 CLI-dependent commands (13 wrap + 2 early-return: removeArchitect, referenceIssueInArchitect); registered unguarded codev.recheckCli.
- `views/status.ts` — persistent "Codev CLI" row + inline recheck button (contextValue codev-cli-{missing,outdated}).
- `package.json` — recheckCli command, status-row inline menu, codevGettingStarted walkthrough (3 steps).
- `walkthroughs/{detect,install,verify}.md`.
- Tests: preflight-core.test.ts + contributes-walkthroughs.test.ts.

Gotcha: worktree had no node_modules; ran pnpm install + built codev-types/codev-core before check-types passed (the `@cluesmith/codev-core/*` module-not-found + cascading implicit-any errors were pre-existing infra, not my diff).

Verified: check-types ✓, lint ✓, test:unit 155 ✓, esbuild ✓.

### Reviewer-driven refinements (pre-push)
- Command guarding refactored twice on reviewer steer: inline `guard()` → declarative `CLI_DEPENDENT` Set → finally **two registrars** `reg` (unguarded) / `regCli` (guarded). Registrar name IS the guard decision; each command id written once (no Set/flag duplication). 15 regCli + 29 reg. Updated architect source-sentinel tests to match.
- `Update via npm`: kept auto-run (button click = the confirmation). Reviewer OK'd.
- `install.md`: added Node.js ≥20 prerequisite note (engines.node >=20.0.0, CI on 20; VS Code's bundled Node doesn't count).

Commits 2b87f216..(install note). check-types/lint/test:unit(155)/esbuild all green. Pushing → porch done → dev-approval gate.
