# PIR Plan: Review comments from the markdown preview pane

## Understanding

The issue wants to remove the editor↔preview mode-switch from the architect's review loop:
read a spec/plan in the rendered markdown preview, hover a block, click `+`, type a comment,
submit — without dropping to the raw `.md` editor to find the gutter `+`. The comment is
serialized with the existing convention: `<!-- REVIEW(@<author>): <text> -->` written on the
line after the targeted block. v1 is **authoring only** — no rendering of existing threads in
the preview. The editor-side Comments API (`packages/vscode/src/comments/plan-review.ts`)
stays as-is for read/reply/delete.

### ⚠️ Critical finding: the issue's proposed mechanism is infeasible

The issue body sketches the implementation as: a script injected via
`contributes.markdown.previewScripts` that `postMessage`s the clicked source line back to the
extension host, which then opens an `InputBox`. **VS Code's built-in markdown preview does not
support this.** I verified against primary sources:

- **`acquireVsCodeApi()` is single-call-per-webview.** The built-in preview
  (`extensions/markdown-language-features/preview-src/index.ts`) already calls it once and does
  not expose the handle globally. A contributed `previewScript` calling it again throws
  *"An instance of the VS Code API has already been acquired"* (microsoft/vscode#122961,
  closed *as-designed*).
- **The host accepts only a fixed message allowlist.** The preview's host-side
  `onDidReceiveMessage` (`extensions/markdown-language-features/src/preview/preview.ts`)
  switches on a closed set — `cacheImageSizes`, `revealLine`, `didClick`, `openLink`,
  `showPreviewSecuritySelector`, `previewStyleLoadError` — with **no passthrough/default
  case**, and validates `e.source` against the previewed resource URI. A custom message type
  is silently dropped.
