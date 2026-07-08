# Decision note — Q3: Offline behavior

**Status**: Proposed (needs main's ratification before any implementation)
**Date**: 2026-07-07
**Question** (interaction-model §9.3): Feed cache? Outbound message queue? What happens to an `AskUserQuestion` fired while the user is offline for two hours?

## Ground truth (verified against repo, 2026-07-07)

- Tower's real-time channel to the dashboard is an SSE bus whose events are *refetch triggers*, not payloads (`packages/types/src/sse.ts`: `overview-changed | notification | builder-spawned | connected | heartbeat`). The dashboard's hooks poll + refetch on any event. There is no replayable, cursored event log today.
- Server state is snapshot-shaped: `GET /api/overview` returns the full current picture (builders, gates, pending PRs, backlog, architects) on every call.
- `question_pending` persistence (interaction-model §8.1) does not exist yet; it is proposed plumbing.

## Decision

**Design offline around snapshots + server-held pending state, not around an event-log sync protocol.**

1. **Feed cache: last-snapshot, not event replay.** On reconnect/foreground, refetch `/api/overview` (and the feed's backing queries) and re-render. Cache the last successful snapshot locally so the app opens instantly to slightly-stale data with a staleness banner. Do NOT build client-side event-log reconciliation — Tower has no cursored log to reconcile against, and the snapshot model makes it unnecessary. (If a true activity feed ships Tower-side later, revisit; the feed itself should still be server-materialized, arriving as a paginated query, not a client-assembled event fold.)
2. **Outbound queue: single-slot draft, not a mailbox.** Offline sends are held locally and flagged "will send when connected", with a visible pending chip and a cancel affordance. Cap the queue small (one per conversation target). Rationale: messages to an *agent* are time-sensitive context — a 2-hour-old "yes go ahead" auto-firing into a conversation that has moved on is actively harmful. On reconnect, if the target's state changed materially since composing (new gate, new phase), require a confirm-before-send tap instead of auto-flushing.
3. **`AskUserQuestion` while offline 2 hours: the question is server-held pending state, answered late or expired — never queued client-side.**
   - The pending question lives in Tower (the proposed `pending_question` persistence, §8.1) with a state machine: `pending → answered | expired | superseded`.
   - When the user comes back online, `usePendingQuestion()` refetches: if still `pending`, show the card (with an "asked 2h ago" timestamp); if `expired`/`superseded` (the agent timed out, moved on, or the question was answered from another surface), show it as a historical feed row, not an actionable card.
   - Answer submission must be **compare-and-set** on the question id + state, so a stale card can never inject an answer into a conversation that moved on. `question_resolved` (§8.3) is the cross-surface invalidation signal.
   - Push (v1+, cloud-dependent) is the wake mechanism; offline delivery is simply "the push waits on APNs/FCM and the truth is re-fetched on open." No client-side question queue exists in any version.
4. **Approvals are never queued.** Gate approve/reject taps require a live connection; offline tap = immediate "you're offline" feedback. A queued approval is an approval of a state you can no longer see.

## Consequence for Tower plumbing (coordinate with main)

The `pending_question` design (§8.1–8.3) must include from day one: `created_at`, a terminal state (`answered | expired | superseded`), the resolving surface, and compare-and-set semantics on resolution. This benefits the web dashboard identically (two browser tabs have the same double-answer race today-by-construction once the feature exists).

## Related

- [[q6-session-presence]] — presence is derived from the same snapshot/refetch model.
- interaction-model §8 (Tower-side plumbing), §9.3.
