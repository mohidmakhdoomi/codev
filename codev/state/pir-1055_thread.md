# PIR #1055 — vscode: edit + preview-side delete on review comments

## Builder: pir-1055 (strict mode, PIR protocol)

### Plan phase (in progress)
Investigated the review-comment architecture:
- **Editor Comments-API surface**: `packages/vscode/src/comments/plan-review.ts` — creates one CommentThread per marker, anchored at the marker's own physical file line. Already has submit + delete. Menu wiring in `package.json` under `comments/commentThread/*`.
- **Preview surface**: `packages/vscode/src/markdown-preview/preview-provider.ts` (host) ↔ `webview/main.ts` ↔ `@cluesmith/codev-artifact-canvas` (`ArtifactCanvas.tsx`, `buildMarkerCards`). Host writes markers via WorkspaceEdit; webview emits intent messages (`messages.ts` union). Currently only `addComment`.
- **Codec**: `packages/core/src/review-markers.ts` — `parseReviewMarkers` returns `{author, line (anchor), text, raw}`. **Key gap**: no physical marker-line in the parsed model → needed for stacked-comment edit/delete identity.

Design: add `markerLine` (physical 0-based file line) to the parsed `ReviewMarker`; surface it through the message channel; add `editComment`/`deleteComment` webview→host messages with optimistic-concurrency check (`expectedAuthor` + `expectedBodyPrefix`) verified in core.

Plan-gate decisions surfaced (affordance UI, payload shape, race UX) per the issue.
