# PIR #1053 — Consultation Rebuttals (iteration 1)

Single advisory pass (`max_iterations: 1`). Disposition of each verdict below.

## Codex — REQUEST_CHANGES (HIGH) → ADDRESSED (real defect, fixed)

**Finding:** Typography was scoped to `.codev-artifact-canvas-body` (and base font tokens to
`.codev-artifact-canvas`), but the exported standalone `MarkdownView` renders
`.codev-artifact-canvas-rendered` with no `.codev-artifact-canvas` ancestor — so the standalone
public surface received no typography tokens or prose rules. This contradicts the approved plan,
which required the rules to cover both containers.

**Assessment:** Valid and HIGH-impact. Verified the facts directly:
- `MarkdownView` is exported from the package's public `index.ts`.
- It renders a bare `.codev-artifact-canvas-rendered` root (`renderer/MarkdownView.tsx:16-21`),
  not nested under `.codev-artifact-canvas`.
- The tokens + base font were declared only on `.codev-artifact-canvas`, which is **not** an
  ancestor of `-rendered`, so the standalone surface inherited neither.
- My own approved plan explicitly stated the rules must cover both containers.

So it ships a known-broken public surface and diverges from the plan. Treated as a real defect and
fixed (not rebutted).

**Fix (commit `[PIR #1053] Cover standalone MarkdownView surface with typography (consult fix)`):**
- The token vocabulary + base `color`/`background`/`font-family`/`font-size`/`line-height` now
  apply to **both** `.codev-artifact-canvas` and `.codev-artifact-canvas-rendered`.
- Every prose element rule now uses an `:is(.codev-artifact-canvas-body,
  .codev-artifact-canvas-rendered)` container group (kept DRY with `:is()` rather than duplicating
  every selector).
- Overlay-only chrome stays composed-surface-only: the gutter `padding-left`, the
  `[data-line]:focus-visible` outline, the comment cards, and the minimap remain
  `.codev-artifact-canvas-body` / `.codev-artifact-canvas` scoped (MarkdownView has no overlay).
- `position: relative` (overlay anchor) split out to `.codev-artifact-canvas` only.

**Regression test** (`src/__tests__/default-theme.test.ts` → "covers the standalone MarkdownView
root, not just the composed canvas"): asserts (1) the token/base-font block names the standalone
root, (2) representative prose selectors (`h1`, `code`) name it via the `:is()` group, and (3) the
gutter `padding-left` rule stays bare-`-body` (composed-surface-only). Fails if a future change
drops the standalone root from prose styling or leaks the gutter into the standalone surface.

**No regression to the shipped consumer:** the VSCode preview uses `ArtifactCanvas` →
`.codev-artifact-canvas-body`, which is inside the `:is()` group, so its rendering is unchanged.
Verified the `:is()` selectors land in the bundled `dist/webview/markdown-preview.css`.

**Escalation:** PIR's single advisory pass does not independently re-review this fix, so it is
flagged to the human at the `pr` gate as the remaining reviewer.

## Claude — APPROVE (HIGH) → no action required (but corroborates the Codex fix)

Approved overall. It flagged the *same* `MarkdownView` scoping gap as a non-blocking observation.
Its parenthetical that the standalone view "gets the font baseline" anyway is factually incorrect —
the base font is declared on `.codev-artifact-canvas`, which is not an ancestor of
`.codev-artifact-canvas-rendered` — which is exactly why the gap was worth fixing rather than
accepting. The fix above resolves the observation. All other points (plan adherence, code quality,
test coverage, review-file quality) were positive; nothing to action.

## Gemini — no usable verdict → nothing to action

The Gemini output was a sandbox/environment status message, not a review (no `VERDICT` line, no
findings). Porch defaulted it to REQUEST_CHANGES because no `APPROVE` token was present, but there
is no substantive feedback to address. The consultation harness produced no review content for
this model on this run.

## Net

The one substantive finding (Codex, corroborated by Claude) is a real defect and is fixed with a
regression test. No outstanding REQUEST_CHANGES content remains unaddressed. The human at the `pr`
gate is the remaining reviewer of the fix (PIR single-pass).
