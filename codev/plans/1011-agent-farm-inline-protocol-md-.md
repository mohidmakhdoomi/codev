# PIR Plan: Deliver framework files via resolver-aware channels (fresh-install class fix)

> **Scope history (2026-06-08):** #1011 grew from "inline protocol.md at spawn" → a
> framework-file class fix → its current **three-layer** form (Delivery / Cleanup /
> Enforcement). This plan tracks the three-layer body. Patch 1 (Layer 1 / A.1) is already
> implemented and at the `dev-approval` gate; this revision folds in the rest. `codev read`
> CLI is **explicitly rejected** — not proposed. Project bootstrap of `codev/resources/` is
> **#1012** (out of scope here).

## Understanding

Spec 618 moved framework files into the package skeleton (resolver tier 4). `resolveCodevFile`
(`skeleton.ts:63`) reaches them. The bug is **consumer-side**: prompts, role docs, and protocol
docs reference framework files by **literal path**, which a raw shell `cat`/`cp` can't resolve
when the file lives only in the embedded skeleton (fresh post-618 installs). The builder hits
"No such file" and wastes turns. Three sub-instances: A.1 (protocol.md from 9 builder-prompts +
`roles/builder.md:83` cat), A.2 (4 template refs), A.3 (workflow-reference inside `spir/protocol.md`).

### Investigation findings that drive the decisions

1. **A.2 references are heterogeneous.** `spir`/`aspir` `prompts/plan.md` already embed a
   self-contained `### Plan Structure` block (a *simpler, different* layout than the 184-line
   canonical `templates/plan.md`) — the template pointer is **redundant chrome**. Only
   `experiment` (`notes.md`, 97L) and `spike` (`findings.md`, 67L) are **genuine content**.
2. **`bugfix` ships no `protocol.md` in the skeleton** (only `protocol.json` + prompts), yet its
   `builder-prompt.md:28` references one, and the local `codev/` tree carries a real **548-line**
   `bugfix/protocol.md` that was *never tracked in the skeleton*. So Patch 1 cannot inline for
   bugfix, and after Layer 2 drops the pointer, bugfix would have **no meta-doc at all** in fresh
   installs. See "Open sub-decision" below — this needs an explicit call.
3. **Embedded `notes.md`/`findings.md` contain zero `{{`**, so inlining them through
   `renderTemplate` (they ride inside `experiment`/`spike` `protocol.md`) is collision-safe.

## Locked Decisions (the 5 plan-gate decisions)

**1 — Delimiter / heading format.**
- Patch 1 (protocol.md): `\n\n---\n\n## Protocol Reference (full text)\n\n<contents>` (done).
- Patch 2 embeds (experiment/spike): a `## Template` section near the reworded instruction,
  with drift-anchor sentinels that use the **skeleton-relative** path (no `codev/` prefix, so the
  Layer 3 doctor grep does not self-flag them):
  ```
  ## Template
  > Embedded copy of the <name> template — delivered inline; recreate the target file from this.
  <!-- BEGIN EMBEDDED TEMPLATE: protocols/<name>/templates/<file> -->
  <template contents>
  <!-- END EMBEDDED TEMPLATE: protocols/<name>/templates/<file> -->
  ```

