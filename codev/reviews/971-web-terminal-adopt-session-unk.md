# PIR Review: Web terminal session-unknown fast-path (browser-visible Tower close code)

Fixes #971

## Summary

The web (dashboard) terminal previously blind-retried for the full 6-attempt backoff (~60 s) before giving up when a session no longer existed on Tower, because a browser can't read a failed WebSocket *upgrade*'s HTTP status (it only sees close `1006`). This change makes Tower, **for browser clients only**, accept the upgrade to an unknown session and immediately close with an app-range code (`4404`); the core `classifyUpgradeError` helper now classifies `4404` as `permanent`; and the dashboard's `onclose` consults the classifier and gives up immediately. The VSCode/Node path is untouched — it still receives the HTTP `404` upgrade rejection it relies on (#936), so there is no regression.

## Files Changed

- `packages/core/src/reconnect-policy.ts` (+25 / -10) — `WS_CLOSE_SESSION_UNKNOWN = 4404` export; `code === 4404 → permanent` branch; doc comment for the overloaded `code` meaning
- `packages/core/src/__tests__/reconnect-policy.test.ts` (+14 / -0) — `4404` permanent + non-4404 WS-code transient cases
- `packages/codev/src/agent-farm/servers/tower-websocket.ts` (+37 / -4) — `rejectUnknownSession()` helper (Origin-based browser/Node discriminator); wired both session-not-found sites
- `packages/codev/src/agent-farm/__tests__/tower-websocket.test.ts` (+62 / -2) — browser-path (4404) + Node-path (404) cases for both routes
- `packages/dashboard/src/components/Terminal.tsx` (+14 / -6) — `onclose(event)` fast-path on `permanent`

## Commits

- `c7ad5b2e` [PIR #971] core: classify WS close code 4404 (session-unknown) as permanent
- `8e4b62d2` [PIR #971] tower: emit browser-visible 4404 close for unknown session
- `aa2fa0f2` [PIR #971] dashboard: fast-path give-up on permanent close (4404)
- (plus `[PIR #971]` thread-log commits)

## Test Results

- `pnpm build`: ✓ (core, codev, dashboard — tsc + vite)
- `pnpm test`: ✓ core reconnect-policy 19/19; tower-websocket 27/27; full codev suite 3224 passed / 13 skipped / 0 failed
- Manual verification: the human reviewed the running worktree at the `dev-approval` gate (kill a session Tower-side → web terminal gives up immediately, no full backoff; VSCode terminal fast-path unchanged).

## Architecture Updates

No `arch.md` changes needed. The reconnect architecture (`ReconnectPolicy` in core, `SessionManager` reconnection, ring-buffer replay) is already documented and unchanged; this PR extends the existing `classifyUpgradeError` seam and adds a localized Origin-based discriminator in the upgrade handler — no module boundary or data-flow change.

## Lessons Learned Updates

Two durable entries added to `codev/resources/lessons-learned.md` (both `[From #971]`):
1. The **`Origin`-header discriminator** for making Tower's session-unknown rejection browser-readable without regressing the Node path, and that the classifier stays a pure predicate (retry policy lives in callers).
2. The **id-reassignment finding**: a "rehydrate before declaring session-unknown" guard would be dead code, because both shellper-reconnect paths reassign the terminal id — the old id in a stale tab is permanently dead, so the give-up code is always truthful and recovery is a state re-fetch + remount, not a WS retry. General principle: before adding a "wait and retry" affordance keyed on an identifier, check whether the recovery path preserves that identifier.

## Things to Look At During PR Review

- **The browser/Node discriminator is the `Origin` header** (`tower-websocket.ts` `rejectUnknownSession`). This is the crux of the no-regression guarantee: Node `ws` clients send no `Origin`, so they keep the HTTP `404` path; browsers always send it, so they get the `4404` close. A browser without `Origin` degrades to blind retry (no worse than today).
- **Only the two session-not-found sites emit `4404`.** The other `404`/`400` rejections (unhandled route, missing/invalid workspace path) stay as HTTP rejections — they're routing errors, not the stale-session case.
- **Kept the `400–499` HTTP-range check** in the classifier's object form (disjoint from WS close-code ranges `1000–1015`/`3000–3999`/`4000–4999`, so it can never misclassify a `CloseEvent.code`; preserves the existing object-`code` contract/tests).
- **One transient retry before give-up is expected** when a session is killed mid-connection: the first drop is `1006` (transient → one retry), the reconnect attempt hits `4404` → give up. Matches the VSCode sequence.
- **Follow-up #991 (filed, tagged here):** a stale tab on a *pre-restart* terminal id can't self-recover without a state re-fetch, because persistent sessions return under a new id after a Tower restart. This PR's give-up is correct; the auto-remount-onto-successor-id affordance is deferred to #991. Rationale captured in lessons-learned and the project thread.

## How to Test Locally

- **View diff**: VSCode sidebar → right-click builder `pir-971` → **Review Diff**
- **Run dev server**: VSCode sidebar → **Run Dev Server**, or `afx dev pir-971`
- **What to verify**:
  - Open a dashboard terminal, kill that session Tower-side → web terminal flips to disconnected promptly (one transient retry at most, not the full ~60 s backoff) with the "session no longer exists" notice; the refresh button still reconnects.
  - Regression: kill a VSCode terminal's session → still fast-paths to the red "session no longer exists" notice with the reconnect link (unchanged).
  - Transient recovery: a brief Tower restart that re-creates the session still recovers via blind retry on both surfaces.

## Related Issues

- Fixes #971
- Refs #961 (extracted the `classifyUpgradeError` seam this PR makes live)
- Refs #991 (follow-up: stale-tab auto-remount onto successor session id)
