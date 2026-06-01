# PIR Review: VSCode startup preflight — verify codev CLI installed and version ≥ extension

Fixes #791

## Summary

Adds a startup preflight to the VSCode extension that, on `activate()`, verifies the `codev` CLI is installed and at least as new as the extension's own `package.json` version. The result is cached per session and bounded to 400ms (fire-and-forget, so activation never blocks). A missing CLI auto-opens the `Get started with Codev` walkthrough (once per workspace); an outdated CLI shows an upgrade notification (`Update via npm` / `Open Install Docs`); either prompt dismissed leaves Codev commands registered but no-op'ing cleanly with a single `Run Setup` toast. A persistent **Codev CLI** row in the sidebar Status view plus a `Codev: Recheck CLI` command let the user re-verify after fixing. This replaces the prior cryptic failure mode (a missing CLI surfaced only as a Tower-startup error logged to the OutputChannel) with actionable, state-specific guidance.

## Files Changed

- `packages/vscode/src/preflight/preflight-core.ts` (+105 / -0) — new, pure/vscode-free logic
- `packages/vscode/src/preflight/preflight.ts` (+261 / -0) — new, vscode glue
- `packages/vscode/src/extension.ts` (+~90 / -~50) — preflight wiring + `reg()`/`regCli()` registrars
- `packages/vscode/src/views/status.ts` (+42 / -0) — Codev CLI status row
- `packages/vscode/package.json` (+~35 / -~3) — `recheckCli` command, status-row inline menu, walkthrough contribution
- `packages/vscode/walkthroughs/detect.md`, `install.md`, `verify.md` (+61 / -0) — walkthrough step bodies
- `packages/vscode/src/__tests__/preflight-core.test.ts` (+100 / -0) — new unit tests
- `packages/vscode/src/__tests__/contributes-walkthroughs.test.ts` (+61 / -0) — new contribution-invariant tests
- `packages/vscode/src/__tests__/extension-architect-commands.test.ts` (+~6 / -~6) — updated source-sentinels for the `reg`/`regCli` registrar rename
- `codev/resources/arch.md`, `codev/resources/lessons-learned.md` — see sections below

## Commits