**2 — Patch 2 mechanism: Option B (explicit-embed). [agree, strengthened]**
Sub-handled by reference kind (finding #1): drop the redundant pointer in `spir`/`aspir`
plan prompts (no embed — prompt already self-contained); embed `notes.md`/`findings.md` into
`experiment`/`spike` `protocol.md`. Rationale beyond the architect's: auto-detect (A) would
inline the 184-line canonical plan template *on top of* the existing `### Plan Structure`,
delivering two conflicting layouts. B is correct, not just simpler; and cheaper than feared
(~164 embedded lines, the big template dropped not duplicated).

**3 — A.3 disposition: Option 2 (strip). [agree]**
Remove the `> Quick Reference: See codev/resources/workflow-reference.md …` line from
`spir/protocol.md`. Informational chrome; zero-risk removal. `roles/architect.md:5` stays out.

**4 — Missing-framework-file behavior: silently skip + `logger.debug` (no stderr warn).**
The skip is a **routine, by-design state**: `bugfix` has no skeleton `protocol.md`, so Patch 1's
resolve returns null and skips on every bugfix spawn (`validateProtocol` only `fatal()`s when
*both* json and md are absent). A stderr warn would fire on every bugfix spawn about an
intentionally-absent file. A.2 = embed (no runtime resolution to fail). Skip + debug it is.

**5 — Doctor check semantics: warn-not-error, skeleton-only initially. [agree]**
`codev doctor` greps for resolver-bypassing **absolute** literal paths only —
`cat codev/(protocols|roles|resources)/…` and backtick-wrapped `` `codev/(protocols|roles|resources)/…` `` —
and reports `status: 'warn'` (never `'fail'`) with a pointer to the convention. Skeleton dir only
for now (user `codev/` customizations are theirs; flagging them risks noise). Scope matches
Layer 2's sweep so a post-sweep skeleton is clean. Relative-path refs (`templates/x.md`,
`spir/protocol.md:215/301`, `experiment/protocol.md:90`) are a lower-severity class **not**
targeted (kept out of both the sweep and the grep) — noted as observed-out-of-scope.

## bugfix sub-decision — RESOLVED: drop the dead pointer, embed nothing (finding #2)

`bugfix` is the one protocol whose `protocol.md` isn't in the skeleton (`codev/` has a tracked
548-line copy that was never shipped). Layer 2 drops its `builder-prompt.md:28` pointer like the
other 8 — and for bugfix that is correct on its own merits, **not** a content loss, because:

- The pointer is a **dead path** in fresh installs regardless (no skeleton `protocol.md`).
- The builder's actionable guidance is **already delivered** via bugfix's phase prompts
  (`investigate.md` / `fix.md` / `pr.md`, 264 lines, porch-delivered): grep confirms the
  300-LOC scope, escalation criteria, mandatory regression test, and `Fixes #N` / PR-body
  structure are all present there.
- The content **unique** to `protocol.md` is overwhelmingly *not* builder-actionable —
  architect-facing phases (spawn / integration-review / cleanup), the ASCII workflow diagram,
  comparison tables, plus material that's gone **stale** vs porch orchestration (manual
  `afx send "Merge it"` merge flow, manual architect CMAP, the deprecated projectlist section).
  Inlining it would add noise, not signal.

So: **no skeleton `bugfix/protocol.md` is added here, and nothing is embedded.** The doc's
skeleton-absence + staleness is a real but orthogonal content-hygiene gap, filed as **#1013**
(not absorbed into this plumbing fix). This also makes visible a latent property of Layer 1 —
protocol docs are mixed-audience (builder + architect) yet Layer 1 inlines the whole doc; for
the 8 protocols that have one we inline as-is per the architect's design, and bugfix simply has
nothing to inline.

## Proposed Change (three layers)

**Layer 1 — Delivery.**
- *Patch 1 (A.1, done):* `loadBuilderPromptTemplate()` inlines `protocol.md` under the delimiter.
- *Patch 2 (A.2):* Option B embeds (per decision 2) — markdown only, 0 LOC code.

**Layer 2 — Cleanup (skeleton sweep).**
- Drop the `Follow the <X> protocol: \`…protocol.md\`` line from all 9 `builder-prompt.md`
  (PIR has two refs: `:30` and the `:90` getting-started line — both go; keep PIR's 3-phase
  breakdown). The protocol text is already in context via Patch 1.
- `roles/builder.md:83`: replace the `cat codev/protocols/spir/protocol.md` example with a note
  that the protocol is inlined in the spawn prompt under `## Protocol Reference`.
