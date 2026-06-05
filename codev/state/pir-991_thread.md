# PIR #991 — dashboard terminal self-heals onto successor session after Tower restart

## Plan phase (current)

**Issue**: After a Tower restart, persistent terminal sessions reconnect under a new id; a dashboard tab holding the old `/ws/terminal/<oldId>` gets a permanent `4404` close and correctly gives up — but nothing triggers the `/api/state` re-fetch that would resolve the successor id and remount. Recovery is incidental (poll/focus/manual refresh).

**Key findings from investigation:**
- Recovery machinery already exists: `useBuilderStatus` polls `/api/state` every 1s + refreshes on SSE; `getTerminalWsPath` produces a new `wsPath` from the successor id; the `Terminal` effect is keyed on `[wsPath]` so it remounts on a new id.
- Tab identity is **stable** across the id swap (`useTabs` keys on `builder.id` / `architect` / `util.id`); only the `terminalId` field changes. So a refresh → new wsPath → remount = self-heal.
- Missing seam: the permanent-close branch (`Terminal.tsx:533-537`) doesn't nudge a re-fetch. The 1s poll is throttled to ~1/min when the tab is hidden, and SSE disconnects while hidden — hence "incidental."

**Chosen approach**: add `onPermanentClose?: () => void` to `Terminal`, wired to `refresh` in `App.tsx` at all 3 render sites. On permanent close: trigger refresh, show `reconnecting`, defer the give-up message behind a bounded `PERMANENT_RECOVERY_MS` (~4s) timer (avoids flashing "session gone" during a successful heal). Dashboard-only; no Tower/core changes.

**Scope decision**: VSCode terminal analogue left as a separate follow-up to keep `area/dashboard` single-area (issue notes folding it in would flip to `area/cross-cutting`).

Plan written to `codev/plans/991-terminal-stale-tab-on-a-pre-re.md`. Awaiting `plan-approval`.
