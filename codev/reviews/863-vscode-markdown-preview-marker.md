# PIR Review: Markdown preview marker-aware features — inline REVIEW cards + right-edge minimap

Fixes #863

## Summary

The Codev Markdown Preview previously rendered REVIEW markers as a minimal v1 overlay that sat *on top of* the annotated block, hiding its first lines. This change moves marker display into the `@cluesmith/codev-artifact-canvas` package as always-visible **inline-below comment cards** (rendered in document flow beneath each annotated block, so they push following content down instead of overlapping it) plus a new **right-edge marker minimap** (one dot per REVIEW marker, hover tooltip, click to smooth-scroll). Both surfaces derive from the same `parseReviewMarkers` source of truth and are pure rendering — no new interaction beyond click-to-jump, no on-disk format change. Implementing in artifact-canvas means every host that embeds the canvas inherits the behavior, not just VSCode.

## Files Changed

- `packages/artifact-canvas/src/components/ArtifactCanvas.tsx` (+~75 / -~35) — inline-below card stacks injected in flow; dropped the overlapping hover overlay marker-list; `+` affordance anchored to the first line's vertical center; body now set via imperative `innerHTML` in a `[html]`-keyed effect (see Lessons)
- `packages/artifact-canvas/src/overlays/MarkerMinimap.tsx` (+87 / -0, new) — right-edge fixed dot column; hover title; click → smooth-scroll; hidden when zero markers
- `packages/artifact-canvas/src/styles/default-theme.css` (+~55 / -~15) — card-stack + minimap styles using existing `--codev-canvas-*` tokens; left-rule + `padding-left` so the marker bar clears the annotated text
- `packages/artifact-canvas/src/components/__tests__/artifact-canvas.test.tsx` (+~50) — updated overlay-marker assertions to inline cards
- `packages/artifact-canvas/src/components/__tests__/marker-card-persistence.test.tsx` (+139 / -0, new) — regression repro for the flash-then-vanish card bug
- `packages/artifact-canvas/src/overlays/__tests__/marker-minimap.test.tsx` (+69 / -0, new) — dot count / hidden-when-empty / click→scrollIntoView / tooltip
- `codev/plans/863-vscode-markdown-preview-marker.md`, `codev/state/pir-863_thread.md`, `codev/projects/863-*/status.yaml` — protocol artifacts

## Commits

