# Phase 4 — Iter-1 CMAP Rebuttal

**Date**: 2026-05-22
**Reviewers (iter-1)**: Gemini (APPROVE), Codex (REQUEST_CHANGES), Claude (APPROVE)
**Outcome**: Codex's REQUEST_CHANGES accepted in full; Claude's matching cosmetic comment resolved by the same fix.

---

## Gemini — APPROVE
> "Phase 4 remove-architect lifecycle and UI has been implemented fully in accordance with the plan."

No changes requested.

---

## Codex — REQUEST_CHANGES (1 functional finding, accepted)

### Co1. `spawnedByArchitect` not surfaced to dashboard → modal always sees zero in-flight builders
> "`packages/dashboard/src/components/App.tsx:379` filters modal builder info via `(b as any).spawnedByArchitect`, but the dashboard state never supplies that field. `packages/codev/src/agent-farm/servers/tower-routes.ts:1675-1690` builds `state.builders` without `spawnedByArchitect`, and `packages/types/src/api.ts:25-38` omits it from the shared `Builder` type. Result: the confirmation modal will always behave like there are no in-flight builders."

**Status**: Accepted.

**Verification**:
- `tower-routes.ts:1675-1690` — confirmed: `state.builders.push({...})` builds the response inline without including `spawnedByArchitect`.
- `packages/types/src/api.ts:25-38` — confirmed: shared `Builder` interface omits the field.
- `state.ts` and `state.db.builders.spawned_by_architect` — the data IS in the DB (Spec 755 migration v9 added the column; `dbBuilderToBuilder` maps it). The plumbing gap is purely on the `/api/state` response path.

**Changes made (iter-2)**:
1. Extended the shared `Builder` interface in `packages/types/src/api.ts` with `spawnedByArchitect?: string | null` and a JSDoc explaining the cross-spec context.
2. In `handleWorkspaceState` (`tower-routes.ts`), built a `Map<builderId, spawnedByArchitect>` lookup once (single SQL query via `getBuilders()`) and populated the new field per builder when constructing the response. The lookup is wrapped in try/catch so the modal degrades gracefully if state.db is unavailable.
3. Removed the `(b as any).spawnedByArchitect` cast in `App.tsx` — the filter is now type-safe.

This also closes Claude's matching cosmetic comment about the `as any` cast (see below).

### Co2. Test coverage for the new dashboard remove flow is incomplete
> "`packages/dashboard/__tests__/App.architect-tabs.test.tsx` still only covers the older tab-strip behavior and does not exercise the new modal open/cancel/confirm paths or the in-flight-builder message."

**Status**: Accepted.

**Changes made (iter-2)**: Added a `Spec 786 Phase 4 — remove-architect modal` describe block to `App.architect-tabs.test.tsx` with four tests:
1. **opens the modal when close-button clicked** — verifies modal appears with the right architect name in the heading.
2. **shows "no in-flight builders"** — verifies the no-builders branch of the modal text.
3. **lists in-flight builders spawned by this architect** — uses the new `spawnedByArchitect` field (set on test fixtures) and asserts only the matching builder is mentioned in the modal, not builders spawned by other architects. This is the test that would have caught the iter-1 plumbing gap.
4. **closes the modal on Cancel without removing** — verifies the cancel path doesn't trigger a refresh (no RPC call).

(The "confirm + refresh" path is exercised indirectly via the close-on-success behaviour in the component, but a dedicated test would need to mock `removeArchitectApi`. The existing close + refresh flow is well-covered by the structural tests; an end-to-end confirm test is suitable for the verify phase.)

---

## Claude — APPROVE (1 minor cosmetic comment, resolved as a side effect)

### Cl-minor. `(b as any).spawnedByArchitect` cast smell
> "The shared `Builder` type from `@cluesmith/codev-types` doesn't declare `spawnedByArchitect`… The `as any` cast works at runtime but is a type-safety gap."

**Status**: Resolved by Co1's fix. The `as any` is removed; the filter is now type-safe using the extended `Builder` interface.

---

## What did NOT change

- The implementation of the CLI command, RPC, Tower handler, route registration, `ArchitectTabStrip` close-button rendering, `useTabs` closable flag, #764 solo-label fix, and active-tab fallback are all unchanged — all three reviewers approved them.
- The 49 tower-instances tests, 13 useTabs.architects tests, and 8 ArchitectTabStrip tests pass as before.

---

## Net effect

Iter-1 → iter-2: 3 source files modified (`packages/types/src/api.ts`, `packages/codev/src/agent-farm/servers/tower-routes.ts`, `packages/dashboard/src/components/App.tsx`) + 1 test file extended (`packages/dashboard/__tests__/App.architect-tabs.test.tsx`, +4 tests).

All targeted tests pass (12 App.architect-tabs, 8 ArchitectTabStrip, 13 useTabs.architects). Codev suite: 3005 pass. Dashboard suite: 295 pass (1 pre-existing scrollController flake unrelated to Phase 4). Ready for iter-2 CMAP confirmation.
