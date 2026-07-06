# Builder thread — pir-1139

Issue #1139: vscode Backlog "Reference issue in architect" ignores QuickPick selection (always injects into main).

## Plan phase

- Verified the issue's root-cause analysis against source: `openArchitectTerminal` (extension.ts:751) resolves arg → picker → 'main' into a local `targetName` and discards it; both reference commands (extension.ts:1019, :1034) then call `injectArchitectText(text)` with no name, which defaults to 'main' (terminal-manager.ts:146, a Spec 786 Phase 6 decision that predates the 841 Gap 2 picker).
- Confirmed the `reg` helper passes handler return values through to `registerCommand`, so returning the resolved name from the command needs no extra plumbing.
- Audited every invoker of `codev.openArchitectTerminal`: only the two reference commands use `executeCommand`; sidebar rows / builders group header / command-relay pass explicit names or ignore the return. Returning a value is additive.
- Plan written to `codev/plans/1139-vscode-backlog-reference-issue.md`. Approach = the issue's fix sketch: return resolved name from `openArchitectTerminal`, thread it into `injectArchitectText` in both reference commands, skip injection on undefined (picker cancel), docstring cleanup in terminal-manager.ts, update the sentinel test that codified the old "always main" behavior.
- Sitting at `plan-approval` gate.