- **`command:` URIs are blocked in the built-in preview.** It is not created with
  `enableCommandUris`, and there is no API to change the preview webview's security policy
  (microsoft/vscode#84886, closed *out-of-scope*).
- **A first-class preview↔host messaging API was proposed and rejected**
  (microsoft/vscode#174080 — `onMarkdownPreview` + `postMessage`/`onDidReceiveMessage` —
  closed *out-of-scope*).
- The official `vscode-extension-samples` has **no** markdown preview message-passing sample;
  the only markdown sample demonstrates `extendMarkdownIt` (render-only). That absence is
  itself confirmatory.

The `previewScripts` / `previewStyles` / `markdownItPlugins` contribution points are
**render-only**. None of them carry a channel back to the extension host. So the issue's
acceptance criteria ("clicking `+` opens an InputBox") **cannot be met on the built-in
preview**. This isn't a detail to "verify at implementation time" (as the issue suggests) —
it's a load-bearing premise that doesn't hold.

## Proposed Change

Deliver the issue's *goal* (comment from a rendered reading surface, no raw-`.md` mode-switch)
via the one supported mechanism: **a Codev-owned webview that renders the markdown itself**, so
we own the single `acquireVsCodeApi()` call and get genuine `postMessage` back to the host.

**Recommended: a read-only `CustomTextEditor` ("Codev Review Preview").** Registering a
`CustomTextEditorProvider` (rather than a free-floating `WebviewPanel`) is the cleaner VS Code
mechanism: it binds to the document lifecycle, receives the document URI naturally, and surfaces
in **"Reopen Editor With… → Codev Review Preview"** plus an editor-title button on eligible
files. It does not hijack `.md` files (the default editor and built-in `Cmd+K V` preview are
untouched) — it's an opt-in alternate view.

Flow:
1. Architect opens an eligible doc (`codev/(plans|specs|reviews)/*.md`) in the Codev Review
   Preview (title-bar button or "Reopen With…").
2. We render the document with `markdown-it`, adding `data-line="<startLine>"` to block tokens
   via a tiny source-map rule (markdown-it exposes `token.map` — this is the same trick the
   built-in preview uses; the issue's "fallback: write our own plugin" is in fact the required
   path here, and it is cheap).
3. A bundled webview script shows a `+` on block hover; clicking it
   `postMessage({ type: 'codev:addComment', line })` to the host.
4. The host (`CustomTextEditorProvider.resolveCustomTextEditor` → `webview.onDidReceiveMessage`)
   opens `vscode.window.showInputBox(...)`, then calls the shared `writeReviewMarkerAt(uri, line, text)`.
5. On document change, we re-render the webview (so a just-added marker — and any editor-side
   edits — are reflected).

**Shared mutation (the still-valid part of the issue).** Extract the file-write core of
`submitReviewComment` in `plan-review.ts` into an exported
`writeReviewMarkerAt(uri: vscode.Uri, line: number, text: string, author: string): Promise<void>`
(preserving the existing indent-matching, whitespace-normalization, and
`insert on Position(line + 1, 0)` semantics). Both the editor Comments-API path and the new
preview path call it. Author identity reuses the existing
`overviewCache.getData()?.currentUser ?? 'architect'`.

**Path gating** reuses `ELIGIBLE_PATH_REGEX` (`/\/codev\/(plans|specs|reviews)\//`, already
exported-worthy) — only eligible files get the Codev Review Preview button; the
CustomTextEditor still opens for any `.md` if explicitly chosen, but the `+` affordance only
activates for eligible paths.

### Honest scope note

This is **materially larger** than the issue advertised ("three contribution points, one
shared mutation function, no Comments API rework"). Reality: it is the **first webview in this
extension** (no existing `createWebviewPanel`/`CustomEditor` usage anywhere in
`packages/vscode/src`), and it adds a `markdown-it` render pipeline (new dependency, bundled by
esbuild into `dist/extension.js`) plus webview asset plumbing (CSP nonce, `asWebviewUri`). For
the `+`-on-rendered-prose UX to actually be used, the Codev preview must be a credible reading
surface (GFM, code highlighting, theme variables) — i.e. good enough that the architect reads
*in it* rather than in `Cmd+K V`.

Because of this gap between the issue's framing and the real cost, the plan-approval gate is a
genuine go/no-go. See **Risks & Alternatives** for the cheaper options if the architect prefers
not to take on the extension's first webview for this.

## Files to Change

- `packages/vscode/src/comments/plan-review.ts` — extract & export
  `writeReviewMarkerAt(uri, line, text, author)`; export `ELIGIBLE_PATH_REGEX` (and reuse it in
  the new preview). `submitReviewComment` becomes a thin caller. No behavior change to the
  editor path.
- `packages/vscode/src/markdown-preview/review-preview.ts` — **new.**
  `CustomTextEditorProvider` ("Codev Review Preview", viewType e.g. `codev.reviewPreview`):
  renders markdown → HTML with `data-line`, builds the webview HTML (CSP + nonce + `asWebviewUri`
  for script/style), handles `onDidReceiveMessage` → `showInputBox` → `writeReviewMarkerAt`,
  re-renders on `onDidChangeTextDocument`.
- `packages/vscode/src/markdown-preview/render.ts` — **new.** markdown-it instance + the
  `data-line` source-map rule (unit-testable in isolation, no `vscode` import).
- `packages/vscode/media/review-preview/add-comment.js` — **new.** webview-side hover-`+` +
  `acquireVsCodeApi().postMessage`. (Lives in `media/`, loaded via `asWebviewUri` — NOT
  `contributes.markdown.previewScripts`.)
- `packages/vscode/media/review-preview/add-comment.css` — **new.** hover-gated `+`, themed via
  `--vscode-*` variables.
- `packages/vscode/src/extension.ts` — register the provider (alongside
  `activateReviewComments(context, overviewCache)` at ~line 696).
- `packages/vscode/package.json` — add `customEditors` contribution (viewType, displayName,
  selector `*.md`, `priority: "option"` so it never replaces the default editor); add a
  `commands` entry + editor-title `menus` button ("Open Codev Review Preview", `when` gated to
  eligible markdown); add `markdown-it` (+ `@types/markdown-it`) to dependencies.
- `packages/vscode/esbuild.js` — ensure `media/**` assets land in the packaged extension. esbuild
  bundles `markdown-it` into `dist/extension.js` automatically (node platform); the `media/`
  files are static and are already included by `.vscodeignore`/vsce packaging from the repo root,
  but confirm they ship (add a copy step only if packaging excludes them).
- `packages/vscode/src/__tests__/` — unit tests for `render.ts` (`data-line` attribution) and
  `writeReviewMarkerAt` (marker format, indent, line+1 insertion).

## Risks & Alternatives Considered

- **Risk: the issue's premise is wrong, so building Option A means building more than asked.**
  Mitigation: surfaced explicitly here and notified the architect before coding; this gate is the
  decision point.
- **Risk: first webview in the extension** (CSP, nonce, asset URIs, no in-repo precedent to copy).
  Mitigation: follow the standard VS Code webview guide; keep the webview script tiny
  (hover + postMessage only); render server-side in the host.
- **Risk: re-rendering markdown ourselves diverges from the built-in preview** (tables, code
  highlighting, math, mermaid). Mitigation: scope v1 to GFM-ish via markdown-it core + a
  highlighter; explicitly *not* aiming for built-in parity. Note this is a permanent maintenance
  surface.
- **Risk: implementer should re-confirm the host allowlist against the exact 1.105 source** in
  case a future VS Code adds the proposed messaging API (#174080). Cheap insurance; if it lands,
  the lighter built-in-preview path reopens and this webview could be retired.
- **Alternative B — built-in preview + double-click-to-source bridge (cheaper, clunkier).** Keep
  the built-in preview; rely on its double-click-to-editor sync to move the cursor to the block,
  then a keybound command "Add Review Comment Here" reads the editor's active line and writes the
  marker. Smaller, no webview, but still a partial mode-switch and requires the source editor open
  in a split. Rejected as not really delivering the issue's "no mode-switch" goal — but it's the
  low-cost option if the architect wants something now.
- **Alternative D — defer/close (cheapest).** Document the infeasibility finding on the issue and
  leave authoring in the editor. Legitimate given the premise break; offered for the architect's
  call at the gate.
- **Alternative C — clipboard / Tower-localhost / `openLink` sentinel hacks.** Rejected: fragile,
  version-dependent, fight the preview allowlist; not maintainable.

## Test Plan

- **Unit (`vitest`):**
  - `render.ts`: a sample markdown → HTML emits `data-line` on paragraphs, headings, list items,
    code blocks matching `token.map[0]`.
  - `writeReviewMarkerAt`: produces `<!-- REVIEW(@author): text -->` with preserved indent,
    whitespace-normalized body, inserted on the line **after** the target; editor-side
    `submitReviewComment` still produces identical output (no regression).
- **Manual (the `dev-approval` gate review, in the Extension Development Host):**
  - Open `codev/plans/859-…md` → "Reopen With → Codev Review Preview" (or title button). Renders.
  - Hover a paragraph/heading/list-item/code-block → `+` appears (hidden until hover).
  - Click `+` → InputBox opens → type → Enter → marker written on the next source line; preview
    re-renders.
  - Open an ineligible `.md` (e.g. repo `README.md`) in the Codev preview → no `+` affordance.
  - Editor-side Comments API path unchanged: open the same file in the text editor, gutter `+`,
    submit/delete still work; existing REVIEW markers still render as threads.
  - Author identity matches the editor path (git/GitHub login, falls back to `architect`).
- **Build:** `pnpm --filter @cluesmith/codev-vscode package` (or repo build) succeeds with
  `markdown-it` bundled; `media/` assets present in the packaged extension.

---

**Decision requested at `plan-approval`:** proceed with Option A (first webview; full goal), fall
back to Option B (cheaper bridge), or Option D (document & defer). I recommend A only if the team
is willing to own a Codev markdown preview as a lasting surface; otherwise D is the honest call
given the issue's premise does not hold.
