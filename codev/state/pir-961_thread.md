# PIR #961 — extract transport-agnostic reconnect policy

## 2026-06-02 — Plan phase

Investigated all four call sites + the EscapeBuffer precedent + test/CI wiring.

### Call-site map (confirmed)
| Site | curve | cap | maxAttempts | classifier | counter order |
|---|---|---|---|---|---|
| `vscode/connection-manager.ts:177` (SSE) | 1000·2^n | 30s | ∞ | none | delay-then-increment |
| `vscode/terminal-adapter.ts:208` (WS) | 1000·2^n | 30s | 6 (give-up + #939 link) | 4xx-upgrade regex | delay-then-increment |
| `dashboard/Terminal.tsx:533` (WS) | 1000·2^n | 30s | 50 (→ silent 'disconnected') | none (onerror no-op) | delay-then-increment |
| `codev/.../tunnel-client.ts:69` | 1000·2^n **+jitter** | **60s** | ∞ (**5-min floor after 10**) | none (JSON auth vocab) | **increment-then-delay** |

### Decisions reached (recommendations, pending plan-approval)
1. **6-vs-50** → unify on **6** for both terminal surfaces.
2. **Web session-unknown** → **kept-as-is (blind retry)**. Hard constraint: Tower 404s at the WS *upgrade* stage; browser `WebSocket` cannot read that status. Real adoption needs a Tower close-code change = separate issue. Classifier shipped accepts a numeric `code` so future wiring is one line.
3. **Web recovery affordance** → coupled to #1. Dropping to 6 without recovery would regress (today's reconnect button only refit+SIGWINCHes a live socket; post-give-up the only recovery is page reload). Recommend enriching the *existing* button to do a true from-disconnected reconnect. Small, contained.
4. **SSE + tunnel** → share the pure curve fn, NOT the controller's give-up nor the classifier. Tunnel keeps its jitter/60s/5-min-floor/circuit-breaker host-side.

### Factoring chosen
- `backoffDelayMs(attempt, opts)` — the ONE shared curve (all 4 sites). Preserves each site's counter ordering since attempt is an explicit arg.
- `BackoffController` — counter+status+give-up wrapper for the two terminal surfaces (where 6-vs-50 unification lives).
- `classifyUpgradeError(reason)` — for VSCode (string form) + forward-looking object/code form for web.

### Open plan-gate decision
Core has no test suite (precedent EscapeBuffer is tested from dashboard). CI unit job runs only `packages/codev` vitest. Recommending: bootstrap vitest in core + add a CI step (proper home, satisfies acceptance literally). Lighter alt: co-locate tests in `packages/codev`. Flagged in plan.

Plan written; awaiting plan-approval gate.

## 2026-06-02 — Implement phase (plan approved)

Built `packages/core/src/reconnect-policy.ts` (`backoffDelayMs` + `BackoffController` + `classifyUpgradeError`) and adopted at all four sites exactly as planned. Factoring held up: the pure curve fn with an explicit `attempt` arg let the tunnel keep its increment→delay ordering while the terminals use the controller.

Bootstrapped vitest in core (had none) — 17 tests, all green. Added a CI step (`packages/core` → `pnpm test`).

### Verification
- core: build ✓, 17 tests ✓
- vscode: `tsc --noEmit` ✓, 222 unit tests ✓ (terminal-adapter close-loop exercises the *real* controller — no mock — and still asserts `[1s,2s,4s,8s,16s,30s]`→give-up)
- codev: tunnel-client + edge-cases 78 tests ✓ (`calculateBackoff` signature/behavior preserved)
- dashboard: `tsc -b` ✓, reconnect suite 12 ✓ (updated for 6-attempt contract + new recovery-affordance test)

### Pre-existing failure (OUT OF SCOPE — not my diff)
`dashboard/__tests__/scrollController.test.ts > warns on unexpected scroll-to-top` fails on a clean tree too (verified by stashing my Terminal.tsx change — the test imports only `ScrollController`, never `Terminal`). Noting for the review's Lessons Learned; not fixing per protocol.

Pushing branch; will pause at dev-approval for the cross-surface forced-give-up smoke test.
