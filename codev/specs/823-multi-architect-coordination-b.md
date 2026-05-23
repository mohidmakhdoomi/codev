# Specification: Multi-Architect Coordination — Builder Attribution, Messaging Docs, Builder Thread State, VSCode Add-Refresh

## Metadata
- **ID**: spec-2026-05-22-823-multi-architect-coordination-b
- **Status**: draft
- **Created**: 2026-05-22
- **GitHub Issue**: [#823](https://github.com/cluesmith/codev/issues/823)
- **Predecessors**: #755 (v3.0.5 primitive), #761 (v3.0.6 tab strip), #774 (v3.0.8 routing fix), **#786 (lifecycle/persistence/UX — PR #822, currently open)**

## Clarifying Questions Asked

Issue #823 is a focused four-deliverable follow-up to #786, written after the architect identified concrete gaps surfaced at PR-iter-3 of #786 and during the spec phase of #786. No additional clarification was sought before drafting — the deliverables, scope boundaries, and "why a SPIR (not separate protocols)" rationale are explicit in the issue body.

## Problem Statement

After #786 ships, the multi-architect feature has:

- a clean **lifecycle** (add, remove, persist across stop/start),
- correct **routing** (builder→architect lands on the spawning sibling),
- coherent **surface enumeration** (`afx status`, VSCode tree, dashboard tab strip).

But four coordination gaps remain that an external adopter (Shannon, the only concrete N>1-architect user today) hits within their first session:

1. **Builder attribution is invisible at the dashboard.** A user looking at the Work view sees a flat list of builders. They cannot tell which architect spawned which builder — even though that information is the basis of the routing primitive. With one architect, the question is meaningless; with two or more, it's the single most-asked question in a multi-architect cohort.
2. **Messaging primitives are undocumented.** Code supports `afx send architect:<name>`, builder→architect routing via affinity, architect→sibling-architect messaging, and `<builder-id>` addressing — but `CLAUDE.md` / `AGENTS.md` / `codev/resources/commands/agent-farm.md` don't surface any of them. Users discover the primitives empirically (or don't), and the discoverability cost compounds across each new external adopter.
3. **Builders have no shared, persistent situational-awareness surface.** A cohort of builders working in parallel cannot read each other's state. A builder finishing phase 3 of a refactor cannot signal "I just renamed `X` — anyone touching it should rebase" to a sibling builder. Architects cannot quickly skim "what did builder 0793 do this morning?" without `afx open`ing the terminal and scrolling. There is no per-builder narrative log that's cheap to write and cheap to read.
4. **The VSCode Architects tree is silently stale on add.** When the user runs `afx workspace add-architect --name ob-refine` from a shell while VSCode is open, the new architect appears in the dashboard's tab strip (dashboard polls), but the VSCode sidebar's Architects tree does NOT refresh until the user manually clicks the sidebar's Refresh button. The remove-architect path refreshes correctly (because `codev.removeArchitect` self-triggers the refresh from within VSCode), but add-architect via the CLI is invisible to VSCode — Tower never emits an SSE event for architect lifecycle changes.

All four are coordination problems: making the *who-spawned-whom* relationship visible, making the *how to message them* surface honest, giving the cohort a *shared narrative log*, and keeping the *editor surface in sync with the running state*. They cohere as one feature pass.

## Current State

### Item 1 — dashboard builder attribution (verified)