- A.2 literal paths leave the four prompts by construction (decision 2).
- A.3: strip per decision 3.

**Layer 3 — Enforcement.**
- *Convention doc:* add a "Framework files: never reference by literal `codev/…` path" section to
  **both** `AGENTS.md` and `CLAUDE.md` (kept in sync, per repo policy).
- *Doctor audit:* add a check to `doctor()` (`packages/codev/src/commands/doctor.ts:539`) mirroring
  the existing `CheckResult`/`printStatus` pattern (decision 5 semantics).

### Tree scope
Edit **both** `codev-skeleton/` (shipped source; required for the fix + repro test) and the
local `codev/` copies (this repo dogfoods; its `codev/` shadows the skeleton). Patch 1 needs no
markdown edits in either tree.

## Files to Change

- `packages/codev/src/agent-farm/commands/spawn-roles.ts` (+ `__tests__/spawn-roles.test.ts`) — Patch 1 (done).
- `{codev-skeleton,codev}/protocols/{spir,aspir}/prompts/plan.md` — drop redundant template pointer (Patch 2 + Layer 2).
- `{codev-skeleton,codev}/protocols/{experiment,spike}/protocol.md` — embed template, reword (Patch 2).
- `{codev-skeleton,codev}/protocols/*/builder-prompt.md` (all 9) — drop protocol.md pointer (Layer 2).
- `{codev-skeleton,codev}/roles/builder.md` — fix the cat example (Layer 2).
- `{codev-skeleton,codev}/protocols/spir/protocol.md` — strip A.3 line (Layer 2).
- `AGENTS.md`, `CLAUDE.md` — convention section (Layer 3).
- `packages/codev/src/commands/doctor.ts` (+ `src/__tests__/doctor.test.ts`) — audit check (Layer 3).

(bugfix gets only the Layer 2 pointer-drop — no skeleton `protocol.md` added; see the resolved
sub-decision above. Doc hygiene tracked in #1013.)

## Risks & Alternatives Considered

- **Drift:** embedded `notes.md`/`findings.md` vs canonical. Mitigation: unit test asserts the
  `BEGIN/END EMBEDDED TEMPLATE` block byte-matches the canonical file. Drift fails CI.
- **Doctor false positives:** scoping the grep to absolute `codev/…` paths (decision 5) keeps it
  aligned with the sweep; relative refs intentionally not matched.
- **Auto-detect (Patch 2 = A):** rejected — double-delivers a conflicting plan layout (finding #1).
- **`codev read` CLI / restore copying / per-`next` injection:** rejected per the issue's table.
- **Residual cat:** eliminated for protocol.md — Layer 2 removes the pointer outright (the earlier
  "leave the instruction" stance is reversed by Layer 2).

## Test Plan

**Automated (`npm test` → `@cluesmith/codev`):**
- Patch 1 (exist): protocol.md inlined under delimiter; omitted-without-error when absent.
- A.2 guard (new): `spir`/`aspir` `plan.md` no longer reference the template path and still carry
  `### Plan Structure`; `experiment`/`spike` `protocol.md` embed-block byte-matches the canonical
  template (drift guard).
- Layer 2 guard (new): no `builder-prompt.md` references `protocol.md`; `roles/builder.md` has no
  `cat codev/protocols/…`; `spir/protocol.md` has no `workflow-reference.md`.
- Layer 3 doctor (new, in `doctor.test.ts`): clean skeleton → check `ok`; a fixture with a
  deliberate literal path → check `warn` (negative test).

**Build:** `npm run build` from worktree root.

**Manual (dev-approval, load-bearing — issue repro):** fresh `codev init` in a tmp dir, spawn a
test builder, run plan + implement + review; confirm (a) no file-hunting for protocol.md OR
templates, (b) per-phase prompts still followed (inlined material not "louder"), (c) templates
land in the right phase, (d) `codev doctor` catches a deliberately-introduced literal-path ref.
