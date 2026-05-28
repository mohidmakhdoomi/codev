# PIR Review: Treat `area/*` labels as a first-class organizing concept

Fixes #909

## Summary

Documented the `area/*` label convention as the primary axis for organizing GitHub issues in codev, so a fresh architect session can group / edit / audit / bulk-move issues without re-discovering the convention. Restructured the label set during the implement phase from 10 to 14 labels (added `area/dashboard`, `area/web`, `area/release`, `area/scaffold`, `area/protocols`; removed `area/panel` with 4 issues relabeled to `area/vscode`). The skeleton's `templates/{CLAUDE,AGENTS}.md` and `roles/architect.md` get framework-neutral guidance so adopters inherit the *pattern* without codev's specific vocabulary.

## Files Changed

```
 AGENTS.md                                          |  29 +++
 CLAUDE.md                                          |  29 +++
 codev-skeleton/roles/architect.md                  |  27 +++
 codev-skeleton/templates/AGENTS.md                 |  22 ++
 codev-skeleton/templates/CLAUDE.md                 |  22 ++
 codev/plans/909-architect-treat-area-labels-as.md  | 229 +++++++++++++++++++++
 codev/projects/909-*/status.yaml                   |  22 ++
 codev/roles/architect.md                           |  25 +++
 codev/state/pir-909_thread.md                      | 125 +++++++++++
 codev/reviews/909-architect-treat-area-labels-as.md (this file)
 9 files changed, 530+ insertions(+), 0 deletions(-)
```

Doc-only PR. No code changes, no test changes, no protocol-definition changes.

## Commits

```
ec19e019 [PIR #909] Drop cross-references between CLAUDE.md and architect.md
051656d7 [PIR #909] Dedup area-labels docs: vocabulary in CLAUDE.md/AGENTS.md, recipes in architect.md
65b7fa19 [PIR #909] Simplify lead-in to **Labels**, move gh label list to recipes with trigger comment
1c0ed423 [PIR #909] Restructure area-label set: add 5 labels, drop area/panel, remove --assignee policy
b7df41bc [PIR #909] Drop synonym alerts and Kubernetes/Terraform parenthetical from area-labels section
55fd42ea [PIR #909] Add area-labels section to codev CLAUDE.md, AGENTS.md, and codev/roles/architect.md
f2970e39 [PIR #909] Plan revised: add codev/roles/architect.md, expand grep, dashboard/synonym hints, follow-up candidates
aece8c03 [PIR #909] Plan draft
```

Plus thread-file updates and porch state-transition commits.

## Test Results

- `npm run build`: ✓ pass (built in ~1.4s, packages/codev/skeleton refreshed)
- `npm test`: ✓ pass (151 test files, 3188 passed, 13 pre-existing skips)
- Manual verification at `dev-approval` gate: reviewer ran the four `gh` recipes (group / edit / audit / bulk-move) against the live repo; group recipe correctly tallied 9 areas with open issues (after `--limit 500` fix mid-implementation); audit recipe surfaced expected unlabeled-issue list; vocabulary table reviewed for accuracy.

## Architecture Updates

No changes to `codev/resources/arch.md`. This PR is pure documentation — the label convention has existed informally since the labels were created; #909 only documents it. No new modules, no API contract changes, no protocol changes.

## Lessons Learned Updates

Updated `codev/resources/lessons-learned.md` with two durable lessons that emerged during this PR:

1. **Cross-file content references in framework files are brittle.** When deduplicating documentation across `CLAUDE.md` and role files, "see X for the table" pointers introduce a novel pattern (no precedent in the codebase). The dedup logic is sound — `CLAUDE.md` auto-loads in every session — but the explicit pointer is redundant when the file IS loaded and misleading if it isn't. Cleaner: each file is self-contained for its audience.

2. **Skeleton's user-facing layer hardcodes `gh` directly; the forge abstraction is internal-only.** Codev has a forge concept-command abstraction (`packages/codev/scripts/forge/<provider>/`) used by porch/doctor/etc., but skeleton docs and protocol prompts all use `gh` directly. When adding new skeleton content, match the established `gh`-direct pattern rather than introducing localized forge-CLI awareness in one section.

