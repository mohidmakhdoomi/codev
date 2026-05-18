I'll read the key source files referenced in the spec to verify the current-state claims and assess feasibility.Now let me check the tower-types.ts for the architects map structure:Good. I've verified the key source files. Now let me check the dashboard's `localStorage` usage to validate the spec's assumption about no existing keys:Good. I now have a thorough understanding of the codebase state. Let me also quickly verify the spec's claim about the `DashboardState` inline type in `tower-routes.ts` — that it's a real dual-definition problem:Confirmed — `tower-routes.ts` does NOT import `DashboardState` from `@cluesmith/codev-types`; it has its own inline type literal. The spec's claim about the dual-type problem is verified.

Now I have everything I need for a thorough review.

---

## Specification Review: 761 — Surface Multiple Architects in Tower Dashboard

### 1. Completeness

**Excellent.** This is one of the most thorough specs I've reviewed. It:

- Clearly states the problem (routing works but UI collapses N architects to 1 — feature is half-shipped)
- Documents exact current state with file paths, line numbers, and code behavior — all verified against the actual source
- Defines success criteria with testable assertions
- Handles edge cases (dead architect, unknown deep-link name, concurrent browser tabs, architect added while dashboard open)
- Correctly identifies deferred scope and forward references for follow-up issues

The architect's slicing decision (dashboard tabs only for 3.0.6) is well-reasoned and clearly documented. The "why" for the slice — customer blocked on the browser flow — is compelling.

### 2. Correctness — Verified Against Code

I verified the spec's current-state claims against the actual files:

- ✅ **`ArchitectState` in `api.ts:11-16`** — confirmed. No `name` field currently. The spec correctly identifies the need to add it.
- ✅ **`DashboardState` in `api.ts:51-60`** — confirmed. Has scalar `architect: ArchitectState | null`, no `architects` array.
- ✅ **Inline type literal in `tower-routes.ts:1452-1461`** — confirmed. The `state` variable is typed with an inline object literal, NOT importing `DashboardState`. The dual-definition problem is real.
- ✅ **`handleWorkspaceState` architect collapse at lines 1472-1487** — confirmed. Uses `entry.architects.get('main') ?? entry.architects.values().next().value` to select one.
- ✅ **`tower-terminals.ts:928-940`** — confirmed. Emits a single `TerminalEntry` with hard-coded `id: 'architect'`, `label: 'Architect'` regardless of architect count.
- ✅ **`useTabs.ts:27-29`** — confirmed. Pushes a single architect tab from scalar `state.architect`.
- ✅ **`useTabs.ts:115`** auto-switch skip — confirmed. `tab.type !== 'architect'` means new architect tabs are NOT auto-switched-to. The spec correctly flags this as a plan-phase decision.
- ✅ **`App.tsx:184`** — confirmed. `tabs.find(t => t.type === 'architect')` selects one architect tab for the left pane.
- ✅ **`App.tsx:39` `activatedTerminals`** — confirmed. The lazy-mount + keep-alive pattern is in place; extending it to multi-architect tabs is natural.
- ✅ **`App.tsx:236-238` left pane rendering** — confirmed. Renders a single `Terminal` or "No architect terminal" div. This is the code that needs the N>1 tab strip logic.
- ✅ **`WorkspaceTerminals` in `tower-types.ts:41-46`** — confirmed. `architects: Map<string, string>` is already collection-shaped.
- ✅ **`localStorage` keys** — confirmed. Only `codev-web-key` (auth) and `TipBanner` date keys exist. No collision risk for an architect-selection key.

**One minor factual correction**: The spec says `useTabs.ts:87` for the deep-link `find` by type, but it's actually at line 87 in the `useEffect` at line 79-99. The tab-find logic is at line 87: `tabs.find(t => t.id === tabParam || t.type === tabParam)`. This works for `?tab=architect` matching by type — Gemini's confirmation is correct. However, the spec's proposed `?tab=architect:<name>` deep-link format would need new parsing since the current logic only does `id` or `type` match. The plan will need to add explicit colon-parsing for this. This is correctly flagged as a plan-phase decision but worth noting that it's not "zero new logic" — it's a small parsing addition.

### 3. Technical Feasibility

**Fully feasible.** The changes are well-bounded:

