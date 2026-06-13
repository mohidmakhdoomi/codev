# PIR Plan: Review comments from a rendered artifact canvas (VSCode host)

> **Re-plan (2026-06-13).** This supersedes the original plan. The original targeted VS Code's
> *built-in* markdown preview via `previewScripts` — proven infeasible (no preview→host messaging;
> see issue comment #4586600146). Since then, **spir-945 landed `@cluesmith/codev-artifact-canvas`**
> (PR #1027), a host-agnostic React review surface. #859 is now the **first host integration** of
> that package, scoped to the **VSCode extension only**. The dashboard/web host is a separate
> `area/dashboard` follow-up (the "and follow-ups" in spir-945's notes) and is explicitly **out of
> scope here** — but this plan houses the shared pieces in `core` so the web host inherits them.
>
> **Rebase delta (2026-06-13, +121 commits).** Re-verified against current `main`. Two changes
> matter: (1) **#920 landed the extension's first webview** (Search Backlog editor-tab panel) — so
> this is no longer the "first webview," it's the first *React/bundled* webview, and #920 gives us
> the CSP/nonce/template precedent to follow (`packages/vscode/src/webviews/backlog-search-panel.ts`,
> `backlog-search.template.ts`, `getNonce()`). (2) **#956 added a lint rule** banning bare
> `vscode.commands.registerCommand` — the open command must register via `reg(...)` from
> `extension.ts`. `@cluesmith/codev-artifact-canvas` is still **3.1.9** (adapter contract unchanged);
> **#1036 and #1029 remain open** (the codec-in-core + blank-replace design still applies).

## Understanding

The architect reviews long specs/plans/reviews in a rendered surface and wants to add a review
comment without dropping to the raw `.md` editor. `@cluesmith/codev-artifact-canvas` already owns
the hard parts: sanitized markdown rendering (`markdown-it` `html:false` + DOMPurify), 0-based
`data-line` on block-start tokens, a hover/keyboard `+` overlay that emits **`onAddComment(line)`
intent only**, and minimal marker display. It is **React**, consumed `workspace:*`, bundled by each
host, with three host-implemented adapters (`FileAdapter`, `MarkerAdapter`, `ThemeAdapter`).

So #859 is no longer "extend the built-in preview." It is: **build the VSCode host that mounts
`<ArtifactCanvas>` in our own webview and wires the three adapters to the extension host's I/O.**

Two cross-cutting facts discovered during the requirements check shape the design:

1. **Markers must be hidden from the rendered body (issue #1036).** Under `html:false` a raw
   `<!-- REVIEW(@a): … -->` line renders as *visible literal text* (markdown-it escapes raw HTML to
   text — confirmed by the package's own sanitization test). The host must therefore strip markers
   from what it feeds the renderer. The chosen mechanism is **blank-line replacement** (replace each
   marker line with an empty line), which keeps render-space and disk-space line counts **identical**
   (no coordinate mapping) and preserves block boundaries. This resolves the **VSCode side of #1036**.
2. **The marker convention is a cross-host contract.** Whatever serialization + anchor rule #859
   picks becomes the standard the future dashboard host must match against the *same committed files*.
   So the marker logic lives in **`@cluesmith/codev-core`** (both hosts already depend on it), not in
   `packages/vscode`.

## Proposed Change

### A. Shared marker codec in `core` (new) — `@cluesmith/codev-core/review-markers`

A pure, browser- and Node-safe module (new subpath export, matching core's existing per-subpath
export style). It is the **single home** for the on-disk marker format and the render transform,
consumed by the VSCode host now and the dashboard host later:

- `serializeMarker(author, text): string` → `<!-- REVIEW(@author): text -->` (whitespace-normalized
  body, the existing format — verified at `plan-review.ts:157`).
- `parseMarkers(text): ReviewMarker[]` → parses every marker and resolves each to the **block-start
  line it annotates** (so `marker.line` equals the canvas's `data-line` and the marker renders on the
  right block).
- `stripMarkersForRender(text): string` → **blank-line replacement** of every marker line (the
  #1036 fix; keeps line count stable).
- `insertMarker(text, line, author, body): string` → inserts a serialized marker **preserving the
  existing on-disk convention** (on the line *after* the anchor — see Convention decision).
- `ELIGIBLE_PATH_REGEX` → moved here from `plan-review.ts` so both hosts share path gating.
- A small `markdown-it` block-start resolver (block-open / `fence` / `code_block` → `token.map[0]`),
  mirroring the canvas renderer's `data-line` rule, used by `parseMarkers` to map a marker to its
  block. `core` gains a `markdown-it` dependency (browser-safe; already used elsewhere in the repo).

### B. VSCode host (new) — render the canvas in our own webview

- **`CustomTextEditorProvider`** `codev.reviewPreview` ("Codev Review Preview"): binds the document,
  surfaces via **"Reopen With…"** + an editor-title button, path-gated to `codev/(plans|specs|reviews)/*.md`.
  Does **not** replace the default `.md` editor or the built-in `Cmd+K V` preview (`priority: "option"`).
- **Webview React app** (new bundle): mounts `<ArtifactCanvas>` with:
  - `FileAdapter.read` → returns `stripMarkersForRender(documentText)` (so markers never show);
    `watch` → driven by the host posting new content on `onDidChangeTextDocument`.
  - `MarkerAdapter.list` → `parseMarkers(documentText)`; `add` → host-invoked, see below.
  - `ThemeAdapter` → bind `.codev-artifact-canvas` `--codev-canvas-*` tokens to `--vscode-*` (off the
    v1 render path; CSS-variable theming per the package's Model A).
- **Webview↔host bridge:** adapters run in the webview, but `TextDocument` / `WorkspaceEdit` /
  `showInputBox` live in the extension host. Flow: `onAddComment(line)` → `postMessage` → host
  `showInputBox` → `MarkerAdapter.add` (host writes via the core codec + `WorkspaceEdit` + save) →
  document change → host re-reads, re-strips, re-posts content + markers → canvas re-renders. The
  round-trip goes **through the file text**, matching the package's design.
- **Author identity** reuses `overviewCache.getData()?.currentUser ?? 'architect'` (unchanged).

### C. Editor path stays, now sharing the codec (no behavior change)

`packages/vscode/src/comments/plan-review.ts` keeps the editor-side Comments API exactly as today,
but its `submitReviewComment` is refactored to call `core`'s `serializeMarker` / `insertMarker` so
the on-disk format lives in **one place**. **The write direction is unchanged** (marker still on the
line after the anchor). This is deliberate — see the Convention decision.

### D. Build / packaging

- A **second esbuild bundle** for the webview React app (browser platform, JSX/TSX), bundling
  `react`, `react-dom`, and `@cluesmith/codev-artifact-canvas` (not npm-published; bundled per host)
  plus the package's `default-theme.css`. The existing Node extension bundle is unchanged.
- `packages/vscode/package.json`: add `customEditors` contribution + the open command/menu; add
  `react`, `react-dom`, `@cluesmith/codev-artifact-canvas` (`workspace:*`) deps. `core` is already a dep.

## Does this remove existing annotations? No.

Explicit, because it was asked: **no existing `<!-- REVIEW… -->` marker is deleted or rewritten.**
`stripMarkersForRender` runs **in memory on the read path only** — the on-disk file keeps every
marker byte-for-byte (git, GitHub, the source editor, and the editor Comments-API path all see the
real file). `MarkerAdapter.add` only inserts; nothing strips markers from disk. The only marker
removal remains the explicit `codev.deleteReviewComment` command. Because the **existing on-disk
convention is preserved** (Convention B below), existing markers also keep anchoring to the correct
block in the new canvas — no cosmetic drift.

## Files to Change

- `packages/core/src/review-markers.ts` — **new.** The codec (A). Pure; `markdown-it` block-start
  resolver; no `vscode` import.
- `packages/core/src/__tests__/review-markers.test.ts` — **new.** Unit + the canvas-parity test.
- `packages/core/package.json` — add `./review-markers` subpath export; add `markdown-it` dep.
- `packages/vscode/src/markdown-preview/review-preview.ts` — **new.** `CustomTextEditorProvider`,
  webview HTML (CSP + nonce + `asWebviewUri`), host-side message handling, re-post on change.
- `packages/vscode/src/markdown-preview/webview/main.tsx` — **new.** Webview entry: `createRoot` →
  `<ArtifactCanvas>` + adapters bridged over `postMessage`.
- `packages/vscode/src/comments/plan-review.ts` — refactor `submitReviewComment` to delegate format
  to `core` (C); import `ELIGIBLE_PATH_REGEX` from `core`. No behavior change.
- `packages/vscode/src/extension.ts` — register the `CustomTextEditorProvider`
  (`vscode.window.registerCustomEditorProvider`) and the open command via `reg(...)` (the #956 helper,
  defined ~line 600), near `activateReviewComments` (~696).
- `packages/vscode/package.json` — `customEditors`, command/menu, `react`/`react-dom`/`artifact-canvas` deps.
- `packages/vscode/esbuild.js` — second (browser) bundle for the webview app + CSS copy.
- `packages/vscode/src/__tests__/` — host bridge + adapter unit tests where they don't need the VS Code runtime.

## Risks & Alternatives Considered

- **Convention decision — keep the existing on-disk convention (Convention B), do NOT flip.**
  - *Chosen (B):* marker stays on the line **after** its anchor (today's editor behavior). `parseMarkers`
    resolves each marker back to its block-start `data-line` via the `markdown-it` block map. **Existing
    annotations are untouched and stay correctly anchored; the editor path needs no behavioral change.**
  - *Rejected (A — "annotate-above" flip):* would make `list()`/`add()` pure arithmetic (no tokenizer),
    but it **reverses the on-disk write direction**, which (1) re-anchors existing markers one block off
    in the canvas (cosmetic but real) and (2) forces editor-path write/delete/parse changes. Conflicts
    with the "don't disturb existing annotations" requirement. Not worth the simplicity.
  - *Cost of B:* `core` carries a `markdown-it` block-start resolver that must stay in parity with the
    canvas renderer's `data-line` rule (both: block-open/`fence`/`code_block` → `token.map[0]`).
    Mitigated by a **parity contract test** (render a fixture through both, assert identical block-start
    lines). Avoids the fragile "previous blank line" heuristic, which mis-anchors on fenced code blocks
    containing blank lines.
- **First *React/bundled* webview** (not the first webview — #920 added one). Follow #920's
  CSP/nonce/template conventions (`webviews/backlog-search-panel.ts`, `backlog-search.template.ts`,
  reuse `getNonce()`). The new part is the **esbuild webview bundle**: #920 inlines a plain
  `CLIENT_SCRIPT` string, but React + `artifact-canvas` + DOMPurify + markdown-it is too large to
  inline, so it ships as a second esbuild entry loaded via `asWebviewUri`. Keep the webview script
  thin (mount + postMessage bridge); all VS Code API stays host-side. *Alternative considered:* #920's
  `createWebviewPanel` editor-tab pattern instead of `CustomTextEditor` — kept `CustomTextEditor` for
  document binding + "Reopen With", with #920's panel as the fallback if binding proves awkward.
- **Command registration (#956 lint rule).** Register the "Open Codev Review Preview" command via
  `reg(...)` in `extension.ts` (not bare `vscode.commands.registerCommand`). The
  `registerCustomEditorProvider` call is `vscode.window.*` and not subject to the rule. Do not disturb
  `plan-review.ts`'s two existing `eslint-disable`d (intentionally unguarded) command registrations.
- **`markdown-it` in `core`.** Adds a dependency to a shared, browser-consumed package. Acceptable (it
  is browser-safe and already in the repo); the codec is otherwise pure string-in/out.
- **#1036 coordination.** The blank-replace-on-read mechanism resolves the **VSCode side** of #1036.
  The cross-cutting issue stays open for the dashboard host; the shared codec in `core` is what lets the
  web host adopt the same fix without re-implementing it. Flag in the architect notification.
- **Dual markdown rendering** (canvas renders; core resolves block lines). Same config, different
  instances — the parity test is the guard. If divergence ever bites, the fallback is to export the
  block-map from a shared module; deferred to avoid coupling `artifact-canvas` to `core` (keeps the
  canvas standalone per #1029).
- **Out of scope (explicit):** the dashboard/web host (separate `area/dashboard` issue); polished inline
  marker bubbles + minimap (#863); reply/resolve/threading.

## Test Plan

- **Unit — `core/review-markers` (`vitest`):**
  - `serializeMarker` produces the exact existing format; `stripMarkersForRender` blanks marker lines
    and preserves line count; round-trip `insertMarker`→`parseMarkers` recovers the block-start line.
  - `parseMarkers` resolves to the correct block-start for paragraphs, headings, list items, blockquotes,
    and **fenced code blocks containing blank lines** (the case the blank-line heuristic would miss).
  - Multiple markers on one block all resolve to the same block-start line.
  - **Parity test:** block-start lines from the core resolver match `renderMarkdown`'s emitted `data-line`s.
- **Unit — vscode bridge:** adapter message protocol (read/watch/list/add) serialization where it can run
  without the VS Code runtime.
- **Manual (the `dev-approval` gate, Extension Development Host):**
  - Open `codev/plans/859-…md` → "Reopen With → Codev Review Preview" → renders; **no raw `<!-- REVIEW -->`
    text visible**.
  - Hover a paragraph/heading/list-item/code-block → `+` appears; click → InputBox → submit → marker
    written on the line after the block; canvas re-renders with the marker shown.
  - A file with **pre-existing** markers (e.g. `codev/plans/0044-…md`) → markers anchor to the correct
    blocks; after using the canvas, `git diff` shows the file's existing markers **unchanged**.
  - Ineligible `.md` (e.g. repo `README.md`) → no Codev Review Preview affordance.
  - Editor-side Comments API path unchanged: gutter `+`, submit, delete, and existing-thread rendering
    all behave exactly as before.
- **Build:** `pnpm --filter @cluesmith/codev build` green with the new core export, the webview bundle,
  and `markdown-it` bundled; `media`/CSS assets present in the packaged extension.

---

**Decision already taken by the architect:** vscode-only scope; codec in `core`; existing on-disk
convention preserved (existing annotations untouched). Remaining open question for the `plan-approval`
gate: confirm the parity-test approach for the core/canvas block-map duplication (vs. a later shared
module), and whether the VSCode side of **#1036** should be closed by this PR or tracked as resolved-by-#859.

---

## Scope expansion (2026-06-14): fix marker rendering in the package

Architect-directed, mid-implement. The host-side blank-replace workaround (above) only papered over
a package limitation: the renderer ran markdown-it with `html: false`, which escaped `<!-- REVIEW -->`
to **visible text** (issue #1036), and blanking the marker line **split multi-line paragraphs**. Both
are rendering concerns that belong in the package, so they're fixed there in this batch (consumed by
the future dashboard host too):

1. **`@cluesmith/codev-artifact-canvas` renderer** (`renderer.ts`):
   - **Strip full-line HTML comments before block parsing** (fence-aware) with a cleaned→original
     line map; the `data-line` rule reports original lines via the map. Markers no longer render and
     **multi-line blocks no longer split** — the comment line is removed, so the paragraph rejoins,
     and `data-line` stays correct. This is the proper #1036 fix and removes the need for any
     on-disk convention flip.
   - **`html: false` → `html: true` + DOMPurify** (issue #1042, amends spir-945 **D7**): safe static
     HTML (`<img>`, `<details>`, `<kbd>`, tables…) renders; scripts, event handlers, and
     `javascript:`/`data:` URLs are stripped; document-supplied JS never executes.
   - Tests updated: `data-line.test.ts` (+strip/line-map/no-split/fence), `sanitization.test.ts`
     (D7 policy flip).
2. **`@cluesmith/codev-core/review-markers`**: removed `stripMarkersForRender` (the renderer owns
   hiding now). The codec is purely the on-disk read/write convention.
3. **VSCode host** (`preview-provider.ts`): sends **raw** document text to the webview (the renderer
   strips markers); no host-side hiding.

Net: #1036 fixed properly in the renderer; richer HTML via #1042 (D7 amended); the multi-line-split
limitation and the above/below convention question are both gone. Spec D7 amendment recorded on
#1042 and here (the closed spir-945 spec file is not rewritten).
