# Builder thread — pir-1139

Issue #1139: vscode Backlog "Reference issue in architect" ignores QuickPick selection (always injects into main).

## Plan phase

- Verified the issue's root-cause analysis against source: `openArchitectTerminal` (extension.ts:751) resolves arg → picker → 'main' into a local `targetName` and discards it; both reference commands (extension.ts:1019, :1034) then call `injectArchitectText(text)` with no name, which defaults to 'main' (terminal-manager.ts:146, a Spec 786 Phase 6 decision that predates the 841 Gap 2 picker).
- Confirmed the `reg` helper passes handler return values through to `registerCommand`, so returning the resolved name from the command needs no extra plumbing.
- Audited every invoker of `codev.openArchitectTerminal`: only the two reference commands use `executeCommand`; sidebar rows / builders group header / command-relay pass explicit names or ignore the return. Returning a value is additive.
- Plan written to `codev/plans/1139-vscode-backlog-reference-issue.md`. Approach = the issue's fix sketch: return resolved name from `openArchitectTerminal`, thread it into `injectArchitectText` in both reference commands, skip injection on undefined (picker cancel), docstring cleanup in terminal-manager.ts, update the sentinel test that codified the old "always main" behavior.
- Sitting at `plan-approval` gate.
- Gate approved 2026-07-07.

## Implement phase

- Applied the plan as written (commit 2e0ca369): `openArchitectTerminal` returns the resolved name (undefined on every early-out incl. picker dismissal), both reference commands capture it via `executeCommand<string | undefined>` and pass it to `injectArchitectText`, early-return on undefined; terminal-manager docstring corrected.
- Replaced the sentinel test that codified the old "no name → main" behavior; added return-contract, pass-through, and cancel-path sentinels in both test files.
- Worktree gotcha for siblings: `codev-vscode` has no `build` script; use `pnpm compile`. Fresh worktree also needs `pnpm --filter @cluesmith/codev-types --filter @cluesmith/codev-core build` once or 14 vitest files fail at import resolution.
- `pnpm compile` green; `pnpm test:unit` green (47 files, 547 tests).
- Sitting at `dev-approval` gate.
- Gate approved 2026-07-08 after a side discussion on scope (fix covers both reference-injection surfaces: Backlog + PR sidebar) and the `return undefined` idiom (matches the codebase's consistent-return style in value-returning functions).

## Review phase

- Review file written; one COLD lesson routed to lessons-learned.md Architecture ("interactive resolution added in front of a defaulting API must return the resolution; audit consumers of the default"). No arch.md changes (command wiring only).
- PR #1157 opened, recorded with porch.
- Consultation (single advisory pass; porch's verify block ran a 2-way claude+codex per this project's config): claude=APPROVE; codex=REQUEST_CHANGES with (1) plan frontmatter missing, rebutted (rule targets pre-spawn architect artifacts; PIR plan approval is porch state; 'validated' would be false for a human-only phase) and (2) How-to-Test lacked extension-load steps, accepted and fixed in bd0dc4dc (Extension Dev Host / vsix instructions), PR body re-synced. Rebuttal file in codev/projects/1139-*/1139-review-iter1-rebuttals.md.
- Architect notified with the REQUEST_CHANGES dispositions. Sitting at `pr` gate.
