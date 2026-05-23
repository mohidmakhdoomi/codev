# Review — iter-1 CMAP Rebuttal

**Date**: 2026-05-22
**Reviewers**: Gemini (APPROVE), Codex (COMMENT), Claude (APPROVE)

---

## Summary

Review CMAP converged at APPROVE/COMMENT/APPROVE. Codex's single COMMENT-level finding (missing tests for the two workspace-scoped emit paths added in Phase 4 iter-1) addressed with 4 new tests. Gemini and Claude both clean APPROVEs with no findings.

---

## Gemini (APPROVE) — clean

No findings. Review document accurately reflects the four phases, lessons learned, consultation iteration history, and follow-up items. PR_SUMMARY provided.

---

## Codex (COMMENT) — one finding addressed

### C-R1-1. Missing direct tests for two workspace-scoped emit paths

**Finding**: `tower-routes.ts` now emits `architects-updated` from FOUR success paths (handleAddArchitect, handleRemoveArchitect, handleWorkspaceRoutes DELETE `/workspace/<encoded>/api/architects/:name`, handleWorkspaceTabDelete `/workspace/<encoded>/api/tabs/architect:<name>`). The unit tests in `tower-routes.test.ts` only directly exercise the first two (the top-level `/api/workspaces/<encoded>/architects/...` routes). The two workspace-scoped variants are not directly tested.

**Verification**: Confirmed. The Phase 4 iter-1 corrections added the emit calls but did not add corresponding tests for the new sites.

**Resolution**: Added 4 new tests to `tower-routes.test.ts`:

1. `handleWorkspaceRoutes DELETE /workspace/<encoded>/api/architects/:name` emits `architects-updated` on success.
2. Same path does NOT emit on failure (e.g. "Cannot remove main").
3. `handleWorkspaceTabDelete /workspace/<encoded>/api/tabs/architect:<name>` emits `architects-updated` on success (validates the 204 No Content response status too).
4. Same path does NOT emit on failure (e.g. "Architect not found").

Tower-routes test suite went from 76 → 80 tests, all passing.

**Where**: `packages/codev/src/agent-farm/__tests__/tower-routes.test.ts` — appended to the "Spec 823: architects-updated SSE emission" describe block.

---

## Claude (APPROVE) — clean

No findings. PR_SUMMARY provided.

---

## Net review change summary (iter-1)

- **4 new tests** in `tower-routes.test.ts` (the two workspace-scoped emit paths × success + failure cases).
- **No findings rejected.** Codex's COMMENT was valid; the two added paths needed direct coverage.

## Final test count for Spec 823

| File | New tests for Spec 823 |
|---|---|
| `packages/dashboard/__tests__/BuilderCard.test.tsx` | 6 |
| `packages/codev/src/agent-farm/__tests__/overview.test.ts` (Spec 823 describe) | 4 |
| `packages/codev/src/agent-farm/__tests__/tower-routes.test.ts` (Spec 823 describe) | 9 (5 originally + 4 review iter-1) |
| `packages/vscode/src/__tests__/workspace.test.ts` (Spec 823 describe) | 4 (source-grep) |
| `packages/vscode/src/__tests__/workspace-sse-subscriber.test.ts` | 9 (runtime behavior) |
| `packages/codev/src/agent-farm/__tests__/e2e/spec-823-builder-attribution.test.ts` | 4 (Playwright) |
| **Total new tests** | **36** |

## PR readiness

The review document is now reviewer-converged. The PR (#824) is open and the architect can review at the `pr` gate.
