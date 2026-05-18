# Plan: Surface Multiple Architects in Tower Dashboard (3.0.6 hotfix)

## Metadata
- **ID**: 761-surface-multiple-architects-in
- **Status**: draft
- **Specification**: [codev/specs/761-surface-multiple-architects-in.md](../specs/761-surface-multiple-architects-in.md)
- **Created**: 2026-05-18
- **GitHub Issue**: #761
- **Target release**: 3.0.6 (Ionic hotfix on top of 3.0.5)
- **Predecessor**: PR #757 / spec #755

## Executive Summary

The spec calls for **dashboard-tabs-only** in v1 (architect's 2026-05-18T20:48Z slicing directive). Two coupled changes, ordered:

1. **`/api/state` exposes the architects collection.** Add `architects: ArchitectState[]` to `DashboardState`; preserve the scalar `architect` field unchanged. The shared interface and the inline literal in `tower-routes.ts:handleWorkspaceState` must be kept in sync.
2. **Dashboard renders one tab per architect when N > 1.** Extend `useTabs` to push one tab per architect; restructure `App.tsx`'s left pane so it participates in the `activatedTerminals` lazy-mount pattern (preventing terminal remount on tab switch); persist active-architect name in `localStorage`; extend deep-link parsing to recognise `?tab=architect:<name>`.

Single-architect workspaces (the dominant population) must see a DOM-snapshot-identical dashboard.

This plan splits the two scope items into two implementation phases. Each phase is one self-contained commit. Both ship in one PR.

## Success Metrics

All criteria from `codev/specs/761-surface-multiple-architects-in.md` apply. Roll-up:

- [ ] `/api/state` returns `architects: ArchitectState[]` (with `name`) AND the preserved scalar `architect`. Both are consistent with `entry.architects`.
- [ ] `DashboardState` (shared) and the inline response type in `tower-routes.ts:handleWorkspaceState` cannot drift (compile-time import OR asserted test).
- [ ] Dashboard renders one tab per architect when N>1, in a tab strip inside the left pane (desktop) and inline in the main TabBar (mobile).
- [ ] Active-architect name persists per workspace in `localStorage`; reload restores it.
- [ ] Deep link `?tab=architect:<name>` works; unknown name falls back to default; bare `?tab=architect` works as before.
- [ ] Switching between architect tabs does not unmount or remount any Terminal component (no WebSocket reconnect-flicker).
- [ ] N=1 dashboard is DOM-snapshot-identical to the pre-761 baseline.
- [ ] All existing tests pass; new tests cover the listed scenarios from spec.

## Phases (Machine Readable)

```json
{
  "phases": [
    {"id": "phase_1", "title": "API state: expose architects collection"},
    {"id": "phase_2", "title": "Dashboard: per-architect tabs + left-pane persistent rendering"}
  ]
}
```

## Phase Breakdown

### Phase 1: API state — expose architects collection

**Dependencies**: None.

#### Objectives

- Extend the `/api/state` response to carry the full architects collection alongside the preserved scalar.
- Eliminate the dual-type-definition drift between `DashboardState` and `tower-routes.ts:handleWorkspaceState` so the change is structurally safe going forward.
- Zero user-visible change at this point — the dashboard still reads the scalar.

#### Deliverables

- [ ] `packages/types/src/api.ts`:
  - Add `name: string` to `ArchitectState`.
  - Add `architects: ArchitectState[]` to `DashboardState`.
  - Existing scalar `architect: ArchitectState | null` stays exactly as it is today.
  - **Also (small companion fix)**: change `Annotation.parent` from required to optional (`parent?: { type: string; id?: string }`) in the **shared** `packages/types/src/api.ts` interface. The handler's inline literal at `tower-routes.ts:1526-1533` builds annotations without it. Plan-time audit done: `grep -rn "annotation\.parent\|ann\.parent" packages/` returns only `agent-farm/state.ts:287-288` and `agent-farm/db/migrate.ts:99-100`, both of which use the *agent-farm-internal* `Annotation` type (`packages/codev/src/agent-farm/types.ts:29`), NOT the shared one. The shared `Annotation.parent` is currently consumed by zero callers. Making it optional aligns the shared type with reality and is a prerequisite for the clean `DashboardState` import.
- [ ] `packages/codev/src/agent-farm/servers/tower-routes.ts:1443-1537` (`handleWorkspaceState`):
  - Replace the inline response type literal at lines 1452-1461 by importing `DashboardState` from `@cluesmith/codev-types` and typing the local `state` variable as `DashboardState`. (This is the lower-risk option than keeping two declarations and asserting equality at test time.)
  - Build the `architects` array by iterating `entry.architects` (name → terminalId) and, for each, looking up the session via `manager.getSession(terminalId)`; emit `{ name, port: 0, pid, terminalId, persistent }` per entry. Skip entries whose session is unavailable. Entries are emitted in `Map` iteration order (insertion order); the `main` entry, when present, is moved to the front so it is always `architects[0]`.
  - Continue populating the scalar `architect` exactly as today (`entry.architects.get('main') ?? entry.architects.values().next().value` → derive the same `ArchitectState` shape, now also carrying `name`).
- [ ] `packages/codev/src/agent-farm/servers/tower-types.ts:62-79`:
  - **Not** touched in this phase. `InstanceStatus.architectUrl` stays scalar; `TerminalEntry` stays as-is. (Spec is explicit: `getTerminalsForWorkspace` is NOT modified in v1.)
- [ ] **No changes** to `packages/codev/src/agent-farm/servers/tower-terminals.ts` or `tower-instances.ts`. Explicitly out of scope for v1 (see spec, References → "Backend call site explicitly NOT touched in v1").

#### Implementation Details

The `entry.architects: Map<string, string>` is already populated by spec #755's machinery. No SQLite migration, no Tower-side data plumbing. The handler change is pure read-and-shape.

**Front-of-array convention for `main`**: Iteration order for `Map` is insertion order; `main` may or may not be inserted first depending on workspace history. Surfacing `architects[0]` as a *reliable* "main pointer" simplifies the dashboard's "default-architect" picker. Implementation: build the array by appending non-`main` entries in iteration order, then `unshift` the `main` entry if present. Document this contract in the JSDoc on `DashboardState.architects`.

**Type sync via import**: removing the inline literal eliminates the drift class entirely. The handler's local `state` variable becomes typed as `DashboardState`. The one type mismatch this exposes is `Annotation.parent`: the shared type marks it required but the handler does not populate it. The companion type fix above (making `parent` optional) resolves this. With that in place, `state: DashboardState` compiles cleanly. If a future field on `DashboardState` also drifts, the compiler will catch it at this seam — which is exactly the drift-prevention this seeks.

If during implementation a different unforeseen mismatch surfaces, fall back to a typed Pick assertion at the end of the handler before serialisation:
```ts
const finalState = state satisfies Pick<DashboardState, 'architect' | 'architects'>;
return res.end(JSON.stringify(finalState));
```
This still anchors the architect-related fields to the shared type while letting other inline-only fields stay loose. Document any such mismatch in the commit message; full alignment is the goal but partial alignment is acceptable if scope creep would otherwise grow.

**Performance impact**: zero — same Map iteration that already happens for the scalar selection. The new array allocation is bounded by N (≤5 in practice).

#### Acceptance Criteria

- [ ] `tsc` passes after the change.
- [ ] `/api/state` for a single-architect workspace returns the new field `architects: [{ name: 'main', port: 0, pid: ..., terminalId: ..., persistent: ... }]` AND the preserved scalar `architect` populated identically.
- [ ] `/api/state` for a two-architect workspace returns `architects` with both entries; `main` is at index 0 if present; scalar `architect` matches `architects[0]`.
- [ ] Type-sync test (or simply the fact that the inline literal no longer exists) asserts no drift.
- [ ] All existing tests pass.

#### Test Plan

- **Unit / API tests** (`packages/codev/src/agent-farm/__tests__/spec-761-api-state.test.ts` — new file):
  - Build a fake workspace entry with `entry.architects = new Map([['main', 'term-1']])` and assert the `/api/state` response.
  - Same with two architects (`main` + `sibling`); assert array contents and ordering (`main` first).
  - Same with three architects, custom name order, asserting `main`-first ordering.
  - Workspace with no architects: `architects: []` and `architect: null`.
- **Type-sync guard**: removing the inline literal means the type is sourced from `DashboardState`; no additional test needed beyond `tsc`.
- **Regression**: existing `tower-routes.test.ts` tests for `/api/state` must continue to pass without modification (they assert the scalar shape and should not care about the new additive field).

#### Rollback Strategy

Revert the single commit; this phase introduces no migrations and no runtime side effects. The scalar `architect` field is unchanged, so consumers stuck on the previous build will continue to work.

#### Risks

- **Risk**: An existing test in `tower-routes.test.ts` asserts the response uses the old inline literal exactly. **Mitigation**: read the existing assertion before editing; if it asserts an absent `architects` key it must be updated to allow either presence (preferred — additive) or rewritten to test the new collection directly.
- **Risk**: The architect-session lookup fails for one entry in `entry.architects` (race, stale registration). **Mitigation**: skip silently (as the scalar handler does today for the single-architect case). Log via `_deps.log` if available.

---

### Phase 2: Dashboard — per-architect tabs + left-pane persistent rendering

**Dependencies**: Phase 1.

#### Objectives

- The dashboard renders one tab per architect when N > 1. When N = 1, the visual is DOM-snapshot-identical to today.
- The left pane participates in the `activatedTerminals` lazy-mount + keep-alive pattern so switching architect tabs does not unmount terminals.
- Active architect name persists per-workspace in `localStorage`; reload restores it.
- Deep link `?tab=architect:<name>` selects the named architect; `?tab=architect` still works.

#### Deliverables

- [ ] `packages/types/src/api.ts` — already updated in Phase 1; no further changes.
- [ ] `packages/dashboard/src/lib/api.ts`:
  - Re-export `ArchitectState` from `@cluesmith/codev-types` (or update the existing re-export to ensure `name: string` is available to consumers). The dashboard already re-exports the types it consumes from this module; just confirm the new field is visible.
- [ ] `packages/dashboard/src/hooks/useTabs.ts`:
  - Extend the `Tab` interface (lines 4-15) with an optional `architectName?: string` field so tabs carry the architect identity (the `id` and `label` already carry it implicitly, but a typed field is cleaner for downstream consumers).
  - Replace the existing scalar-driven push (lines 27-29) with a loop over `state.architects ?? []` (with a fallback to `state.architect` populated as a one-element array if `architects` is absent — handles a momentary deploy-window where dashboard.js is newer than the server). Push one tab per architect: `{ id, type: 'architect', label: a.name, closable: false, terminalId: a.terminalId, persistent: a.persistent, architectName: a.name }`.
  - **Tab ID convention (revised per Gemini iter-1 review)**: The *first* architect tab always uses `id: 'architect'` (bare, no name suffix), regardless of N. Subsequent architect tabs use `id: 'architect:<name>'`. Since Phase 1 emits `main` at `architects[0]` whenever it is registered, the first tab is `main` in essentially all real workspaces — its ID is stable across the N=1→N=2 transition. The earlier draft of this plan used asymmetric N-dependent IDs (bare for N=1, prefixed for N>1) which would have re-keyed `main`'s ID on transition, breaking `activatedTerminals` tracking and auto-switch logic. The first-vs-rest convention preserves DOM-snapshot stability for N=1 AND keeps the first tab's ID stable for every workspace lifecycle.
  - Extend the `?tab=` deep-link parser in the `useEffect` at lines 79-99: add a check for `tabParam?.startsWith('architect:')` before the existing match-by-id-or-type. Extract the suffix as `name`; find the architect tab whose `architectName === name`; if not found, fall back to the existing match-by-type which lands on the first architect tab.
  - Adjust the auto-switch skip at line 115 (`tab.type !== 'architect'`): this currently suppresses auto-selection of newly-appearing architect tabs (a deliberate choice when there was only one architect tab that existed at page-load). Now that architects can be added post-load via `afx workspace add-architect`, the plan decision is: **invert the skip for architect tabs**. New architect tabs auto-switch like builder tabs do today. This matches the spec's "important question" resolution and gives external customers a useful "appears in the dashboard immediately after `add-architect`" UX.
  - **localStorage persistence**: a small helper module `packages/dashboard/src/lib/architectPersistence.ts` exporting `readActiveArchitect(workspacePath): string | null` and `writeActiveArchitect(workspacePath, name)`. Key namespace: `codev-active-architect:<workspacePath>`. Plan-pinned key name — audit confirmed only `codev-web-key` and `TipBanner` date keys exist today.
  - `useTabs` reads the persisted active architect on initial mount (in the same effect that handles the `?tab=` URL parameter, with URL parameter taking precedence). When the user clicks an architect tab (via `selectTab`), the helper persists the architect name.
- [ ] `packages/dashboard/src/components/App.tsx`:
  - **The left pane must participate in `activatedTerminals` lazy-mount + keep-alive**. Currently `App.tsx:184` finds `const architectTab = tabs.find(t => t.type === 'architect')` and renders ONE `Terminal` component at `App.tsx:236-238`. New approach:
    - Replace single-tab discovery with `const architectTabs = tabs.filter(t => t.type === 'architect')`.
    - When N>1, render a small tab strip ABOVE the terminal area inside the left pane (above the existing `architectToolbarExtra` row, or as a new sibling — implementation detail decided in the React tree, not load-bearing). The strip uses the existing `tab` and `tab-active` CSS classes for visual consistency with the right-pane TabBar, but is its own React component (e.g., `ArchitectTabStrip`) to keep responsibility contained.
    - When N=1, do NOT render the strip — the existing bare-terminal rendering is preserved exactly. (DOM-snapshot-identical constraint.)
    - For the terminal content, render N hidden + 1 visible `Terminal` components using the same `display: none` + `activatedTerminals` pattern from `renderPersistentContent` (lines 113-149). Implementation: extract a `renderPersistentTerminals(tabs)` helper that takes a list and renders them with the persistence pattern; call it once for the left pane (architects) and once for the right pane (builders + shells, as today).
  - The right pane's `TabBar` filter `t.type !== 'architect'` (line 256) is unchanged; architect tabs stay out of the right tab bar regardless of N.
  - Mobile (`MobileLayout`, line 168-181): no change needed. `useTabs` already produces the right tab list; the existing `renderPersistentContent(['architect', 'builder', 'shell'])` call covers all architect tabs.
  - `architectToolbarExtra` (the collapse buttons) is rendered on the currently-active architect terminal, exactly like today. When there is no active architect, the existing `"No architect terminal"` empty state shows.
  - **Active-tab selection**: the active-tab ID for an architect comes from `useTabs`. When the user clicks a strip entry, `useTabs.selectTab(id)` runs; that change in `activeTabId` causes the corresponding terminal pane's `display` to flip from `none` to undefined. No remount; no WebSocket reconnect.
- [ ] New module: `packages/dashboard/src/components/ArchitectTabStrip.tsx`:
  - Renders a horizontal strip of architect tab buttons. Props: `tabs: Tab[]`, `activeTabId: string`, `onSelectTab: (id) => void`. Visual style: same as the right-pane `TabBar` (reuse classes) but without close buttons (architect tabs are not closable).
- [ ] **NO changes** in this phase to `Tab` IDs of non-architect tabs, the right-pane `TabBar`, `MobileLayout`, `WorkView`, or any other surface.
- [ ] Single-architect DOM snapshot tests:
  - `App.terminal-persistence.test.tsx` is the existing relevant test family.
  - Add `packages/dashboard/__tests__/App.architect-tabs.test.tsx` with two cases:
    - N=1: snapshot of left-pane DOM matches a baseline; no `architect-tab-strip` element present.
    - N=2: left-pane DOM has an `ArchitectTabStrip` with two entries; clicking one toggles the visible terminal pane via the `display` style; both `Terminal` components remain mounted.
  - Add `packages/dashboard/__tests__/useTabs.architects.test.ts` for unit-level tests of the hook: deep-link parsing, localStorage round-trip, auto-switch behaviour, N=0 / N=1 / N=2 / N=3 cases.

#### Implementation Details

**Persistent-terminal extraction**. The existing `renderPersistentContent` (`App.tsx:113-149`) does the lazy-mount + keep-alive pattern for the right-pane terminal tabs. The cleanest refactor is to:

1. Extract a pure `renderPersistentTerminals(tabsToRender, activeTabId, toolbarExtra?): JSX.Element[]` helper. Signature includes an optional `toolbarExtra` prop that is threaded through to the **active** terminal only (passing it to all would render multiple copies of the collapse buttons; only the visible terminal needs them). No new logic beyond that — the existing inline loop is hoisted into a named function.
2. The right-pane caller maps to `renderPersistentTerminals(persistentRightTabs, activeTabId)` exactly as today (no `toolbarExtra`).
3. The left-pane caller maps to `renderPersistentTerminals(architectTabs, activeTabId, architectToolbarExtra)` when N > 1; when N = 1, falls through to the bare `<Terminal toolbarExtra={architectToolbarExtra} ... />` render at `App.tsx:236-238` (preserves DOM identity for snapshot stability).

**`toolbarExtra` threading rule (pinned per Gemini iter-1 and Claude iter-1 reviews)**: on the active terminal only. Within `renderPersistentTerminals`, when `tab.id === activeTabId`, pass `toolbarExtra` as a prop; otherwise omit it. This matches the today's single-terminal behaviour (toolbar visible on the architect terminal) and keeps the collapse buttons correctly placed when switching architects.

The `activatedTerminals` Set in `App.tsx:39` is keyed by `tab.id`; since architect tab IDs are now `architect:main` etc. (N>1 only), the Set will simply gain those keys as the user visits them. The existing `useEffect` at `App.tsx:76-87` that marks the active terminal as activated continues to work — it checks `activeTab.type === 'architect' || 'builder' || 'shell'`.

**Deep-link parsing addition**:

```ts
// inside the existing useEffect in useTabs.ts
const tabParam = urlParams.get('tab');
if (tabParam) {
  // New: handle architect:<name> form
  if (tabParam.startsWith('architect:')) {
    const name = tabParam.slice('architect:'.length);
    const archTab = tabs.find(t => t.architectName === name);
    if (archTab) {
      setActiveTabId(archTab.id);
      urlTabHandled.current = true;
      // ... existing URL cleanup
      return;
    }
  }
  // Existing: match by id or type (handles bare ?tab=architect → first architect tab)
  const matchingTab = tabs.find(t => t.id === tabParam || t.type === tabParam);
  if (matchingTab) {
    setActiveTabId(matchingTab.id);
    urlTabHandled.current = true;
    // ... existing URL cleanup
  }
} else {
  urlTabHandled.current = true;
}
```

**localStorage helper**:

```ts
// packages/dashboard/src/lib/architectPersistence.ts
const KEY_PREFIX = 'codev-active-architect:';

function workspaceKey(): string {
  // Use window.location.pathname (e.g. "/workspace/Users%2Fmwk%2F.../").
  // Audit (Gemini iter-1): DashboardState.workspaceName = path.basename(workspacePath),
  // which collides when two workspaces share a basename (e.g. ~/work/codev vs ~/personal/codev).
  // pathname is URL-encoded and globally unique per workspace.
  return window.location.pathname;
}

export function readActiveArchitect(): string | null {
  try { return localStorage.getItem(KEY_PREFIX + workspaceKey()); }
  catch { return null; }
}

export function writeActiveArchitect(name: string): void {
  try { localStorage.setItem(KEY_PREFIX + workspaceKey(), name); }
  catch { /* quota / SSR / private-mode — silently ignore */ }
}
```

**Pinned (revised per Gemini iter-1 review)**: use `window.location.pathname` for the key suffix. `DashboardState.workspaceName` is just `path.basename`, which is NOT globally unique. The pathname is the URL-encoded full workspace path the dashboard is served at, guaranteed unique per workspace within a Tower.

**Auto-switch skip inversion**:

```ts
// useTabs.ts line 115 — current:
if (!knownTabIds.current.has(tab.id) && tab.type !== 'architect') {
  setActiveTabId(tab.id);
}
// new:
if (!knownTabIds.current.has(tab.id)) {
  setActiveTabId(tab.id);
}
```

The original skip was added when there was only one architect tab and it was pre-existing at page-load (so a "new" architect tab was conceptually nonsense). Now that adding architects post-load is supported by spec #755's `afx workspace add-architect`, removing the skip gives users immediate visual feedback. Caveat: on initial page load, ALL architect tabs are "new" relative to the empty seed. The existing seed-on-non-null-state pattern (lines 105-112) already handles that — `knownTabIds.current` is set to the full current list once `state !== null` is observed; only then does auto-switch fire. So removing the skip is safe.

**Dead architect tab handling** (spec open question): pinned here as **omit dead architects from the tab strip**. The `architects` array in `/api/state` is built from sessions where `manager.getSession(terminalId)` returns a live session (Phase 1's skip-silently rule). So a dead architect terminal won't appear in `state.architects` and its tab won't be rendered. No grey-out indicator. (Cleanest, smallest change. Follow-up issues can revisit.)

#### Acceptance Criteria

- [ ] `pnpm build` succeeds; `tsc` clean.
- [ ] N=1 dashboard DOM matches snapshot (no `ArchitectTabStrip` element).
- [ ] N=2 dashboard renders the tab strip with two entries; click toggles which terminal pane is visible; both `Terminal` components remain mounted via `display: none`.
- [ ] `localStorage` key `codev-active-architect:<workspacePath>` is written when an architect tab is selected, and read on reload to restore the selection.
- [ ] `?tab=architect:sibling` opens `sibling` tab on initial load; `?tab=architect:ghost` falls back to the first architect tab.
- [ ] New architect added via `afx workspace add-architect --name foo` post-load appears in the strip on the next `/api/state` poll and auto-switches to.
- [ ] All existing tests pass, especially `App.terminal-persistence.test.tsx` and `architect-toolbar.test.tsx`.
- [ ] Mobile layout unchanged behaviourally; multi-architect appears as multiple tabs in the main TabBar.

#### Test Plan

- **`packages/dashboard/__tests__/useTabs.architects.test.ts`** (new):
  - Hook unit test (using `@testing-library/react-hooks` or equivalent already in the suite).
  - Cases:
    - `state.architects: []` → no architect tab.
    - `state.architects: [{name: 'main', ...}]` → one tab, `id: 'architect'`, `label: 'main'`. (Bare ID preserves DOM identity.)
    - `state.architects: [{main}, {sibling}]` → two tabs, IDs `architect:main` and `architect:sibling`.
    - Initial load with `?tab=architect:sibling` → `activeTabId === 'architect:sibling'`.
    - Initial load with `?tab=architect:ghost` → falls back to `'architect:main'` (or the first one).
    - Initial load with `?tab=architect` → falls back to first architect tab.
    - `localStorage` round-trip: write `sibling`, simulate reload, hook reads `sibling` as initial active.
    - URL `?tab=` takes precedence over `localStorage`.
    - Post-load architect addition: `state.architects` grows from 1 to 2; `useTabs` returns 2 tabs; `activeTabId` auto-switches to the new one.
- **`packages/dashboard/__tests__/App.architect-tabs.test.tsx`** (new):
  - Render `App` with mocked `useBuilderStatus` returning `state.architects` of various sizes.
  - N=0: no architect tab, `"No architect terminal"` empty state, snapshot match.
  - N=1: one architect, no tab strip in left pane, bare `Terminal` rendered, snapshot match for left pane DOM.
  - N=2: tab strip present with two entries; clicking each toggles which terminal is visible (`display: none` style swap); both Terminals remain in the DOM throughout.
  - WebSocket lifecycle: assert no remount of either `Terminal` across a click sequence (existing test patterns in `App.terminal-persistence.test.tsx` show how to assert this).
- **`packages/dashboard/__tests__/ArchitectTabStrip.test.tsx`** (new):
  - Component-level tests: renders one button per tab; calls `onSelectTab` with the right ID on click; renders active-state styling for `activeTabId`.
- **Existing tests** that must still pass without modification:
  - `App.terminal-persistence.test.tsx`
  - `architect-toolbar.test.tsx`
  - `TabBar.test.tsx`
  - `SplitPane.test.tsx`
  - `MobileLayout.test.tsx`
- **E2E (deferred unless trivial)**: an explicit Playwright test that drives a two-architect workspace through tab-switching and reload would be valuable; the codebase has Playwright infra (`codev/resources/testing-guide.md`). Implementation-phase to decide whether to add or defer to the follow-up issues. The unit + component tests above are the floor.

#### Rollback Strategy

Revert the phase commit. Phase 1's `/api/state` change continues to ship harmlessly (additive field that the dashboard chose to ignore). No data loss, no migration.

#### Risks

- **Risk**: The DOM-snapshot test for N=1 catches a tiny structural change introduced by the refactor (e.g., an extra wrapper `<div>`). **Mitigation**: design the refactor to either (a) keep the N=1 path bypassing the new `renderPersistentTerminals` entirely, or (b) emit identical DOM at N=1. Plan-pin (a) as the default — N=1 keeps the bare `<Terminal />` render at `App.tsx:236-238`, no new wrappers.
- **Risk**: localStorage write fails (quota, SSR, private mode). **Mitigation**: the helper is wrapped in try/catch; missed persistence is a usability degradation, not a crash.
- **Risk**: Removing the auto-switch skip causes a visible flash on initial load (the first architect tab steals focus from `'work'`). **Mitigation**: the existing seed-on-non-null pattern in `useTabs.ts:105-112` means the first non-null state populates `knownTabIds` with all current tabs; only post-seed changes trigger auto-switch. Test asserts initial active tab is `'work'` for a workspace that has architects at page-load time.
- **Risk**: The `useTabs.ts` `tabs.map(t => t.id).join(',')` dependency in the auto-switch `useEffect` (line 121) recomputes on every state poll, even when the tab list is unchanged. Adding `architectName` to `Tab` does not change this; just verify the dependency string still uniquely captures tab identity for the equality check. **Mitigation**: existing dependency is fine — IDs alone are unique.
- **Risk**: Reusing the `tab` and `tab-active` CSS classes from `TabBar` couples the strip's visual to the right pane's. **Mitigation**: acceptable for a hotfix; the visual consistency is a feature. Follow-up styling work can fork the classes if needed.

---

## Dependency Map

```
Phase 1 (API) ──→ Phase 2 (Dashboard)
```

Both phases ship in one PR. Each is a single atomic commit.

## Resource Requirements

### Development resources

- Single builder. Both phases are React + Node TypeScript; no new tooling.

### Infrastructure

- None new. No SQLite migration. No new services. No new dependencies in `package.json`.

## Integration Points

### Internal systems

- Tower's `entry.architects: Map<string, string>` — read-only consumer.
- Dashboard's existing `useBuilderStatus` polling — adds the new `architects` field to its consumed state; no change to fetch logic.
- Dashboard's existing `activatedTerminals` lazy-mount pattern — extended to the left pane.

### External systems

- None.

## Risk Analysis

### Technical risks

| Risk | Probability | Impact | Mitigation | Owner |
|------|------------|--------|------------|-------|
| Inline-type drift returns in a future PR after Phase 1 removes it | Medium | Medium | Phase 1 imports `DashboardState` directly; future-builder convention is "no inline type literals for API responses." A lint rule could enforce, but is out of scope for v1. | Builder |
| N=1 DOM snapshot test rejects a structurally-identical-but-React-different render | Medium | Low | Bypass `renderPersistentTerminals` entirely at N=1; emit the same `<Terminal />` rendering today's `App.tsx:236-238` does. | Builder |
| localStorage key namespace collides with a future feature | Low | Low | Prefix `codev-active-architect:` is specific and prefix-stable. | Builder |
| Removing the auto-switch skip causes regression in a workspace where users prefer Work tab on load | Low | Low | Seed-on-non-null pattern means new tabs don't auto-switch on initial load; only post-load additions do. Test asserts initial active is `'work'`. | Builder |
| Dashboard build output too large for hotfix budget (bundle size) | Low | Low | Net additions are a small React component + helper module + hook diff. Probably <2KB gzipped. | Builder |

### Process risks

| Risk | Probability | Impact | Mitigation | Owner |
|------|------------|--------|------------|-------|
| Codex unavailable for plan-phase consult (same environment issue as spec phase) | Medium | Low | Plan can ship with gemini + claude review; architect already accepted 2-of-3 for the spec. | Builder / Architect |
| Plan phase consultations flag a new gap that requires re-scoping | Low | Medium | Plan re-iteration is built into SPIR. | Builder |

## Notes

The plan keeps the scope tight per the architect's slicing directive. Phase 1 is mostly type/API plumbing; Phase 2 is the actual UI change. Splitting them gives a clean reviewable commit boundary and lets Phase 1 be merged ahead of Phase 2 if a future emergency requires the API field without the UI. Both ship in one PR for 3.0.6.

Plan-time decisions (revised after iter-1 review):

1. **Tab ID convention** — *revised*: bare `'architect'` ID for the FIRST architect always, `architect:<name>` for subsequent. Original draft asymmetric-by-N convention would have re-keyed `main`'s ID on N=1→N=2 transition. The first-vs-rest rule preserves both DOM-snapshot stability AND tab-ID stability across architect-count changes. (Gemini iter-1 finding.)

2. **localStorage key suffix** — *revised*: `window.location.pathname`, not `DashboardState.workspaceName`. The latter is `path.basename(workspacePath)` and collides when two workspaces share a basename. (Gemini iter-1 finding.)

3. **`toolbarExtra` threading in persistent-terminal helper** — *pinned*: on the active terminal only. Both Gemini and Claude flagged this as undefined; pinned explicitly. (Iter-1.)

4. **`Annotation.parent` type alignment** — *added*: make `parent` optional in the shared `Annotation` type as a small Phase 1 companion fix. The shared type has required `parent`, but the handler doesn't populate it and no dashboard consumer reads it. Required to make the clean `DashboardState` import compile. (Claude iter-1 finding.)

5. **Auto-switch behaviour for post-load architects** — *pinned (unchanged from draft)*: removed the suppression so new architect tabs auto-switch like builders. Matches user expectation that "I just added an architect, I want to see it." Alternative: keep suppression and require explicit click.

6. **Dead architect tab handling** — *pinned*: omit dead architects entirely. The `/api/state` builder skips architects whose `manager.getSession(terminalId)` returns no session, so they're invisible at the API layer. No grey-out indicator in v1.

All decisions are reversible at follow-up time.

## Expert Consultation

**Date**: 2026-05-18
**Models Consulted**: Gemini 3 Pro, Claude Opus 4.7. Codex unavailable in this worktree (same environmental issue as the spec phase — vendored binary missing, `pnpm rebuild` blocked by harness's permission classifier).

### Verdicts (iteration 1)

| Model | Verdict | Confidence |
|-------|---------|------------|
| Gemini | REQUEST_CHANGES (addressed) | HIGH |
| Claude | COMMENT (addressed) | HIGH |
| Codex | (unavailable) | — |

### Convergent findings (addressed)

1. **`toolbarExtra` threading undefined** (both reviews). The plan's extracted `renderPersistentTerminals` helper didn't say where the architect's collapse-button `toolbarExtra` prop goes when there are multiple architect terminals being rendered persistently. **Fix**: helper signature now takes `toolbarExtra?: ReactNode`; pinned threading rule is "on the active terminal only" — within the loop, pass it only when `tab.id === activeTabId`.

### Gemini-specific findings (addressed)

1. **Tab ID convention breaks N=1→N=2 transition.** Draft used bare `'architect'` for N=1 and `architect:<name>` for N>1; transitioning architects from 1 to 2 would re-key `main`'s ID, breaking `activatedTerminals` tracking and triggering spurious auto-switch. **Fix**: revised to "first architect always bare `'architect'`, subsequent prefixed". DOM snapshot for N=1 stays stable, AND `main`'s ID never changes across lifecycle.
2. **`localStorage` key collision via `workspaceName` basename.** Two workspaces with same basename (`~/work/codev` vs `~/personal/codev`) would collide. **Fix**: helper now uses `window.location.pathname`, which is URL-encoded and globally unique per workspace.

### Claude-specific findings (addressed)

1. **`DashboardState` import will fail due to `Annotation.parent` mismatch.** Shared type marks `parent` required; handler at `tower-routes.ts:1526-1533` builds annotations without it. Builder following the original plan would hit a compile error. **Fix**: Phase 1 now includes a small companion type change — `Annotation.parent` becomes optional. Audit step is documented: `grep -rn "annotation\.parent\|ann\.parent" packages/` should return no consumer reads (verified at plan time; confirm at implementation). Fallback (`satisfies Pick<DashboardState, ...>`) documented for the unforeseen-mismatch case.

### Persisted consultation outputs

- `codev/projects/761-surface-multiple-architects-in/761-plan-iter1-gemini.txt`
- `codev/projects/761-surface-multiple-architects-in/761-plan-iter1-claude.txt`
- (codex output absent — same environment issue as spec phase)

## Approval

- [ ] Multi-agent consultation complete
- [ ] Architect review (M Waleed Kadous)
- [ ] Plan-approval gate (porch)