- **API side**: Iterating `entry.architects` to build an array in `handleWorkspaceState` is trivial. The `Map<string, string>` is already there.
- **Type side**: Adding `name: string` to `ArchitectState` and `architects: ArchitectState[]` to `DashboardState` is straightforward.
- **Dashboard side**: The hardest part is the conditional tab strip in the left pane (N>1). This is a React UI task with clear requirements. The `activatedTerminals` pattern already exists and naturally extends.
- **No migrations needed** — confirmed, all data is already persisted from #755's v13 migration.

The scope is appropriate for a hotfix. I estimate ~200-300 LOC net change across the API handler, types, `useTabs.ts`, and `App.tsx`.

### 4. Edge Cases and Error Scenarios

Well covered. I particularly appreciate:

- Dead architect terminal handling (plan-phase pinned, but failure mode is explicitly "must not crash")
- `?tab=architect:ghost` fallback (no crash, no error toast)
- Concurrent browser tabs (last-write-wins documented as acceptable)
- Architect added post-load (existing polling + `useTabs` behavior analyzed with specific line references)
- N=1 visual regression prevention as a hard constraint

**One edge case I'd add** (minor): What happens when an architect is **removed** while the dashboard is open (if `afx workspace remove-architect` exists or will exist)? The active tab could reference a now-nonexistent architect. The spec doesn't mention removal — but since architect names are immutable and there's no removal CLI in v1, this is genuinely out of scope. Just noting it for completeness.

### 5. Security Considerations

Appropriate and well-reasoned. No new auth surfaces, no credential exposure, architect names are already visible in logs and routing. The `[a-z][a-z0-9-]*` constraint from #755 prevents injection concerns in tab labels. No issues here.

### 6. Testing Strategy

Comprehensive. The test scenarios cover:

- Single-architect regression (the most important test)
- Multi-architect tab switching + WebSocket persistence
- Deep linking (both formats)
- `localStorage` persistence
- Type-sync enforcement
- Non-functional (payload size, render flicker, DOM identity)

**One suggestion**: The spec says "DOM-snapshot identical" for N=1 regression but doesn't specify how to test this. A DOM structure assertion (e.g., "no element with class `architect-tab-strip` exists when N=1") would be more practical than a full snapshot comparison. The plan should pick a concrete assertion strategy.

### 7. Observations

**Strengths:**
- The slicing rationale is excellent — shipping the browser-usable surface first, deferring quality-of-life improvements. This directly addresses the "shipped-a-primitive-without-a-UI" pattern.
- Current-state analysis is surgically precise with line numbers, all verified correct.
- Deferred items are documented with enough detail that follow-up specs won't need to re-discover the same information.
- The expert consultation findings are well-integrated — Gemini's REQUEST_CHANGES are correctly resolved by the scope reduction.

**Minor observations (not blocking):**
1. The spec's "Solution Approach" section still describes all four layers (API, dashboard, VSCode, afx status) but only layers 1 and 2 are in v1 scope. This is slightly confusing — the deferred sections are marked, but a reader might misunderstand the approach as all-four-layers. Consider trimming layers 3 and 4 from the approach section since they're already covered under "Deferred."

2. The `Tab` interface in `useTabs.ts` (line 4-15) doesn't have a `name` field for architects. The plan will need to decide whether to add one, or use the existing `id` field to carry the architect name (e.g., `id: 'architect:main'`). The spec's "Tab label = architect name" requirement implies the `label` field handles this, which is already supported.

3. The left-pane rendering (`App.tsx:236-238`) currently renders a bare `Terminal` component — it doesn't go through `renderPersistentContent`. The plan will need to restructure this to use the `activatedTerminals` pattern for multi-architect, which means the left pane will need its own persistent-content rendering logic (or the existing `renderPersistentContent` needs to be parameterized for the left pane too). This is a plan-phase concern, but worth flagging as the biggest implementation subtlety.

---

---
VERDICT: APPROVE
SUMMARY: Thorough, well-sliced spec with verified current-state analysis; ready for plan phase.
CONFIDENCE: HIGH
---

KEY_ISSUES:
- None blocking. All current-state claims verified against source code. Scope is well-bounded for a hotfix.
- Minor: Solution Approach section still describes all 4 layers despite only 2 being in v1 — could confuse a builder. Consider trimming or adding a clearer "v1 stops here" marker after layer 2.
- Minor: Left-pane rendering restructuring (from bare `Terminal` to `activatedTerminals`-managed multi-architect) is the biggest implementation subtlety — the plan must address this explicitly since the current left pane bypasses the persistent-content pattern entirely.