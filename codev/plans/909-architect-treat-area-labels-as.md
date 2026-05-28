# PIR Plan: Document `area/*` labels as architect's primary issue-organizing axis

## Understanding

Issue #909 asks for standing architect documentation on the `area/*` label convention so that any fresh session — in this repo or in an adopter's repo — can group, edit, audit, and bulk-move issues without re-discovering (or mis-applying) the convention. Today the rules live only in the labels themselves, in existing issue bodies, and in per-session memory; a new chat window has none of that context.

The work is *two coordinated doc updates*:

1. **codev's own `CLAUDE.md` + `AGENTS.md`** — concrete label vocabulary, policy rules, and `gh` recipes. Must stay byte-identical (per the existing sync rule).
2. **`codev-skeleton/templates/CLAUDE.md` + `templates/AGENTS.md` + `roles/architect.md`** — *framework-neutral* version. No mention of codev's specific area names; teaches the pattern, not the vocabulary (per the `framework-neutral-on-label-semantics` discipline).

Live label inventory (confirmed via `gh label list --search area/` on 2026-05-28):

| Label | Scope |
|---|---|
| `area/docs` | Documentation (this repo, CLAUDE/AGENTS, role files, resources) |
| `area/vscode` | VSCode extension (sidebar views, commands, keybindings) |
| `area/panel` | Codev panel/dashboard webview |
| `area/consult` | Consult CLI and consultation tooling |
| `area/tower` | Tower server + `afx`/agent-farm CLI (no separate `area/agent-farm`) |
| `area/cross-cutting` | Multi-area work (used alone, never alongside another `area/*`) |
| `area/porch` | Porch state machine / protocol orchestration |
| `area/config` | `.codev/config.json` and workspace setup |
| `area/terminal` | Terminal-specific (PTY, vscode terminal pane) |
| `area/core` | Shared core library / forge abstraction (`packages/core`, `packages/codev/src/lib`) |

Policy rules already in personal memory but undocumented in repo:

- Exactly one `area/*` per issue; multi-area work uses `area/cross-cutting` *alone*.
- No `type:*` labels (codev uses areas only).
- `area/` uses slash; other label families would keep colon — but only `area/*` is in active use.
- `gh issue create` invocations include `--assignee @me`.

## Proposed Change

Add a new section titled **"Area Labels — the organizing axis for issues"** to:

1. `CLAUDE.md` and `AGENTS.md` (codev root)
2. `codev-skeleton/templates/CLAUDE.md` and `codev-skeleton/templates/AGENTS.md`
3. `codev-skeleton/roles/architect.md`

### Design decisions (these are the calls that want plan-approval)

**1. Placement in `CLAUDE.md`/`AGENTS.md`.** Insert directly after the existing `### Project Tracking` subsection (currently lines 110–130, ending before `### 🚨 CRITICAL: Two human approval gates...`). That subsection already establishes "GitHub Issues are the source of truth for project tracking"; area labels are the *axis* on which those issues are organized, so the topical adjacency is exact. Keeping it under `## Quick Start` (the top of the doc) maximizes discoverability — well above `## Git Workflow` (line 579), which is too deep for first-encounter material a fresh session needs.

**2. Granularity of per-label scope hints.** Render the label vocabulary as a **two-column mini-table** (label / one-line scope hint) — the same 10-row table shown in "Understanding" above. Rationale: a table is more scannable than a bulleted paragraph, makes future additions a one-line append, and keeps the section's vertical footprint to ~20 lines. Rejected alternatives: bulleted list (less scannable), paragraph per area (too verbose for an at-a-glance reference), or examples-only (forces the reader to infer the pattern).

**3. Codev file vs. skeleton file split — the vocabulary boundary.** The codev file lists the concrete 10 labels inline (it is the source of truth for *this* repo). The skeleton file lists **zero** concrete label values — it teaches *how to discover and reason about* whatever label scheme an adopter uses (`gh label list`, infer from existing issues, confirm before bulk changes). This honors the existing `framework-neutral-on-label-semantics` discipline. Without this split the skeleton would silently push codev's vocabulary onto adopters who organize work by `team/*` or `priority/*` instead.

**4. Live list inline vs. pointer.** Both, in the codev file: the table is inline (zero-friction starting vocabulary for a fresh session) *and* the section closes with `gh label list --search area/` as the authoritative source if anything looks wrong or stale. The skeleton file ships **only** the pointer, since it has no canonical vocabulary to mirror. The staleness risk of the inline table is bounded — adding/removing an area is a rare deliberate event that already touches multiple repo files; the table just gets one more line.

