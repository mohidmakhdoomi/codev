# Specification: Surface Multiple Architects in Tower Dashboard (3.0.6 hotfix)

## Metadata
- **ID**: 761-surface-multiple-architects-in
- **Status**: draft
- **Created**: 2026-05-18
- **Protocol**: SPIR
- **GitHub Issue**: #761
- **Predecessor**: spec/PR #755 / #757
- **Target release**: 3.0.6 (hotfix on top of Ionic 3.0.5)

## Architect Slicing Decision (2026-05-18)

**This spec's v1 ships dashboard tabs only.** The architect directed (2026-05-18T20:48Z) that the minimum shippable slice for 3.0.6 is the single browser-side change that unblocks the external customer: rendering one tab per architect in the Tower dashboard so the sibling-architect terminal is **clickable from a browser**.

**Concretely, v1 (this PR) ships**:
1. `/api/state` exposes the full architects collection (with names) alongside the preserved scalar pointer.
2. The dashboard renders one tab per architect when N > 1; single-architect workspaces look identical to today.

**v1 explicitly defers** (each spun out as its own follow-up issue after this merges):
- **VS Code extension Workspace sidebar** (lists all architects in the tree view).
- **`afx status` formatter** (architect names header + `--architect <name>` builder filter).

**Why slice this way**: shipping 3.0.5 with the routing primitive but no browser-side surface was a customer-impact mistake (the sibling architect is registered, addressable by routing, but invisible to the human). The browser tab is the single change that turns "routing works in theory" into "feature is usable end-to-end" — every other surface (VSCode, CLI) is a quality-of-life improvement on top of an already-usable feature. The customer is blocked specifically on the browser flow. Velocity through 3.0.6 matters more than completeness across all surfaces in one PR.

The rest of this spec is written to v1 scope. Sections that previously described VSCode and `afx status` work are now marked "deferred" and retained briefly as forward references; full re-specification will happen in the follow-up issues at the time those slices are pulled in.

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

### In scope (v1 — 3.0.6 hotfix)

Two coupled changes; both required for v1 to be useful end-to-end:

