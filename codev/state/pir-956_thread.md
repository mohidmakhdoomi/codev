# PIR #956 — vscode lint rule banning bare `vscode.commands.registerCommand`

## Plan phase

Issue asks for a `no-restricted-syntax` ESLint rule enforcing the #791 `reg`/`regCli`
registrar convention.

**Key investigation finding the issue missed**: bare `vscode.commands.registerCommand`
exists at **four** sites in `packages/vscode/src/`, not two:
- `extension.ts:485,487` — the `reg`/`regCli` helper definitions (expected escape hatch)
- `comments/plan-review.ts:120,131` — `codev.submitReviewComment` / `codev.deleteReviewComment`,
  registered in a separate module with no access to the `activate`-scoped helpers. They're
  CLI-independent (local-file review-marker commands, graceful Tower fallback).

Plan decision: repo-wide ban + 4 visible `eslint-disable-next-line ... -- reason` escape
hatches (2 helpers + 2 plan-review commands). Rejected `extension.ts`-only scoping (leaves
new modules unguarded) and refactoring plan-review.ts to share the helpers (closure capture
+ would change guard behavior = runtime change the issue forbids). Flagged the 2 extra
exemptions for human review at the plan-approval gate.

Rule severity = `error` (not `warn` like the rest of the config) so `pnpm lint` actually fails.

Plan file: `codev/plans/956-vscode-lint-rule-banning-bare-.md` (exact name required by
`plan_exists` check: `test -f codev/plans/${PROJECT_TITLE}.md`).

`pnpm install` run (node_modules was missing in fresh worktree) so implement phase can run lint.

**CI check**: confirmed no workflow lints/builds/packages `packages/vscode` (test.yml covers
core+codev only). Reviewer confirmed lint-only enforcement is enough — NO CI job added.
Enforcement = local `pnpm lint` + VSIX packaging/publish gate (`pnpm package` runs lint).
Documented as deliberate scope boundary in the plan's "Enforcement scope" section.

Plan-approval gate: APPROVED.

## Implement phase

Applied 3 edits per plan:
- `eslint.config.mjs` — `no-restricted-syntax` rule (`error` severity), selector on
  `vscode.commands.registerCommand`, message names reg/regCli + cites #791.
- `extension.ts:484-489` — 2 `eslint-disable-next-line ... -- this IS the reg/regCli helper (#791)`.
- `comments/plan-review.ts` — 2 `eslint-disable-next-line ... -- CLI-independent review-comment command in a separate module`.

Verification:
- `pnpm lint` → clean (exit 0) with all 4 exemptions.
- Negative probe (transient temp file, removed): bare `registerCommand` → 1 error at the
  call site with the #791 message. Positive probe `reg(...)` → clean. Confirms the rule bites
  only unjustified bare calls.
- `pnpm check-types` → clean (after building core+types first; the fresh-worktree failures
  were all pre-existing `@cluesmith/codev-core/workspace` missing-module + implicit-any in
  `views/*.ts`, none in files I touched — NOT my change).
- `node esbuild.js` → bundle builds clean. No bundle content change (comments + lint config
  don't ship).

Note for porch checks: root `npm run build` / `npm test` target core+codev, not vscode, so
they pass independent of this change. The real verification for this change is vscode `pnpm lint`.

Dev-approval gate: APPROVED (after rewording plan-review disable reasons to lead with
policy — "intentionally unguarded: CLI-independent command" rather than "no access to
reg/regCli").

## Review phase

Wrote `codev/reviews/956-vscode-lint-rule-banning-bare-.md` (retrospective, becomes PR body).
No arch.md / lessons-learned.md changes (lint guardrail around existing #791 pattern; sections
explain why). Next: PR, record with porch, `porch done` triggers single-pass 3-way consult,
then pr gate.
