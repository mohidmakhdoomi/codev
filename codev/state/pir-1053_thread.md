# PIR #1053 — typography tokens for the Codev Markdown Preview (artifact canvas)

## Plan phase (in progress)

Investigated the codebase:
- `packages/artifact-canvas/src/styles/default-theme.css` — ships 8 color-only `--codev-canvas-*` tokens. Prose elements inherit everything else.
- `packages/artifact-canvas/src/types.ts` — D4 "locked public contract" comment; contract to amend.
- `packages/vscode/src/markdown-preview/preview-template.ts` — inline `<style>` binds the 8 color tokens to `--vscode-*`. This is the tier-2 host-mapping seam.
- VSCode preview mounts `<ArtifactCanvas>` (webview/main.ts), whose prose lives under `.codev-artifact-canvas-body`. CSS prose rules must target that container's descendants.
- Rendered prose elements: h1-h6, p, ul/ol/li, blockquote, pre, code, table (markdown-it output, sanitized).

Key plan-gate decisions captured in the plan: final token list, heading granularity (per-level vs scale+ratio), github-markdown-css version pin, prose-max-width default, tier-3 scope.

Writing plan to `codev/plans/1053-vscode-typography-tokens-for-t.md`.

## Plan approved (silent on the 5 decisions) → proceeded with recommendations.

Locked: 21-token vocabulary (8 color + 13 typography), per-level heading tokens (h1-h6,
github's non-geometric scale can't be a single ratio), github-markdown-css v5.8.1 pin,
`prose-max-width: none` default, Tier 3 included (2 settings, low-risk).

## Implement phase — done, awaiting dev-approval

- `default-theme.css`: +13 typography tokens with github v5.8.1 defaults + prose/heading/code
  CSS rules scoped to `.codev-artifact-canvas-body` (chrome untouched).
- `types.ts`: D4 contract amendment comment (#1053 doc trail).
- `README.md`: typography token table + baseline pin (doc trail).
- `default-theme.test.ts` (new): inline-snapshot of the 21-token list + non-empty + default
  assertions.
- `preview-template.ts` (Tier 2): code-font-family → editor font; prose keeps the sans stack
  (documented why); Tier-3 user overrides emitted into the host `<style>`.
  Gotcha: backticks inside the CSS comment broke the surrounding template literal — removed them.
- `preview-provider.ts` + `package.json` (Tier 3): `codev.markdownPreview.fontSize` /
  `.lineHeight` settings, read in renderHtml, live-reflow via onDidChangeConfiguration.

Tests: canvas 54/54, vscode 442/442 unit; both typechecks + esbuild bundle clean. Verified the
new tokens + prose rules land in the bundled `dist/webview/markdown-preview.css`.
(Had to build codev-core + codev-types first — they weren't built in the fresh worktree; the
resolution errors were environmental, not from my diff.)

## dev-approval gate — reviewer Q&A

Reviewer probed the Tier-3 plumbing (config listener, buildUserTypographyOverrides): all of it
exists only to make the two `codev.markdownPreview.*` settings reflow live. Reviewer confirmed
Tier 3 is "essential" → KEEP it. Settings are controlled via VSCode's standard Settings editor /
settings.json only (no in-preview UI).
- Per reviewer: documented the two settings in `packages/vscode/README.md` Settings table.
- Per reviewer: filed #1070 (area/vscode) for an in-preview zoom control affordance + write-back
  (the UI piece, deliberately out of scope here; tokens + settings already shipped by #1053).

## dev-approval round 2 — element styling + dark-mode contrast fix

Reviewer flagged poor inline-code contrast in dark mode. Root cause: `code` had a background
token but NO foreground token, so its text fell through to the body foreground — and the host
paired `textCodeBlock.background` (a code-BLOCK token) with the general foreground (a different
theme color group), which pairs poorly in dark themes. Reviewer: "must fix properly now, what
other rules / styling issues still need to be handled" → did a full element pass.

Fixes (now 22 tokens: +`--codev-canvas-code-foreground`):
- New `--codev-canvas-code-foreground` color token; host binds inline code to VSCode's
  `textPreformat-foreground/background` pair (theme-tuned to contrast each other).
- Inline `code`: chip padding + radius + its own fg/bg.
- `pre`: padding, border, radius, overflow:auto. `pre code` resets the chip chrome INCLUDING
  font-size (was compounding 0.85em × 0.85em ≈ 72%).
- `blockquote` (muted + left rule), tables (collapsed borders, zebra, scrollable), `hr`
  (hairline), `img` (max-width:100%), list indent (2em).
- Doc trail updated: README color table + binding example, types.ts contract comment.
- New test: inline-code-foreground token present.

Tests: canvas 55/55, vscode 442/442; typechecks + bundle clean; verified new rules land in
bundled webview CSS.

## dev-approval round 3 — horizontal scroll

Reviewer asked how line wrapping works / why a horizontal scrollbar sometimes appears. Two kinds:
(1) intentional per-block scroll on `pre` (long code lines) + `table` (wide tables) via their own
`overflow:auto` — correct, github-style; (2) the bug: prose had no rule to break a long
UNbreakable token (long inline-code span, URL, file path), so it overflowed the column and forced
a PAGE-level scrollbar. Fix: `overflow-wrap: break-word` on `.codev-artifact-canvas-body`
(github-markdown-css's own approach); `pre`/`table` opt out by design. Verified in both bundles.

## Review phase — PR #1071 open, 3-way consult running

dev-approval approved. Wrote `codev/reviews/1053-vscode-typography-tokens-for-t.md` (Summary +
Architecture Updates [none — extends existing canvas theming seam] + 3 UI/UX lessons added to
COLD lessons-learned.md: bg-without-fg contrast bug, prose-vs-code overflow split, em-on-em
compounding). PR #1071 opened with review as body, recorded via `porch done --pr 1071`.
Checks passed. 3-way consult (gemini/codex/claude, type=impl, single advisory pass) running in
background. Then notify architect + wait at `pr` gate.

## Consult results + fix

- Codex: REQUEST_CHANGES (HIGH) — typography scoped to `.codev-artifact-canvas-body` only, but
  exported `MarkdownView` renders `.codev-artifact-canvas-rendered` (no `.codev-artifact-canvas`
  ancestor) → standalone surface got NO typography. Contradicts the approved plan (both containers
  required). REAL defect.
- Claude: APPROVE (HIGH) but flagged the SAME gap as non-blocking; its "standalone still gets the
  base font" aside is factually wrong (base font is on `.codev-artifact-canvas`, not an ancestor
  of `-rendered`).
- Gemini: no usable verdict (sandbox/env message, no VERDICT line).

Both substantive reviewers found the same issue → fixed (not rebutted). Token+base-font block
now names both roots; all prose rules use `:is(.codev-artifact-canvas-body,
.codev-artifact-canvas-rendered)`; overlay chrome (gutter/focus/cards/minimap) stays body-only.
Added regression test asserting standalone root is covered + gutter stays body-only. Used `:is()`
to keep it DRY. canvas 56/56, vscode 442/442, typechecks+bundle clean; verified `:is()` selectors
land in bundled webview CSS. VSCode preview (uses ArtifactCanvas→`-body`, inside the `:is()`
group) unaffected. Recorded disposition in review "Things to Look At". Escalating Codex finding to
architect at pr gate (PIR won't re-review).
