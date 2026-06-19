# PIR #929 — Support codex & gemini CLIs as architects

## Builder thread

### 2026-06-17 — RESCOPE: agy replaces gemini for architects (porch rewound to PLAN)

Architect rewound porch to the plan phase. Issue #929 rescoped (#778): the Gemini CLI retires
2026-06-18; `agy` (Antigravity CLI) replaces it as the non-Claude **architect**. PR #1059 stays
open/unmerged; we extend it. Keep from #1059: the harness-agnostic `buildResume` seam, codex parity,
the `getArchitectFiles` seam. Delta: add `AGY_HARNESS`, swap gemini out of architect support.

**Key investigation finding (flagged to architect):** agy's role/context mechanism is NOT gemini's —
it's codex-like.
- agy reads `AGENTS.md` **natively** (binary strings: "append to AGENTS.md in the Workspace
  Customizations Root"; global root = `~/.gemini`). So agy needs **no** `getArchitectFiles` pointer
  file (the retired gemini CLI needed `.gemini/settings.json` → context.fileName; agy doesn't).
- agy has **no** `--append-system-prompt` flag / no `GEMINI_SYSTEM_MD` env. Role injection rides
  `-i`/`--prompt-interactive "<role>"` (agy --help; consult's "hermes precedent"), folding the role
  into the interactive launch prompt. So `AGY_HARNESS.buildRoleInjection` → `['--prompt-interactive',
  roleContent]`.
- Binary resolution reuses consult's `resolveAgyBin`/`isRealAgyCli`/`agyRespondsToVersion` (bare `agy`
  on PATH may be the IDE launcher symlink). Plan: extract those to `lib/agy-bin.ts`, add optional
  `HarnessProvider.resolveBinary?`, apply at the ~6 architect executable-determination sites.

Swap details: doctor affirms codex/`agy` (bars gemini as architect like opencode); remove
`GEMINI_HARNESS.getArchitectFiles` (architect-only dead code) + the `.gemini/settings.json` gitignore
entry; tests/docs cover agy instead of gemini; GEMINI_HARNESS stays for builders. `AGY_HARNESS.buildResume`
undefined → fresh launch (resume deferred). Plan rewritten; committing and sitting at plan-approval.

### 2026-05-31 — Plan phase

Investigated the resume crash-loop bug. Root cause confirmed across two sites, one mechanism:

- **Architect**: `tower-instances.ts:500` calls `findLatestSessionId(workspacePath)` (reads only `~/.claude/projects/<encoded-cwd>/*.jsonl`) without gating on the configured harness, then builds `[...cmdParts.slice(1), '--resume', resumeSessionId]`. A codex/gemini architect + any stale Claude jsonl ⇒ `codex --resume <claude-uuid>` ⇒ shellper restart-loop to death.
- **Builder**: `spawn.ts:83 discoverResumeSession()` (called at 459 + 838) has the same Claude-only assumption; `spawn-worktree.ts:746` then bakes `${baseCmd} --resume "${id}"` into the launch script. `workspace-recover.ts` re-enters via `afx spawn --resume`, inheriting it.

**Fix direction**: add an optional `discoverResumeSession?` capability to `HarnessProvider`. Only `CLAUDE_HARNESS` implements it (delegates to `findLatestSessionId`); codex/gemini/opencode leave it undefined ⇒ null ⇒ fresh launch via `buildArchitectArgs` / role-injection script path. Gate both call sites on the harness. The downstream `--resume` arg/script construction is reached only when claude returned a non-null id, so it stays claude-shaped safely.

**Scoping decision**: MVP fixes the **config-driven** selection path (`.codev/config.json` `shell.architect`/`architectHarness`), which is what every acceptance criterion is phrased around. The `TOWER_ARCHITECT_CMD`/`--architect-cmd` env/CLI-override-without-matching-config edge stays a documented nice-to-have (issue lists it as such).

**Empirical validation** (launch on stale-jsonl cwd, add-architect, `afx send` multiline/interrupt/streaming, reconnect, affinity, dashboard scrollback) needs codex/gemini actually installed — that happens at the `dev-approval` gate when the human runs the worktree. That's precisely why PIR was chosen.

Architect PR-target note: no push access to cluesmith/codev — push branch to fork `mohidmakhdoomi/codev`, open PR with `gh pr create --repo mohidmakhdoomi/codev`.

Plan written, awaiting `plan-approval`.

### 2026-05-31 — Plan revision (architect feedback, 5 verified issues)

Revised after a 2-way consult + architect verification:
1+2. **Seam redesign**: collapsed the two paired methods (`discoverResumeSession` + `buildResumeInvocation!`) into a single bundled `buildResume?(cwd, opts) → { sessionId, args, scriptFragment } | null`, mirroring `buildRoleInjection`/`buildScriptRoleInjection`. Node-argv `args` for the architect `spawn()` site; **shell-escaped** `scriptFragment` for the builder bash generator. Kills the `!` non-null assertion and the raw-argv `.join(' ')` word-split/quoting bug.
3. **Test layering fix**: regression guards moved to where the bugs live — `tower-instances.test.ts` (architect launch, no `--resume` for codex/gemini + stale jsonl) and `spawn-worktree.test.ts` (builder script uses escaped fragment). `af-architect.test.ts` (no-Tower command only) noted as NOT guarding the real regression.
4. **Gemini context promoted to MVP**: add `getArchitectFiles?` hook; `GEMINI_HARNESS` writes `.gemini/settings.json` `context.fileName → AGENTS.md` (write-if-missing). Codex already reads AGENTS.md natively; gemini shipped context-blind otherwise.
5. **Builder override caveat documented**: `--builder-cmd`/env vs config-only `getBuilderHarness` is the exact analog of the architect `TOWER_ARCHITECT_CMD` trap — added to Risks alongside it.

Re-signalled, awaiting architect re-review.

### 2026-05-31 — Implement phase

Plan approved. Implemented all six tasks:

1. **harness.ts**: added `buildResume?` (bundled discovery + Node-argv + escaped script fragment) and `getArchitectFiles?` to `HarnessProvider`. `CLAUDE_HARNESS.buildResume` delegates to `findLatestSessionId`; `GEMINI_HARNESS.getArchitectFiles` writes `.gemini/settings.json` → AGENTS.md. codex/gemini/opencode leave `buildResume` undefined.
2. **tower-instances.ts**: architect resume now gated on `getArchitectHarness(...).buildResume?.()` (preserving the `safeToResume` sibling guard); writes `getArchitectFiles?()` if-missing on launch.
3. **spawn.ts / spawn-worktree.ts**: `discoverResumeSession` takes the builder harness and returns the bundled object; `startBuilderSession`'s `resumeSessionId?: string` → `resume?: { sessionId, scriptFragment }`, script emits `${baseCmd} ${resume.scriptFragment}`.
4. **doctor.ts / arch.md**: codex/gemini architect affirmation + "resume is Claude-main-only" docs.
5. **Tests**: `discover-resume-session.test.ts` (harness arg + codex/gemini null-return guards), `tower-instances.test.ts` (architect resume-skip for codex/gemini + stale jsonl; claude still resumes; gemini `.gemini/settings.json` write-if-missing + no-clobber), `spawn-worktree.test.ts` (resume script uses escaped fragment, no prompt/role injection; fresh path has no `--resume`).

**Test-infra notes**: worktree had no `node_modules` — ran `pnpm install` + built `@cluesmith/codev-core` (vitest loads source which imports the core package's subpath exports). Two mock gaps surfaced and were fixed in the test files: `tower-instances.test.ts` db mock needed `getDb`/`closeDb` (state.getArchitects uses `getDb()`, not the already-mocked `getGlobalDb` — without it the `safeToResume` guard threw and silently skipped the claude resume); `spawn-worktree.test.ts` needed a `../lib/tower-client.js` mock (getTowerClient stub) so `startBuilderSession`→`createPtySession` runs without a live Tower.

The three affected files: 143 passed. Full suite running. Build green.

### 2026-06-16 — Review phase

dev-approval gate approved (human validated the running worktree). Re-confirmed build green + 146 tests pass across the 3 affected files. Wrote `codev/reviews/929-support-codex-and-gemini-clis-.md` (Summary / Files / Architecture Updates / Lessons Learned / Things to Look At). arch.md was already updated in the implement commit; routed one cold-tier lesson to `lessons-learned.md` (Architecture): audit **all** invocation seams — including resume/restart — when extending a provider abstraction; the resume branch is a separate call site Spec 591 left harness-blind.

PR target: branch lives on fork `mohidmakhdoomi/codev` (origin push → fork; `builder/pir-929` confirmed on fork, absent on cluesmith). Opening PR within the fork (base `main`). Recording with porch, then `porch done` runs the single-pass CMAP-2 verify.

CMAP-2 verdicts (iter1): gemini=APPROVE, codex=APPROVE, no issues. (`pr_exists` check first failed because `gh` had no default repo → defaulted to cluesmith where the branch doesn't live; fixed with `gh repo set-default mohidmakhdoomi/codev`.) Gate fired pending; architect notified.

### 2026-06-16 — Architect integration review: REQUEST CHANGES (2 blockers + 3 nits)

Architect reviewed the running integration and returned a punch list. All addressed:

- **BLOCKER B (override re-arms crash-loop)**: `getArchitectHarness`/`getBuilderHarness` auto-detected the harness from the *raw config* command, ignoring `TOWER_ARCHITECT_CMD` / `--architect-cmd` / `--builder-cmd`. So `TOWER_ARCHITECT_CMD=gemini` launched gemini but resolved claude → buildResume injects `--resume <stale-uuid>` → the exact crash-loop. Fix: both resolvers now source the command from `getResolvedCommands` (override-aware), and `getResolvedCommands.architect` now includes `TOWER_ARCHITECT_CMD`. Regression tests in `config.test.ts`.
- **BLOCKER A (gemini context path-dependent)**: `getArchitectFiles` was written inline only in `launchInstance`, so sibling/no-Tower/reconnect gemini launches were context-blind. Fix: centralized into `buildArchitectArgs` (the shared helper all 4 Tower paths route through) as exported `writeArchitectContextFiles`; refactored the no-Tower `architect.ts` to call `buildArchitectArgs` instead of duplicating injection. Now every launch path writes it. Regression tests in `tower-utils.test.ts`.
- **NIT 1**: `safeToResume` WARN now gated on `architectHarness.buildResume` (no noise for codex/gemini, which never resume).
- **NIT 2**: `discoverResumeSession` logs "This harness does not support conversation resume" when `buildResume` is undefined, distinct from "No prior conversation found".
- **NIT 3**: `.gemini/settings.json` added to both root `.gitignore` and the managed adopter `CODEV_GITIGNORE_ENTRIES` (gitignore.ts); gitignore/update test expectations updated.

Full suite: 3338 passed, 48 skipped, 0 failures. Build green. Re-running `porch done` for a fresh single CMAP-2 pass, then re-requesting the pr gate.

Porch quirk: re-running `porch done` landed straight back at `gate_pending` (iter1) without re-issuing consult tasks — because the architect's REQUEST_CHANGES arrived via `afx send`, not a porch gate rejection, so the iteration never advanced. Ran a fresh advisory 2-way consult manually on the updated diff (iter2 outputs) since porch wouldn't re-trigger it.

iter2 verdicts: gemini=APPROVE (HIGH), codex=REQUEST_CHANGES (MEDIUM, false positive: "plan lacks approval frontmatter"). Rebutted — the frontmatter convention is for architect-pre-approved artifacts; this plan was builder-authored and approved via porch's `plan-approval` gate (status.yaml), and no merged plan in codev/plans (0001–0009) carries that frontmatter. Documented the rebuttal in the review's "Consultation Findings & Dispositions" section; escalating to the human at the pr gate. Gate remains pending.

### 2026-06-16 — Architect re-review: APPROVE + PR retargeted upstream

Architect verified all 5 integration-review items at source (affected tests 193/193 green) and confirmed codex's frontmatter finding is a false positive (rebuttal sound). **APPROVE.**

PR retargeting: this is an **upstream contribution to cluesmith/codev**. Architect opened the correct cross-fork PR → **cluesmith/codev#1059** (head `mohidmakhdoomi:builder/pir-929` → base `cluesmith/codev:main`). Fork PR #1 CLOSED as superseded (wrong base = fork main).

**MERGE POLICY: pull-only on cluesmith — do NOT self-merge. A cluesmith maintainer merges #1059.** The porch pr gate is the human's to approve as bookkeeping only (no `gh pr merge` from me). Bookkeeping done: reset gh default repo → cluesmith, recorded PR #1059 in porch pr_history. Nothing further to push unless review feedback lands on #1059. Waiting at the pr gate; on gate approval I will NOT merge — I'll record/close out per the no-self-merge policy.

### 2026-06-17 — 3-way re-review: APPROVE-with-caveat (doc-only addendum)

Architect ran a 3-way re-review: gemini APPROVE, claude APPROVE, codex REQUEST_CHANGES (2/3). Verdict: **APPROVE with one documented caveat**.

Codex's lone (verified) finding: `resolveHarness` (harness.ts) defaults an *unrecognized* override command (e.g. `TOWER_ARCHITECT_CMD=bash`, a wrapper script) to `CLAUDE_HARNESS` when no explicit `shell.architectHarness`/`builderHarness` is set → can still build `<cmd> --resume <uuid>` against a stale claude jsonl. **Pre-existing, narrow, separable — not a #929 regression** (#929 strictly improved the recognized codex/gemini cases). Disposition: document + follow-up (cluesmith/codev#1062).

Doc-only addendum (no code change, per architect instruction): added the caveat to arch.md's #929 subsection and the review's caveat section, noting the unrecognized-command default + mitigation (set explicit harness) + the #1062 follow-up. Commit + push flows into PR #1059; no gate re-request (doc addendum to an already-approved PR). Still no self-merge — maintainer merges #1059.

### 2026-06-16/17 — pr gate APPROVED (human-instructed); protocol complete; NOT self-merged

Human instructed `git pull` + `porch approve 929 pr --a-human-explicitly-approved-this`. `git pull` failed to fast-forward the local branch (origin fetch=cluesmith lacks builder/pir-929, which lives on the fork) but did fetch updates. `porch approve` passed all checks and committed the gate-approved state locally, but its `git push -u origin HEAD` was **rejected**: the architect had merged `main` into the fork's builder/pir-929 (commit 0fd70b72) to keep #1059 current, so the fork was ahead. Resolved by rebasing the single unpushed porch chore commit onto `fork/builder/pir-929` (only touches 929 status.yaml → no conflict) and pushing — fork now at `f337b61f`. Gate status: **approved**; `porch next 929` → status: complete, phase: verified. Per the standing pull-only instruction I did **NOT** run `gh pr merge` / pr-merge.sh — a cluesmith maintainer merges #1059. Architect notified. Project complete pending the upstream merge + architect-driven cleanup.

### 2026-06-19 — RE-RESCOPE: CODEX-ONLY (agy dropped → #1063); plan revised at plan-approval gate

Resumed session. Architect re-scoped 929 to **codex-only**: agy is dropped entirely (split to
follow-up #1063 — agy's only role-injection channel is its first user turn `--prompt-interactive`,
weaker/visible vs claude's `--append-system-prompt` / codex's `-c model_instructions_file=`). The plan
file on disk was the STALE agy version (commit 3082c186 "agy replaces gemini"); rewrote it codex-only.

Verified against `gh issue view 929` (codex-only banner) + architect brief. Confirmed actual branch
state via grep before planning:
- `getArchitectFiles` seam: only implementer = `GEMINI_HARNESS` (harness.ts:135); only consumer =
  `writeArchitectContextFiles` (tower-utils.ts:181), itself called only from `buildArchitectArgs`
  (:205). ⇒ removing gemini-architect makes the whole seam dead ⇒ delete it (interface method +
  gemini impl + writeArchitectContextFiles + its call). `buildArchitectArgs` keeps `getArchitectHarness`
  (still used by `buildRoleInjection` at :213).
- `.gemini/settings.json` gitignore: root `.gitignore:11` + `lib/gitignore.ts:24` + test expectations
  in gitignore.test.ts (140,211) & update.test.ts (530,550). No codev-skeleton mirror.
- doctor.ts:699 affirms `codex || gemini` → split: affirm codex, bar gemini as architect (builder-only).

**KEEP intact** (engine-neutral, the core deliverable): `buildResume` crash-loop seam + codex architect
parity. **REVERT**: #1059's gemini-architect additions. **KEEP**: gemini *builder* surface
(`GEMINI_SYSTEM_MD`) + gemini builder tests.

Plan rewritten, committing + pushing to `builder/pir-929` (PR #1059 auto-updates). Parked at
plan-approval — NOT implementing until architect approves.

### 2026-06-19 — Implement phase (codex-only delta)

Implemented the subtractive gemini-architect removal. Three commits:
1. `a6b42daa` — removed the `getArchitectFiles` HarnessProvider method (gemini = only impl) +
   `writeArchitectContextFiles` (only consumer) + their `buildArchitectArgs` wiring; dropped the now-
   unused `HarnessProvider` import in tower-utils.ts; tidied codex/gemini→codex comments at the
   architect resume site. buildResume seam + codex parity untouched.
2. `0d920884` — doctor: split codex||gemini affirmation → affirm codex / warn gemini-builder-only-not-
   architect (#778). Removed `.gemini/settings.json` from root `.gitignore` + `CODEV_GITIGNORE_ENTRIES`.
3. `be84f75a` — tests + arch.md: removed writeArchitectContextFiles + gemini settings.json architect
   tests; retargeted the `TOWER_ARCHITECT_CMD` env-override resolution test to codex (kept the
   override-aware-resolution coverage, dropped the dead getArchitectFiles assertion); dropped gemini
   resume-skip architect test (codex case already guards the regression); gitignore-backfill
   expectations now `['.architect-role.md']`. arch.md #929 subsection → claude+codex architects,
   gemini builder-only, seam removed. CLAUDE.md/AGENTS.md untouched (no gemini-architect claim there).

Grep-clean: 0 refs to `getArchitectFiles` / `writeArchitectContextFiles` / `.gemini/settings.json`
anywhere. Diff is purely subtractive (38 ins / 166 del). Build green. Full suite: 3332 passed, 48
skipped, 0 failures. Pushing to fork; signalling dev-approval.

### 2026-06-19 — Review phase: codex-only review file + full 3-way CMAP

Refreshed `codev/reviews/929-*.md` to the net codex-only delivered state (PR body), pushed, updated
PR #1059 title/body (cluesmith/codev#1059), recorded PR in porch pr_history.

Per architect instruction, running a FULL 3-way CMAP (not the protocol-default 2-way) over the whole
PR — whole-file review, not diff hunks. Used `--prompt-file /tmp/cmap-929-prompt.md` (since `--type pr`
is diff-centric and `--prompt`/`--type` are mutually exclusive) instructing each reviewer to read every
changed file in full + callers/deps and assess the full PR as it stands. All three (gemini/codex/claude)
launched in parallel + background → /tmp/cmap-929-{gemini,codex,claude}.md. Advisory single pass.
Awaiting verdicts; will report all three to architect leading with any REQUEST_CHANGES + disposition.
Will NOT self-merge — stop at pr gate.

### 2026-06-19 — Full 3-way CMAP verdicts (advisory, single pass)

- **codex: APPROVE** — no blockers; crash-loop fix correct, resume gating centralized behind buildResume.
  3 non-blocking coverage nits.
- **claude: APPROVE** — no blockers; whole-file trace confirms codex/gemini can never reach
  `--resume <claude-uuid>` at either site, seam removal clean (0 dangling refs), regression pinned 4 ways.
  4 non-blocking obs.
- **gemini (agy): no usable verdict** — returned a greeting in 8.1s, didn't review (agy structural
  limitation, the #1063 reason). Recorded as unavailable.

Net: 2/2 substantive reviewers APPROVE, zero REQUEST_CHANGES, zero blocking defects → no code change.
Consensus non-blocking nit (doctor architect-shell branch + codex no-Tower path lack direct tests):
deferred — trivial branch logic verified-correct by both reviewers, and there's no existing test harness
for the doctor shell.architect block (even the long-standing opencode branch is untested), so it's
net-new infra beyond this subtractive PR. Recorded dispositions in review's Consultation section,
committing + pushing. Then advancing porch to the pr gate; NOT self-merging.

### 2026-06-19 — pr gate PENDING (parked, not self-merging)

`porch done 929` → structural checks green (pr_exists, review_has_arch_updates, review_has_lessons_updates);
`porch next 929` → gate_pending on **pr**. Porch's recorded verify verdicts: gemini=APPROVE, codex=APPROVE
(porch's own block / cached). My authoritative LIVE manual 3-way (reported to architect): codex=APPROVE,
claude=APPROVE, gemini(agy)=unavailable. Zero REQUEST_CHANGES, zero blocking defects either way.

PR body synced to PR #1059. Parked at the pr gate. Per the standing upstream policy (cluesmith/codev#1059
is a cross-fork contribution: head mohidmakhdoomi:builder/pir-929 → base cluesmith:main) and this session's
architect instruction ("the pr gate is mine/the maintainer's; do NOT self-merge"), I will NOT run
`gh pr merge`. Waiting for human pr-gate approval + maintainer merge. Architect notified with all verdicts.
