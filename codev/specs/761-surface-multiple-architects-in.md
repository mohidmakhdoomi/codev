# Specification: Surface Multiple Architects in Tower Dashboard, VSCode Extension, and `afx status`

## Metadata
- **ID**: 761-surface-multiple-architects-in
- **Status**: draft
- **Created**: 2026-05-18
- **Protocol**: SPIR
- **GitHub Issue**: #761
- **Predecessor**: spec/PR #755 / #757

## Problem Statement

PR #757 (spec #755) shipped the **plumbing** for the sibling-architect pattern: Tower can hold N named architect terminals per workspace, each with a stable name; builders persist `spawnedByArchitect`; and `afx send architect` from a builder routes back to its spawning architect specifically.

But spec #755 deliberately kept the **user-facing surface scalar** — explicitly: "`/api/state` shape is unchanged in v1; the dashboard sees the `main` architect (or first registered)." The result is that a workspace can host two architects today and routing works correctly, but the human running both architects has **no clickable way to access the second architect's terminal** from either the Tower dashboard or the VS Code extension. They have to read the terminal ID from the spawn output and either deep-link manually (`?tab=architect` only opens the `main`/first one) or memorise the terminal ID.

That makes the feature half-shipped: the protocol-level fix is in place but the day-to-day driving surfaces — dashboard tabs, VS Code Workspace view, `afx status` — still pretend there is exactly one architect.

This spec scopes a v1 UI surface change to make the multi-architect topology first-class throughout the user-facing layer, without touching any routing logic.

## Current State

**Internally Tower already supports N architects.** `WorkspaceTerminals.architects` (`packages/codev/src/agent-farm/servers/tower-types.ts:41-46`) is a `Map<string, string>` keyed by architect name. `addArchitect()` in `tower-instances.ts` registers each named architect into the map. The local `state.db` `architect` table and the global `terminal_sessions` `role_id` both store names. Routing already uses these names.

**Surface layers collapse the collection to a scalar.** The collapse happens in three places:

1. **`/api/state` handler** (`packages/codev/src/agent-farm/servers/tower-routes.ts:1472-1486`) emits a scalar `architect: { port, pid, terminalId?, persistent? } | null`, populated from `entry.architects.get('main') ?? entry.architects.values().next().value`. Architects beyond the first are not exposed.
2. **`getTerminalsForWorkspace()`** (`packages/codev/src/agent-farm/servers/tower-terminals.ts:928-940`) registers every named architect into the in-memory map but emits exactly one `TerminalEntry` of type `'architect'` with hard-coded `id: 'architect'` and `label: 'Architect'`. There is therefore one architect entry in `InstanceStatus.terminals`, regardless of how many architects are registered.
3. **`architectUrl`** (`packages/codev/src/agent-farm/servers/tower-instances.ts:205`) is a scalar `${proxyUrl}?tab=architect` deep link. The dashboard's `useTabs.ts` reads `?tab=` and matches `'architect'` by type — there is no `?tab=architect-2` path.

**Dashboard consumes the scalar.** `useTabs.ts:27-29` pushes a single `{ id: 'architect', type: 'architect', label: 'Architect', ... }` tab when `state.architect` is present. `App.tsx:184` finds that one tab and renders it in the left pane of the desktop SplitPane (or in the mobile tab bar). The right-side `TabBar` filters out `t.type === 'architect'` (`App.tsx:256`).

**VS Code extension** (`packages/vscode/src/views/workspace.ts:23-34`) renders a single hard-coded `TreeItem('Open Architect')` whose command is `codev.openArchitectTerminal`. That command (`packages/vscode/src/extension.ts:140-157`) reads `state.architect.terminalId` from the workspace state and opens it via `terminalManager.openArchitect(...)`. There is no surface for a second architect.

