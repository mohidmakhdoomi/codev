# PIR Plan: Marker-aware artifact canvas — inline-below comment cards + right-edge minimap

Issue: #863 — *vscode: markdown preview marker-aware features — inline REVIEW rendering + right-edge marker minimap*

## Understanding

The issue asks the Codev markdown preview to make the REVIEW-marker feedback layer **visible** in two complementary ways: (1) render each marker as an in-context call-out anchored to the block it annotates, and (2) give a spatial overview of where markers sit via a right-edge minimap.

The issue body has two eras. The original "Implementation sketch" (a VSCode `markdown-it` plugin + `previewScripts`) is **stale** — its own "Update (post-#859 / PR #1045)" section says so. After #859/#945, the rendering surface is the React package **`packages/artifact-canvas/`**, mounted by VSCode as a read-only `CustomTextEditor` (`packages/vscode/src/markdown-preview/preview-provider.ts` + `webview/main.ts`). I verified this against the tree; the markdown-it/previewScripts files the sketch names do not exist.

Two consequences of the `CustomTextEditor` reality that reshape the issue's acceptance criteria:

1. **There is no separate "source editor" to jump into.** The canvas *is* the editor surface. The inline cards already sit beside the content they annotate, so the original "click call-out → open source file at the marker's line" loses its target. I reframe inline cards as **read-only display** (the AC's stated v1 intent is "read + click-to-jump only"); the click-to-jump affordance is preserved on the **minimap dots**, which smooth-scroll the canvas to the marker — an internal scroll, not a host round-trip.
2. **The concrete bug to fix is the overlap.** Today `ArtifactCanvas.tsx` renders the active block's markers in an *absolutely-positioned hover overlay* anchored at the block's `offsetTop` (`ArtifactCanvas.tsx:193-216`, `.codev-canvas-marker-list` in `default-theme.css:79-88`). The list paints over the first lines of the block. The issue's recommended fix (and "Additional acceptance criteria for the layout fix") is **inline-below**: cards rendered in document flow below the annotated block, pushing subsequent content down, tied to the gutter by a thin vertical rule, with no slot when a block has zero comments.

### Current code map (verified)

- `packages/artifact-canvas/src/components/ArtifactCanvas.tsx` — owns content + markers state, the post-render decoration effect (`:118-149`), the hover overlay (`:193-216`).
- `packages/artifact-canvas/src/renderer/renderer.ts` — strips full-line HTML comments, stamps `data-line` + `tabindex` on blocks. **No change needed.**
- `packages/artifact-canvas/src/styles/default-theme.css` — 8 `--codev-canvas-*` tokens, overlay + marker-list styles.
- `packages/artifact-canvas/src/overlays/CommentAffordance.tsx` — the `+` button. **No change needed.**
- `packages/vscode/src/markdown-preview/preview-template.ts:39-50` — maps the 8 tokens to `--vscode-*`. Reusing existing tokens means **no host change** for theming.
- `packages/vscode/src/markdown-preview/webview/main.ts` — mounts `<ArtifactCanvas>`. No new props needed (minimap + cards are internal to the package).
- #861 floating TOC: **does not exist yet** (no grep hits) — "compose with TOC" is forward-looking; the minimap just must not hard-claim space a future TOC would want.

## Proposed Change

All work lands in the **`@cluesmith/codev-artifact-canvas` package** so every host (VSCode preview today; dashboard / mobile later) inherits it. No new public props, no new tokens, no host wiring changes.

### 1. Inline-below comment cards (the layout fix + "inline REVIEW rendering")

Replace the hover overlay's marker-list with an **always-visible card stack injected inline-below each annotated block**, in document flow.

- Keep the existing post-render effect pattern (imperative DOM, consistent with `ArtifactCanvas.tsx:118-149`). For each `[data-line]` block that has markers, build a `<div class="codev-canvas-marker-cards">` containing one `<div class="codev-canvas-marker-card">` per marker (author label + body), and insert it as the block's next sibling. Clean up previously-injected stacks at the top of the effect (so re-renders from watch/refreshKey don't duplicate). Injecting real DOM siblings means the stack participates in flow and **pushes subsequent content down** (no overlap), satisfying the layout AC.
- A thin vertical rule = a left border / accent on `.codev-canvas-marker-cards`, aligned into the existing left gutter (`padding-left: 1.9rem` on `.codev-artifact-canvas-body`), visually tying the stack to the `+` gutter.
- Zero-comment blocks get **no injected node** → no slot, no consumed vertical space (AC).
- Multiple markers on one line render in `markers` order, which is the codec's `parseReviewMarkers` order (creation order) (AC).
- The hover overlay keeps **only** the `+` `CommentAffordance` (add-comment intent unchanged). Remove the `.codev-canvas-marker-list` branch and `activeMarkers` plumbing from the overlay.
- Keep the existing `.codev-canvas-has-marker` left accent bar on the block as a cheap in-context "this block has feedback" cue (complementary, non-overlapping).
- Cards are display-only (no click handler) — see Understanding for why click-to-jump moved to the minimap.