- `2b87f216` [PIR #791] Add CLI preflight core + vscode glue
- `3ec42037` [PIR #791] Wire preflight into activation; guard CLI-dependent commands
- `f3b08dbb` [PIR #791] Add Codev CLI status row with inline recheck
- `b2908122` [PIR #791] Add recheck command, status-row menu, Getting Started walkthrough
- `a7ee702d` [PIR #791] Tests for preflight core + walkthrough contribution
- `64c29805` [PIR #791] Refactor command guarding into reg()/regCli() registrars
- `eea70d29` [PIR #791] Note Node.js >=20 prerequisite in install walkthrough
- `ccb5bb5f` [PIR #791] Complete Verify step on cliReady context; rename walkthrough to 'Get started with Codev'

## Test Results

- `pnpm check-types`: ✓ pass
- `pnpm lint`: ✓ pass
- `pnpm test:unit`: ✓ pass (155 tests, ~25 new across the two new suites)
- `node esbuild.js`: ✓ bundles
- porch `build` + `tests` checks: ✓ pass (8.6s / 21.3s)
- Manual verification (human, at `dev-approval` gate): ran the Extension Development Host against the worktree; reviewed the `Get started with Codev` walkthrough (three steps), confirmed the Verify-step completion now keys off `codev.cliReady`, and approved the title/behaviour.

## Architecture Updates

Updated `codev/resources/arch.md` — added a "Startup CLI preflight (#791)" bullet to the VS Code Extension *Key Design Decisions* list, documenting: the on-activate `codev --version` check vs the extension's own version, the fire-and-forget/cached/400ms-bounded probe, the missing/outdated/dismissed UX branches, the `reg`/`regCli` two-registrar guard pattern (registrar name = guard policy, no separate list), the `codev.cliReady` context key, and the `src/preflight/` core+glue split. This is a genuine new architectural behaviour for the extension (a thin client that now verifies the CLI dependency it relies on), so it belongs in arch.md rather than only in this review.

## Lessons Learned Updates

Added two entries to `codev/resources/lessons-learned.md` (UI/UX), both durable for future VSCode work:

1. **Walkthrough step completion semantics** — steps without explicit `completionEvents` fall back to `onStepSelected` (auto-tick on view, which reads as false progress; the first step auto-selects on open). Wire completion to an observable signal (`onContext:`/`onCommand:`/`onSettingChanged:`), and key it on *outcome* (`onContext:codev.cliReady`) not *attempt* (`onCommand:recheck`) so a failed retry doesn't falsely complete the step.
2. **Bundled Node ≠ system Node** — a running extension doesn't imply a usable `node`/`npm` on the user's PATH (VSCode ships its own bundled Node for the extension host). Install/CLI guidance must state the Node prerequisite (codev needs ≥20) and resolve binaries from workspace/PATH.

## Things to Look At During PR Review

- **The guard split** — `regCli` wraps 15 CLI-dependent commands; `reg` registers the other 29 unguarded (recovery/recheck/config-toggles/read-only viewers). Confirm nothing critical is mis-classified. The policy is now the registrar name at each call site (grep `regCli(`), there is no separate list.
- **Optimistic `pending`** — `isCliReady()` treats the not-yet-resolved preflight window (~≤400ms) as ready, so a command fired during startup is never falsely blocked. The trade-off (a command in that window won't be guarded even if the CLI is actually missing) is intentional; the command then falls through its existing not-connected path and the walkthrough/notification still fires once preflight resolves.
- **`Update via npm` auto-runs** the install in an integrated terminal (the button click is the confirmation). The terminal-close re-verify is instance-matched and exit-code-gated; a failed/cancelled install does not silently re-cache — it surfaces an explicit `Recheck` toast.
- **Walkthrough `when`** — intentionally *not* gated; the walkthrough is always listed and VSCode features it once per install (`workbench.welcomePage.walkthroughs.openOnInstall`), which is acceptable. Our explicit once-per-workspace auto-open on the `missing` path is additive.
- **Recheck button scoped to `missing`/`outdated`, not `pending`** (raised by the Codex consultation as a COMMENT — minor plan drift). Deliberate: `pending` is the ≤400ms transient startup-probe state (shown as a spinner) with a preflight *already in flight* — a recheck button there is meaningless and would risk launching a second concurrent `codev --version`. The plan's wording listed `pending` too; this is an intentional narrowing. Verdicts: Gemini APPROVE, Claude APPROVE, Codex COMMENT (no REQUEST_CHANGES). PIR's consultation is single-pass, so this decision is recorded here for the `pr`-gate reviewer rather than re-reviewed by the models.

## How to Test Locally

- **View diff**: VSCode sidebar → right-click builder `pir-791` → **View Diff**
- **Run the extension**: launch the Extension Development Host against this worktree (the realest test for an extension change)
- **What to verify** (maps to the plan's Test Plan):
  - **OK path**: current CLI installed → activate → no toast/walkthrough; Status row shows ✓ with the version; activation feels instant.
  - **Missing**: shadow `codev` off PATH → `Get started with Codev` walkthrough opens once per workspace; Status row shows ✗ with inline recheck.
  - **Outdated**: stub `codev --version` below the extension version → upgrade notification; `Open Install Docs` opens the browser; `Update via npm` runs the install in a terminal.
  - **Recheck**: fix the CLI, click the Status-row recheck button (or run `Codev: Recheck CLI`) → row flips to ✓; the walkthrough's Verify step completes via `codev.cliReady`.
  - **Dismiss → no-op**: dismiss, invoke a guarded command (e.g. Spawn Builder) → single `Run Setup` toast; an unguarded command (Reconnect) still works.