**`afx status`** (`packages/codev/src/agent-farm/commands/status.ts`) has two code paths:
- Tower-running path (lines 44-71) reads `workspaceStatus.terminals` and prints each terminal one per line. Because `getTerminalsForWorkspace` collapses to one architect entry, the user sees a single line: `architect - Architect (active)`. Architect names are invisible.
- Tower-not-running path (lines 82-92) reads local `state.architect` scalar. (`state.ts` already has a `main`-only shim since spec #755, so this only ever sees `main`.)

There is no `--architect <name>` filter on builders, even though `state.db`'s `builders` table now has `spawned_by_architect TEXT`.

**Net result**: a sibling-architect workspace has its second architect terminal registered in Tower (the human can route to it from `afx send architect`), but they cannot **see** or **click** it anywhere in the standard UX. To open the second architect's terminal in the dashboard, the user must know its terminal ID (visible only in spawn-time log lines) and construct a URL manually. To open it in VS Code they must do the same and use `codev.openTerminalById` (if such a thing exists; today it does not). To find out which architect spawned which builder, they have to read `state.db` directly.

This is exactly what the spec #755 architect comments flagged for follow-up: "Filtering and dashboard surfacing is out of scope for v1; will be picked up by issue #2 (per-architect identity in spawn + status)." Issue #761 *is* that issue, scoped to the UX side specifically.

## Desired State

A sibling-architect workspace is visible and operable from every standard Codev driving surface:

- The dashboard shows **one architect tab per architect**, labelled by name. Switching between them is a single click; the selected architect is remembered per workspace across page loads.
- The VS Code extension Workspace sidebar shows **one row per architect**, each opening that architect's terminal in a VS Code tab named `Codev: <name> (architect)`.
- `afx status` shows the **list of registered architects** (with their names) and supports `--architect <name>` to filter the builder list to those spawned by that architect.
- `/api/state` exposes the **full architects collection** so all three surfaces can consume it from a single source of truth.

**Single-architect workspaces show zero visual change.** A workspace with just `main` looks identical in dashboard, VS Code, and `afx status` to its pre-#761 appearance — same single tab in the left pane, same single "Open Architect" row in the sidebar, same single line in `afx status`. The multi-architect UI elements only manifest when N > 1.

## Scope

### In scope (v1)

1. **`/api/state` exposes the full architects collection.** Add `architects: Array<{ name, terminalId, port, pid, persistent }>` (or an equivalent keyed object — plan-phase decision) to the `DashboardState` response. The scalar `state.architect` field is preserved as a backward-compat convenience pointer to `main` (or first registered), with the same shape it has today. The plan phase audits consumers and decides whether to deprecate it; the spec only requires that *both* shapes are valid at the response level for one release cycle so the dashboard and VS Code extension can migrate independently.

2. **Dashboard renders one tab per architect when N > 1.**
   - **Tab label** = architect name (`main`, `architect-2`, or whatever custom name was supplied).
   - **Tab body** = that architect's terminal, rendered the same way the single architect terminal is rendered today (xterm WebSocket, `persistent` flag respected).
   - **Active-tab persistence per workspace**: the active architect is remembered in `localStorage` keyed by workspace path, so a page refresh returns the user to the same architect they were viewing. The persistence key is plan-phase-defined.
   - **Layout placement**: on desktop, the architect terminals live in the left pane of the existing SplitPane. When N = 1 the pane contains a single bare terminal (no tab strip — current visual exactly). When N > 1 the pane gains a small tab strip *inside the pane* listing the N architects; the body shows the active architect's terminal. On mobile, architect tabs appear in the main TabBar like builder/shell tabs do today; with N > 1 there are N architect-typed entries.
   - **Deep linking**: `?tab=architect` continues to select the first architect tab (backward compat). `?tab=architect:<name>` selects the named architect tab. The colon separator follows the existing pattern; the plan phase confirms or proposes an alternative.
   - **Single-architect appearance unchanged**: when N = 1, no architect tab strip is rendered in the left pane; the visual is byte-identical to today's single-architect dashboard.

3. **VS Code extension Workspace sidebar lists all architects.** Replace the single `TreeItem('Open Architect')` with one row per registered architect. Each row's label is the architect's name (`main`, `architect-2`, …); each row's command opens that architect's terminal in a VS Code tab named `Codev: <name> (architect)`. When N = 1 the sidebar shows exactly one row labelled `main` — visually almost identical to today's "Open Architect" (the label change from `Open Architect` to `main` is the only delta, and is necessary so users learn the name they will use for routing). Plan phase decides whether to add `(architect)` suffix on the row label for clarity, or rely on the section header / icon.

4. **`afx status` shows architect names.** Add a header line (or section) listing registered architects by name alongside builders. Example shape (final formatting is plan-phase):
   ```
   Architects: main, sibling
   ```
   When Tower is running, this is read from `/api/state` via the new `architects` collection. When Tower is not running, it is read from `state.db`'s `architect` table (which already stores `id TEXT` = name).

5. **`afx status --architect <name>` filters builders.** Adds a `--architect <name>` flag on `afx status`. When set, the builders list is filtered to those whose `spawned_by_architect = <name>`. Unknown name fails with a clear error listing the registered architects. Flag name confirmed in plan phase (the issue text proposes `--architect`; `--owned-by` is a plausible alternative — plan phase to pick one and document the rationale).

6. **Backward compatibility**:
   - Single-architect workspaces see **no behavior change** in any of the four surfaces (dashboard layout, VSCode sidebar, `afx status` output, `/api/state` consumers).
   - The scalar `state.architect` field on `/api/state` is preserved for at least this release cycle so VSCode extension users who have not yet updated continue to work.
   - The `?tab=architect` deep-link path continues to land on a valid architect tab (the first one, or `main`).
   - Existing `afx status` output for solo-architect workspaces is byte-stable except for one new line: the `Architects: main` header. (If this line is judged visually disruptive for solo users in plan-phase consultation, the plan may opt to omit it when N = 1; the spec requires only that names are *available* in the output, not that they always appear as a header.)

### Out of scope (deferred follow-ups)

These items from the original issue #755 follow-up list are **not** addressed by this spec:

- `THREAD.md` template + lifecycle (`codev thread new/list/archive`) — #755 follow-up #3.
- Cross-thread visibility (`codev thread show <name>`) — #755 follow-up #4.
- Thread-aware `consult` (`consult --thread <name>` or `.thread` auto-detection) — #755 follow-up #5.

These remain as separate follow-up issues and would not be unblocked by 761.

### Explicitly NOT in scope

- **No routing logic touched.** The affinity-routing primitive (builder → spawning architect) is already in place from PR #757. This spec only changes the user-facing surface.
- **No new architect-identity model.** Names are the identity, exactly as established in spec #755. No new fields on `ArchitectState`, `Builder`, or related types beyond what's needed to surface existing names.
- **No new architect-creation CLI.** `afx workspace add-architect --name <name>` from #755 stays as the way to create additional architects. 761 does not add a creation surface inside the dashboard or VS Code.
- **No multi-architect-aware send.** `afx send architect` continues to use the builder's recorded `spawnedByArchitect` for routing. The dashboard / VS Code do not gain a "send to architect by name" UI.
- **No name-rename UI.** Architect names are set at registration and immutable for v1. Renaming is left for a future spec if demand arises.
- **No removal of the scalar `state.architect` field on `/api/state`.** The spec keeps it as a backward-compat pointer; a follow-up spec may deprecate and remove it once all consumers (including external clients) have migrated.

## Stakeholders

- **Primary**: Codev consumers running the sibling-architect pattern (the user that motivated #755/#761, plus future adopters of the pattern).
- **Secondary**: Solo-architect users — must see **zero behavior change**. This is a hard constraint, not an aspiration.
- **Technical Team**: Codev maintainers (Tower routes, dashboard React, VSCode extension, `afx` CLI).
- **Business Owner**: M Waleed Kadous (architect role for Codev).

## Success Criteria

- [ ] In a workspace with two architects (`main` + `sibling`), the Tower dashboard shows two architect tabs labelled `main` and `sibling`. Clicking each opens its terminal.
- [ ] Active architect tab is persisted per workspace in `localStorage`; page refresh restores the previously-selected architect.
- [ ] In the same workspace, the VS Code extension Workspace sidebar shows two rows, one per architect; clicking each opens that architect's terminal as a VS Code tab named `Codev: <name> (architect)`.
- [ ] `afx status` in the multi-architect workspace shows both architect names (header line or equivalent).
- [ ] `afx status --architect main` filters the builders list to only builders whose `spawned_by_architect = 'main'`. `afx status --architect sibling` filters to sibling's builders. `afx status --architect nonexistent` exits with non-zero status and prints an error listing the registered architects.
- [ ] `/api/state` response includes an `architects` array (or keyed object) listing every registered architect with name, terminalId, port, pid, persistent. The scalar `state.architect` field continues to be returned and points to `main` (or first registered).
- [ ] A single-architect workspace (only `main`) shows **byte-identical** dashboard layout, VSCode sidebar rendering, and `afx status` output to the pre-#761 baseline — modulo the one new `Architects: main` line in `afx status`, which the plan phase may suppress for N = 1 if that's preferred (the spec only requires that name-discovery is *possible*, not that it is always displayed when N = 1).
- [ ] Deep link `?tab=architect` continues to land on a valid architect tab (defined as `main` if present, else first registered). Deep link `?tab=architect:<name>` lands on the named architect's tab; unknown name falls back to the default.
- [ ] All existing tests pass; new tests cover the routing matrix:
  - Dashboard: tab-strip presence for N>1, absence for N=1, active-tab persistence across reload, deep-link `?tab=architect` and `?tab=architect:<name>`.
  - VSCode extension: tree-view rendering for N=1 and N=2; click-to-open command invokes the correct terminal ID.
  - `afx status`: header presence for N>1, `--architect <name>` filter behaviour, unknown-name error text.
  - `/api/state`: `architects` collection contents, scalar `architect` preserved, both shapes consistent with the in-memory `WorkspaceTerminals.architects` map.

## Constraints

### Technical constraints

- **No routing logic change.** Only `/api/state`, the dashboard React layer, the VS Code extension tree view, the `afx status` command, and possibly `getTerminalsForWorkspace`'s terminal-emission may be touched. Spec #755's three security rules and the `from`-aware `resolveTarget` path are not in scope and not modified.
- **Backward-compatible `/api/state` shape.** Adding `architects` is fine; removing or renaming `architect` is not. External consumers (the VSCode extension on user machines that haven't updated, possibly cron jobs) may depend on the scalar shape and must continue to work.
- **No new SQLite migrations.** All data needed is already persisted by spec #755's v13 migration (`architect.id` = name, `builders.spawned_by_architect` = name). The spec calls out no schema change.
- **Dashboard layout stability.** The current SplitPane (architect left, work/builders right) is load-bearing for muscle memory. Multi-architect rendering must not move the architect terminals out of the left pane on desktop, must not lose the `?tab=` deep-link path, and must not break the existing `--no-architect` empty-state ("No architect terminal").
- **VS Code extension TreeView**: must remain in the existing Workspace section of the sidebar. The plan phase may decide whether architects render as flat siblings of "Open Web Interface" (simplest) or as children of a parent "Architects" group node (cleaner when N > 2).
- **`afx status` output formatting**: must remain readable on a standard terminal width (80 cols). Architect names follow the `[a-z][a-z0-9-]*` charset from #755 (max 64 chars), so a header line is feasible without wrapping in realistic cases.
- **Tab-strip empty state**: when an architect terminal is registered but its PTY session has died (`session.status !== 'running'`), the tab strip should still show the architect (greyed out / with a status indicator) — or alternatively omit it. Plan-phase decision; the spec only requires that the surface does not crash on a dead architect.

### Business constraints

- **Solo-architect users must never have to know this feature exists.** No new mandatory CLI flags, no new mandatory config keys, no UI elements that appear before the user opts into a second architect.
- **Time-to-merge matters.** This is the second half of a multi-architect feature whose first half shipped in PR #757. Keeping it tightly scoped is more valuable than polish.

## Assumptions

- The architects' identity model from spec #755 is final. Each architect has a stable `name` (string, `[a-z][a-z0-9-]*`, ≤64 chars); `main` is the default for the first; subsequent are auto-numbered `architect-N`. Names are immutable for v1.
- The dashboard's SplitPane / left-pane architect convention is desirable to preserve; users should still be able to see the architect terminal side-by-side with the right-pane work view. This is the v1 assumption — a follow-up could move architects into the right tab bar entirely if user feedback demands it.
- VSCode extension users can be assumed to have updated to a version that handles the new `architects` collection (since 761 is a single commit on top of #755). The scalar `state.architect` field is preserved purely for non-VSCode external consumers.
- Per-workspace `localStorage` persistence is acceptable for active-tab memory; no requirement for cross-device sync of which architect was last open.

## Solution Approach

The change splits cleanly into four lateral edits, each independently shippable but combined here to give the v1 user the complete experience:

1. **`/api/state` collection.** Extend `DashboardState` with `architects: ArchitectState[]` (each entry adds a `name: string`). Preserve scalar `architect` populated from `main` or first registered, identical to today. Update `handleWorkspaceState` (`tower-routes.ts:1443-1537`) to iterate `entry.architects` and emit the collection. Update `getTerminalsForWorkspace` (`tower-terminals.ts:928-940`) to emit **one `TerminalEntry` per architect** instead of one fixed entry; the entry's `id` becomes `architect:<name>` (or `architect` for the default `main`-preserving backward-compat case) and `label` becomes the name. This is the foundation the other three layers consume.

2. **Dashboard.** Extend `useTabs.ts:17-29` to push one architect tab per entry in `state.architects`. Update `App.tsx` so that when there is more than one architect, the left pane renders a small tab strip listing the architects' names; selecting one shows that terminal's body. When N = 1 the existing single-terminal rendering is unchanged. The `?tab=` deep link is extended to recognise `?tab=architect:<name>`. Active-tab persistence stores the selected name in `localStorage` keyed by `architect:<workspacePath>` (or similar; plan-phase to confirm). On mobile, architect tabs go through the existing TabBar machinery, one per architect.

3. **VS Code extension.** Replace the single `TreeItem('Open Architect')` in `workspace.ts:26-34` with a loop over `state.architects`. Each item's command is a new `codev.openArchitectByName` command (or the existing `codev.openArchitectTerminal` widened to accept a name argument — plan-phase decision); the command resolves `name → terminalId` from the cached state and calls `terminalManager.openArchitect(terminalId, ...)` with a VS Code tab name of `Codev: <name> (architect)`. The existing keybinding / command-palette entry continues to work and routes to `main` (or first) when invoked without arguments.

4. **`afx status`.** Add a header line listing architect names. Add a `--architect <name>` flag that filters the builders list by `spawned_by_architect`. Use the Tower API path (`getWorkspaceStatus`) when Tower is running, and fall back to `state.db` (architect table + builders.spawned_by_architect column) when Tower is not running. The `--architect nonexistent` failure mode produces a non-zero exit with an error message of the form `"unknown architect '<name>'; registered: <list>"` — exact wording fixed in plan phase but specified as test-asserted.

Each layer can be implemented and reviewed in its own commit; the plan phase will sequence them. The recommended order is `/api/state` first (so the consumers have a stable surface to read from), then the three consumer surfaces in parallel.

## Open Questions

### Critical (blocks progress)

*None.* All previously-critical questions resolved during architect's framing in the issue body.

### Important (affects design)

- [ ] **Should the scalar `state.architect` field be deprecated in 761 or in a follow-up?** The plan phase audits external consumers (VSCode extension on older versions, any cron / scripted consumer) and recommends. The spec assumes "keep it, deprecate later."
- [ ] **Tab strip placement when N > 1 on desktop.** Inside the left pane is the cleaner option (the architect terminals stay in their pane). Plan-phase decision on whether the strip is *above* the terminal (like the right-pane TabBar) or *below* / inside a header bar of the left pane. The spec only requires that the strip exists and persists active selection.
- [ ] **Tab-strip behaviour for dead architect terminals** (PTY session ended but registration still in `entry.architects`). Plan-phase to decide: omit, grey-out with a status indicator, or show with a click-to-restart affordance.
- [ ] **Flag name for `afx status` builder filter.** `--architect <name>` (issue's example) or `--owned-by <name>` or `--spawned-by <name>`. Plan-phase to pick one and document the rationale.
- [ ] **VS Code sidebar grouping.** Flat list (N rows of architects mixed with "Open Web Interface") or nested under a parent "Architects" group node when N > 2. Plan-phase to decide; either preserves the N=1 visual.
- [ ] **`afx status` header line when N = 1.** Show `Architects: main` always (one extra line vs today) or suppress when N = 1 (byte-stable output for solo users). Plan-phase to pick one; the spec requires only that the names are *available* somehow when N > 1.

### Nice-to-know (optimization)

- [ ] **Active-tab persistence key collisions.** If a user opens the same workspace in two browser tabs simultaneously, both write to the same `localStorage` key. Plan-phase to confirm this is acceptable (last-write-wins) or pick a different store.
- [ ] **Should the tab body show the architect's spawn time / uptime?** Adjacent to the deferred "richer architect status surface" follow-up. Out of scope for v1.

## Performance Requirements

- **`/api/state` payload size.** The new `architects` collection adds ~4 fields × N architects to the response. For realistic N (2–3 in practice) this is sub-kilobyte and negligible. No streaming or pagination needed.
- **Dashboard render cost.** N architect tabs is bounded by N architect terminals, which is bounded by the human's working-memory limit (likely ≤ 5 in practice). No virtualisation needed.
- **`afx status` runtime.** No new DB queries beyond what already happens; the architect table is already read for the solo-architect case. The filter is a single `WHERE spawned_by_architect = ?` on an already-indexed-by-id table; effectively free.

## Security Considerations

- **No new auth surfaces, no new credentials, no new tokens.** The change is purely presentational; routing, message delivery, and identity remain unchanged.
- **Tab-name spoofing not a concern.** Architect names are constrained to `[a-z][a-z0-9-]*` (max 64) at registration time per spec #755. There is no surface where a builder can suggest a name; names are set by the user via the architect-creation CLI.
- **`/api/state` exposes architect names that were previously hidden in the response.** A name is not a secret — it appears in spawn logs, in `state.db`, and in routing messages already. Exposing it in the API does not widen the visibility envelope.
- **Cross-workspace leakage.** `/api/state` is already per-workspace (its handler reads `entry = getRehydratedTerminalsEntry(workspacePath)`). Adding the collection does not change the scoping.

## Test Scenarios

### Functional

1. **Single-architect baseline (regression).** One architect named `main`. Dashboard renders no tab strip in the left pane; VS Code sidebar shows one row (label TBD by plan); `afx status` shows the architect name in some form (header line or single-arch path). `/api/state` returns scalar `architect: { ..., name: 'main' }` AND `architects: [{ name: 'main', ... }]`. The dashboard layout is byte-identical to the pre-761 visual.
2. **Two architects, dashboard tabs.** Workspace with `main` + `sibling`. Dashboard left pane shows a tab strip with two entries labelled `main` and `sibling`. Clicking each switches the terminal body. Selection persists across page reload (`localStorage`). Deep link `?tab=architect:sibling` opens sibling. Deep link `?tab=architect` opens main (backward compat).
3. **Two architects, VS Code sidebar.** Same workspace. Sidebar shows two rows, labelled `main` and `sibling`. Clicking each opens a VS Code terminal tab named `Codev: main (architect)` / `Codev: sibling (architect)`.
4. **Two architects, `afx status`.** Same workspace. Output includes both architect names. `afx status --architect main` lists only main's builders. `afx status --architect sibling` lists only sibling's builders. `afx status --architect ghost` exits non-zero with the documented error text.
5. **Three architects.** Same shape as scenario 2/3/4 but with `main`, `architect-2`, `architect-3`. Tab strip / sidebar rows / status header all show three entries.
6. **Dead architect terminal.** Architect `sibling` is registered (still in `entry.architects`) but its PTY has exited (`session.status !== 'running'`). Dashboard does not crash; the tab is either omitted or visibly indicates dead state (plan-phase decision); `afx status` lists the name still. (Behaviour pinned in the plan, not this spec.)
7. **Active-tab persistence across browser tabs.** User opens the workspace in two browser tabs, selects different architects in each, then refreshes one. The refreshed tab restores the architect that was last selected in *that* localStorage state (last-write-wins). Documented as acceptable.
8. **Deep link with unknown name.** `?tab=architect:ghost` falls back to the default architect (`main` or first). No crash, no error toast. Tested in unit test.
9. **`/api/state` shape.** Response includes both `architect` (scalar, == main or first) and `architects` (array, all registered). Both are consistent with the in-memory `WorkspaceTerminals.architects` map. Tested.

### Non-functional

1. **Payload latency parity.** `/api/state` response size in a single-architect workspace is within a few bytes of today's response. No measurable client-side parse-time impact.
2. **Render flicker.** Switching architect tabs in the dashboard does not trigger a Terminal unmount/remount (terminals are persistent per the existing `activatedTerminals` mechanism in `App.tsx`). Verified via existing terminal-persistence test patterns.
3. **No `afx status` regression for solo users.** With N = 1 the command's output is either byte-stable with today's, or differs only by the agreed-upon one-line `Architects: main` header (plan-phase decision).

## Dependencies

- **Internal systems**: `WorkspaceTerminals.architects` map (already collection-shaped from #755), `state.db` `architect` table (already keyed by name), `state.db` `builders.spawned_by_architect` column (already exists), Tower `/api/state` handler, dashboard React, VS Code extension TreeView and terminal manager, `afx status` formatter.
- **External services**: none.
- **Libraries / frameworks**: none new.

## References

**Spec #755 / PR #757 (predecessor)**:
- `codev/specs/755-multi-architect-support-per-ar.md`
- `codev/plans/755-multi-architect-support-per-ar.md`
- `codev/reviews/755-multi-architect-support-per-ar.md`

**Surface call sites to touch**:
- `packages/codev/src/agent-farm/servers/tower-routes.ts:1443-1537` — `handleWorkspaceState` / `/api/state` handler.
- `packages/codev/src/agent-farm/servers/tower-terminals.ts:722-946` — `getTerminalsForWorkspace`; emits `TerminalEntry` for the architect surface.
- `packages/codev/src/agent-farm/servers/tower-instances.ts:200-208` — `getInstances()`; scalar `architectUrl`.
- `packages/codev/src/agent-farm/servers/tower-types.ts:71-79` — `InstanceStatus.architectUrl` (decide: extend to collection, or leave scalar as a backward-compat pointer).
- `packages/types/src/api.ts:11-16,51-60` — `ArchitectState` and `DashboardState` interfaces; add `architects` collection field, gain `name` on `ArchitectState`.
- `packages/dashboard/src/hooks/useTabs.ts:17-99` — tab construction and deep-link handling.
- `packages/dashboard/src/components/App.tsx:113-149,184-238,256` — left-pane SplitPane content, right-pane TabBar filter.
- `packages/vscode/src/views/workspace.ts:23-51` — sidebar TreeView.
- `packages/vscode/src/extension.ts:140-157` — `codev.openArchitectTerminal` command implementation.
- `packages/codev/src/agent-farm/commands/status.ts:44-92` — status formatter (both Tower-running and Tower-not-running paths).

**Identity model and data persistence (already in place; reference, not modified)**:
- `packages/codev/src/agent-farm/types.ts:7-19` — `Builder.spawnedByArchitect`.
- `packages/codev/src/agent-farm/db/schema.ts` — `architect.id TEXT`, `builders.spawned_by_architect`, `terminal_sessions.role_id`.

## Risks and Mitigation

| Risk | Probability | Impact | Mitigation |
|------|-------------|--------|------------|
| Single-architect users see a visual regression (extra tab strip, extra header line) | Medium | Medium | Hard constraint that N=1 renders byte-identically to today, validated by snapshot / DOM-presence tests on dashboard and explicit byte-stability assertion on `afx status` output (or explicit acceptance of the one-line header as a documented diff). |
| Adding `architects` to `/api/state` breaks an external consumer that asserts on the response shape | Low | Medium | Scalar `state.architect` is preserved unchanged; new field is additive. Consumers that ignore unknown fields (the JSON convention) are unaffected. |
| Dashboard tab strip introduces a layout bug when the user collapses the left pane (`collapsedPane === 'left'`) | Medium | Medium | The tab strip lives inside the left pane and follows the pane's visibility. Existing collapse-pane tests cover the layout; new tests verify tab-strip behaviour under collapse. |
| Active-tab persistence collides with an existing `localStorage` key | Low | Low | Plan-phase audits existing `localStorage` keys (dashboard already uses some) and picks a non-colliding namespace; documented in the plan. |
| VS Code extension's older versions deployed on user machines still expect the scalar field | Medium | Medium | Scalar is preserved (Scope item 1). Extension users will see the new sidebar rows only after updating to the new extension build; the old extension renders only the scalar as today and continues to work. |
| `afx status --architect <name>` name parsing ambiguity (e.g., name with a hyphen looking like a flag) | Low | Low | Names follow `[a-z][a-z0-9-]*` per #755; argument parser passes the value after `--architect` literally. Test covers `architect-2`, `architect-3`. |
| Plan phase under-scopes the `getTerminalsForWorkspace` change and the architects collection diverges from `InstanceStatus.terminals` | Medium | Medium | Plan must enumerate the change to terminal-entry emission explicitly. Test asserts the two collections agree for a given workspace state. |

## Expert Consultation

**Date**: 2026-05-18
**Models Consulted**: TBD (pending consultation step)

This section will be populated after the spec-phase 3-way consultation (Gemini, Codex, Claude). Convergent and model-specific findings will be addressed in the next iteration of this spec.

## Approval

- [ ] Multi-agent consultation complete (Gemini, Codex, Claude)
- [ ] Architect review (M Waleed Kadous)
- [ ] Spec-approval gate (porch)

## Notes

The architect's framing in issue #761 is unusually clear: the routing primitive is shipped, the four user-facing surfaces (`/api/state`, dashboard, VSCode, `afx status`) are explicitly named with required behaviour, and out-of-scope items are explicitly listed. This spec mostly translates that framing into testable acceptance criteria and pins the surface-area decisions (tab strip placement, deep-link extension, persistence key, `--architect` flag) for plan-phase resolution.

Two design choices deserve explicit attention at plan time:
1. **Whether the dashboard's left-pane architect-tab-strip is inside the pane or above it.** Both are coherent; preference is plan-phase.
2. **Whether to deprecate the scalar `state.architect` field now or defer.** The spec defaults to "defer" to keep blast radius small.
