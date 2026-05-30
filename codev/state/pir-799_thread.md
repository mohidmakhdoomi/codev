# PIR #799 — vscode: builder changed-file rows render grey instead of SCM colors

## Builder thread (pir-799)

### Plan phase — opening

Key discovery on first investigation: **the fix described in the issue body was already implemented and shipped.**

- Commit `0301b7fa "Fix #799: use custom scheme for builder changed-file resourceUri"` already switched `builderFileResourceUri` to the custom `codev-builder-diff:` scheme (v3.1.4).
- Registration (`extension.ts:267`), cache keying (`resourcePath === c.path`, so tree-item URI and decoration map key match), and `onDidChangeDecorations` firing are all correct on paper. Unit tests in `builder-file-tree-item.test.ts` pass — but they only assert URI *shapes* and cache lookups, never actual *rendering*.
- The architect **reopened** the issue (2026-05-29) confirming via fresh screenshot that rows are STILL grey. So the custom-scheme theory in the issue body did NOT solve the visible bug.

Conclusion: the issue body's root-cause analysis is wrong or incomplete. This is now a genuine multi-hypothesis investigation — and a guess-fix already failed once, so the next fix must be confirmed on the *running* extension (exactly why PIR/dev-approval gate fits).

Central open question: when a custom TreeView TreeItem's `resourceUri` uses a NON-`file` scheme, does VSCode apply the FileDecorationProvider's `color` to the label, or only the badge?

Launched a 3-lens parallel investigation workflow (run `wf_7b1f578b-c4b`):
1. VSCode rendering semantics (does label color apply for non-file schemes? authoritative, from vscode source).
2. Code-path audit (timing/race/keying defects unit tests miss).
3. Alternative hypotheses + a definitive live diagnostic for the dev-approval gate.

### Investigation result (workflow wf_7b1f578b-c4b, 4 agents)

The two lead lenses disagreed; synthesis reconciled it decisively:

- **Falsified**: "VSCode doesn't invoke FileDecorationProvider for custom schemes." The badge (`A`/`M`/`D`) and the color come from the **same** `provideFileDecoration` return, rendered as two independent CSS classes (`badgeClassName`, `labelClassName`) in vscode `labels.ts`. A visible badge proves the provider IS invoked for `codev-builder-diff:` and the decoration reaches the renderer. `decorationsService.getDecoration` is scheme-agnostic — no layer inspects the scheme.
- **Therefore**: the prior custom-scheme fix could never have changed the label *color*. It correctly stopped the Git decorator from competing (a real, separate win), but the remaining grey is a **color-value** defect, masked by the first.
- **Root cause (medium confidence)**: `builder-file-decoration.ts:18-26` reuses `gitDecoration.*ResourceForeground` tokens, but `package.json` ships **no `contributes.colors`** (confirmed: contributes keys = commands/menus/snippets/keybindings/viewsContainers/views/configuration). We depend on tokens we don't own resolving to a saturated value in every theme — they resolve near-foreground/grey.

**Recommended fix**: KEEP the custom scheme (reverting re-introduces the intermittent Git-ignored grey). REPLACE borrowed tokens with first-class `contributes.colors` (`codev.builderDiff.*Foreground`) with saturated light/dark/highContrast defaults; point the DECO map at them. Robust to both "token undefined" and "token resolves near-foreground".

**PIR fit**: confidence is medium and unit tests can't render — so the plan is **diagnostic-first at the dev-approval gate**: hard-code a bright color + log provideFileDecoration, reload the Extension Dev Host, confirm rows turn red (→ value problem, our fix works) vs stay grey (→ fallback: check `explorer.decorations.colors`, CSS specificity via DevTools, or iconPath approach). The human runs the extension before any PR exists — exactly why PIR was chosen.

Writing the plan now.
