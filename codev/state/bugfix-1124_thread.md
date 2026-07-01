# bugfix-1124 thread — SSE thundering herd / ephemeral port exhaustion

## Investigate phase started

Issue #1124: Tower SSE endpoint evicts oldest client when at cap (50), causing a reconnect cascade that exhausts ephemeral ports via TIME_WAIT accumulation.

Reading the four code locations identified in the issue to confirm root cause.

Root cause confirmed across all five vectors. Bug fits BUGFIX scope (< 300 LOC).

## Fix phase

Five changes applied:

1. **Reject instead of evict** (tower-server.ts `addSseClient`): Returns `false` at cap instead of `sseClients.shift()` + `res.end()`. The handler (tower-routes.ts `handleSSEEvents`) now checks the return value and responds 503 + `Retry-After: 5` before writing SSE headers. Rejection is a dead end; eviction was a chain reaction.

2. **Cap raised 50 → 200**: SSE connections are lightweight (one open response per client). 50 was too low for workstations with many builders + dashboard tabs.

3. **`retry: 5000` SSE directive**: Sent immediately after SSE connection setup. Browsers respect this field and wait 5 seconds before reconnecting, reducing churn.

4. **Logging throttled**: Removed per-client connect/disconnect INFO logs. Heartbeat log also removed (the heartbeat still runs for dead-client detection and max-age eviction, just doesn't log every 30s cycle).

5. **Jitter on max-age eviction**: `SSEClient.maxAgeJitterMs` field assigned randomly in [-60s, +60s] at connect time. The heartbeat interval uses `SSE_MAX_AGE_BASE_MS + client.maxAgeJitterMs` instead of a fixed 5-minute cutoff. Prevents synchronized eviction bursts.

Three regression tests added to tower-routes.test.ts:
- 503 rejection when addSseClient returns false
- `retry: 5000` directive present in SSE stream
- No cleanup listeners registered after rejection

All 87 tower-routes tests pass. Build passes.

## CMAP review — Gemini finding addressed

Gemini identified that browser `EventSource` transitions to `CLOSED` (readyState === 2) on a non-200 response (our 503) and does NOT auto-reconnect. The dashboard's `useSSE.ts` hook assumed auto-reconnect on all errors. Fixed by adding manual reconnection with 2-5s jitter when `readyState === EventSource.CLOSED`. VSCode extension and legacy `tower.html` already use fetch-based SSE with their own retry logic — no change needed there.

Added regression test in `useSSE.reconnect.test.ts`. All 6 dashboard SSE tests pass.
