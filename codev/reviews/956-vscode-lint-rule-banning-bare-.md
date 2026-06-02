# PIR Review: Lint rule banning bare `vscode.commands.registerCommand`

Fixes #956

## Summary

Adds a built-in `no-restricted-syntax` ESLint rule to `packages/vscode/eslint.config.mjs` that bans bare `vscode.commands.registerCommand(...)` calls, enforcing the `reg`/`regCli` registrar convention introduced in #791. The rule fires at `error` severity so a bare call fails `pnpm lint` (and therefore `pnpm compile` / `pnpm package`); the four legitimate existing call sites opt out with inline `eslint-disable-next-line … -- <reason>` comments. This closes a silent-regression class: a future contributor who registers a command the old way would otherwise bypass the CLI-preflight guard `regCli` provides, with grep as the only review-time signal.

## Files Changed

- `packages/vscode/eslint.config.mjs` (+12 / -0) — the `no-restricted-syntax` rule
- `packages/vscode/src/extension.ts` (+2 / -0) — `eslint-disable-next-line` on the two `reg`/`regCli` helper definitions
- `packages/vscode/src/comments/plan-review.ts` (+2 / -0) — `eslint-disable-next-line` on the two CLI-independent review-comment commands

## Commits

- `d3d700bc` [PIR #956] Add no-restricted-syntax rule banning bare vscode.commands.registerCommand
- `6beca0ce` [PIR #956] Reword plan-review disable reasons to lead with policy (intentionally unguarded)

(Plus thread-file updates and porch phase-transition commits.)

## Test Results

- `npm run build` (root → core + codev): ✓ pass (porch gate check, 6.8s)
- `npm test` (codev): ✓ pass (porch gate check, 20.7s)
- `packages/vscode` `pnpm lint`: ✓ clean with all four exemptions
- `packages/vscode` `pnpm check-types`: ✓ pass (after building core/types — see "Things to Look At")
- `node esbuild.js`: ✓ bundle builds; no shipped-bundle change (comments + lint config don't ship)
- **Rule-bites verification** (transient probe files, not committed):
  - Negative: a bare `vscode.commands.registerCommand('codev.foo', …)` → `1 error` at the call site with the #791 message → confirms enforcement.
  - Positive: `reg('codev.foo', …)` → lints clean → confirms the helpers are allowed.
- Manual verification (human, dev-approval gate): reviewed the running worktree; approved.

## Architecture Updates

No `arch.md` changes needed — this PR adds a lint guardrail around an existing, already-documented pattern (the #791 `reg`/`regCli` registrar split). It introduces no new module boundary, data flow, or architectural concept; it only mechanically enforces a convention that already exists in the codebase.

## Lessons Learned Updates

No `lessons-learned.md` update needed — the change is a small, self-contained lint addition. One worth-noting-but-not-durable observation (recorded here, not promoted to `lessons-learned.md` to keep it lean): a repo-wide AST selector surfaces *every* real call site, including ones outside the convention's home module. Here it revealed two `registerCommand` calls in `comments/plan-review.ts` that the issue hadn't anticipated. The honest reconciliation was a visible `eslint-disable-next-line … -- <policy reason>` per site rather than silently scoping the rule to `extension.ts` (which would have left new files unguarded) — the escape hatch documents intent at the call site instead of hiding the exception in config.

## Things to Look At During PR Review

- **The two `plan-review.ts` exemptions** are the only non-obvious part. These commands (`codev.submitReviewComment`, `codev.deleteReviewComment`) live in a separate module from `activate()`, so they can't reach the `activate`-scoped `reg`/`regCli` closures. They're intentionally unguarded (CLI-independent local-file edits), so the disable comments lead with that policy rather than the mechanical "no access". Refactoring them to share the helpers was rejected as out of scope — it would change whether they're guarded (a runtime-behavior change #956 forbids).
- **Severity is `error`, not `warn`** like the rest of the config — deliberate, because the acceptance criterion is that a bare call *fails* lint (`eslint` exits 0 on warnings).
- **Enforcement is local + packaging-time, not CI**: no GitHub workflow lints `packages/vscode`, so a bad PR won't fail a GitHub check — it fails `pnpm lint` / `pnpm package` locally and at VSIX publish. Confirmed sufficient with the reviewer; a CI lint job is explicitly out of scope (possible follow-up).
- **Known selector limitation**: only the `vscode.commands.registerCommand(...)` member form is matched. An aliased form (`const { registerCommand } = vscode.commands`) would not be caught — accepted, since there are zero such instances today and the form is unidiomatic here.

## How to Test Locally

- **View diff**: VSCode sidebar → right-click builder pir-956 → **View Diff**
- **What to verify** (maps to the plan's Test Plan):
  - `cd packages/vscode && pnpm lint` → clean (exit 0)
  - Add `vscode.commands.registerCommand('codev.foo', () => {});` to any `src/` file → `pnpm lint` fails with the #791 message → remove it
  - Add `reg('codev.foo', () => {})` instead → lints clean
- The change is config + comments only — no dev server needed to exercise it.
