# PIR #991 — dashboard terminal self-heals onto successor session after Tower restart

## Plan phase (current)

**Issue**: After a Tower restart, persistent terminal sessions reconnect under a new id; a dashboard tab holding the old `/ws/terminal/<oldId>` gets a permanent `4404` close and correctly gives up — but nothing triggers the `/api/state` re-fetch that would resolve the successor id and remount. Recovery is incidental (poll/focus/manual refresh).

**Key findings from investigation:**
- Recovery machinery already exists: `useBuilderStatus` polls `/api/state` every 1s + refreshes on SSE; `getTerminalWsPath` produces a new `wsPath` from the successor id; the `Terminal` effect is keyed on `[wsPath]` so it remounts on a new id.
- Tab identity is **stable** across the id swap (`useTabs` keys on `builder.id` / `architect` / `util.id`); only the `terminalId` field changes. So a refresh → new wsPath → remount = self-heal.
- Missing seam: the permanent-close branch (`Terminal.tsx:533-537`) doesn't nudge a re-fetch. The 1s poll is throttled to ~1/min when the tab is hidden, and SSE disconnects while hidden — hence "incidental."

**Chosen approach**: add `onPermanentClose?: () => void` to `Terminal`, wired to `refresh` in `App.tsx` at all 3 render sites. On permanent close: trigger refresh, show `reconnecting`, defer the give-up message behind a bounded `PERMANENT_RECOVERY_MS` (~4s) timer (avoids flashing "session gone" during a successful heal). Dashboard-only; no Tower/core changes.

**Scope decision (resolved)**: Architect chose **Option B** — fold VSCode in, relabel `area/cross-cutting`. There was NO existing GitHub issue for the VSCode successor remount (#936 added VSCode give-up/backoff but not auto-remount); #991's Notes were the only tracker. Both surfaces had the same hole.

## Plan revised — both surfaces + shared core helper

Architecture (matches #961/#971 cross-cutting pattern):
- **Core** (`@cluesmith/codev-core/session-successor`): new pure `resolveSuccessorTerminalId(state, ref)` over the shared `DashboardState` wire type. Resolves builder (via existing `resolveAgentName`) + architect (by name) → current terminalId. Only builder/architect are persistent/restart-reconciled (shells/dev are not), so the `SessionRef` union is scoped to those two.
- **VSCode glue**: adapter gets `onSessionGone?` seam → manager `recoverSuccessor(mapKey)` re-fetches `getWorkspaceState`, resolves successor via the helper, reopens via existing stale-replace (`openBuilder`/`openArchitect`). Also routes the manual `reconnectByTerminal` link through it (fixes the dead-URL retry bug).
- **Dashboard glue**: Terminal `onPermanentClose` → App `refresh()` → reactive `useTabs` rebuild → new wsPath → remount (unchanged from v1). Plus reconnecting-status + bounded deferred give-up message.

**Honest design note flagged to architect at the gate**: the dashboard does NOT directly consume the core helper — its `useTabs` already resolves the successor reactively by stable tab id, so forcing helper consumption would mean plumbing a SessionRef into Terminal + duplicating useTabs. Recommended: helper in core (consumed by VSCode), dashboard stays reactive. Architect can overrule.

Key findings backing this:
- VSCode `terminals` map keyed by stable identity (`builder-<id>`, `architect:<name>`); entries store current `terminalId`. `openBuilder`/`openArchitect` already do stale-replace (dispose+reopen on id change). `openBuilderByRoleOrId` already fetches state + resolves successor for builders.
- Give-up path (`reconnectByTerminal` → `pty.reconnect()` no URL) is the ONLY thing that bypasses all of it → blindly retries dead id. That's the gap.
- `getWorkspaceState` (core `tower-client.ts`) returns the SAME `DashboardState` the dashboard `/api/state` returns → helper is a clean fit for both.

dev-approval verification will exercise BOTH surfaces against a forced Tower restart (architect's explicit requirement).

Plan v2 committed. Awaiting `plan-approval`.
