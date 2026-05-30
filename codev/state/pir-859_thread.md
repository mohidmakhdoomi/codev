# PIR #859 — markdown preview review comments

## Plan phase (2026-05-31)

Investigated the issue. **Core finding: the issue's stated mechanism is infeasible.**

The issue proposes injecting a script via `contributes.markdown.previewScripts` that
`postMessage`s back to the extension host. VS Code's built-in markdown preview does
**not** support preview→host messaging for contributed scripts:

- The built-in preview already calls `acquireVsCodeApi()` once (only one call allowed
  per webview), and does not expose the handle. A contributed script's second call throws.
- The host-side `onDidReceiveMessage` accepts only a fixed allowlist (`didClick`,
  `openLink`, `revealLine`, `cacheImageSizes`, …) with no passthrough — custom message
  types are dropped.
- `command:` URIs are blocked in the built-in preview (no `enableCommandUris`, no API to set it).
- The proposed first-class messaging API was filed and **closed out-of-scope**
  (microsoft/vscode#174080); related #122961 (as-designed), #84886 (out-of-scope).

So the `previewScripts` + `previewStyles` + `markdownItPlugins` approach in the issue body
cannot deliver "click + in the preview → host opens an InputBox".

**Recommended path (in plan):** Option A — a custom Codev webview that renders the eligible
markdown itself (via `markdown-it` + a small `data-line` source-map plugin), so we own the
single `acquireVsCodeApi()` and get real `postMessage` back to the host. Framed as an
optional CustomTextEditor ("Reopen With → Codev Review Preview"). The `writeReviewMarkerAt`
refactor from `plan-review.ts` is still valid and shared between editor + preview paths.

**Caveats flagged for architect at plan gate:** this is the extension's first webview, adds
`markdown-it`, and the affordance lives on a *separate* Codev preview (not the built-in
`Cmd+K V`). Materially larger than the issue advertised ("three contribution points"). Also
offered cheaper alternatives (defer/close; editor-side bridge) for the architect to choose.

Notified architect of the premise break. Plan committed, sitting at plan-approval gate.
