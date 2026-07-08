# Decision note — Q4: Per-architect / per-builder push controls

**Status**: Proposed (needs main's ratification; implementation is Phase 2 / cloud-gated)
**Date**: 2026-07-07
**Question** (interaction-model §9.4): User opts in to `main` but not `demos`; per-gate-type controls; DND schedules?

## Decision

**Two-axis matrix — event class × source — with attention-demanding defaults on and everything else off. DND delegates to the OS.**

1. **Axis 1, event class** (the primary control): `needs-you` (gates pending, `AskUserQuestion`, builder blocked, sibling-architect ping addressed to you) vs `informational` (phase changes, PR merged, spawns, cleanups). Default: `needs-you` ON, `informational` OFF. This is the May feasibility doc's "do not over-notify" anti-pattern made concrete: informational push is the churn vector.
2. **Axis 2, source scoping**: per-architect toggles (the multi-architect model makes architects the natural unit — `main` yes, `demos` no), with builders inheriting from their `spawned_by_architect` (the column exists in `global.db`). Per-builder overrides are v2; per-architect inheritance covers the stated use case without a settings jungle.
3. **No per-gate-type granularity in v1.** Gate types (spec-approval / plan-approval / dev-approval / pr) are all `needs-you` by definition; a user who doesn't want plan-approval pushes from an architect doesn't want that architect's pushes. Revisit only if usage data shows demand.
4. **DND: use the platform's.** iOS Focus modes and Android DND already do schedules, exceptions, and location awareness better than we ever will, and users already have them configured. We ship notification *channels/categories* (Android channels, iOS interruption levels) so the OS controls can discriminate; we do not build an in-app scheduler.

## Where the preference lives

Per-device, stored cloud-side with the device token record (from [[q2-auth-model]]) — the push fan-out must consult it *before* sending (server-side filtering), not deliver-then-mute (client-side filtering leaks content to APNs/FCM unnecessarily and burns battery).

## Related

- [[q2-auth-model]] (device records), [[q5-multi-workspace]] (workspace is a third implicit axis — a muted workspace mutes all its sources), issue #655 (cloud messaging carries the same event taxonomy).