- `f13c6607` [PIR #863] Inline-below comment cards + right-edge marker minimap
- `c7869a99` [PIR #863] Tests for inline cards and marker minimap
- `256f5788` [PIR #863] Fix comment cards vanishing: own markdown body innerHTML imperatively
- `cba892fd` [PIR #863] Thread: dev-approval card-disappear finding + fix
- `be6a2958` [PIR #863] Add padding so marker bar doesn't crowd annotated text

## Test Results

- `pnpm --filter @cluesmith/codev-artifact-canvas build` (tsup): ✓ pass
- `pnpm --filter @cluesmith/codev-artifact-canvas test` (vitest): ✓ pass (50 tests, ~30 new across the two new test files + updated assertions)
- VSCode webview bundle (`node esbuild.js --production`): ✓ rebuilt
- Manual verification (human, at the `dev-approval` gate): inline cards render below each annotated block with no overlap; multi-comment blocks stack in creation order; zero-comment blocks consume no space; minimap dots persist with working hover tooltip + click-scroll; `+` add-comment flow intact. The reviewer caught two issues during this gate, both fixed and re-reviewed: (1) added cards flashed then vanished; (2) the marker accent bar crowded the annotated text.

## Architecture Updates

No arch changes — this PR adds rendering surfaces *inside* the existing `artifact-canvas` package (a new internal overlay component + CSS). It introduces no new module boundary, invariant, port, or cross-cutting fact, and does not alter the marker on-disk format or the host adapter contract. Nothing qualifies for `arch-critical.md` (hot) or `arch.md` (cold).

## Lessons Learned Updates

Added one entry to the **cold** `codev/resources/lessons-learned.md` (Debugging and Root Cause Analysis section), `[From 863]`: React's `dangerouslySetInnerHTML` re-commits the element's innerHTML on every re-render, silently wiping imperatively-injected DOM children — which was the exact root cause of the flash-then-vanish bug the reviewer found at the gate. The fix is the standard escape hatch: set `innerHTML` imperatively in a `[html]`-keyed effect so React no longer owns that subtree. Routed to cold (not hot `lessons-critical.md`) because it is a spec-narrow React/webview recipe, not a behavior-changing cross-cutting rule, and the hot tier is at its cap.

## Things to Look At During PR Review

- **[Codex REQUEST_CHANGES — fixed] Multi-`data-line` block anchoring.** The PR-stage 3-way consult (Codex, HIGH confidence) found that the card-injection loop ran for *every* `[data-line]` match, but the renderer stamps the same `data-line` on multiple nested blocks for one source line (e.g. both a `ul` and its `li`; `renderer/__tests__/data-line.test.ts`). A marker on a list/blockquote/table line therefore injected a **duplicate** card stack and, worse, **invalid `ul > ul` DOM** (the stack is itself a `<ul>`, so `el.after(...)` on the inner `<li>` nested it under the parent list). Fixed in `ArtifactCanvas.tsx` by anchoring the stack + `has-marker` decoration to the *first* match per line (querySelectorAll yields tree order, so first = outermost block). Pinned by a regression test ("anchors a single card stack to the OUTERMOST block…") that fails without the fix (`expected 2 to be 1`). The minimap was assessed and is **not** affected: it maps over `markers` (one dot per marker, not per `[data-line]` node) and its `querySelector` returns the outermost block in tree order — consistent with the card anchor. Reviewer: please sanity-check a real list/blockquote/table marker in the running worktree.
- **`ArtifactCanvas.tsx` body rendering** — the switch from `dangerouslySetInnerHTML` to an imperative `innerHTML` assignment in a `[html]`-keyed `useEffect`. This is the load-bearing fix for the card-persistence bug; confirm the effect dependency array is exactly `[html]` and that nested-block markers still resolve (the imperative path must preserve the same parsed DOM the JSX path produced).
- **Card injection vs. React reconciliation** — cards are injected into the now-React-unowned body subtree. Verify no path re-introduces React ownership of that subtree (which would re-trigger the wipe).
- **Minimap positioning under jsdom** — minimap position tests assert *structure* (dot count, hidden-when-empty, click→`scrollIntoView` spy, tooltip text), not pixel coordinates, because jsdom has no layout engine. Real proportional placement was verified manually at the dev-approval gate, not in unit tests.
- **Theme tokens** — all colors flow through the eight `--codev-canvas-*` tokens; no hardcoded colors. Worth a glance that the new card/minimap rules don't introduce a raw hex outside `default-theme.css`'s token block.

## How to Test Locally

- **View diff**: VSCode sidebar → right-click builder `pir-863` → **Review Diff**
- **Run dev server**: VSCode sidebar → **Run Dev Server**, or `afx dev pir-863`
- **What to verify**:
  - Open a `codev/(plans|specs|reviews)/*.md` containing REVIEW markers in the Codev Markdown Preview
  - Inline cards render *below* each annotated block (no overlap); content below is pushed down; zero-comment blocks consume no extra space; the thin left rule ties cards to the gutter; multi-comment blocks stack in creation order
  - Minimap: one dot per marker, roughly proportional placement; hover shows author + truncated body; click smooth-scrolls to the card; minimap absent on a marker-free doc
  - `+` add-comment still works end-to-end (hover → `+` → input → marker appears as a new card on refresh); `+` sits centered on the first line
  - Switch a dark/light theme; card + dot colors track `--vscode-*`
  - A non-`codev/(plans|specs|reviews)` markdown file is unaffected (preview opt-in for those paths)
