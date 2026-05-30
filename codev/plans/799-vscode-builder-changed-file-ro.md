# PIR Plan: Builder changed-file rows render grey instead of SCM colors (#799)

## Understanding

Builder changed-file rows in the VSCode Builders view (list and tree mode) render
their filenames in flat grey instead of SCM colors — Added should be green,
Modified yellow, Deleted red. The `A`/`M`/`D` status badge on the right still
renders correctly; only the label *color* is missing.

**Critical context the issue body did not have: the issue's own "proposed fix"
was already implemented and shipped, and it did not work.**

- Commit `0301b7fa "Fix #799: use custom scheme for builder changed-file
  resourceUri"` switched `builderFileResourceUri` to the custom
  `codev-builder-diff:` scheme (`builder-file-tree-item.ts:43-45`), shipped in
  v3.1.4.
- The architect **reopened** the issue on 2026-05-29, confirming via a fresh
  screenshot that rows are **still grey** — the fix is present in the bundled
  code but the user-visible behavior is unchanged.

So the issue body's root-cause theory ("the built-in Git decorator wins the
color merge on the `file:` URI") is wrong, or at best a second-order effect. We
re-investigated from scratch (3-lens parallel investigation + adversarial
synthesis, run `wf_7b1f578b-c4b`).

### Root cause

VSCode's tree-label color pipeline is **entirely scheme-agnostic**. No layer
(`treeView.ts` `TreeRenderer`, `labels.ts`, `decorationsService.getDecoration`)
inspects the URI scheme when deciding the label color. The badge and the color
are derived from the **same** `FileDecoration` returned by
`provideFileDecoration`, and applied as **two independent CSS classes**
(`badgeClassName` for the badge, `labelClassName` for the color), each gated only
on the sibling booleans of the `explorer.decorations` setting (both default
`true`).

The decisive evidence is the **badge-yes / color-no symptom**: because the badge
renders, our provider *is* being invoked for the `codev-builder-diff:` scheme,
the decoration *does* reach the label renderer, and the color path *is*
reachable. The only variable left that can be wrong is the **color value**.

`BuilderFileDecorationProvider` (`builder-file-decoration.ts:18-26`) sets each
status color to a borrowed `gitDecoration.*ResourceForeground` ThemeColor token,
but the extension's `package.json` ships **no `contributes.colors` block**
(confirmed: `contributes` keys are `commands, menus, snippets, keybindings,
viewsContainers, views, configuration` — no `colors`). We depend on theme tokens
we do not own resolving to a saturated, distinguishable value in the user's
active theme. They instead resolve to something at or near the default tree-label
foreground → grey.

This explains **both** the original intermittent grey (when the Git decorator was
also firing on the `file:` URI and could win the merge) **and** the persistent
grey after the scheme swap (Git no longer fires, but our own color token still
resolves near-foreground). The scheme swap fixed a real but *different* defect
and left the color-value defect untouched.

This is a `medium`-confidence diagnosis. It is robust to the two most likely
failure modes of the borrowed token (undefined, or resolving near-foreground),
but unit tests cannot render labels or resolve theme tokens, so it **must be
confirmed on the running extension** before we commit. That confirmation is the
`dev-approval` gate's job — and is exactly why this is a PIR.

### Why the prior unit tests passed while the bug shipped

`builder-file-tree-item.test.ts` asserts only URI *shapes* (scheme is non-`file`)
and cache lookups. It never asserts the decoration carries a color, and cannot
observe rendering. It passed while the color stayed broken.

## Proposed Change

**Diagnostic-first, then fix.** Because a guess-fix already shipped and failed,
the implement phase opens with a live A/B diagnostic the human verifies at the
`dev-approval` gate, *then* lands the fix.

### Step 0 — Live diagnostic (confirm root cause before committing the fix)

Temporary instrumentation, reverted before PR:

1. In `provideFileDecoration`, hard-code a maximally-saturated, definitely-defined
   color for **all** statuses: `color: new vscode.ThemeColor('charts.red')` (or
   `'errorForeground'`).
2. Add `console.log(uri.toString(), uri.scheme, this.cache.decorationFor(uri))`
   at the top of `provideFileDecoration`.
