# PIR #789 — inject file/hunk ref into builder PTY from the unified-diff editor (codelens)

## Plan phase (iteration 1)

Investigated the vscode extension. Key findings:
- `codev.viewDiff` opens VSCode's multi-file diff editor (`vscode.changes`); right side of each file is a plain `file:` URI at `<worktree>/<relpath>` — carries new-side line numbers.
- `injectArchitectText` (`terminal-manager.ts:146`) is the inject-without-Enter precedent; no builder equivalent exists yet.
- `openBuilderByRoleOrId` opens/reveals a builder terminal but returns void and resolves roleOrId → a *canonical* id that can differ from the input → terminal key mismatch risk. Plan returns the resolved id to fix this.
- Palette suppression: just don't declare the codelens-backing command in `contributes.commands`.

### Design chosen
CodeLensProvider on the right-side `file:` documents. New pure helpers (`diff-inject-ref.ts`) for hunk parsing + ref strings; provider (`diff-inject-codelens.ts`) reads a per-`viewDiff`-run registry; `viewDiff` parses one extra `git diff --unified` to populate hunk ranges; `terminal-manager` gets `injectBuilderText` + id-returning `openBuilderByRoleOrId`; `extension.ts` registers palette-hidden `codev.injectBuilderFileRef`.

### Primary risk (to validate at dev-approval gate)
CodeLenses may not render inside the `vscode.changes` multi-diff editor (document-scoped lenses + multi-diff embedding has historical gaps). Fallback if so: same provider/registry on the per-file `vscode.diff` (`openBuilderFileDiff`). This is exactly what PIR's dev-approval gate (run the worktree) is for.

Plan written to `codev/plans/789-vscode-inject-file-hunk-refere.md`, committed. Awaiting `plan-approval`.