### 2. Right-edge marker minimap

A new `MarkerMinimap` component, rendered by `ArtifactCanvas` as a child of `.codev-artifact-canvas` (which is already `position: relative`).

- One dot per marker. Dot vertical position is proportional to the annotated block's offset within the rendered body (`block.offsetTop / body.scrollHeight`), mapped onto the minimap column height. Recompute via a layout effect on `[html, markers]` and on a debounced `resize` (window) — the issue's "updates on resize and rebuild".
- `position: fixed` column at the viewport right edge (matches the issue's drawing and the webview's full-window scroll model). Narrow strip so a future #861 TOC can sit beside it without fighting (documented, not enforced).
- **Hover dot** → native `title` = `@author: <first ~80 chars of body>` (AC tooltip).
- **Click dot** → `block.scrollIntoView({ behavior: 'smooth', block: 'center' })` (AC smooth-scroll). Dots are real `<button>`s (keyboard-reachable, accessible label), mirroring `CommentAffordance`.
- **Hidden entirely when zero markers** (AC) — render nothing.

### 3. Bundled polish: anchor the `+` to the first line's center (issue comment)

The architect's issue comment asks to anchor the `+` affordance to the first line's vertical center instead of the block's top edge (`.codev-canvas-overlay { align-items: flex-start }` + `setOverlayTop(el.offsetTop)`). Small, directly related, and explicitly "fits alongside this issue's polish". I'll fold it in: offset the overlay `top` by roughly half the first line's height (computed from the block's line-height / first client rect) with `transform: translateY(-50%)` on the button, kept in the package. **Flagged for the human at the gate** — easy to drop from this bundle if you'd rather it be its own change.

## Files to Change

- `packages/artifact-canvas/src/components/ArtifactCanvas.tsx`
  - Decoration effect (`:118-149`): inject/cleanup inline-below card stacks per annotated block.
  - Overlay (`:193-216`): drop the `marker-list` branch; keep only the `+` affordance. Adjust the `+` anchor (bundled polish).
  - Render `<MarkerMinimap markers={markers} bodyRef={bodyRef} />`.
- `packages/artifact-canvas/src/overlays/MarkerMinimap.tsx` — **new.** Dots, positioning effect, resize handler, click→scroll, hover title, hidden-when-empty.
- `packages/artifact-canvas/src/styles/default-theme.css`
  - New `.codev-canvas-marker-cards` / `.codev-canvas-marker-card` (inline-below, vertical rule, theme tokens).
  - New `.codev-canvas-minimap` / `.codev-canvas-minimap-dot` (fixed right column, dots).
  - Remove/replace the now-unused `.codev-canvas-marker-list`; adjust `.codev-canvas-overlay` for the `+`-center anchor.
- `packages/artifact-canvas/src/components/__tests__/artifact-canvas.test.tsx`
  - Update the "surfaces … via the overlay" test (`:177-190`) to assert the **inline card** instead.
  - Add: inline card injected below the annotated block; no slot for zero-comment blocks; multi-marker stack order; add-comment flow still works (regression).