3. `pnpm --filter @cluesmith/codev compile`, launch the Extension Development
   Host (F5 / "Run Extension"), open a workspace with a spawned builder worktree,
   **reload the window** (FileDecoration color caching can require a reload —
   microsoft/vscode#209907), expand a builder, look at the rows.

Interpretation:
- **Rows turn red** → the scheme, provider invocation, `explorer.decorations.colors`,
  and the color CSS path are all healthy; the only defect was the borrowed
  `gitDecoration.*` tokens resolving near-foreground. **Root cause confirmed** →
  proceed to Step 1.
- **Rows stay grey** → the color CSS class is not being applied at all (value was
  never the issue). Switch to the fallback path (Risks section).
- The `console.log` independently confirms the provider fires once per row for the
  custom scheme (re-falsifying the "provider not invoked for custom scheme"
  hypothesis live).

### Step 1 — The fix (most-likely branch): own the colors

Keep the custom `codev-builder-diff:` scheme (it correctly and permanently stops
the built-in Git decorator from firing on the gitignored worktree paths;
reverting to `file:` would regress to the intermittent Git-ignored grey). Stop
borrowing `gitDecoration.*` tokens; register first-class, self-owned colors so the
tint is deterministic and theme-independent.

1. Add a `contributes.colors` array to `packages/vscode/package.json` with one
   entry per status:
   - `codev.builderDiff.addedForeground`
   - `codev.builderDiff.modifiedForeground`
   - `codev.builderDiff.deletedForeground`
   - `codev.builderDiff.renamedForeground` (also used for Copied)
   - `codev.builderDiff.conflictingForeground` (Unmerged)

   Each with an explicit `defaults` block for `light`, `dark`, and
   `highContrast`, seeded from the Git extension's known-saturated values so they
   never collapse to foreground (added ≈ `#587c0c`/`#81b88b`, modified ≈
   `#895503`/`#e2c08d`, deleted ≈ `#ad0707`/`#c74e39`, renamed/copied ≈ the
   "modified/added" family, conflicting ≈ `#6c6cc4`/`#e4676b`). Final exact hexes
   chosen during implementation to match VSCode's current Git defaults.

2. In `builder-file-decoration.ts`, change the `DECO` map's `color` strings from
   `gitDecoration.*ResourceForeground` to the new `codev.builderDiff.*Foreground`
   ids. No other logic changes — `new vscode.ThemeColor(d.color)` already wraps
   whatever id is supplied. `T` (type-changed) keeps mapping to the modified
   token; `C` (copied) keeps mapping to the renamed token.

3. Add regression tests (see Test Plan).

4. Bump version + add an *unreleased* VSCode CHANGELOG entry **only after** the
   live diagnostic confirms color renders. (The reopen comment removed the prior
   premature CHANGELOG entry; do not re-add until genuinely confirmed.)

### What this does NOT touch (already correct)

- Cache keying — `decorationFor`/`syncDecorations` both key by `uri.toString()`
  via the shared `builderFileResourceUri` helper; the tree-item URI and the
  decoration-map key match exactly. (`builder-diff-cache.ts:56,103,108`)
- Provider registration — exactly one `registerFileDecorationProvider` at
  `extension.ts:267`; no competing Codev provider exists.
- The custom scheme itself — kept.

## Files to Change

- `packages/vscode/src/views/builder-file-decoration.ts:18-26` — repoint the
  `DECO` map `color` values from `gitDecoration.*ResourceForeground` to the new
  `codev.builderDiff.*Foreground` token ids. (Step 0 also temporarily edits
  `provideFileDecoration` at `:35-46` for the diagnostic; reverted before PR.)
- `packages/vscode/package.json` — add a `contributes.colors` array (new key) with
  the five `codev.builderDiff.*Foreground` color definitions + light/dark/highContrast
  defaults. Version bump after confirmation.
- `packages/vscode/src/test/builder-file-tree-item.test.ts` (or a new
  `builder-file-decoration.test.ts`) — add tests asserting the decoration *content*
  (color id + badge), plus a `package.json` contract test (every DECO color id is
  declared in `contributes.colors`).
- `packages/vscode/CHANGELOG.md` (or the worktrees changelog path used for the
  VSCode extension) — unreleased entry, added last, only after live confirmation.

## Risks & Alternatives Considered

- **Risk: diagnostic shows rows stay grey even with a hard-coded bright color.**
  Then the color CSS class is not applied at all and `contributes.colors` won't
  help. Fallback, in order: (a) verify `explorer.decorations.colors` is `true` in
  the test profile (it gates the color class independently of badges; if a profile
  disabled it, badges show but colors never do — that's a config/UX issue, not a
  code bug); (b) open Developer Tools, inspect the row label DOM — is the decoration
  color class *absent* (would contradict the badge → unlikely) or *present-but-
  overridden* by a higher-specificity rule (TreeView selection/focus foreground, or
  a custom-view label foreground)? If overridden, the fix shifts to CSS specificity;
  (c) last resort — encode status via a colored `ThemeIcon`/`iconPath` glyph on the
  TreeItem (rendered through a more deterministic path), accepting the loss of the
  SCM-label look.

- **Risk: the borrowed `gitDecoration.*` tokens are actually defined (the built-in
  Git extension is usually active).** True — so "undefined token" is not certain.
  But our own `contributes.colors` with saturated explicit defaults is robust
  *regardless* of whether the cause is "undefined" or "resolves near-foreground":
  no theme overrides our `codev.builderDiff.*` ids, so our saturated defaults
  always win. The diagnostic disambiguates which it was, but the fix covers both.

- **Alternative: revert to the `file:` scheme.** Rejected. The scheme swap was a
  genuine, separate win (stops the intermittent Git-ignored-grey on the gitignored
  worktree path). Reverting re-introduces that bug to fix nothing — the color
  pipeline is scheme-agnostic, so `file:` would not restore color either.

- **Alternative: add a second FileDecorationProvider / change cache keying.**
  Rejected. Both are already correct; the synthesis explicitly ruled out a
  colorless-provider-wins-merge race (single provider) and a cache key mismatch.

- **Risk noted in the original issue: third-party extensions that filter
  `resourceUri.scheme === 'file'` skip our rows.** Unchanged by this plan (we keep
  the custom scheme); built-in `revealFileInOS`/`copyFilePath` accept the fsPath
  regardless, so the right-click menu stays intact.

## Test Plan

The `dev-approval` gate is the real verification — unit tests cannot render labels
or resolve theme tokens.

### Manual (at the dev-approval gate — the killer move)

1. `pnpm --filter @cluesmith/codev compile` in the worktree.
2. Launch the Extension Development Host (F5 "Run Extension", or install the built
   `.vsix`). Open a workspace that has at least one spawned builder worktree with
   Added, Modified, and Deleted files.
3. **Reload the window** (Developer: Reload Window) — FileDecoration color caching
   can require a reload.
4. Expand a builder row in the Builders view. Confirm in **both list and tree
   mode**:
   - Added file label is green, Modified is yellow, Deleted is red (badges
     unchanged).
   - Try a light theme, a dark theme, and a high-contrast theme — colors stay
     distinguishable in all three.
5. Run the Step 0 diagnostic first if there is any doubt the fix took effect.

### Unit / contract (regression guards)

- Assert decoration **content**: instantiate `BuilderFileDecorationProvider` with a
  seeded cache, call `provideFileDecoration` per status, assert the returned
  decoration carries a defined `color` whose `ThemeColor` id is the expected
  `codev.builderDiff.*` token (not a borrowed `gitDecoration.*` one) and a
  non-empty badge. This would have caught the original "borrowed-token" defect that
  the shape-only tests missed.
- `package.json` contract test: parse `contributes.colors`, assert every color id
  referenced by the `DECO` map is declared with `light`/`dark`/`highContrast`
  defaults.

### Optional (rendering-layer smoke)

- If feasible per `codev/resources/testing-guide.md`, a VSCode integration /
  Playwright test that launches the extension against a fixture worktree and reads
  the computed label color, asserting it is the contributed status color and not
  the default tree foreground. This is the only layer that can actually observe the
  grey-vs-colored regression.