**5. `gh` recipe set.** Include the four canonical operations the issue enumerates — group, edit, audit, bulk-move — as a one-line recipe each (8–10 lines total). Examples drawn from the issue's use-case list. Same recipes appear in the codev file (concrete: `area/tower`, etc.) and in the skeleton file (abstract: `<prefix>/<value>` placeholders).

**6. `codev-skeleton/roles/architect.md` placement.** Add as a new top-level section titled **"Working with project labels"**, placed immediately after `## Project Tracking` (line 247) and before `## Handling Blocked Builders` (line 262). Mirrors the codev-file placement choice: project tracking → label-as-organizing-axis. The role doc gets the same framework-neutral phrasing as the skeleton's CLAUDE/AGENTS templates (no codev vocabulary).

### Section content (concrete preview, codev's CLAUDE.md/AGENTS.md)

```markdown
### Area Labels — the organizing axis for issues

`area/*` is the **primary axis** for organizing GitHub Issues in this repo.
When users ask to group, edit, audit, or bulk-move issues, treat `area/*` as
the grouping dimension first — not `type:*` (we don't use them), not
milestones, not assignees.

**Live vocabulary** (run `gh label list --search area/` to confirm):

| Label | Scope |
|---|---|
| `area/docs` | Documentation, CLAUDE/AGENTS, role files, resources |
| `area/vscode` | VSCode extension (sidebar views, commands, keybindings) |
| `area/panel` | Codev panel / dashboard webview |
| `area/consult` | Consult CLI and consultation tooling |
| `area/tower` | Tower server + `afx`/agent-farm CLI (no `area/agent-farm`) |
| `area/cross-cutting` | Multi-area work (used **alone**, never alongside another `area/*`) |
| `area/porch` | Porch state machine / protocol orchestration |
| `area/config` | `.codev/config.json` and workspace setup |
| `area/terminal` | Terminal-specific (PTY, VSCode terminal pane) |
| `area/core` | Shared core library / forge abstraction |

**Policy:**

- **Exactly one** `area/*` per issue. Multi-area work uses `area/cross-cutting` *alone* — never two `area/*` labels.
- **No `type:*` labels.** Codev classifies issues by area only.
- `area/` uses **slash** (Kubernetes/Terraform convention). Other label families (if ever introduced) would keep colons.
- All `gh issue create` invocations include `--assignee @me` so issues land in the user's assigned list.

**Operational recipes:**

```bash
# Group: list open issues by area
gh issue list --state open --json number,title,labels --jq \
  'group_by([.labels[].name | select(startswith("area/"))]) | .[] | "\(.[0].labels[] | select(.name | startswith("area/")).name): \(length)"'

# Edit: change area on a single issue
gh issue edit <N> --remove-label area/old --add-label area/new

# Audit: find open issues with no area label
gh issue list --state open --json number,title,labels \
  --jq '.[] | select([.labels[].name] | any(startswith("area/")) | not) | "#\(.number) \(.title)"'

# Bulk-move: relabel all open `area/X` issues to `area/Y`
for n in $(gh issue list --state open --label area/old --json number --jq '.[].number'); do
  gh issue edit "$n" --remove-label area/old --add-label area/new
done
```

When in doubt, run `gh label list --search area/` — it is the source of truth.
```

### Section content (skeleton, framework-neutral)

The skeleton variant uses placeholder vocabulary throughout (`<prefix>/<value>`, `<your-prefix>/*`) and opens with the phrasing the issue suggests:

> If your project uses GitHub labels with a structured prefix (e.g. `area/*`, `team/*`, `priority/*`) to organize issues, treat them as the primary axis when users ask about grouping, editing, or auditing. Run `gh label list` to discover what your project uses, infer the convention from how existing issues are labeled, and ask the user to confirm before applying broad changes.

Followed by:

- `gh label list` discovery recipe.
- Abstract policy ("conventions vary — common patterns include one-label-per-axis, dedicated multi-prefix fallbacks like `area/cross-cutting`, etc. Confirm with the user before bulk operations").
- The same four recipe shapes (group/edit/audit/bulk-move) with `<prefix>` placeholders instead of `area/`.

## Files to Change

- `CLAUDE.md` — insert new `### Area Labels — the organizing axis for issues` subsection after the `### Project Tracking` block ending around line 130 (before the "🚨 CRITICAL: Two human approval gates" block).
- `AGENTS.md` — apply the **byte-identical** insertion. Verify with `diff CLAUDE.md AGENTS.md` (must be empty after the edit).
- `codev-skeleton/templates/CLAUDE.md` — insert framework-neutral subsection. Current file is short (122 lines, ends with "For More Info"); best placement is after the existing `## Key Locations` section (line 41) and before `## Quick Start`, or as a new top-level `## Working with Project Labels` section before `## Git Workflow` (note: the skeleton template doesn't have a `## Git Workflow` heading — final placement TBD at implement time, anchored to whatever puts it adjacent to project-tracking-style content).
- `codev-skeleton/templates/AGENTS.md` — byte-identical insertion. Verify diff is empty (except for the existing header / "AGENTS.md standard" preamble difference).
- `codev-skeleton/roles/architect.md` — new `## Working with project labels` section after `## Project Tracking` (currently line 247), before `## Handling Blocked Builders` (line 262).

No code, no tests, no protocol-spec changes. Pure documentation.

## Risks & Alternatives Considered

**Risk: inline label list goes stale.** Mitigated by (a) low churn rate — adding/renaming an area is rare and already touches multiple files, and (b) the closing pointer to `gh label list --search area/` makes the live list one command away. If staleness becomes a real problem we'd add a MAINTAIN-protocol audit step; deferred until needed.

**Risk: the framework-neutral skeleton phrasing leaks codev vocabulary.** Mitigated by code review at PR time and by deliberately keeping the codev file (with vocabulary) and the skeleton file (without) in *different directories* — the diff should make any leak obvious. The `framework-neutral-on-label-semantics` rule is the explicit guard.

**Risk: CLAUDE.md ↔ AGENTS.md drift.** Mitigated by running `diff CLAUDE.md AGENTS.md` as part of the test plan; same for the skeleton pair (modulo the existing 4-line preamble difference, which is the only intentional divergence).

**Alternative considered: top-level `## Area Labels` section near the top of CLAUDE.md.** Rejected because subsection-under-Quick-Start keeps the section *adjacent to* the related Project Tracking content, which is more discoverable for someone scanning headings to find "where are issues organized" than yet another top-level heading among the existing 18.

**Alternative considered: bulleted list instead of mini-table for the label vocabulary.** Rejected as less scannable; the mini-table puts label and scope on the same line for instant visual matching.

**Alternative considered: drop the inline label list, just point to `gh label list --search area/`.** Rejected because the whole point is *zero-memory* operability — a fresh session must be able to pick the right area for "file an issue for X" without first running a discovery command. The pointer is for verification, not first-touch.

**Alternative considered: a separate `codev/resources/area-labels.md` reference doc with `CLAUDE.md` linking to it.** Rejected — the issue explicitly asks for it to land *in* `CLAUDE.md` and `AGENTS.md` so it loads into the agent's context automatically. A separate file would defeat the no-memory-dependence acceptance criterion (the agent would have to know to read it).

## Test Plan

This is a doc-only change, so the test plan is **review-driven** rather than build-driven. At the `dev-approval` gate the reviewer should:

1. **Byte-identical files check** —
   ```bash
   diff CLAUDE.md AGENTS.md             # empty
   diff codev-skeleton/templates/CLAUDE.md codev-skeleton/templates/AGENTS.md  # only the 4-line preamble
   ```

2. **Vocabulary leak check** — confirm the skeleton files contain **zero** instances of codev's actual area names:
   ```bash
   grep -E "area/(docs|vscode|panel|consult|tower|cross-cutting|porch|config|terminal|core)" \
     codev-skeleton/templates/CLAUDE.md \
     codev-skeleton/templates/AGENTS.md \
     codev-skeleton/roles/architect.md
   # Expected: no output
   ```

3. **`gh` recipe smoke test** — run each recipe against the live repo and confirm output is reasonable:
   - Group: produces a tally per area.
   - Audit: returns issues without `area/*` (currently this may include legacy issues — that's fine, the recipe is what's being tested).
   - Edit: dry-run conceptually (don't actually relabel anything for the test).
   - Bulk-move: dry-run conceptually.

4. **Cold-session readability check** (the killer acceptance test from the issue) — open a fresh Claude chat in this repo, paste each of these and confirm the architect responds with the right `gh` command without further prompting:
   - "Show me my open issues grouped by area."
   - "Change the area on #872 from `area/porch` to `area/tower`."
   - "Which open issues have no area label?"
   - "All open `area/core` issues should move to `area/tower` — do the relabel."
   - "File an issue for X." (architect picks the right area without asking)

5. **Markdown rendering check** — render `CLAUDE.md` in VSCode preview and confirm the table layout doesn't break.

No unit tests, no build steps, no cross-platform concerns. The 3-way consult at the `pr` gate is the only AI review pass.