1. **`/api/state` exposes the full architects collection.** Add `architects: Array<{ name, terminalId, port, pid, persistent }>` to the `DashboardState` response. The scalar `state.architect` field is preserved unchanged as a backward-compat convenience pointer to `main` (or first registered) so VSCode extension users on older builds continue to work. Both fields are returned simultaneously in v1; deprecation of the scalar is a follow-up decision tracked outside this spec.

   **Implementation notes the plan must address** (called out by Gemini's spec review):
   - The response shape is defined in **two places** that must stay in sync: the shared interface `DashboardState` in `packages/types/src/api.ts:51-60` AND the inline type literal in `tower-routes.ts:1452-1461` inside `handleWorkspaceState`. The plan must update both, or refactor to import from `@cluesmith/codev-types`.
   - v1 does **not** add `spawnedByArchitect` to the builders returned by `/api/state`. That field is only needed by the deferred `afx status --architect <name>` filter; surfacing it requires expanding the in-memory `WorkspaceTerminals.builders` cache (currently `Map<string, string>` = builderId → terminalId) to carry architect-name metadata, or doing per-builder `state.db` lookups in the API handler. Both are reasonable but neither is needed for v1. The follow-up issue that picks up `afx status` decides this.

2. **Dashboard renders one tab per architect when N > 1.**
   - **Tab label** = architect name (`main`, `architect-2`, or whatever custom name was supplied via `afx workspace add-architect --name <name>`).
   - **Tab body** = that architect's terminal, rendered the same way the single architect terminal is rendered today (xterm WebSocket, `persistent` flag respected, `activatedTerminals` lazy-mount pattern preserved).
   - **Active-tab persistence per workspace**: the active architect's name is remembered in `localStorage` keyed by workspace path, so a page refresh returns the user to the architect they were viewing. The persistence key is plan-phase-defined (collision audit required).
   - **Layout placement on desktop**: the architect terminals live in the left pane of the existing SplitPane. When N = 1 the pane contains a single bare terminal (no tab strip — current visual exactly). When N > 1 the pane gains a small tab strip *inside the pane* listing the N architects; the body shows the active architect's terminal. The SplitPane and its collapse-pane behaviour are unchanged.
   - **Layout placement on mobile**: architect tabs appear in the main TabBar like builder/shell tabs do today; with N > 1 there are N architect-typed entries. With N = 1, the single architect tab renders identically to today.
   - **Deep linking**: `?tab=architect` continues to select the first architect tab (the existing `useTabs.ts` match-by-type at line 87 naturally falls back to the first `type: 'architect'` tab — Gemini confirmed this requires no new logic). `?tab=architect:<name>` selects the named architect tab; unknown name falls back to the default.
   - **WebSocket lifecycle when switching architect tabs** (called out by Claude's spec review): the existing `activatedTerminals` Set in `App.tsx:39` already implements lazy mount + keep-alive — terminals are mounted on first visit and stay mounted (hidden via CSS `display: none`) thereafter. The plan extends this to architect tabs: each architect terminal is mounted on first visit; all N WebSocket connections stay alive across tab switches. This matches existing builder/shell terminal behaviour and avoids reconnect-flicker. Acceptable resource cost for realistic N ≤ 5.
   - **Single-architect appearance unchanged**: when N = 1, no architect tab strip is rendered in the left pane; the visual is structurally identical (DOM-snapshot identical) to today's single-architect dashboard. "Structurally identical" rather than "byte-identical" is the precise requirement (Claude flagged that literal byte equality is awkward to assert in React rendering).

3. **Backward compatibility**:
   - Single-architect workspaces see **no behavior change** in either of the two in-scope surfaces (dashboard layout, `/api/state` consumers).
   - The scalar `state.architect` field on `/api/state` is preserved.
   - The `?tab=architect` deep-link path continues to land on a valid architect tab.

### Deferred to follow-up issues (NOT in v1)

These were originally in the issue body's "Required" list and the spec's earlier scope. The architect's 2026-05-18 directive moved them to follow-up issues to keep 3.0.6 small and fast:

- **VS Code extension Workspace sidebar listing all architects.** Replaces single `TreeItem('Open Architect')` with one row per architect. Each row opens its terminal in a VS Code tab `Codev: <name> (architect)`. **Follow-up issue must address the `terminalManager.openArchitect` map-key collision Gemini flagged** (`terminals.get('architect')` is keyed by literal `'architect'` today; multi-architect requires `architect-${name}` keying or it will re-focus the first tab silently). The follow-up issue also must make `WorkspaceProvider.getChildren()` async and fetch `client.getWorkspaceState()`, since today's TreeProvider returns static items only. Tracked separately.

- **`afx status` architect-names header.** Add a header line listing registered architects by name. Source-of-truth audit required at follow-up: the spec's earlier draft had a contradiction between `getWorkspaceStatus()` (returns `InstanceStatus` — no architect names) and `getWorkspaceState()` (returns `DashboardState` — has names). The follow-up issue standardises on `getWorkspaceState()`. Tracked separately.

- **`afx status --architect <name>` builder filter.** Filters the builders list to those with `spawned_by_architect = <name>`. Requires either (a) expanding `WorkspaceTerminals.builders` to carry architect-name metadata, (b) on-the-fly `state.db` query in the `/api/state` handler, or (c) reading `state.db` directly from the CLI. Decision is part of the follow-up issue.

These follow-ups are tightly coupled to v1's `/api/state` change (they consume the new `architects` collection), but they do not block 3.0.6 from shipping.

### Out of scope (deferred follow-ups)

These items from the original issue #755 follow-up list are **not** addressed by this spec:

- `THREAD.md` template + lifecycle (`codev thread new/list/archive`) — #755 follow-up #3.
- Cross-thread visibility (`codev thread show <name>`) — #755 follow-up #4.
- Thread-aware `consult` (`consult --thread <name>` or `.thread` auto-detection) — #755 follow-up #5.

These remain as separate follow-up issues and would not be unblocked by 761.

### Explicitly NOT in scope

- **No routing logic touched.** The affinity-routing primitive (builder → spawning architect) is already in place from PR #757. This spec only changes the dashboard surface.
- **No new architect-identity model.** Names are the identity, exactly as established in spec #755. The only new field on existing types is `name: string` on `ArchitectState` (already implicitly there since the in-memory `WorkspaceTerminals.architects` map is keyed by name).
- **No new architect-creation CLI.** `afx workspace add-architect --name <name>` from #755 stays as the way to create additional architects. 761 does not add a creation surface inside the dashboard.
- **No multi-architect-aware send.** `afx send architect` continues to use the builder's recorded `spawnedByArchitect` for routing. The dashboard does not gain a "send to architect by name" UI.
- **No name-rename UI.** Architect names are set at registration and immutable for v1. Renaming is left for a future spec if demand arises.
- **No removal of the scalar `state.architect` field on `/api/state`.** The spec keeps it as a backward-compat pointer; a follow-up spec may deprecate and remove it once all consumers have migrated.
- **No `spawnedByArchitect` on `/api/state` builders.** Deferred to the `afx status` follow-up that actually needs it.
- **No VS Code extension changes in this PR.** Deferred — see "Deferred to follow-up issues" above.
- **No `afx status` changes in this PR.** Deferred — see "Deferred to follow-up issues" above.

## Stakeholders

- **Primary**: Codev consumers running the sibling-architect pattern (the user that motivated #755/#761, plus future adopters of the pattern).
- **Secondary**: Solo-architect users — must see **zero behavior change**. This is a hard constraint, not an aspiration.
- **Technical Team**: Codev maintainers (Tower routes, dashboard React, VSCode extension, `afx` CLI).
- **Business Owner**: M Waleed Kadous (architect role for Codev).

## Success Criteria

- [ ] `/api/state` response includes an `architects` array listing every registered architect with `{ name, terminalId, port, pid, persistent }`. The scalar `state.architect` field continues to be returned and points to `main` (or first registered).
- [ ] The shared `DashboardState` interface in `packages/types/src/api.ts` and the inline type literal in `tower-routes.ts:handleWorkspaceState` are updated together; a unit or type-check test asserts they stay in sync (e.g. by importing the shared type into the handler, or by an automated assertion).
- [ ] In a workspace with two architects (`main` + `sibling`), the Tower dashboard left pane (desktop) or main TabBar (mobile) shows a small architect tab strip with two entries labelled `main` and `sibling`. Clicking each switches the terminal body. Both terminals' WebSockets stay alive across tab switches (no reconnect-flicker).
- [ ] Active architect tab name is persisted per workspace in `localStorage`; page refresh restores the previously-selected architect. Last-write-wins across multiple browser tabs is acceptable and documented.
- [ ] A single-architect workspace (only `main`) shows a DOM-snapshot-identical dashboard layout to the pre-#761 baseline. No architect tab strip, no extra DOM nodes.
- [ ] Deep link `?tab=architect` continues to land on a valid architect tab (the first one returned by `state.architects`, which equals `main` if present). Deep link `?tab=architect:<name>` lands on the named architect's tab; unknown name falls back to the default with no error toast.
- [ ] All existing tests pass; new tests cover:
  - **`/api/state`**: `architects` collection contents match the in-memory `entry.architects` map (single and multi-architect cases); scalar `architect` is preserved and points to `main` or first.
  - **Type sync**: `tower-routes.ts` inline response type cannot drift from `DashboardState`. Either enforced by importing or by an explicit assertion test.
  - **Dashboard tabs**: tab-strip presence for N>1, absence for N=1, active-tab `localStorage` persistence across reload, deep-link routing including `?tab=architect:<name>` and fallback for unknown name.
  - **Persistent terminal mount**: switching between architect tabs does not unmount existing terminals (extend the existing `activatedTerminals` test patterns).
- [ ] Single-architect users (the dominant population) see no visible difference in either the dashboard or in `/api/state` consumers that ignore unknown fields.

## Constraints

### Technical constraints

- **No routing logic change.** Only `/api/state`, the dashboard React layer, and possibly `getTerminalsForWorkspace`'s terminal-emission may be touched in v1. Spec #755's three security rules and the `from`-aware `resolveTarget` path are not in scope and not modified.
- **Backward-compatible `/api/state` shape.** Adding `architects` is fine; removing or renaming `architect` is not. External consumers (the unupgraded VSCode extension is the most-cited example) may depend on the scalar shape and must continue to work.
- **Two type definitions must stay in sync.** The `DashboardState` interface lives in `packages/types/src/api.ts`. An inline duplicate of the response shape lives in `tower-routes.ts:handleWorkspaceState`. v1 must update both, or refactor to remove the duplication. The plan picks the approach; the spec requires that drift is structurally prevented (compile-time import, or asserted test).
- **No new SQLite migrations.** All data needed is already persisted by spec #755's v13 migration (`architect.id` = name). No schema change in v1.
- **Dashboard layout stability.** The current SplitPane (architect left, work/builders right) is load-bearing for muscle memory. Multi-architect rendering must not move the architect terminals out of the left pane on desktop, must not lose the `?tab=` deep-link path, and must not break the existing `--no-architect` empty-state ("No architect terminal").
- **Persistent WebSocket model preserved.** The existing `activatedTerminals` lazy-mount + keep-alive pattern in `App.tsx` (Bugfix #205) must be extended to architect tabs, not replaced. Tab switching must not trigger Terminal unmount/remount.
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

The v1 change is two coupled edits, ordered:

1. **`/api/state` collection.** Extend `DashboardState` in `packages/types/src/api.ts` with `architects: ArchitectState[]`, where each `ArchitectState` gains a `name: string` field. Preserve the scalar `architect` field unchanged (population logic: `main` if present, else first registered — identical to today). The implementation lives in `handleWorkspaceState` in `tower-routes.ts:1443-1537`: iterate `entry.architects` and emit one entry per name, each carrying its session-derived `pid`, `terminalId`, and `persistent`. The inline type literal at `tower-routes.ts:1452-1461` must be updated alongside (or refactored to import `DashboardState` from `@cluesmith/codev-types`).

   **Do NOT modify `getTerminalsForWorkspace`** (`tower-terminals.ts:928-940`). The dashboard does not consume `TerminalEntry[]` for architect rendering; it reads from `/api/state` (which reads `entry.architects` directly). Modifying `getTerminalsForWorkspace` would change `InstanceStatus.terminals` — which flows into `afx status` via `getWorkspaceStatus()` — breaking the strict "no `afx status` changes in v1" boundary. The single `TerminalEntry` of type `'architect'` it emits today stays as-is; multi-architect `TerminalEntry` emission is a follow-up alongside the `afx status` work.

2. **Dashboard.** Extend `useTabs.ts:17-29` to push one architect tab per entry in `state.architects` (replacing the current scalar-driven push at lines 27-29). Update `App.tsx` so that when there is more than one architect, the left pane renders a small tab strip listing the architects' names; selecting one shows that terminal's body. When N = 1 the existing single-terminal rendering is unchanged. The deep-link parser in the `useTabs.ts:79-99` `useEffect` is extended to recognise `?tab=architect:<name>` (small colon-parsing addition; the existing `tab.id === tabParam || tab.type === tabParam` match continues to handle the bare `?tab=architect` case). Active-tab persistence stores the selected architect name in `localStorage` keyed by `codev-active-architect:<workspacePath>` (plan-phase confirms key naming). On mobile, architect tabs flow through the existing TabBar machinery, one per architect.

   **Implementation subtlety (called out by Claude review)**: today's left-pane rendering at `App.tsx:236-238` is a bare `Terminal` component that bypasses the `activatedTerminals` lazy-mount + keep-alive pattern used by the right pane (`renderPersistentContent`). For multi-architect tab-switching to avoid Terminal unmount/remount, the left pane needs to participate in the `activatedTerminals` machinery — either by extending `renderPersistentContent` to also accept a "left-pane terminal list" parameter, or by introducing a parallel persistent-content renderer for the left pane. Plan-phase picks the approach; either keeps the WebSocket alive across tab switches.

This is the entirety of the v1 implementation surface. Layers for VS Code extension and `afx status` are explicitly deferred to follow-up issues (see "Deferred to follow-up issues" in Scope).

## Open Questions

### Critical (blocks progress)

*None.* All previously-critical questions resolved during architect's framing in the issue body.

### Important (affects design)

- [ ] **Tab strip placement on desktop.** Inside the left pane is the cleaner option (architect terminals stay in their pane). Plan-phase to decide whether the strip is *above* the terminal (small horizontal tab row, like the right-pane TabBar) or rendered as a left-vertical strip / dropdown header. The spec only requires that the strip exists, persists active selection, and respects the existing pane-collapse behaviour.
- [ ] **Tab-strip behaviour for dead architect terminals** (PTY session ended but registration still in `entry.architects`). Plan-phase to decide: omit, grey-out with a status indicator, or show with a click-to-restart affordance.
- [ ] **Deep-link separator.** `?tab=architect:<name>` is the spec's preferred shape. Plan-phase confirms or proposes a colon-free alternative (e.g. `?architect=<name>` as a separate param) if the colon parsing conflicts with existing URL handling.
- [ ] **`localStorage` key naming.** Plan-phase audits existing dashboard `localStorage` keys (none assumed at spec time) and picks a non-colliding namespace.

### Nice-to-know (optimization)

- [ ] **Active-tab persistence key collisions across browser tabs.** If a user opens the same workspace in two browser tabs simultaneously, both write to the same `localStorage` key. Spec assumes this is acceptable (last-write-wins).
- [ ] **`/api/state` polling vs SSE for newly-added architects.** If a second architect is added via `afx workspace add-architect` while the dashboard is already loaded, how does it appear? Claude flagged this in spec review. Today's dashboard polls `/api/state` (existing `useBuilderStatus` hook); the new architect appears on the next poll, and `useTabs` already auto-switches to genuinely-new tabs (`useTabs.ts:114-119`) — so the new architect would auto-select. The plan must verify this works for architect tabs (the existing skip condition is `tab.type !== 'architect'`, which would suppress auto-switch — see `useTabs.ts:115`). Resolve: invert that skip for architect tabs added post-load (treat them like builders), or leave them at user-explicit selection. Plan-phase decision.
- [ ] **Should the tab body show the architect's spawn time / uptime?** Adjacent to a deferred "richer architect status surface" follow-up. Out of scope.

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

1. **Single-architect baseline (regression).** Workspace has one architect (`main`). `/api/state` returns scalar `architect: { ..., terminalId, ... }` AND `architects: [{ name: 'main', terminalId, ... }]`. Dashboard renders no tab strip in the left pane; the architect terminal fills the pane as today. DOM-snapshot identical to pre-761 baseline.
2. **Two architects, dashboard tabs.** Workspace with `main` + `sibling`. `/api/state` returns `architects: [main, sibling]`. Dashboard left pane shows a tab strip with two entries labelled `main` and `sibling`. Clicking each switches the visible terminal body without unmounting either. Both WebSockets remain alive after switching. Selection persists across page reload via `localStorage`. Deep link `?tab=architect:sibling` opens sibling. Deep link `?tab=architect` opens main (backward compat).
3. **Three architects.** Workspace with `main`, `architect-2`, `architect-3`. Tab strip shows three entries. Each click works; `localStorage` round-trip works for each.
4. **Newly-added architect, dashboard already loaded.** User has the dashboard open. Architect adds a second architect via `afx workspace add-architect --name sibling`. On next `/api/state` poll, a `sibling` tab appears in the strip. Auto-switch behaviour matches plan-phase decision (the existing `useTabs.ts:114-119` auto-switch logic with architects either re-enabled or kept suppressed).
5. **Dead architect terminal.** Architect `sibling` is registered (still in `entry.architects`) but its PTY has exited. Dashboard does not crash; tab is either omitted or visibly indicates dead state (plan-phase pinned).
6. **Active-tab persistence across browser tabs (concurrent).** User opens the workspace in two browser tabs, selects different architects in each, refreshes one. The refreshed tab restores the architect that was last selected in *that* localStorage state (last-write-wins). Documented as acceptable.
7. **Deep link with unknown name.** `?tab=architect:ghost` falls back to the default architect tab. No crash, no error toast.
8. **`/api/state` collection vs scalar consistency.** Response includes both `architect` (scalar, == `main` or first) and `architects` (array, all registered). For all valid `entry.architects` states, the two views are consistent.
9. **Type-sync guard.** A unit / type-check test (or compile-time import) ensures `DashboardState` in `packages/types/src/api.ts` and the inline type in `tower-routes.ts:handleWorkspaceState` cannot drift.

### Non-functional

1. **Payload latency parity.** `/api/state` response size in a single-architect workspace is within a small constant overhead of today's response (one extra `architects` array with one entry). No measurable client-side parse-time impact.
2. **Render flicker.** Switching architect tabs in the dashboard does not trigger a Terminal unmount/remount. Verified via existing terminal-persistence test patterns (Bugfix #205 / Bugfix #524 test families).
3. **No regression for solo users.** With N = 1, dashboard DOM is structurally identical to pre-761; `/api/state` is shape-stable (scalar `architect` field unchanged).

## Dependencies

- **Internal systems**: `WorkspaceTerminals.architects` map (already collection-shaped from #755), `state.db` `architect` table (already keyed by name), `state.db` `builders.spawned_by_architect` column (already exists), Tower `/api/state` handler, dashboard React, VS Code extension TreeView and terminal manager, `afx status` formatter.
- **External services**: none.
- **Libraries / frameworks**: none new.

## References

**Spec #755 / PR #757 (predecessor)**:
- `codev/specs/755-multi-architect-support-per-ar.md`
- `codev/plans/755-multi-architect-support-per-ar.md`
- `codev/reviews/755-multi-architect-support-per-ar.md`

**Surface call sites for v1 (in scope)**:
- `packages/codev/src/agent-farm/servers/tower-routes.ts:1443-1537` — `handleWorkspaceState` / `/api/state` handler. **Note dual type definition** (inline literal at 1452-1461).
- `packages/types/src/api.ts:11-16,51-60` — `ArchitectState` (gains `name: string`) and `DashboardState` (gains `architects: ArchitectState[]`).
- `packages/dashboard/src/hooks/useTabs.ts:17-99` — tab construction and deep-link handling.
- `packages/dashboard/src/components/App.tsx:39,76-87,113-149,184-238,256` — `activatedTerminals` state, left-pane SplitPane content, right-pane TabBar filter.

**Backend call site explicitly NOT touched in v1** (separated from the deferred-follow-up call sites because it's a non-obvious choice):
- `packages/codev/src/agent-farm/servers/tower-terminals.ts:928-940` — `getTerminalsForWorkspace`'s architect-`TerminalEntry` emission. Stays at one entry per workspace in v1. Modifying it would change `InstanceStatus.terminals` and leak into `afx status`, violating the slicing boundary. The follow-up that picks up `afx status` revisits this together with the formatter change.

**Call sites NOT touched in v1 (deferred)**:
- `packages/vscode/src/views/workspace.ts:23-51` — sidebar TreeView. Deferred follow-up.
- `packages/vscode/src/extension.ts:140-157` — `codev.openArchitectTerminal` command. Deferred follow-up. **Map-key collision in `terminalManager.openArchitect` flagged by Gemini must be addressed at that time.**
- `packages/codev/src/agent-farm/commands/status.ts:44-92` — status formatter. Deferred follow-up.
- `packages/codev/src/agent-farm/servers/tower-instances.ts:200-208` — `getInstances()` / scalar `architectUrl`. Stays scalar for v1 (matches `state.architect` scalar preservation).

**Identity model and data persistence (already in place; reference, not modified)**:
- `packages/codev/src/agent-farm/types.ts:7-19` — `Builder.spawnedByArchitect`.
- `packages/codev/src/agent-farm/db/schema.ts` — `architect.id TEXT`, `builders.spawned_by_architect`, `terminal_sessions.role_id`.

## Risks and Mitigation

| Risk | Probability | Impact | Mitigation |
|------|-------------|--------|------------|
| Single-architect users see a visual regression (extra tab strip, extra DOM nodes) | Medium | Medium | Hard constraint that N=1 renders DOM-snapshot-identical to today, validated by snapshot / DOM-presence tests on dashboard. |
| Adding `architects` to `/api/state` breaks an external consumer that asserts on the response shape | Low | Medium | Scalar `state.architect` is preserved unchanged; new field is additive. JSON consumers that ignore unknown fields are unaffected. |
| Dashboard tab strip introduces a layout bug when the user collapses the left pane (`collapsedPane === 'left'`) | Medium | Medium | The tab strip lives inside the left pane and follows the pane's visibility. Existing collapse-pane tests cover the layout; new tests verify tab-strip behaviour under collapse. |
| Active-tab `localStorage` key collides with an existing key | Low | Low | Plan-phase audits existing `localStorage` keys and picks a non-colliding namespace. |
| `DashboardState` and the inline `tower-routes.ts` type literal drift apart in a follow-up PR | Medium | Medium | Plan-phase enforces drift-prevention (import the shared type at compile time, or add an assertion test). Tracked as a Success Criterion. |
| Existing `useTabs.ts` `tab.type !== 'architect'` auto-switch skip (line 115) suppresses the new architect tab from auto-focus when added post-load | Medium | Low | Plan-phase explicit decision: invert for architect tabs added post-load, or keep behaviour and require the user to click. Documented as an Open Question. |
| Persistent WebSocket count grows with N | Low | Low | At realistic N (≤ 5), N WebSockets is comparable to the builder-count load already present today. No optimisation needed. |
| Codex unavailable for this consultation round | Medium | Low | Two reviews (Gemini + Claude) cover the same checks. Architect decides whether to require codex re-review before approval. |

## Expert Consultation

**Date**: 2026-05-18
**Models Consulted**: Gemini 3 Pro, Claude Opus 4.7. **Codex unavailable** in this worktree environment due to a missing vendored binary (`@openai+codex@0.101.0-darwin-arm64/.../codex` directory empty in pnpm node_modules); two retries both failed with `ENOENT`. Builder unable to `pnpm rebuild` in this environment (permission denial). Architect to decide whether to require codex re-review before approval or accept gemini + claude.

### Verdicts (iteration 1)

| Model | Verdict | Confidence |
|-------|---------|------------|
| Gemini | REQUEST_CHANGES | HIGH |
| Claude | APPROVE | HIGH |
| Codex | (unavailable) | — |

### Verdicts (iteration 2 — after architect's slicing directive + fixes)

| Model | Verdict | Confidence |
|-------|---------|------------|
| Gemini | REQUEST_CHANGES (resolved in this iteration) | HIGH |
| Claude | APPROVE | HIGH |
| Codex | (unavailable) | — |

### Convergent findings (addressed in this iteration)

1. **Inline-type drift in `tower-routes.ts:handleWorkspaceState`.** Both Gemini and Claude noted that the API handler defines its response shape inline (`tower-routes.ts:1452-1461`) rather than importing `DashboardState`. Adding `architects` requires updating both. **Fix**: Constraints section now requires that drift is structurally prevented (compile-time import OR asserted test). Success Criteria adds an explicit type-sync test. References call this out at the file/line level.

### Gemini-specific findings (REQUEST_CHANGES verdict — addressed by re-slicing)

Gemini raised three CRITICAL issues. Two of them (`afx status` data-source contradiction and `terminalManager.openArchitect` map-key collision) only affect the deferred VSCode and `afx status` slices, which the architect's 2026-05-18 directive moved out of v1. The third (missing `spawnedByArchitect` on `/api/state` builders) is similarly only required by the deferred `afx status --architect` filter — v1 does not surface this field at all.

**Fix**: the spec's scope is now sliced per the architect directive. Each of Gemini's three concerns is captured in the "Deferred to follow-up issues" section as a known-must-address item for the corresponding follow-up. None of them are v1 blockers.

Gemini also flagged a non-critical issue:
- **`workspace.ts` TreeProvider must be async** to fetch state. — Captured under the deferred VSCode follow-up.
- **`?tab=architect` natural fallback in `useTabs.ts:87`.** — Gemini confirmed this works without extra logic since the existing match-by-type will pick the first architect tab. Noted in Scope item 2 (deep linking).

### Claude-specific findings (APPROVE verdict — addressed)

1. **WebSocket lifecycle across architect tabs.** Spec did not explicitly state whether all N architect WebSockets stay alive or only the visible one. **Fix**: Scope item 2 now explicitly extends the existing `activatedTerminals` lazy-mount + keep-alive pattern to architect tabs. All N WebSockets stay alive across tab switches. Acceptable resource cost at realistic N ≤ 5.

2. **Inline-type drift.** Covered above as convergent.

3. **"Byte-identical" too literal for React.** **Fix**: Success Criteria and Constraints now say "DOM-snapshot identical" instead of "byte-identical."

4. **Architect registered while dashboard is open.** **Fix**: added to Open Questions (nice-to-know) with a specific resolution-needed item — `useTabs.ts:114-119` skip condition currently suppresses architect-tab auto-switch; the plan must decide whether to invert this for post-load-added architects.

5. **`Open Architect` → `main` label change in VS Code (N=1 regression).** **Fix**: VS Code scope is deferred. The follow-up issue inherits this question.

### Iteration-2 findings (addressed in this iteration)

Iteration 2 ran after the architect's 2026-05-18 slicing directive was incorporated into the spec.

**Gemini (REQUEST_CHANGES)** raised two contradictions left over from the slicing rewrite:
1. **Stale "Solution Approach" steps 3 & 4 (VS Code, `afx status`)** still describing in-line implementation despite Scope marking them deferred. A builder reading the Solution Approach directly would have built out-of-scope features. **Fix**: deleted steps 3 & 4 entirely. Solution Approach now has only two steps (matching v1 scope).
2. **Incorrect instruction to modify `getTerminalsForWorkspace`** in Solution Approach step 1. The dashboard reads architects from `entry.architects` (via `tower-routes.ts:handleWorkspaceState`), NOT from `TerminalEntry[]`. Modifying `getTerminalsForWorkspace` would change `InstanceStatus.terminals` and leak into `afx status`, breaking the slicing boundary. **Fix**: removed the instruction; added an explicit "do NOT modify" note in Solution Approach with rationale; called out the file in References under "explicitly NOT touched in v1."

**Claude (APPROVE)** verified all current-state claims against source files and confirmed no remaining blockers. Three minor observations, two adopted:
1. **`?tab=architect:<name>` is not zero-new-logic.** The existing `tabs.find(t => t.id === tabParam || t.type === tabParam)` handles bare `?tab=architect` but not the `:<name>` form. **Fix**: Solution Approach step 2 now explicitly says "small colon-parsing addition" rather than implying zero work.
2. **Left-pane rendering subtlety.** `App.tsx:236-238` is a bare `Terminal` component, NOT going through `renderPersistentContent` / `activatedTerminals`. For multi-architect tab-switching to avoid Terminal remount, the left pane must participate in `activatedTerminals`. **Fix**: Solution Approach step 2 now calls out this implementation subtlety explicitly with two implementation options for plan-phase to pick.
3. **Architect-removed-while-dashboard-open edge case.** Not in v1 (no removal CLI exists), but worth a note. *Not adopted as a code change* — out of scope.

### Persisted consultation outputs

- `codev/projects/761-surface-multiple-architects-in/761-spec-iter1-gemini.md` (REQUEST_CHANGES, mostly addressed by slicing)
- `codev/projects/761-surface-multiple-architects-in/761-spec-iter1-claude.md` (APPROVE)
- `codev/projects/761-surface-multiple-architects-in/761-spec-iter2-gemini.md` (REQUEST_CHANGES, addressed in this iteration)
- `codev/projects/761-surface-multiple-architects-in/761-spec-iter2-claude.md` (APPROVE)
- (codex output absent — see note above)

## Approval

- [ ] Multi-agent consultation complete (Gemini, Codex, Claude)
- [ ] Architect review (M Waleed Kadous)
- [ ] Spec-approval gate (porch)

## Notes

The architect's 2026-05-18 directive **explicitly sliced v1 to dashboard-tabs-only for the 3.0.6 hotfix**, deferring VS Code Workspace view and `afx status` to follow-ups. The customer is blocked specifically on the browser flow — every hour of process between now and 3.0.6 is a customer waiting on a feature paid-for-in-3.0.5-but-unusable. Velocity matters more than completeness across all surfaces in one PR.

This is exactly the kind of "ship-the-primitive-without-the-UI" failure that the user's recent feedback called out: spec #755 shipped a primitive without an end-to-end usable surface, so the customer got "routing works in theory" but couldn't drive it from a browser. 761 v1 closes that gap with the smallest possible surface change.

Two design choices deserve explicit attention at plan time:
1. **Tab strip placement.** Inside the left pane is the cleaner option. Plan-phase to decide horizontal-above vs. left-vertical vs. dropdown-header.
2. **Auto-switch behaviour for post-load-added architects.** Whether to invert the existing `useTabs.ts` skip condition for architect tabs added while the dashboard is open.

A consultation gap (codex unavailable in this worktree environment due to a missing vendored binary) is documented in the Expert Consultation section. Architect to decide acceptability.
