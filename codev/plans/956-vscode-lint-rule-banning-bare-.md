# PIR Plan: Lint rule banning bare `vscode.commands.registerCommand`

Issue: #956 — enforce the `reg`/`regCli` registrar convention from #791 with a lint rule.

## Understanding

#791 introduced two command registrars in `packages/vscode/src/extension.ts`:

- `reg(id, handler)` — registers with no guard (CLI-independent commands)
- `regCli(id, handler)` — wraps the handler in `guard()` (CLI-preflight + "run setup" toast)

The registrar name at each call site *is* the guard policy. A future contributor who writes a bare `vscode.commands.registerCommand('codev.foo', …)` silently bypasses both guards, and the only review-time signal is grep. The issue asks for a lint rule that makes this a hard `pnpm lint` failure, with a message that names the helpers and cites #791.

The issue suggests a built-in `no-restricted-syntax` selector rather than a custom rule package — zero extra plumbing, precise enough. I agree.

### Investigation finding the issue did not anticipate

The issue assumed bare `vscode.commands.registerCommand` exists in exactly two places — the two helper definitions in `extension.ts`. It does not. A repo grep of `packages/vscode/src/` finds **four** call sites:

| File | Lines | What it is |
|---|---|---|
| `extension.ts` | 485, 487 | the `reg` / `regCli` helper definitions (the intended escape hatch) |
| `comments/plan-review.ts` | 120, 131 | `codev.submitReviewComment` and `codev.deleteReviewComment`, registered in `registerPlanReviewComments()` — a **separate module** with no access to the `activate`-scoped `reg`/`regCli` closures |

The two `plan-review.ts` commands are CLI-independent (they edit `<!-- REVIEW… -->` markers in local files; `submitReviewComment` reads an author handle from Tower's overview cache but **falls back to `"architect"`** when Tower hasn't fetched yet — it never hard-requires the CLI). They are effectively `reg`-style (unguarded) registrations that predate / sit outside the helper pattern.

A repo-wide ban therefore flags four sites, not two. The plan must decide how to reconcile the two `plan-review.ts` sites — this is the one judgement call worth a gate.

## Proposed Change

Add a `no-restricted-syntax` rule to `packages/vscode/eslint.config.mjs` banning the `vscode.commands.registerCommand` member-call form, and place a visible `eslint-disable-next-line` escape hatch on each of the **four** legitimate existing call sites.

Rationale for repo-wide (not `extension.ts`-scoped):
- The whole point is to catch the *future* contributor, who may add a command in a new file, not just in `extension.ts`. Scoping to `extension.ts` would leave new modules unguarded — exactly the gap #791 is trying to close.
- The two `plan-review.ts` calls are real, intentional, unguarded registrations. Making them visible escape hatches (with a one-line justification each) is *more* honest than hiding them behind a file-scoped rule — the next reader sees "yes, these bypass the helpers, on purpose, here's why."

### Rule (added to the `rules` block in `eslint.config.mjs`)

```js
"no-restricted-syntax": ["error", {
  selector:
    "CallExpression[callee.object.object.name='vscode'][callee.object.property.name='commands'][callee.property.name='registerCommand']",
  message:
    "Use reg(...) or regCli(...) from extension.ts instead of bare vscode.commands.registerCommand — regCli adds the CLI-preflight guard (#791). If a registration legitimately can't use the helpers, add an eslint-disable-next-line with a one-line reason.",
}],
```

Note: the config's existing rules are all `"warn"`. This rule is `"error"` deliberately — a silent guard-bypass is a correctness regression, not a style nit, and the acceptance criterion is that it **fails** `pnpm lint`. (`eslint src` exits non-zero on any error; warnings alone exit 0.)

### Escape hatches (4 total)

`extension.ts` — on the two helper definitions:
```ts
// eslint-disable-next-line no-restricted-syntax -- this IS the reg helper (#791)
vscode.commands.registerCommand(id, handler);
...
// eslint-disable-next-line no-restricted-syntax -- this IS the regCli helper (#791)
vscode.commands.registerCommand(id, guard(handler));
```

`comments/plan-review.ts` — on the two existing command registrations:
```ts
// eslint-disable-next-line no-restricted-syntax -- separate module, CLI-independent review-comment command (no access to extension.ts reg/regCli)
vscode.commands.registerCommand(
  'codev.submitReviewComment',
  ...
```
(same for `codev.deleteReviewComment`).

The `--` suffix on each disable comment is ESLint's built-in description syntax, so the *reason* travels with the escape hatch.

## Files to Change

- `packages/vscode/eslint.config.mjs` — add the `no-restricted-syntax` entry to the `rules` object (~5 lines).
- `packages/vscode/src/extension.ts:484-487` — add two `eslint-disable-next-line` comments on the helper bodies.
- `packages/vscode/src/comments/plan-review.ts:119-126,128-137` — add two `eslint-disable-next-line` comments on the existing registrations.

No production logic changes. No bundle change (comments and lint config don't ship). Net diff well under 50 LOC.

## Risks & Alternatives Considered

- **Risk — selector misses aliased forms.** The selector only matches the `vscode.commands.registerCommand(...)` member-expression. A contributor who does `const { registerCommand } = vscode.commands; registerCommand(...)` is not caught. Mitigation: accepted as out of scope — that form is contrived and unidiomatic in this codebase (zero instances today); the rule targets the realistic copy-paste regression. Documented here so it's a known limit, not a surprise.
- **Risk — `error` severity could block an unrelated lint run** if there were other latent `registerCommand` calls. Mitigation: the grep above is exhaustive (4 sites, all exempted); I'll re-run `pnpm lint` after the change to confirm a clean pass.
- **Alternative — scope the rule to `extension.ts` only** (via a `files: ["**/extension.ts"]` override). Rejected: leaves new modules (and the existing `plan-review.ts`) unguarded, defeating the future-proofing goal. The acceptance criterion explicitly says "anywhere in `packages/vscode/src/`".
- **Alternative — refactor `plan-review.ts` to import shared `reg`/`regCli`.** Rejected for this issue: `reg`/`regCli` are closures inside `activate()` (they capture `isCliReady`, `guard`, `showSetupRequiredToast`). Exporting them means extracting a registrar factory — a real refactor with its own blast radius, and it would change whether those two commands become guarded (a runtime-behavior change the issue forbids). The visible escape hatch is the minimal, in-scope reconciliation. Worth a follow-up issue if we want every command funneled through the helpers.
- **Alternative — full custom ESLint rule package.** Rejected per the issue: `no-restricted-syntax` is built-in and precise enough; a custom plugin is overkill.

## Test Plan

Acceptance is verifiable purely via `pnpm lint` (no runtime/UI to exercise — this is config + comments).

- **Baseline**: `cd packages/vscode && pnpm lint` exits 0 after the change (the four exemptions keep it clean).
- **Negative test (proves the rule bites)**: temporarily add `vscode.commands.registerCommand('codev.foo', () => {});` to a `src/` file → `pnpm lint` exits non-zero with the #791 message → remove it. I'll do this transiently during implement and report the exact error output in the dev-approval summary (it will **not** be committed).
- **Positive test (proves helpers lint clean)**: temporarily add `reg('codev.foo', () => {})` → `pnpm lint` stays clean → remove it.
- **Helper sites still clean**: confirm the two `extension.ts` helpers and the two `plan-review.ts` commands produce no lint error.
- **No bundle change**: `node esbuild.js` (or `pnpm compile`) output is byte-unaffected by comments/lint config; `pnpm check-types` still passes.

Manual / cross-platform: none — no UI, no runtime path touched.