- `packages/artifact-canvas/src/overlays/__tests__/marker-minimap.test.tsx` — **new.** Dot count = marker count; hidden when zero; click → `scrollIntoView` spy; title contains author + truncated body.
- `packages/artifact-canvas/src/index.ts` — export `MarkerMinimap` only if it needs to be public (likely internal-only; default: no export change).

**No `packages/vscode/` changes expected.** If a CSP / fixed-positioning quirk in the real webview forces a tweak, it would be confined to `preview-template.ts` and called out at dev-approval.

## Risks & Alternatives Considered

- **Risk: imperative DOM injection desyncs from React's innerHTML body.** Mitigation: rebuild from scratch each effect run (cleanup-then-inject), keyed off `[html, markers]` exactly like the existing decoration effect — same proven pattern, same lifecycle.
- **Risk: `scrollHeight`/`offsetTop` are 0 in jsdom**, so minimap *position* math is untestable in unit tests. Mitigation: unit-test structure/behavior (counts, hidden-when-empty, click→`scrollIntoView` spy, tooltip text); verify pixel positioning manually in the running webview at the `dev-approval` gate (the gate exists precisely for visual/running review).
- **Risk: removing the overlay marker-list breaks an existing test.** Expected and intended — that test asserts the *old* overlapping behavior. I update it to assert the new inline card; the regression-relevant behavior (add-comment intent) keeps its own passing tests.
- **Risk: `position: fixed` minimap fights a future #861 TOC.** #861 isn't built yet; I keep the strip narrow and documented as composable. No enforcement possible against code that doesn't exist.
- **Alternative — render cards by interleaving React children** instead of DOM injection: rejected; the body is a single `dangerouslySetInnerHTML` blob, so interleaving means a full renderer rewrite (parse to React tree) — far larger blast radius than the issue warrants.
- **Alternative — keep the overlay but add top-padding to the block** (the issue's "top padding push" row): rejected for the same reasons the issue rejects it (consumes space inelegantly, no clean multi-card story).
- **Alternative — put the minimap in the VSCode webview (`previewScripts`)** per the stale sketch: rejected; it would not be inherited by the dashboard/mobile hosts and would duplicate marker state the package already holds.

## Test Plan

**Unit (vitest + @testing-library/react, run from `packages/artifact-canvas/`):**
- `pnpm test` — existing suite stays green (add-comment intent, round-trip, error paths, request-versioning, refreshKey).
- New/updated:
  - Inline card renders below a block that has a marker; shows author + body.
  - A block with zero markers injects no card node.
  - Two markers on one line render two cards in creation order.
  - Add-comment flow unchanged: hover → `+` → click → `onAddComment(line)`; package never calls `markerAdapter.add`.
  - Minimap: dot count == marker count; nothing rendered when zero markers; clicking a dot calls `scrollIntoView` (spied); dot `title` contains author + truncated body.
- `pnpm check-types` clean; `pnpm build` (tsup) clean.

**Manual at the `dev-approval` gate (the killer move — run the worktree):**
- Open a `codev/plans|specs|reviews/*.md` with REVIEW markers in the Codev Markdown Preview (`afx dev pir-863`, then "Reopen With… Codev Markdown Preview" or `codev.openMarkdownPreview`).
- Verify: cards render inline-*below* each annotated block (no overlap); content below is pushed down; zero-comment blocks consume no space; the thin vertical rule ties cards to the gutter; multi-comment blocks stack in order.
- Verify minimap: one dot per marker, roughly proportional vertical placement; hover shows author + truncated body; click smooth-scrolls to the card; minimap absent on a marker-free doc.
- Verify `+` add-comment still works end-to-end (hover → `+` → InputBox → marker appears as a new card on refresh) and the `+` now sits centered on the first line.
- Verify theme: switch a dark/light VSCode theme; colors track `--vscode-*` (cards + dots).
- Path eligibility unchanged: a non-`codev/(plans|specs|reviews)` markdown file is unaffected (preview is opt-in for those paths).

## Out of Scope (carried from the issue)

Reply/thread display, resolve-state coloring, filter UI, editing from the call-out, per-marker minimap colors, outline-panel enrichment. v1 keeps single-comment-per-card display, uniform dot color, read + minimap-click-to-scroll only.
