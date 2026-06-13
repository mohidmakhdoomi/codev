# PIR Review: Review comments from a rendered Markdown Preview (VSCode + artifact-canvas)

Fixes #859

## Summary

Adds **Codev Markdown Preview** — a VSCode custom editor that renders a spec/plan/review in the
shared `@cluesmith/codev-artifact-canvas` React surface and lets a reviewer add inline review
comments by hovering a block and clicking `+`, with no drop to the raw `.md` editor. It is the
first host integration of the artifact-canvas package. The on-disk `<!-- REVIEW(@author): text -->`
convention is centralized in a new `@cluesmith/codev-core/review-markers` codec shared by both the
new preview and the existing editor Comments-API path. Mid-implement (architect-directed), the work
also fixed marker rendering at its source in the package: the renderer now strips full-line HTML
comments before parsing (fixes #1036 and the multi-line-paragraph split) and runs with `html: true`
+ DOMPurify as the sole guard (#1042, amends spec-945 D7) so safe static HTML renders.

## Files Changed

`git diff --stat main...HEAD` (code + artifacts; excludes porch chore commits and the builder thread):

- `packages/artifact-canvas/src/renderer/renderer.ts` (+86 / −) — strip comments pre-parse + line map; `html:true`
- `packages/artifact-canvas/src/renderer/__tests__/data-line.test.ts` (+45) — strip/no-split/line-map/fence
- `packages/artifact-canvas/src/renderer/__tests__/sanitization.test.ts` (+35 / −) — D7 policy flip
- `packages/core/src/review-markers.ts` (new, +114) — shared marker codec
- `packages/core/src/__tests__/review-markers.test.ts` (new, +98)
- `packages/core/package.json` (+4) — `./review-markers` subpath export
- `packages/vscode/src/markdown-preview/preview-provider.ts` (new, +116) — CustomTextEditor + bridge
- `packages/vscode/src/markdown-preview/preview-template.ts` (new, +69) — webview HTML
- `packages/vscode/src/markdown-preview/webview/main.ts` (new, +91) — React webview entry
- `packages/vscode/src/markdown-preview/webview/webview-env.d.ts` (new, +4) — `declare module '*.css'`
- `packages/vscode/src/comments/plan-review.ts` (+30 / −) — editor path shares the codec
- `packages/vscode/src/commands/view-artifact.ts` (+11 / −) — sidebar View → preview
- `packages/vscode/src/extension.ts` (+29) — register provider + `codev.openMarkdownPreview`
- `packages/vscode/esbuild.js` (+70 / −) — second browser/IIFE webview bundle
- `packages/vscode/package.json` (+38 / −) — customEditors, command/menus, deps, check-types
- `packages/vscode/tsconfig.json` (±) — exclude webview dir from host typecheck
- `packages/vscode/tsconfig.webview.json` (new, +16) — webview typecheck (DOM libs)
- `codev/plans/859-…md`, `codev/resources/arch.md`, `codev/resources/lessons-learned.md` — docs

## Commits

`git log main..HEAD --oneline` (non-chore):

- `9415edbe` Scope custom editor to codev artifacts; type-check the webview bundle
- `03a0dbfd` Extract Markdown Preview webview HTML into preview-template.ts
- `9e37063a` core: stacked comments on one block all anchor to that block
- `c66e4082` Renderer owns marker hiding: drop core stripMarkersForRender, host sends raw text
- `443f9d28` artifact-canvas: strip comments pre-parse (fix #1036/split) + html:true (#1042)
- `75246957` Sidebar View Review File also opens in the Markdown Preview
- `81284b99` Sidebar View Spec/Plan File opens in the Markdown Preview
- `96ee1d99` Fix title icon theming: light/dark codev variants (was black in dark mode)
- `68aa3fb4` Use Codev icon for the Open Markdown Preview title button
- `4e91d0f2` Rename surface to 'Codev Markdown Preview'
- `53702239` vscode: Codev Review Preview custom editor on artifact-canvas
- `253d4c81` vscode: editor review path shares the core marker codec
- `a8080a30` core: shared review-marker codec
- (+ plan/re-plan and thread commits)

## Test Results

- Build: ✓ `core` (tsc), `artifact-canvas` (tsup), `vscode` (`check-types` host + webview, `lint`, 2 esbuild bundles) all pass.
- Tests: ✓ `core` 29 · `artifact-canvas` 39 · `vscode` 395. New: the `core/review-markers` suite (serialize/parse/strip-gating/stacking/round-trip) and the `artifact-canvas` renderer additions (comment-strip, no-split, line-map, fence-exclusion, D7 policy flip).
- Manual verification (human, `dev-approval` gate, Extension Development Host): rendered preview opens for codev artifacts; hover `+` → InputBox → marker written + re-rendered; multi-line paragraph no longer splits; raw HTML renders (img/details), scripts stripped; sidebar View Spec/Plan/Review open in the preview; dark-mode title icon correct; multiple comments on one block all render.

## Architecture Updates

Routed to **COLD** (`codev/resources/arch.md`, "VS Code Extension → Key Design Decisions"), not HOT:
the HOT tier is at its 10-fact cap with more foundational facts, and this is subsystem-scoped. Added
a "Markdown Preview / artifact-canvas host integration (#859)" entry capturing the CustomTextEditor +
first-bundled-webview pattern and the two cross-cutting invariants it established: (1) the on-disk
REVIEW-marker convention lives in `@cluesmith/codev-core/review-markers` (shared by every host), and
(2) the canvas renderer is `html:true` + DOMPurify (sole guard, #1042/D7) and strips full-line HTML
comments pre-parse with a line map (#1036).

## Lessons Learned Updates

Routed to **COLD** (`codev/resources/lessons-learned.md`, "UI/UX"): three entries —
(1) VS Code's built-in markdown preview has no preview→host message channel for contributed scripts
(so render in an owned webview, don't extend the built-in preview); (2) editor/title command icons
given as an SVG file path render with no color context (`currentColor` → black), so supply
`{light,dark}` variants; (3) hide a source-embedded annotation by *removing* its line pre-parse
(with a line map), not by blanking it, or a blank line splits the multi-line block.

## Things to Look At During PR Review

- **Scope expansion + spec amendment.** This grew beyond the approved vscode-only plan into the
  shared `artifact-canvas` package and **amends spec-945's D7** (`html:false` → `html:true` +
  DOMPurify). This was architect-directed mid-implement; recorded in the plan addendum, #1042, and
  arch.md. The closed spec-945 file is intentionally not rewritten. Worth a careful look at the
  security posture: DOMPurify is now the *sole* raw-HTML guard (plus the webview's nonce CSP).
- **Renderer comment-strip + line map** (`renderer.ts`): the cleaned→original `lineMap` threaded via
  markdown-it `env` is the load-bearing bit for correct `data-line` after stripping. Fence-awareness
  prevents stripping comment lines inside code blocks. Indented (4-space) code blocks are not
  fence-tracked — an HTML-comment line inside one could be stripped (rare; noted as a v1 edge).
- **Marker anchoring convention** (`core/review-markers.ts`): a marker anchors to the nearest
  non-marker line above it (so stacked comments group on one block). Known boundary: an
  editor-authored comment deep inside a multi-line block anchors to a mid-block line with no
  `data-line`, so it won't render in the canvas (canvas-authored comments always target the block
  start, so they never hit this). Richer anchoring is deferred to #863.
- **Webview is bundled, not inlined** (`esbuild.js` second entry) — first of its kind in the
  extension; the extension-host bundle stays React-free (the webview entry isn't imported by host code).

## How to Test Locally

- **View diff**: VSCode sidebar → right-click builder `pir-859` → **Review Diff**.
- **Run it**: open `.builders/pir-859` in VSCode → **F5** ("Run Codev Extension") → Extension Development Host.
- **What to verify** (maps to the plan's Test Plan):
  - Open a `codev/plans|specs|reviews/*.md` → title-bar **Open Markdown Preview** (or sidebar View Spec/Plan/Review). Renders; no raw `<!-- REVIEW -->` text.
  - Hover a block → `+` → type → Enter → marker written, re-rendered, anchored. Multi-line paragraph does not split. Multiple comments on one block all show.
  - Raw HTML (`<details>`, `<img src="https://…">`) renders; `<script>`/`onerror=` stripped.
  - A non-codev `.md` (e.g. README) is NOT offered the preview in "Reopen With…".
  - Editor gutter-`+` Comments path and existing markers unchanged.

## Consultation (PR, single advisory pass)

PIR runs one advisory 3-way pass (`max_iterations: 1`); it is **not** re-reviewed, so dispositions
are recorded here for the human at the `pr` gate.

- **Claude — APPROVE (HIGH)**: clean; one non-blocking nit (a `void`-prefixed floating promise at
  `preview-provider.ts:77`). **Addressed** — removed the `void` prefix (matches the project's
  bare-call convention).
- **Gemini — no usable verdict**: the gemini consult lane derailed on two consecutive runs (first
  an off-topic `agy --sandbox` tangent, then an "empty workspace" prompt). This is a lane/infra
  failure, not a review of this PR. Escalated to the human; effectively a 2-of-3 pass.
- **Codex — REQUEST_CHANGES (HIGH)**, two findings, both **rebutted** (no PIR re-review, so flagged
  for the human):
  1. *Editor-authored comments on a continuation line of a multi-line block won't render in the
     canvas* (they anchor to a line with no `data-line`). **Real but a documented, architect-approved
     limitation**: the block-start-parity promise came from the *original* re-plan's markdown-it
     resolver, which the architect explicitly directed me to drop (codec simplification), then we
     landed on the strip-pre-parse + nearest-non-marker convention through a series of approved
     decisions. Canvas-authored comments always target the block start and never hit this; markers
     are never lost (still in the file, still rendered in the editor's Comments thread). Richer
     anchoring is explicitly **#863**. Not fixed here to avoid unrequested scope creep into the
     canvas component's anchoring (which is #863's domain).
  2. *No `packages/vscode/src/__tests__/` bridge tests*. The pure, regression-prone logic (the marker
     codec: serialize / parse / strip / anchor) is fully unit-tested in `core` (29 tests). The host
     bridge is thin `vscode`-API glue (`onDidReceiveMessage` → `showInputBox` → `WorkspaceEdit`) that
     isn't unit-testable without a heavy `vscode` mock; it was exercised live at the `dev-approval`
     gate. Judged not worth a brittle mock harness for this surface.

## Follow-ups (filed)

- **#1042** — relax artifact-canvas HTML policy (done in this PR; issue tracks the D7 amendment).
- **#863** — inline comment input in the canvas (replaces per-host `showInputBox`) + anchor the `+`
  to the first line (currently renders above the baseline) + richer multi-line anchoring.
- **#1036** — markers render as body text: fixed by this PR's renderer change.
