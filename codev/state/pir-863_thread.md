# PIR #863 — vscode markdown preview marker-aware features

## Plan phase (in progress)

Investigated the post-#859 world. Key findings:

- The rendering surface is **`packages/artifact-canvas/`** (React package), NOT a VSCode
  markdown-it plugin. The issue's original "Implementation sketch" (markdown-it plugin +
  previewScripts) is stale; the update section confirms this.
- The canvas is mounted as a **`CustomTextEditor`** (`packages/vscode/src/markdown-preview/
  preview-provider.ts` + `webview/main.ts`). It REPLACES the source editor — there is no
  separate "source editor" to click-to-jump into. So inline-card click-to-jump is reframed.
- Current marker rendering: `ArtifactCanvas.tsx` shows markers two ways — (a) a left inset
  accent bar (`.codev-canvas-has-marker`) on the block, and (b) an absolutely-positioned
  hover overlay marker-list anchored at the block's `offsetTop`. The overlay marker-list is
  the thing that **overlaps content** (the issue's "new concrete symptom").
- #861 floating TOC does NOT exist yet (no grep hits) — "compose with TOC" is forward-looking;
  I just need to not preclude it.
- Theme tokens: 8 `--codev-canvas-*` vars in `default-theme.css`, mapped to `--vscode-*` in
  `preview-template.ts`. Reuse existing tokens; no host changes needed for theming.
- Tests: vitest + @testing-library/react (jsdom). jsdom has no layout, so minimap position
  tests must assert structure (dot count, hidden-when-empty, click→scrollIntoView spy), not px.

Decision: implement entirely in the artifact-canvas package (so all hosts inherit it):
1. Move marker display from the hover overlay to always-visible **inline-below card stacks**.
2. Add a **right-edge minimap** component (dots, hover tooltip, click→smooth-scroll).
3. (Bundled, from issue comment) anchor the `+` affordance to the first line's vertical center.

Writing plan to codev/plans/863-vscode-markdown-preview-marker.md.

## Implement phase (in progress)

plan-approval gate approved. Implementing in the artifact-canvas package:
1. ArtifactCanvas.tsx — inject inline-below card stacks (DOM siblings, in flow);
   drop the overlapping hover overlay marker-list; keep the "+" affordance; anchor "+"
   to the first line's vertical center (bundled polish from the issue comment).
2. MarkerMinimap.tsx (new) — right-edge fixed dot column; hover title; click→smooth-scroll;
   hidden when zero markers.
3. default-theme.css — card stack + minimap styles (existing --codev-canvas-* tokens only).
4. Tests — update the old overlay-marker-list test to assert inline cards; add minimap tests.

## dev-approval finding: comment cards flashed then vanished

Reviewer reported: added comments appear momentarily then disappear; minimap dots persist.

Diagnosis (captured, not guessed):
- Built a faithful jsdom repro of the webview refreshKey round-trip (real parseReviewMarkers
  semantics) — basic add, mid-paragraph split (#1036), and double-update. ALL kept the card.
  So the injection logic is correct in isolation; the defect is browser-only.
- Decisive asymmetry: the React-rendered minimap survived; the DOM-injected card (a child of the
  dangerouslySetInnerHTML body that React owns) vanished. Root cause: React re-commits the body's
  innerHTML on a re-render, wiping imperatively-injected children.

Fix: stop using dangerouslySetInnerHTML for the body. Set body.innerHTML imperatively in a
[html]-keyed effect so React no longer owns those children and can't re-commit/​wipe them (the
standard React escape hatch for non-React DOM). Cards + has-marker decoration are now stable.
Preserves nested-block markers and avoids HTML-splitting/layout risk. 50/50 tests pass; package +
vscode webview bundle rebuilt.

## Review phase

dev-approval approved (reviewer caught + I fixed two things at the gate: card flash-then-vanish,
and the marker accent bar crowding the text → added padding-left:10px).

Wrote codev/reviews/863-vscode-markdown-preview-marker.md (Summary + Architecture Updates [none —
internal-to-package] + Lessons Learned [added [From 863] React dangerouslySetInnerHTML re-commit
wipes injected children → cold lessons-learned.md, Debugging section]). Opened PR #1056 (Fixes #863),
recorded with porch. Ran `porch done 863` → single-pass 3-way consult in flight. Waiting at pr gate.

Side discussion w/ architect: edit/delete/reply/resolve are out of scope here (storage-format
blocked). Filed umbrella issue #1055 (Comment system v2) at architect's request.

## PR-stage 3-way consult (single advisory pass)

- gemini=APPROVE (off-track run — explored wrong dir, no weight)
- claude=APPROVE (HIGH, no key issues; 2 non-blocking notes: emoji portability, key=index → no change)
- codex=REQUEST_CHANGES (HIGH) — REAL: card stack injected per-[data-line] match, but renderer
  stamps same data-line on nested blocks (ul+li) → duplicate stack + invalid ul>ul DOM for
  list/blockquote/table markers. Minimap NOT affected (maps over markers, querySelector=outermost).

FIXED: anchor stack+has-marker to first (outermost) match per line via decoratedLines Set.
Regression test "anchors a single card stack to the OUTERMOST block…" — confirmed fails without
fix (expected 2 to be 1), passes with. 51/51 green. Rebuttal at codev/projects/863-*/...rebuttals.md.

Pushed to PR #1056. Notified architect (led with REQUEST_CHANGES + disposition; escalated that
PIR won't re-review). pr gate PENDING — waiting for human approval, then merge.