| Aspect | Status |
|---|---|
| `Builder.spawnedByArchitect` field on `agent-farm/types.ts` | ✅ exists (added in #755) |
| `spawned_by_architect` column on `state.db.builders` | ✅ exists (per `state.ts:126`, `:152`) |
| Field populated on every `spawnBuilder` path | ✅ verified (6 call sites in `commands/spawn.ts`: `:460`, `:535`, `:593`, `:618`, `:669`, `:831`) |
| Field exposed on the overview API (`BuilderOverview` type) | ❌ NOT exposed |
| Field exposed on the shared `OverviewBuilder` type (`packages/types/src/api.ts:100`) | ❌ NOT exposed |
| `BuilderCard.tsx` renders it | ❌ NOT rendered |
| Routing uses it correctly (post-#774) | ✅ verified in `tower-messages.ts:275-342` |

**Proximate cause**: `discoverBuilders()` in `overview.ts:545-700` reads `status.yaml` from the builder's worktree, which does not carry `spawnedByArchitect`. The existing DB enrichment block at `overview.ts:781-797` reads `issue_number` from `state.db.builders` but does not read `spawned_by_architect`. Once the field is added to `BuilderOverview` and the SQL `SELECT` is extended, the field flows all the way through to `OverviewBuilder` on the dashboard side (the two types are kept in sync — see `packages/types/src/api.ts:100-138` vs `packages/codev/src/agent-farm/servers/overview.ts:35-74`).

**SQL `WHERE` clause caveat (iter-1 Gemini)**: The current enrichment query at `overview.ts:786` is `SELECT worktree, issue_number FROM builders WHERE issue_number IS NOT NULL`. This `WHERE` clause excludes soft-mode / task-mode builders (which spawn with `issue_number = NULL` in `state.db.builders`). If we add `spawned_by_architect` to the `SELECT` but keep the `WHERE`, those builders' attribution will silently fail to render even when they were spawned by a sibling architect. The implementation must drop the `WHERE issue_number IS NOT NULL` clause (or replace it with `WHERE issue_number IS NOT NULL OR spawned_by_architect IS NOT NULL`) and conditionally apply each enrichment field based on whether it's populated for the row. Plan phase pins the exact form.

### Item 2 — messaging documentation (verified)

| Primitive | Code support | Documented today |
|---|---|---|
| `afx send <builder-id> "msg"` (architect → builder) | ✅ | ✅ (`agent-farm.md`) |
| `afx send architect "msg"` (architect → main, or builder → spawning architect via affinity) | ✅ (post-#774) | ⚠️ Partial — `agent-farm.md` shows the form but doesn't explain the builder-side affinity-routing behavior |
| `afx send architect:<name> "msg"` (explicit architect addressing — see spoofing-check note below) | ✅ | ❌ NOT documented |
| `afx send <workspace>:architect "msg"` (cross-workspace) | ✅ | ✅ (`agent-farm.md`) |
| Architect → sibling architect messaging (sender = architect bypasses the spoofing check) | ✅ (per #786 spec test scenario #8) | ❌ NOT documented |
| `afx status` lists architects alongside builders | ✅ post-#786 (per #786 spec MUST: "afx status enumerates ALL registered architects") | ❌ NOT documented in the messaging context |

**The code primitives are complete after #786 lands.** This item is purely a documentation surfacing pass — no new behavior, no new code paths, just making the existing affordances discoverable.

**Spoofing-check note (verified against `tower-messages.ts:196-230`)**: When a builder is the sender, `architect:<name>` is allowed ONLY when `<name>` matches the builder's `spawnedByArchitect`. Mismatches are rejected by the address-spoofing check at `resolveArchitectByName` (`tower-messages.ts:213-218`). Non-builder senders (architects, including `main` sending to `architect:<sibling>`) bypass the spoofing check. So the documentation must distinguish: from **architects**, `architect:<name>` is an open address grammar (sibling-architect messaging); from **builders**, it is constrained to the builder's own spawning architect (an explicit form of the affinity routing, not an override).

### Item 3 — per-builder thread state (greenfield)

| Aspect | Status |
|---|---|
| `codev/state/` directory exists | ❌ does not exist today |
| Builder protocol prompts mention a thread file | ❌ no |
| Builder roles file (`codev/roles/builder.md`) mentions a thread file | ❌ no |
| Architect convention for reading sibling builders' state | ❌ unwritten — architects ad-hoc tail terminals via `afx open` |

**The issue is explicit about minimalism**: just a location and an instruction. No schema, no porch hook, no timestamp formatter, no rotation strategy. Trust the LLM. The spec must hold that line — `codev/state/<builder-id>_thread.md`, write to it in natural language, that's it.

### Item 4 — VSCode Architects tree refresh on add (verified)

| Aspect | Status |
|---|---|
| Tower emits `worktree-config-updated` SSE event (parallel precedent) | ✅ exists |
| Tower emits an `architects-updated` (or equivalent) SSE event on add | ❌ does not exist |
| Tower emits same event on remove | ❌ does not exist |
| VSCode `WorkspaceProvider` subscribes to such an event | ❌ does not subscribe |
| VSCode `WorkspaceProvider` refreshes correctly on `codev.removeArchitect` | ✅ self-triggers refresh (per #786) |
| Dashboard add-refresh | ✅ polling already picks it up |
| Documented as a known limitation in `codev/projects/786-.../verify-scenarios.md` Scenario 11 | ✅ (on the #786 branch — not present on this builder's branch until #786 merges) |

**This deliverable closes the gap noted at #786 PR-iter-3 (Codex finding Co2)** — architect's followup decision was to fold it into a follow-up SPIR rather than expand #786's scope.

## Desired State

After #823 ships:

1. A dashboard user looking at the Work view with two or more architects in the workspace can immediately tell which architect spawned each builder. The visual treatment is **subtle** (a small inline tag adjacent to the builder ID/title, not a column) so the N=1 dashboard is visually identical to today.
2. A user reading `CLAUDE.md`, `AGENTS.md`, or `codev/resources/commands/agent-farm.md` discovers the four addressing forms (`<builder-id>`, `architect`, `architect:<name>`, `<workspace>:architect`), the architect↔sibling-architect messaging behavior, AND the builder-side spoofing-check constraint (builders may only address their own spawning architect via `architect:<name>`), with concrete examples for each.
3. Every builder maintains `codev/state/<builder-id>_thread.md` as a free-text log of phase transitions, decisions, blockers, and anything else worth recording. Architects and sibling builders can read each other's threads via plain file I/O (`cat`, `Read` tool, file browser, `ls codev/state/`). The thread is **markdown**, **free-form**, and **owned by the builder LLM** — no structured schema, no porch hooks.
4. Running `afx workspace add-architect --name <name>` from a shell while VSCode is open causes the VSCode Architects tree to refresh within ~1s (the SSE round-trip), with the new architect appearing as a child of the tree without manual user action. Same for remove (already works, must continue working).

## Stakeholders

- **Primary Users**: Codev users running two or more architects in a workspace. Currently: the codev maintainer (when driving #786-class follow-ups with sibling architects) and Shannon's external adopter setup (`main` + `ob-refine`). Future external adopters who scale from one architect to several.
- **Secondary Users**: Builders themselves — items 2 and 3 directly affect how a builder LLM discovers messaging primitives and writes its thread.
- **Technical Team**: The codev maintainer (architect). The builder spawned for #823 implements; the architect reviews at spec-approval, plan-approval, and PR gates.
- **Business Owners**: The codev maintainer. #823 closes the last coordination gaps from the multi-architect epic (#755 → #761 → #774 → #786 → **#823**).

## Constraints

### Technical
- **#823 depends on #786 for the full deliverable surface.** Specifically:
  - Item 2's documentation references `afx status` listing architects — that enumeration is added by #786 (gap #6 in #786's spec).
  - Item 4's "refresh on remove" path depends on `codev.removeArchitect` existing in VSCode — added by #786 (phase 6).
  - Item 4 must continue to work with #786's remove path; the new SSE event must be emitted from both add and remove call sites.
  - PR #822 (for #786) is currently OPEN. **#823's implementation must rebase onto #786 once #786 merges**, or be implemented on a branch that already includes #786's changes. The plan phase must pin which approach.
- **Single-workspace assumption holds.** Cross-workspace coordination is still deferred.
- **Field-naming consistency**: `spawnedByArchitect` (TypeScript) and `spawned_by_architect` (SQL) — pre-existing conventions from #755, do not rename.
- **No new dependencies.** Items 1, 3, 4 are pure-codev changes. Item 2 is pure-markdown.
- **CLAUDE.md and AGENTS.md must stay synchronized** — they're identical files per the existing convention (per `CLAUDE.md` line 3: *"An identical AGENTS.md file is also maintained following the AGENTS.md standard..."*). Item 2 must update both atomically in the same commit.
- **Markdown ecosystem only for item 3.** `codev/state/<builder-id>_thread.md` must be readable by any markdown-capable tool (Claude's Read tool, `cat`, GitHub web preview, VSCode editor) without special tooling.

### Business
- The next coherent release after #786 should ship #823 — closes the multi-architect coordination story.
- No time estimates per SPIR convention.

### Out of Scope (per issue body, treat as fixed)
- VSCode parity for item 1 (builder attribution in the VSCode Builders tree) — separate follow-up.
- Cross-workspace messaging — still deferred (per #755 and #786).
- Renaming architects after add — separate follow-up.
- Workspace-scoping of `state.db.architect` (Co1 from #786 PR-iter-3) — needs schema migration; deferred until multi-workspace Tower architect routing becomes a goal.
- Structured schema for the thread file (item 3) — explicitly rejected by the issue body ("Trust the LLM"). Trying to add timestamps, headers, or required sections re-creates the very ceremony the issue is rejecting.
- Porch hooks that auto-write the thread (item 3) — same rejection. The thread is the builder's, not porch's.
- Thread-file mirroring to dashboard / VSCode (item 3) — markdown-ecosystem discoverability (file browser, `ls`, `cat`, GitHub web preview) is the discovery story. UI surfacing is a possible follow-up.

## Baked Decisions

These items in the issue body are fixed by the architect and not subject to spec-level relitigation:

1. **Item 1 — N>1 conditional render only.** Builder attribution renders ONLY when `architects.length > 1`. The N=1 dashboard stays visually identical to today. No N=1 attribution rendered "for consistency" or "for future N>1 cases."
2. **Item 1 — dashboard surface only.** VSCode parity for builder attribution is deliberately deferred to a follow-up.
2b. **Item 1 — visual style locked to OQ-B (a)** (architect direction 2026-05-23, pre-spec-approval). The attribution tag is `<builder-id> · <architect-name>` — separator + name, NO "spawned by" prefix label. Hover-tooltip with full "spawned by `<name>`" text is the COULD nice-to-have. Plan phase MUST honor this; other visual options (prefix label, subscript, new column) are out of scope.
3. **Item 3 — free-text only, no schema.** The thread file is markdown with no required sections, no timestamp format, no enforced structure. The spec pins **location** and the **instruction in the builder protocol prompt** — nothing else.
4. **Item 3 — no porch hooks.** Porch does not write to the thread, does not validate it, does not require it to exist. Builders write it themselves because the protocol prompt instructs them to.
5. **Item 3 — no per-builder thread schema.** Each builder maintains its own `codev/state/<builder-id>_thread.md`. There is no shared cohort file (e.g. `codev/state/cohort.md`). The shared view falls out of `ls codev/state/`.
6. **Item 4 — SSE event mirrors `worktree-config-updated`.** The new event reuses the same emit-on-mutation, subscribe-from-extension shape that the worktree config event already uses. Plan phase pins the exact event name and payload.
7. **Item 4 — Tower-side emit + VSCode subscribe.** Dashboard parity falls out of existing polling. No dashboard code changes needed for item 4; verify only.
8. **Splitting any of the four items into a separate issue is the wrong call.** The issue body is explicit that items 1+2+3+4 cohere as one coordination feature pass.

## Assumptions

- After #786 lands, `afx workspace add-architect` writes the new architect to Tower's in-memory map AND to `state.db.architect`, AND the architect appears in subsequent `/state` API responses. (Verified against #786 spec MUSTs.)
- `afx workspace remove-architect` (introduced by #786 phase 4) removes the architect from the in-memory map and `state.db`. (Verified against #786 spec MUSTs.)
- The dashboard `/state` API endpoint includes a per-architect entry whenever a sibling is added. (Verified against `packages/types/src/api.ts:78` and Spec 761's emit shape.)
- The existing `worktree-config-updated` SSE event in Tower is a usable precedent for an `architects-updated` event (similar mutate-on-write semantics, no fan-out throttling needed).
- The builder LLM is competent enough to write a useful free-text thread when instructed in its protocol prompt — same trust assumption already in place for all builder narrative output (commit messages, review docs, lesson-learned write-ups).

## Solution Approaches

### Approach 1: All four items in one SPIR PR, ordered Item 1 → 2 → 3 → 4 (RECOMMENDED)

**Description**: One PR, one branch (rebased onto #786 once it merges, or branched off #786 if #786 is still open at implementation start). Four phases in the plan, one per deliverable, in the order the issue lists them. Each phase commits independently within the single PR.

**Pros**:
- Matches the issue body's framing ("one coherent multi-architect coordination feature pass").
- Each phase is independently meaningful and testable (so cmap reviewers can verify each in isolation).
- Documentation (item 2) and thread state (item 3) phases are very small; bundling them in is cheap.
- One verify pass exercises all four deliverables on a real workspace with two architects.

**Cons**:
- Branch coordination with #786 needs attention — if #786 re-iterates, #823 may need to rebase mid-implementation.
- One large PR touches multiple surfaces (dashboard, types, two markdown files, VSCode extension, Tower SSE) — needs disciplined commit hygiene.

**Estimated Complexity**: Low-Medium.
**Risk Level**: Low — each individual item is small; #786 already establishes the multi-architect patterns the implementation reuses.

### Approach 2: Two PRs — (1+2) and (3+4)

**Description**: Ship items 1 (attribution) and 2 (docs) in one PR — both are dashboard/documentation work with no Tower-side or VSCode-side changes. Ship items 3 (thread state) and 4 (VSCode refresh) in a follow-up PR.

**Pros**:
- Each PR is smaller and easier to review.
- Item 4's Tower-side SSE event is the most risk-bearing change; isolating it reduces blast radius.

**Cons**:
- Loses the "one coherent feature pass" framing the issue body insists on.
- Doubles the porch ceremony (two spec phases, two plan phases, two PRs).
- The four items are already small; splitting feels like ceremony-driven over-design.

**Estimated Complexity**: Low cumulative, but more total porch work.
**Risk Level**: Low.

### Approach 3: Defer item 1 to its own follow-up, ship 2+3+4 in this SPIR

**Description**: Item 1 (builder attribution) is the most dashboard-CSS-sensitive item. Defer to a dashboard-focused follow-up where Playwright visual verification is built in. Ship the other three here.

**Pros**:
- Reduces UI risk for #823.
- Aligns with [[feedback_ui_visual_verification]] — Playwright before approving UI.

**Cons**:
- Strands the easiest, most user-visible win of the four.
- Item 1 is genuinely small (a span + a CSS class + a type field). Deferring it is over-cautious.

**Estimated Complexity**: Low.
**Risk Level**: Low.

**Recommendation**: **Approach 1.** The issue is explicit that these four items cohere; the cost of bundling is small commit-hygiene discipline; the cost of splitting is doubled porch ceremony and lost framing. The item 1 UI risk is real but manageable with one Playwright pass during the verify phase (per [[feedback_ui_visual_verification]]).

## Open Questions

### Critical (Blocks Progress)

None as of draft time. The issue body is unusually well-scoped — most of what would normally be a critical OQ is already resolved as a baked decision above.

### Important (Affects Design)

- **OQ-A — Item 1: how does `BuilderCard` learn the architect count?** Two options:
  - (a) `BuilderCard` reads `state.architects.length` from a context/prop passed down through `WorkView`. The N>1 conditional render is local to `BuilderCard`.
  - (b) `WorkView` computes `architectCount` once and passes it to each `BuilderCard` as a prop.
  - **Recommendation**: (b) — single computation, cleaner prop interface, avoids context plumbing. Plan phase confirms.
- **OQ-B — Item 1: what does the "spawned by" tag look like visually?** The issue says "small inline tag." Options:
  - (a) A small pill next to the builder ID with just the architect name (`#0042 · ob-refine`) — the `·` separator is the only visual cue that the second token is an attribution; no "spawned by" prefix.
  - (b) A small pill next to the builder ID with an explicit prefix (`#0042 [spawned by ob-refine]`) — more discoverable for users seeing it for the first time, but visually heavier.
  - (c) A subscript under the builder ID.
  - (d) A new column at the right of the table, hidden when `architects.length === 1`.
  - **Recommendation**: (a) — minimum DOM change, no column-shift on N=1↔N>1 transition. The `·` separator is sufficiently unambiguous in context (a multi-architect workspace's user knows what they're looking at). Hover-tooltip with full "spawned by `<name>`" text is a cheap nice-to-have (see COULD criterion below). Per iter-1 Claude, the spec's visual intent is now spelled out: **just the separator + the architect name, no prefix label**. Plan phase pins the CSS class and HTML structure; verify phase exercises with Playwright at N=1, N=2, N=3.
  - **DECISION (architect, 2026-05-23, pre-spec-approval)**: **Locked to (a) — `#0042 · ob-refine` separator format plus the hover-tooltip COULD criterion.** Plan phase MUST honor this; further visual options are out of scope.
- **OQ-C — Item 3: which protocol prompts get the thread-instruction?** Two scopes:
  - (a) Only the SPIR protocol prompts (`codev/protocols/spir/protocol.md` or its phase prompts).
  - (b) All protocols (SPIR, ASPIR, AIR, BUGFIX, PIR, TICK, EXPERIMENT, MAINTAIN, RESEARCH).
  - **Recommendation**: (b) — the thread is a builder-level concern, not a protocol-specific one. Add the instruction in `codev/roles/builder.md` so every builder spawn picks it up regardless of protocol. Plan phase confirms by reading `codev/roles/builder.md` and the protocol prompt files.
- **OQ-D — Item 3: should the thread file be created up-front (on spawn) or lazily (first time the builder writes)?**
  - (a) Up-front: porch creates an empty `codev/state/<builder-id>_thread.md` at spawn time. (But the issue says "no porch hooks.")
  - (b) Lazily: builder LLM creates it on first write via the Write tool.
  - **Recommendation**: (b) — honors the "no porch hooks" baked decision. The instruction in the builder role says "you will maintain `codev/state/<builder-id>_thread.md` — create it the first time you write to it." Plan phase confirms.
- **OQ-E — Item 3: how does the builder know its own `<builder-id>`?** The role-level prompt needs to teach the builder how to resolve its own id. Options:
  - (a) The builder reads the basename of its worktree (`.builders/<id>`) — already known via cwd.
  - (b) Porch sets an env var (`CODEV_BUILDER_ID`) at spawn time. (But the issue says "no porch hooks." A spawn-time env var is borderline — it's a one-shot read, not a per-write hook. But it adds complexity.)
  - (c) The instruction in `codev/roles/builder.md` says "your builder id is the basename of your current working directory" — builder runs `basename $(pwd)` once.
  - **Recommendation**: (c) — zero porch ceremony, builder reads cwd. Plan phase verifies the worktree path is reliable.
- **OQ-F — Item 4: exact SSE event name and payload.** Options:
  - (a) `architects-updated` with payload `{ workspace: string }` (workspace path, subscriber re-fetches `/state` to get the new architect list).
  - (b) `architects-updated` with payload `{ workspace: string, architects: ArchitectState[] }` (workspace path + full collection, subscriber can skip the re-fetch).
  - (c) `architect-added` / `architect-removed` with payload `{ workspace: string, name: string }` (delta per event).
  - **Recommendation**: (a) — matches `worktree-config-updated`'s shape exactly (per `packages/codev/src/agent-farm/servers/worktree-config-watcher.ts:60-65`, which emits `{ workspace: workspacePath }` body and lets subscribers re-fetch). **The payload MUST include `workspace` to support multi-workspace Tower** (Tower can serve multiple workspaces; subscribers need to know which workspace's architect list changed before re-fetching). Plan phase confirms by reading `worktree-config-watcher.ts`'s exact emit signature.
- **OQ-G — Item 4: which Tower-side call sites emit the event?** Three known mutation points:
  - `addArchitect` in `tower-instances.ts` (the `workspace add-architect` path).
  - `removeArchitect` in `tower-instances.ts` (added by #786 phase 4).
  - `launchInstance` in `tower-instances.ts` (re-spawns persisted siblings — but only on workspace start, not "add"; emit may be redundant since dashboard polls on init).
  - **Recommendation**: emit on `addArchitect` and `removeArchitect`. Skip on `launchInstance` since subscribers (VSCode `WorkspaceProvider`) already re-fetch on activate. Plan phase confirms.

### Nice-to-Know (Optimization)

- **NQ-A — Item 3: should `codev/state/` be gitignored?** Thread files are per-builder narrative state. They live in the builder's worktree. After PR merge, they're either committed (becoming part of the review record) or discarded (lost on cleanup).
  - **Recommendation**: leave gitignore as-is (don't add `codev/state/`). Builders can commit threads if useful in the PR; otherwise they get cleaned up with the worktree. Plan phase confirms by checking what other transient builder state does today.
- **NQ-C — Item 3: thread-file accumulation on `main` over time (per iter-1 Claude).** If builders commit their thread files at PR time, then after 50 features `main` carries 50 thread files from builders whose worktrees no longer exist. The thread files are part of the historical review record (parallel to `codev/reviews/`), so accumulation is intentional — they're a per-builder narrative log alongside the formal review doc. **Lifecycle decision**: leave accumulation as-is; pruning (if ever needed) is a MAINTAIN-protocol concern, not #823's scope. The MAINTAIN protocol already prunes `codev/reviews/` selectively; the same discipline applies to `codev/state/` if it grows beyond reason. Plan phase does NOT introduce an auto-cleanup mechanism.
- **NQ-B — Item 4: should the dashboard explicitly subscribe to the new SSE event for instant updates, beyond polling?** Probably no — polling already picks it up within ~3s and the issue body explicitly defers dashboard verification to "polling will pick it up naturally." But the option exists if user-perceived staleness is a concern.

## Performance Requirements

- **Item 1**: No measurable dashboard render regression for N ≤ 8 architects with N ≤ 50 builders.
- **Item 1**: No additional `/state` or `/overview` API call cost — the field is added to an existing SQL query, served from existing endpoints.
- **Item 3**: File-write cost is negligible (markdown append). Builders write at phase boundaries, not per-action.
- **Item 4**: SSE event round-trip from `addArchitect` call to VSCode tree refresh: <1s on a local Tower.

## Security Considerations

- **Item 3**: `codev/state/<builder-id>_thread.md` is workspace-private. Same trust model as the rest of `codev/`. No new exposure.
- **Item 3**: Free-text from the builder LLM is uncontrolled — builders are already trusted to write commit messages, PR descriptions, and review docs. No new trust delta.
- **Item 4**: SSE event carries the architect collection (names, terminal IDs). Same shape as the existing dashboard `/state` response. No new exposure.
- **Items 1, 2**: No security implications.

## Success Criteria

### Functional (MUST)

#### Item 1 — Dashboard builder attribution
- [ ] `OverviewBuilder` (`packages/types/src/api.ts`) and `BuilderOverview` (`packages/codev/src/agent-farm/servers/overview.ts`) both gain a `spawnedByArchitect: string | null` field.
- [ ] The overview SQL enrichment block at `overview.ts:781-797` SELECTs `spawned_by_architect` alongside `issue_number`, drops the `WHERE issue_number IS NOT NULL` clause (per iter-1 Gemini — so soft-mode / task-mode builders also enrich), and conditionally applies each enrichment field based on whether the row's column is non-null. The resulting `spawnedByArchitect` field is populated on each `BuilderOverview` whose worktree row exists in `state.db.builders`, regardless of issue-number presence.
- [ ] `BuilderCard.tsx` conditionally renders a small inline tag (CSS class TBD by plan phase, per OQ-B recommendation `#0042 · ob-refine` style) when `architectCount > 1` AND `builder.spawnedByArchitect !== null`.
- [ ] When `architectCount === 1` (the N=1 baseline), `BuilderCard` renders identically to its pre-823 output — no extra DOM, no extra CSS class, no extra spacing.
- [ ] `WorkView` computes `architectCount = state.architects.length` once and passes it to each `BuilderCard` as a prop (per OQ-A recommendation).
- [ ] Unit test: `BuilderCard` snapshot at `architectCount=1` matches the pre-823 baseline.
- [ ] Unit test: `BuilderCard` rendering at `architectCount=2` with `spawnedByArchitect='ob-refine'` includes the attribution tag.
- [ ] Unit test: `BuilderCard` at `architectCount=2` with `spawnedByArchitect=null` (legacy builder) does NOT render the tag.
- [ ] Visual verification (Playwright per [[feedback_ui_visual_verification]]): render dashboard with N=1 builder + 1 architect, N=2 builders + 2 architects, and N=3 builders + 3 architects. Confirm the tag appears only in the N>1-architect cases and the layout doesn't shift.

#### Item 2 — Inter-agent messaging documentation
- [ ] `CLAUDE.md` gains a new section (location TBD by plan, candidate: after the existing "Agent Responsiveness" section or near the existing `afx send` references at line ~497) documenting the four addressing forms:
  - `afx send <builder-id> "msg"` — architect (or any sender) → builder.
  - `afx send architect "msg"` — when sent from a builder, routes to the spawning architect via affinity (per #774). When sent from main / any architect, routes to the default architect named `main`.
  - `afx send architect:<name> "msg"` — explicit per-architect addressing. From **architects** (including `main`), addresses any architect by name — this is the sibling-architect messaging form. From **builders**, allowed ONLY when `<name>` matches the builder's `spawnedByArchitect`; mismatches are rejected by the spoofing check at `tower-messages.ts:213-218`. This is an explicit form of the affinity routing, not an override.
  - `afx send <workspace>:architect "msg"` — cross-workspace addressing (existing).
- [ ] `CLAUDE.md` documents that architect → sibling-architect messaging works today via `architect:<name>` (per #786 spec scenario #8 — sender = architect bypasses the spoofing check). Provide an example: `main` running `afx send architect:ob-refine "PR-iter-2 feedback ready"`.
- [ ] `CLAUDE.md` explicitly notes the builder-side spoofing-check constraint (with a concrete example: builder `spir-823` running `afx send architect:ob-refine "..."` is rejected unless its `spawnedByArchitect == 'ob-refine'`).
- [ ] `CLAUDE.md` documents that `afx status` lists architects alongside builders (post-#786).
- [ ] `AGENTS.md` receives the identical content in the same commit. (Both files are kept synchronized per the existing convention.)
- [ ] `codev/resources/commands/agent-farm.md` `afx send` section is extended with the same four forms and the sibling-architect example. The `architect:<name>` form is added to the "Target terminal" argument list at the top of the `afx send` section.
- [ ] `CLAUDE.md` / `AGENTS.md` / `agent-farm.md` MUST include a one-sentence mention of the per-builder thread file (`codev/state/<builder-id>_thread.md`, item 3) in the messaging-section context, with a pointer to the discovery path (`ls codev/state/`). This is **promoted from SHOULD to MUST per iter-1 Claude** — a user reading the messaging docs is the natural audience for the thread-discovery story; splitting it across two doc sections would lose discoverability.
- [ ] No new behavior is introduced — this is a documentation surfacing pass only. No code changes outside the three markdown files.

#### Item 3 — Per-builder thread state
- [ ] `codev/roles/builder.md` (the builder role definition referenced by all protocol-driven spawns) gains a new section titled "Thread file" instructing every builder to maintain `codev/state/<builder-id>_thread.md` as a free-text markdown log. The instruction names: the path (`codev/state/<builder-id>_thread.md`), the resolution rule (`<builder-id>` = the basename of the builder's worktree path, e.g. `spir-823` for this builder — runnable as `basename "$(pwd)"`), the intent (record phase transitions, decisions, blockers, anything worth recording for collective situational awareness), the freedom (no schema, no required sections), the discovery story (sibling builders and architects can read it via plain file I/O), AND the cross-builder traversal pattern: sibling builders share the parent `.builders/` directory, so builder A reads builder B's thread at `../<sibling-id>/codev/state/<sibling-id>_thread.md` from A's worktree (per iter-1 Claude — the path is correct today but should be spelled out in the instruction rather than left to the LLM to figure out).
- [ ] The instruction explicitly says: "Create the file the first time you write to it" (lazily, per OQ-D recommendation). No up-front creation required.
- [ ] The instruction explicitly says: "Trust your own judgement about what to write and when. There is no template."
- [ ] The instruction explicitly says: "This is for the cohort's situational awareness, not porch's tracking. Porch does not read this file."
- [ ] No porch code changes. Porch does not create, validate, or read `codev/state/<builder-id>_thread.md`.
- [ ] No protocol-prompt-file changes beyond the shared `codev/roles/builder.md` update.
- [ ] No tests required — the thread is a freeform LLM-authored artifact. Plan phase confirms.
- [ ] Verify-phase manual exercise: spawn a fresh builder (any protocol) and confirm it creates and writes to `codev/state/<builder-id>_thread.md` at phase boundaries without being explicitly told to in the spawn prompt.

#### Item 4 — VSCode Architects tree auto-refresh on add
- [ ] Tower emits a new SSE event named `architects-updated` (or equivalent — pinned by plan per OQ-F) on every successful `addArchitect` and `removeArchitect` call. Event payload includes `{ workspace: <workspacePath> }` at minimum (matching `worktree-config-updated`'s shape per `worktree-config-watcher.ts:60-65`); subscribers re-fetch `/state` for the workspace to get the new architect list. The workspace field is **required** to support multi-workspace Tower deployments where subscribers need to disambiguate which workspace mutated.
- [ ] The event is NOT emitted from `launchInstance` (per OQ-G recommendation) — subscribers re-fetch on activate.
- [ ] `WorkspaceProvider` in `packages/vscode/src/views/workspace.ts` (or the appropriate subscriber location pinned by plan) subscribes to the new event and fires its `changeEmitter` (the same trigger used today by `codev.removeArchitect`).
- [ ] The dashboard does NOT subscribe to the new event explicitly. Its polling continues to pick up architect changes within its existing poll interval. Plan phase confirms by checking `/state` polling cadence (existing behavior, no change).
- [ ] Verify-phase manual exercise: with VSCode open against the workspace, run `afx workspace add-architect --name <name>` from a shell. Within ~1s, the VSCode Architects tree shows the new architect WITHOUT manual user action.
- [ ] Verify-phase regression: same exercise with remove — `afx workspace remove-architect <name>` (positional per #786) causes the tree to refresh (already works post-#786 via `codev.removeArchitect` self-refresh, and now ALSO via the new SSE event if remove is invoked from a non-VSCode surface like the CLI).
- [ ] Update the #786 verify-scenarios artifact (`codev/projects/786-multi-architect-feature-is-und/verify-scenarios.md` once #786 merges, or whichever artifact path the merged #786 lands at) to reflect that Scenario 11's known-limitation gap is closed by #823. The artifact does not exist on this branch yet (#786 PR #822 is open at draft time); the rebase / post-#786-merge step adds this edit. Plan phase confirms the cross-reference shape after #786 lands.

### Functional (SHOULD)

- [ ] Item 1: The attribution tag includes a click target (e.g. tab-switch to the spawning architect's tab). **Deferred** — not in the issue body's scope. Listed only so the plan phase explicitly notes the deferral.

### Functional (COULD)

- [ ] Item 1: Hover-tooltip on the attribution tag showing the full "spawned by `<name>`" text — improves discoverability for users seeing the `·` separator for the first time without making the visual heavier in normal use. (Cheap — `title` attribute on the span.)
- [ ] Item 1: Click-through from the attribution tag to the spawning architect's tab. (Skip unless cheap; defer otherwise.)

### Non-Functional

- [ ] No reduction in test coverage on touched files. New code adds unit tests for `BuilderCard` rendering at N=1 and N=2, and for the overview SQL enrichment (covering both spawned-by-architect populated and null cases). Item 4 adds a Tower-side unit test that `addArchitect` and `removeArchitect` emit the event; VSCode-side unit test (vitest, per #786 phase 6's new setup) that `WorkspaceProvider.refresh()` is called on event receipt.
- [ ] All existing tests (codev unit suite, dashboard unit suite, vscode vitest suite) continue to pass.
- [ ] The verify phase manually exercises items 1 and 4 on a real workspace with two architects, per [[feedback_e2e_headline_path]] and [[feedback_ui_visual_verification]].

## Test Scenarios

### Functional Tests

1. **Item 1, N=1 baseline (regression)**: Dashboard renders with one architect, three builders. No "spawned by" tag visible on any card. DOM identical to pre-823.
2. **Item 1, N=2 happy path**: Dashboard renders with `main` and `ob-refine` architects, four builders (two spawned by each). Each builder card shows the correct "spawned by" tag.
3. **Item 1, N=2 legacy builder**: Dashboard renders with N=2 architects; one builder has `spawnedByArchitect === null` (legacy row from before #755). That builder's card renders no tag; the others render their tags.
3b. **Item 1, N=2 soft-mode builder (per iter-1 Gemini)**: Dashboard renders with N=2 architects; one builder is soft-mode (e.g. `task-foo`) with `issue_number = NULL` but `spawned_by_architect = 'ob-refine'`. After dropping the `WHERE issue_number IS NOT NULL` clause, this builder MUST appear in the SQL enrichment result and render its attribution tag. This scenario validates that the SQL fix doesn't drop soft-mode rows.
4. **Item 1, transition**: Start at N=1 (no tags). User runs `afx workspace add-architect`. After dashboard polls (≤3s) and re-renders, attribution tags appear on existing builders' cards (those with non-null `spawnedByArchitect`).
5. **Item 2, doc discoverability**: `grep` for `architect:<name>` in `CLAUDE.md`, `AGENTS.md`, and `codev/resources/commands/agent-farm.md` all return ≥1 hit each. Same for `architect → sibling architect`.
6. **Item 3, builder writes thread**: Spawn a fresh SPIR builder. After spec drafting commits, verify `codev/state/<builder-id>_thread.md` exists and contains ≥1 meaningful entry written by the builder.
7. **Item 3, architect reads thread**: From the architect's terminal in a separate workspace activity, `cat codev/state/spir-823_thread.md` shows the builder's narrative log. Same via the Read tool in a Claude Code session.
8. **Item 3, sibling builder reads thread**: From builder A's worktree, `cat ../<sibling>/codev/state/<sibling-id>_thread.md` shows the sibling's narrative log. (Path navigation is via the parent workspace, since each builder is in its own worktree.)
9. **Item 4, add-via-CLI refresh**: VSCode open against the workspace, Architects tree expanded. Run `afx workspace add-architect --name ob-refine` from an external shell. Within ~1s, the tree displays `ob-refine` as a child entry without the user clicking refresh.
10. **Item 4, remove-via-CLI refresh**: Same setup. Run `afx workspace remove-architect ob-refine` (positional per #786). Tree updates to remove the entry within ~1s.
11. **Item 4, remove-via-VSCode (regression)**: Right-click `ob-refine` in VSCode tree → Remove. Tree refreshes (existing behavior via `codev.removeArchitect` self-trigger).
12. **End-to-end multi-architect coordination**: Spawn two architects (`main`, `ob-refine`). Spawn a builder from each. Each builder writes to its thread file. The dashboard shows both builders with correct attribution. The architect runs `afx send architect:ob-refine "check the auth migration"` and the message lands on the sibling. The VSCode tree shows both architects.

### Non-Functional Tests

1. **Coverage no-regression**: Coverage report on `BuilderCard.tsx`, `overview.ts`, `workspace.ts`, and any Tower-side files touched matches or exceeds pre-823 baseline.
2. **UI smoke (Playwright)**: Render dashboard with N=1, N=2, N=3 architects (multiplied by N=1, N=3 builders). Visually verify the attribution tag presence/absence and layout stability. Per [[feedback_ui_visual_verification]].
3. **SSE event timing**: With Tower local, measure `addArchitect` → VSCode `WorkspaceProvider.refresh()` event round-trip. Assert <1s.

## Dependencies

- **External Services**: None.
- **Internal Systems** (all post-#786):
  - **Item 1**:
    - `packages/types/src/api.ts` — add `spawnedByArchitect: string | null` to `OverviewBuilder`.
    - `packages/codev/src/agent-farm/servers/overview.ts` — add field to `BuilderOverview`; extend SQL `SELECT` to include `spawned_by_architect`.
    - `packages/dashboard/src/components/BuilderCard.tsx` — conditional inline render.
    - `packages/dashboard/src/components/WorkView.tsx` — compute and pass `architectCount`.
    - Tests: dashboard unit suite, codev overview unit tests.
    - CSS: a new utility class for the attribution tag (kept minimal — color and font-size tweak, no new component).
  - **Item 2**:
    - `CLAUDE.md` — new messaging section.
    - `AGENTS.md` — identical content.
    - `codev/resources/commands/agent-farm.md` — extend `afx send` section.
  - **Item 3**:
    - `codev/roles/builder.md` — new "Thread file" section. (Same file referenced by the builder spawn prompt template.)
    - Sanity check: `codev-skeleton/roles/builder.md` if it exists separately (so external projects pick it up via `codev update`).
  - **Item 4**:
    - `packages/codev/src/agent-farm/servers/tower-instances.ts` — emit the new event from `addArchitect` and `removeArchitect`.
    - `packages/codev/src/agent-farm/servers/tower-routes.ts` (or the equivalent SSE event-stream broadcast site, likely the same broadcast helper used by `worktree-config-watcher.ts` — plan phase confirms the seam).
    - `packages/vscode/src/views/workspace.ts` — subscribe to the new event, fire `changeEmitter`. The actual SSE subscription mechanism is `connectionManager.onSSEEvent()` (per iter-1 Claude verification), not a direct tower-client call.
    - `packages/core/src/tower-client.ts` (per iter-1 Claude correction — original spec mis-located this at `packages/vscode/src/tower-client.ts`) — extend its event handler set if a new event type needs registration. The VSCode extension consumes the client via `packages/vscode/src/connection-manager.ts`'s SSE subscription.
    - #786 verify-scenarios artifact — note Scenario 11 closure (after #786 merges and the artifact path lands).
  - **Libraries/Frameworks**: None new.

## References

- Issue [#823](https://github.com/cluesmith/codev/issues/823) — this spec is its formalization.
- PR #822 / Spec 786 — multi-architect lifecycle/persistence/UX (precursor; must merge before #823 implementation completes).
- PR #757 / Spec 755 — multi-architect primitive (v3.0.5).
- PR #762 / Spec 761 — dashboard tab strip (v3.0.6).
- PR #775 / Bugfix #774 — routing fix (v3.0.8).
- [[feedback_e2e_headline_path]] — drives the verify-phase manual round-trip for items 1 and 4.
- [[feedback_ui_visual_verification]] — Playwright render-before-approval for item 1.
- `codev/projects/786-multi-architect-feature-is-und/verify-scenarios.md` Scenario 11 — known-limitation note that item 4 closes.

## Risks and Mitigation

| Risk | Probability | Impact | Mitigation Strategy |
|------|------------|--------|---------------------|
| #786 (PR #822) does not merge before #823 implementation completes, forcing mid-build rebase | Medium | Low | Plan phase decides: branch off #786's HEAD if #786 is still open at implementation start; otherwise rebase onto main after #786 merges. The four items are sequenced so that items 1, 2, 3 can land first without item 4's #786 dependency if mid-build rebase becomes necessary. |
| Item 1's attribution tag visually shifts the layout when transitioning from N=1 to N>1 | Low | Medium | OQ-B locks the visual treatment to inline-adjacent (no new column, no row-height change). Verify phase exercises Playwright at N=1, N=2, N=3 per [[feedback_ui_visual_verification]]. |
| Item 3's free-text thread becomes a dumping ground or noisy log that no one reads | Low | Low | The issue explicitly accepts this risk ("trust the LLM"). The instruction in `codev/roles/builder.md` frames the thread as "for collective situational awareness," which biases the LLM toward useful entries. No schema enforcement. If a future iteration shows the thread is consistently noise, that's a separate spec to add structure — not this one. |
| Item 4's SSE event name collides with an existing event | Very Low | Low | Plan phase greps `tower-routes.ts` and the SSE event-stream handler for existing event names before pinning `architects-updated`. |
| VSCode-side `WorkspaceProvider.refresh()` fires too eagerly and causes UI churn | Low | Low | The same handler is already invoked by `codev.removeArchitect`; this is just one additional trigger source. Plan phase confirms no debounce/throttle is needed (the rate is bounded by user-driven add/remove actions, ≤1/s in any realistic scenario). |
| Item 3's worktree-cwd-based `<builder-id>` resolution fails for soft-mode builders (whose worktree names don't match a protocol pattern) | Low | Low | The OQ-E (c) recommendation works for soft-mode builders too — the basename of their worktree IS their id (e.g. `task-foo`). No special handling needed. Plan phase verifies by reading `worktreeNameToRoleId` in `overview.ts`. |
| Adding the `spawnedByArchitect` field to `OverviewBuilder` ripples into VSCode-side consumers that don't expect it | Very Low | Low | Field is optional (`string \| null`). Existing consumers ignore unknown fields by TypeScript convention. Plan phase greps `OverviewBuilder` consumers to confirm. |
| SSE connection drops between `addArchitect` Tower-side and VSCode receipt; tree silently misses the update (per iter-1 Claude) | Low | Low | The VSCode `connectionManager.onSSEEvent()` subscription re-establishes on disconnect (existing behaviour for `worktree-config-updated` reconnect). On re-establish, `WorkspaceProvider` should `refresh()` defensively to pick up any architect changes missed during the gap. Plan phase confirms reconnect behaviour and adds a defensive refresh on reconnect if missing. |
| The `WHERE issue_number IS NOT NULL` SQL change ripples into existing `issueId` enrichment behaviour | Low | Low | The change drops the filter, not the field application. `builder.issueId` is set conditionally on `row.issue_number != null`. Existing N=1-architect dashboards continue showing issue IDs identically. Plan phase asserts this with a regression test. |

## Expert Consultation

**Date**: 2026-05-22 (iter-1)
**Models Consulted**: Gemini, Codex, Claude (via porch CMAP)
**Verdicts**: REQUEST_CHANGES (Gemini), REQUEST_CHANGES (Codex), APPROVE (Claude)

**Sections updated** based on iter-1 feedback:

- **Current State / Item 1** (per Gemini): Added SQL `WHERE` clause caveat — current enrichment query at `overview.ts:786` filters with `WHERE issue_number IS NOT NULL`, which would exclude soft-mode / task-mode builders whose `issue_number` is NULL. Spec now MUSTs dropping the `WHERE` clause and conditionally applying each enrichment field. Added Test Scenario 3b covering this edge case.
- **Current State / Item 2 + Functional MUST / Item 2** (per Codex): Added spoofing-check note. `architect:<name>` from a builder is rejected when `<name>` doesn't match the builder's `spawnedByArchitect` — it is NOT a way to override affinity routing. Documentation must distinguish architect-sender behaviour (open address grammar) from builder-sender behaviour (constrained to own spawning architect).
- **CLI examples throughout** (per Codex): Fixed `afx workspace add-architect ob-refine` → `afx workspace add-architect --name ob-refine` (verified against `packages/codev/src/agent-farm/cli.ts:110`). `remove-architect` is positional per #786 — left as-is.
- **Item 4 verify-scenarios reference** (per Codex): Relaxed pin on `codev/projects/786-multi-architect-feature-is-und/verify-scenarios.md` — that file doesn't exist on this branch yet (#786 PR #822 is open at draft time). Spec now says "after #786 merges and the artifact path lands."
- **OQ-F + Functional MUST / Item 4** (per Codex): Required `workspace` field in the SSE event payload, matching `worktree-config-updated`'s `{ workspace: workspacePath }` shape verified at `worktree-config-watcher.ts:60-65`. Necessary for multi-workspace Tower deployments where subscribers need to disambiguate which workspace mutated.
- **Dependencies / Item 4** (per Claude): Corrected tower-client path from `packages/vscode/src/tower-client.ts` (mis-located) to `packages/core/src/tower-client.ts`. Clarified that the actual VSCode SSE subscription mechanism is `connectionManager.onSSEEvent()` in `workspace.ts`, not a direct tower-client call.
- **Functional MUST / Item 3 + builder.md instruction** (per Claude): Added explicit cross-builder traversal pattern (`../<sibling-id>/codev/state/<sibling-id>_thread.md`) to the `codev/roles/builder.md` instruction — sibling builders share the parent `.builders/` directory, so the path is reachable, but the instruction now spells it out instead of leaving the LLM to figure it out.
- **OQ-B** (per Claude): Spelled out the visual intent — just the `·` separator + architect name, NO "spawned by" prefix label. Hover-tooltip with the full text is in the COULD list as a cheap nice-to-have.
- **Functional MUST / Item 2 — promoted from SHOULD to MUST** (per Claude): The one-sentence mention of `codev/state/<builder-id>_thread.md` in the messaging docs is now a MUST. Item 2 is the natural discovery surface for the thread file; splitting would lose discoverability.
- **NQ-C (new)** (per Claude): Acknowledged thread-file accumulation on `main` over time. Decision: leave accumulation as-is; pruning is a MAINTAIN-protocol concern, NOT #823's scope. No auto-cleanup mechanism introduced.
- **Risks table** (per Claude): Added SSE-reconnect edge case — defensive `refresh()` on reconnect if not already in place. Added SQL-change ripple risk (low, but called out).

## Approval

- [ ] Architect Review (spec-approval gate)
- [x] Expert AI Consultation iter-1 complete (Gemini REQUEST_CHANGES + Codex REQUEST_CHANGES addressed; Claude APPROVE)

## Notes

- The four deliverables are deliberately small and surgical. No one of them is architecturally significant in isolation. The value is in shipping them together so the multi-architect coordination story is *complete* after #823, not partial.
- Item 1 is the most user-visible win and the most likely to need iteration. Plan phase budget should reflect this — most of the implementation phase time goes into item 1, the others are largely mechanical.
- Item 3's success is unmeasurable in tests by design. The verify phase exercise (item 3 test scenario 6) is the only fidelity check; if a spawned builder doesn't write to its thread file unprompted, the instruction in `codev/roles/builder.md` needs to be sharpened. Plan phase should pin the exact wording.
- Item 4 closes the loop on a gap that's been documented as a known limitation since #786 PR-iter-3. Shipping it here keeps the coordination story honest.
- The verify phase MUST include the full end-to-end coordination exercise (test scenario 12), per [[feedback_e2e_headline_path]]. Automated tests are necessary but not sufficient.

---

## Amendments

<!-- TICK amendments tracked here if needed in future. None at draft time. -->