## Things to Look At During PR Review

1. **Scope expansion at dev-approval.** The original plan (approved at `plan-approval`) listed label changes as out-of-scope. During the dev-approval review, the reviewer requested an audit of the label set, which surfaced gaps (no `area/dashboard`, no `area/web`/`area/release`/`area/scaffold`/`area/protocols`) and a wrong description for `area/panel`. The PR was expanded to: (a) create 5 new labels via `gh label create`, (b) delete `area/panel` after relabeling its 4 issues to `area/vscode`, (c) restructure the table. This is documented in the plan file's "Scope Expansion" section. Worth a careful read of the final label set vs. the original "out of scope" intent.

2. **`area/panel` ≠ `area/dashboard`** disambiguation. The 4 issues previously labeled `area/panel` (#812, #813, #814, #815) are all titled "vscode: migrate ... view to panel tab" — they're about the VSCode bottom-panel UI surface, NOT the `@cluesmith/codev-dashboard` React package. Initial mis-framing would have conflated them. The relabel went `area/panel → area/vscode` (not `→ area/dashboard`). Verify the 4 issues now read sensibly under `area/vscode`.

3. **Doc dedup direction.** Vocabulary table + policy live in `CLAUDE.md` / `AGENTS.md`; operational recipes live in `codev/roles/architect.md`. No cross-references between files. Verify the split feels right — the alternative ("everything in all three files") was explicitly rejected as duplication-heavy.

4. **`--assignee @me` policy removal.** A prior memory rule ("all `gh issue create` includes `--assignee @me`") was wrong: reporting an issue ≠ committing to do the work. The policy bullet was removed from all six files; the memory file (`feedback_assign_issues_to_user.md`) was updated to scope the self-assign behavior to actual user-take-on intent.

5. **Skeleton variants stay vocabulary-free.** `grep -rE "area/(docs|vscode|dashboard|consult|tower|cross-cutting|porch|protocols|config|terminal|scaffold|release|web|core)" codev-skeleton/` returns no output — verified at multiple checkpoints. The skeleton uses `<prefix>/<value>` placeholders throughout.

6. **Shannon follow-up filed.** Issue [cluesmith/shannon#1872](https://github.com/cluesmith/shannon/issues/1872) tracks adopting the convention in shannon, with a 12-label proposed vocabulary derived from shannon's apps/packages layout. Out of scope for this PR but cross-linked for traceability.

## How to Test Locally

For reviewers pulling the branch:

- **View diff**: VSCode sidebar → right-click builder `pir-909` → **View Diff**
- **Run dev server**: not applicable — this is a doc-only PR

What to verify (cold-session check — the killer acceptance test from the issue body):

1. Open a fresh Claude chat in this repo
2. Paste each of these and confirm the architect responds correctly without further prompting:
   - "Show me my open issues grouped by area" → should run the group recipe (with `--limit 500`) and tally by area
   - "Change the area on #X from `area/porch` to `area/tower`" → should run the edit recipe
   - "Which open issues have no area label?" → should run the audit recipe
   - "All open `area/core` issues should move to `area/tower` — do the relabel" → should run the bulk-move recipe
   - "File an issue for X" → should pick the right area without asking, and should NOT include `--assignee @me` by default
3. Verify `gh label list --search area/` returns the 14 labels listed in the table

Mechanical checks:

- `diff CLAUDE.md AGENTS.md` → empty (byte-identical)
- `diff codev-skeleton/templates/CLAUDE.md codev-skeleton/templates/AGENTS.md` → only the 4-line preamble differs (intentional)
- `grep -rE "area/(docs|vscode|dashboard|consult|tower|cross-cutting|porch|protocols|config|terminal|scaffold|release|web|core)" codev-skeleton/` → no output (no vocabulary leak)
- `gh label list --search area/` → 14 labels
- Recipes in `codev/roles/architect.md` work against the live repo
