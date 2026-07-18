# Spike: Kimi Code CLI support as architect and builder

**Date**: 2026-07-18

**Verdict**:
- **Builder**: **Feasible with Caveats**
- **Architect**: **Feasible with Caveats**

Both verdicts rest on one validated pattern — the **seed-session bootstrap** (POC 6 below) — which simultaneously solves the three hard problems: role injection, initial-prompt delivery, and the stored-session-ID architect contract.

## Question

> What does it take to support kimi code cli as an architect and builder?

Prompted by the architect handoff for spike task-Iptx. The decision that depends on the answer: whether to green-light a production integration project (and under which protocol), or document Kimi as unsupported.

**Sources discipline**: all *documented* Kimi claims below come exclusively from the designated command reference, https://www.kimi.com/code/docs/en/kimi-code-cli/reference/kimi-command.html. Everything marked **(observed)** is an empirical result against the locally installed `kimi` 0.27.0 (`~/.kimi-code/bin/kimi`) and is not a documented guarantee.

## Research Summary

- **Kimi command reference** (exclusive source): `kimi [options]` starts an interactive TUI in the cwd. Relevant flags: `--session/-S [id]` (resume by id; `-r/--resume` alias), `--continue/-c` (resume most recent session *for the cwd*), `--prompt/-p` (single non-interactive prompt; conflicts with `--yolo`/`--auto`/`--plan`; auto permission policy; static deny rules still apply), `--output-format stream-json` (requires `-p`), `--yolo` (auto-approve tools; conflicts with `--auto`), `--auto` (agent does not ask user questions), `--plan`, `--skills-dir <dir>` (**replaces** auto-discovered user+project skill dirs; repeatable), `--add-dir`. Subcommands: `login` (device-code OAuth; not a status probe), `doctor` (validates `config.toml`/`tui.toml` under `KIMI_CODE_HOME` or `~/.kimi-code`; exit 0 valid/skipped, 1 missing/invalid; **not** an auth check), `acp` (JSON-RPC over stdio), `server` (REST + WebSocket, loopback), `export [sessionId]` (defaults to most recent session in cwd). No documented system-prompt/instructions flag and no documented positional prompt.
- **PR #1059** (codex architect, PIR #929) reviewed against current HEAD: its durable lessons hold (provider abstraction, override-aware detection, centralized `buildArchitectArgs`, capability-gated resume, doctor/tests/docs), but the architect session architecture has since moved to the **stored-ID `HarnessProvider.session` contract** (#832) with ownership verification (#1145), crash-loop fallback (#1149), and sibling liveness pruning (#1150). The mtime-discovery architect path is gone; do not reintroduce it.
- **Current seams read at HEAD** (`165339ab` lineage): `utils/harness.ts` (provider interface: `buildRoleInjection`, `buildScriptRoleInjection`, `getWorktreeFiles?`, `session?` {`newSessionArgs`, `resumeArgs`, `verifyOwnership?`}, `buildResume?`; `detectHarnessFromCommand`; `resolveHarness` falls through to **CLAUDE_HARNESS** for unrecognized commands — the #1062 caveat), `utils/config.ts` (`getArchitectHarness`/`getBuilderHarness`, override-aware), `commands/spawn.ts` (`discoverResumeSession`), `commands/spawn-worktree.ts` (`startBuilderSession` emits `${baseCmd} ${fragment} "$(cat promptFile)"` — positional prompt; resume path emits `scriptFragment`), `commands/architect.ts` (no-Tower path via shared `buildArchitectArgs`), `servers/tower-utils.ts` (`buildArchitectArgs`, `resolveArchitectLaunch` — **synchronous**, `resolveArchitectRestart`, `buildArchitectCrashLoopFallback`, `siblingRegistrationIsLive`), `servers/tower-instances.ts` (launch + add-architect sites), `servers/tower-terminals.ts` (two shellper restart-bake sites), `servers/message-write.ts` (paced writes: 10ms inter-line, 50/80ms delayed Enter), `commands/doctor.ts` (per-CLI presence/auth checks + architect-shell branch), `codev/resources/arch.md` §"Supported Architect Harnesses & Conversation Resume (#929)".

### What breaks today if you just point Codev at `kimi`

1. `detectHarnessFromCommand('kimi')` → undefined → `resolveHarness` falls through to the **Claude harness** (#1062). Architect launch appends `--append-system-prompt <role>`; **(observed)** `kimi --append-system-prompt x` → `error: unknown option`, exit 1 → shellper restart loop.
2. Builder fresh script appends the prompt positionally; **(observed)** `kimi "<anything>"` → `unknown command '…'`, exit 1 → same loop.
3. Because the false Claude harness exposes Claude's `session`/`buildResume`, a stale Claude `.jsonl` could route `--resume <claude-uuid>` into `kimi` (the pre-#929 crash-loop class).

A no-op custom harness is not enough: role injection would be silently dropped AND the positional initial prompt still kills the builder launch.

## Empirical Observations (kimi 0.27.0)

All labeled **(observed)**; reproducible via `task-Iptx-kimi-poc.sh` alongside this file.

| # | Probe | Result |
|---|---|---|
| 1 | `kimi "<text>"` (positional prompt) | `unknown command '<text>'`, **exit 1** |
| 2 | `kimi --append-system-prompt x` / `kimi -c model_instructions_file=…` | unknown option / unknown command, **exit 1** (`-c` is `--continue` in Kimi) |
| 3 | Session store layout | `~/.kimi-code/sessions/wd_<basename>_<12hex>/session_<uuid>/` with `state.json` (`createdAt`, `updatedAt`, `workDir`, `lastPrompt`) + `agents/main/wire.jsonl`; global `~/.kimi-code/session_index.jsonl` maps `{sessionId, sessionDir, workDir}`; `workspaces.json` maps wd-hash → root path. **Exact cwd recorded per session** — stronger than Claude's encoded-path store |
| 4 | Session creation timing | Session dir + ID created **immediately at TUI launch**, before any prompt (`title: "New Session"`, no `lastPrompt`) |
| 5 | `kimi --continue -p "…"` in a dir with no sessions | Prints `No sessions to continue under "<dir>"; starting a fresh session.` and proceeds — **graceful, exit 0** |
| 6 | **Seed-session bootstrap** | `kimi -p "<role briefing>… acknowledge and wait" --output-format stream-json` → model acknowledges; stream-json emits a machine-readable meta line `{"role":"meta","type":"session.resume_hint","session_id":"session_<uuid>",…}`. Then `kimi -S <captured-id> --yolo` opens the **TUI resuming that session**; a subsequent interactive turn shows the role briefing **retained and applied** (model kept the required `ROLE-OK` reply prefix) |
| 7 | `kimi -S <id> -p "…"` (pinned-ID non-interactive resume) | Works; prior-turn context recalled correctly |
| 8 | `kimi -S session_00000000-…` (bogus id) | `error: failed to run prompt: Session "…" not found.` — **fast fail, exit 1** (clean signal for crash-loop fallback design) |
| 9 | TUI under a PTY (`script(1)`) | Renders fully (composer, status bar); typed input lands in composer |
| 10 | Submit timing | `text\r` in **one write** → treated as paste, **not submitted**. Text, then `\r` after **1s** → submits. The exact `message-write.ts` timing (10ms inter-line, **80ms** delayed Enter) → **not submitted**; same lines with a **1s** delayed Enter → submitted as **one** multi-line message, model replied correctly |
| 11 | `AGENTS.md` in cwd | **Read and applied natively** (instruction marker honored in reply) — like Codex, project context comes free |
| 12 | `--skills-dir` skill as role channel | Skill *description* always visible; **body is model-mediated** — the model must choose to invoke the Skill tool to load it (visible deliberation in thinking trace; it did load and apply in the probe). Probabilistic, not a guaranteed system-instruction channel; also `--skills-dir` **replaces** the user's normal skill dirs (documented) |
| 13 | Auth surface | OAuth artifacts at `~/.kimi-code/credentials/kimi-code.json` + `~/.kimi-code/oauth/kimi-code` when logged in (undocumented layout). `kimi doctor` validates config only, exit 0/1 as documented |
| 14 | `KIMI_CODE_HOME` | Redirects the home dir (documented for doctor; observed working) — natural **test seam** for session-store fixtures, but an isolated home also isolates credentials (so it is a test seam, not a per-worktree isolation mechanism) |

## Approaches Tried

### Approach 1: `-p`/argv-based prompt delivery (mechanical port of the Claude/Codex shape)
- **What**: positional prompt, role flags, `-p` as the builder loop command.
- **Result**: positional prompt and role flags rejected (obs. 1–2). `-p` is one-shot, no TUI, auto permission, conflicts with `--yolo`/`--auto`/`--plan` (documented); the builder loop would rerun the task after every exit and there is no durable PTY for `afx send`/gates.
- **Verdict**: Didn't work — as predicted in the handoff.

### Approach 2: `--skills-dir` as the role channel
- **What**: generated skill carrying the role, injected via `--skills-dir`.
- **Result**: model-mediated load; worked once but is probabilistic, and replacement semantics would discard users' normal skills unless Codev merges them into the generated dir.
- **Verdict**: Partially worked — rejected as the *primary* role channel; viable only as a defense-in-depth supplement.

### Approach 3: Seed-session bootstrap (recommended)
- **What**: (a) run `kimi -p "<role briefing + ack-and-wait wrapper>" --output-format stream-json` in the target cwd; (b) parse `session.resume_hint.session_id` from stdout; (c) persist the id; (d) launch the interactive TUI with `kimi -S <id> --yolo`; (e) deliver the task/first instruction as a normal PTY message (Kimi-tuned delayed Enter).
- **Result**: end-to-end success (obs. 6, 7, 10). Role retained across the seed→TUI boundary and applied in interactive turns. Codev knows the exact session ID **before the TUI starts**.
- **Verdict**: Worked. Solves role injection, initial-prompt delivery, and the stored-ID session contract in one pattern, with no PTY readiness race for the *role* (only the task message needs PTY delivery, which is the same problem `afx send` already solves).

### Approach 4: ACP / local server adapter
- **What**: `kimi acp` (JSON-RPC over stdio) or `kimi server` (REST + WebSocket) as a structured backend.
- **Result**: not POC'd. Documented to exist with local OpenAPI/AsyncAPI docs. Would give structured session/prompt control but replaces the entire PTY/terminal model Codev is built around (Tower terminals, dashboard, VSCode tabs, `afx send`) with a bespoke client for one CLI.
- **Verdict**: Not needed. The TUI harness path is validated; ACP/server is a much larger backend change with no parity payoff for this integration. Revisit only if a future Codev feature needs structured agent I/O generally.

## Constraints Discovered

- **No documented system-prompt flag and no positional prompt** — the whole launch shape must be provider-owned, not another pair of role args.
- **Session IDs cannot be pinned at creation** (no documented caller-supplied ID; bogus `-S` fast-fails) — the `session.newSessionArgs(sessionId)` mint-and-pin contract cannot be satisfied; a **capture** contract can (seed via `-p`, or post-launch store scan since the session dir appears at TUI start).
- **Paste/submit timing**: Kimi's paste window is longer than Claude's — 80ms delayed Enter fails, 1s works (threshold between 80ms and 1s, to be bisected during implementation). `message-write.ts` needs a per-harness Enter-delay knob; until then `afx send` to a Kimi PTY would silently not submit.
- **Role rides a user turn**, not a system prompt — weaker authority/trust semantics (the same limitation that deferred agy as an architect, #1063). Held up in POC; long-session drift is untested.
- **Undocumented reliance**: session store layout, `session_index.jsonl`, and the `session.resume_hint` stream-json meta line are all observations. Version-fragile; pin a minimum Kimi version and keep an integration smoke probe.
- **No write-guard parity**: Claude builders get the PreToolUse worktree write-guard hook (#1018). Kimi has no documented hook seam. The `-p` docs mention "static deny rules remain in effect", implying a deny-rule config exists somewhere outside the exclusive reference — a follow-up investigation, not a claimable guarantee. A Kimi builder must be documented as **not** having equivalent write isolation.
- **`--yolo` vs `--auto`**: recommend `--yolo` as the Codev default (matches `claude --dangerously-skip-permissions` semantics; trusted-workspace warning acknowledged). `--auto` suppresses agent→user questions, which Codev's gate/Q&A workflow depends on. Never combine (documented conflict).
- **Seed cost/latency**: one short model call (~5–15s) per fresh spawn; negligible tokens, but the fresh-launch path becomes **async** (a real contract change for `resolveArchitectLaunch`).
- **`--continue` is cwd-scoped**: safe for a builder's private worktree, unsafe for sibling architects sharing one cwd — but the seed pattern makes per-architect exact IDs available (captured from each seed's own stdout, so no store race), so `--continue` is never needed for architects.

## Recommended Approach

### Minimum viable integration (MVI): Kimi as **builder**

Self-contained; no Tower launch-contract changes (the generated bash script owns the seed):

1. **`KIMI_HARNESS`** in `harness.ts` + `detectHarnessFromCommand` recognizing `kimi` (kills the #1062 fallthrough for this CLI — the false-Claude behavior becomes impossible even before full support).
2. **Provider-owned builder launch shape**. New optional capability, e.g. `buildLaunchScript(ctx)` (or a `promptDelivery: 'argv' | 'seed-session'` discriminator branched in `spawn-worktree.ts`), generating:
   ```bash
   # .builder-start.sh (kimi shape)
   if [ ! -s .builder-kimi-session ]; then
     kimi -p "$(cat .builder-role.md) …ack-and-wait wrapper…" --output-format stream-json \
       | <extract session.resume_hint.session_id> > .builder-kimi-session
   fi
   exec_loop kimi -S "$(cat .builder-kimi-session)" --yolo
   ```
   Inner restarts resume the same session — role/task context survives restarts (better than the fresh-per-restart Claude loop). Task delivery: after PTY creation, `spawn.ts` posts the task prompt through Tower's message path (the validated delayed-Enter write), so the task turn is the "begin" signal. Seed failure (unauthenticated, network) exits non-zero before the loop → surfaced, not looped.
3. **`buildResume` for Kimi** (builder `afx spawn --resume`): prefer the persisted `.builder-kimi-session` id; fall back to newest `state.json` by `updatedAt` where `workDir == worktreePath` (via `session_index.jsonl`/store scan honoring `KIMI_CODE_HOME` as the test seam). Returns `{sessionId, args: ['-S', id], scriptFragment}` — fits the existing interface unchanged. (`--continue` is the degenerate alternative; explicit-ID keeps the null-return → fresh-with-role fallback semantics correct.)
4. **`message-write.ts` Enter-delay knob** per harness (Kimi ≥ ~1s until bisected; plumb the target session's harness or key off session metadata).
5. **`doctor`**: presence + version; optionally shell out to `kimi doctor` for config validity; **truthful auth story** — no documented status probe, so report credential-artifact presence as a heuristic and point at `kimi login` (never make a billed `-p` call without explicit opt-in).
6. Docs (`arch.md` harness section; config examples for `shell.builder`/`builderHarness`), skeleton mirror where framework files change, and the test matrix below.

### Parity follow-up: Kimi as **architect**

Everything above, plus the session-contract generalization:

1. **Generalize `HarnessProvider.session`**: make `newSessionArgs` optional and add an async `seedSession(cwd, roleContent) → Promise<sessionId>` capability. Kimi implements `seedSession` (the `-p` seed + stream-json capture), `resumeArgs(id) = ['-S', id]`, and `verifyOwnership(id, cwd)` = session dir exists AND `state.json.workDir === cwd` (exact-path match — stronger than Claude's encoded-dir check; honors `KIMI_CODE_HOME` for tests).
2. **Async fresh-launch path**: `resolveArchitectLaunch` (and its four call sites: `launchInstance`, `add-architect`, both shellper restart-bakes, plus no-Tower `afx architect`) grows an async variant. Only the *fresh* branch awaits the seed; the *resume* branch stays synchronous (`-S <stored-id>`), so shellper restart-bake is unchanged in character.
3. **Invariant check** against #832/#1145/#1149/#1150:
   - Stored-ID resume: satisfied via capture-at-seed (no cwd discovery anywhere — no #1145 hijack reintroduction; sibling architects each capture from their own seed's stdout, race-free).
   - Ownership verification: satisfied (obs. 3; exact `workDir`).
   - Crash-loop fallback (#1149): a fresh Kimi fallback cannot be precomputed synchronously (seeding is async). MVI decision: **omit the precomputed fallback for Kimi** — a dead resume fast-fails (obs. 8) into shellper's max-restart cap, and the next explicit start seeds fresh; document this as Codex-like degradation. Full parity later = async-capable `CrashLoopFallback`.
   - Sibling liveness (#1150): `siblingRegistrationIsLive` works as-is once `verifyOwnership` exists.
4. **Acceptable-degradation alternative** (if the async seam is deferred): ship Kimi architect **Codex-like** — no `session` capability, fresh on every restart, role delivered by seed inside a generated architect launch script. Loses conversation persistence but requires zero Tower contract changes. This is a legitimate stage-1; the stored-ID contract is stage-2.

### Answers to the handoff's §8 questions

1. **Can a session ID be captured reliably?** Yes — from the seed's own stdout (`session.resume_hint`, machine-readable, observed) or from the store (session dir appears at TUI launch, `state.json.workDir` exact match). Capture-from-own-stdout is race-free even with concurrent launches.
2. **Can `--continue` implement builder resume?** Yes, safely, in a private worktree — including the no-prior-session case (graceful fresh start, exit 0, observed). But explicit-ID `buildResume` is preferred so the no-session case falls back to the role-injecting fresh path instead of a roleless fresh session.
3. **Is Codex-like initial support acceptable?** Yes for the architect (fresh after restart) as stage-1. For builders the seed pattern already gives *better* than Codex-like (context survives inner restarts) with no Tower changes.
4. **True per-architect resume requirements**: the `seedSession` capability + async fresh-launch seam + the #1149 fallback decision above; no invariant regressions identified.

## File-by-file impact map (current HEAD)

| File | Change |
|---|---|
| `packages/codev/src/agent-farm/utils/harness.ts` | `KIMI_HARNESS`; `detectHarnessFromCommand` + `BUILTIN_HARNESSES` entries; new `buildLaunchScript`/prompt-delivery capability; `session` contract generalization (`newSessionArgs?` + `seedSession?`); Kimi `buildResume`/`verifyOwnership`; new `kimi-session-discovery.ts` sibling module (store scan, `KIMI_CODE_HOME`-aware) |
| `packages/codev/src/agent-farm/commands/spawn-worktree.ts` | Branch `startBuilderSession`/`buildWorktreeLaunchScript` on the prompt-delivery capability → Kimi script shape (seed + `-S` loop + persisted `.builder-kimi-session`); gitignore/skip-worktree handling for the session file |
| `packages/codev/src/agent-farm/commands/spawn.ts` | Post-spawn task delivery via Tower message path for seed-style harnesses; `discoverResumeSession` works unchanged once Kimi has `buildResume` |
| `packages/codev/src/agent-farm/servers/tower-utils.ts` | Async variant of `resolveArchitectLaunch` fresh branch (awaits `seedSession`); `buildArchitectArgs` unchanged for flag-harnesses; Kimi fallback decision (#1149) encoded |
| `packages/codev/src/agent-farm/servers/tower-instances.ts` | Await the async launch resolution at `launchInstance` + `add-architect` sites (already async functions) |
| `packages/codev/src/agent-farm/servers/tower-terminals.ts` | Restart-bake sites unchanged in character (resume branch is sync); crash-loop fallback omitted for seed-style harnesses (stage-1) |
| `packages/codev/src/agent-farm/servers/message-write.ts` | Per-harness/session Enter-delay (Kimi ≥ bisected threshold); callers plumb the target's harness |
| `packages/codev/src/agent-farm/commands/architect.ts` | No-Tower path: await seed before spawn (function is already async) |
| `packages/codev/src/commands/doctor.ts` | `kimi` presence/version; optional `kimi doctor` config check; heuristic auth presence + `kimi login` guidance; architect-shell branch affirmation for kimi |
| `packages/codev/src/lib/config.ts` / types | Accept `kimi` wherever harness names are enumerated (audit; likely string-typed already) |
| `codev/resources/arch.md` (+ lessons) | Extend §"Supported Architect Harnesses & Conversation Resume"; document seed pattern, no-write-guard caveat, undocumented-surface reliance |
| `CLAUDE.md`/`AGENTS.md` + `codev-skeleton/` mirrors | Only if framework-facing docs/roles change (dual-tree rule) |

## Test matrix

**Unit** (existing patterns; `KIMI_CODE_HOME` as the fixture seam):
- `detectHarnessFromCommand('kimi'` / path forms`)` → `'kimi'`; unrecognized-fallthrough regression: `kimi` + stale Claude jsonl never yields `--resume <claude-uuid>` or `--append-system-prompt` (the #929-class guard, four angles like PR #1059: harness, config, spawn-worktree, tower-instances).
- Kimi `buildResume`: fixture store → newest-by-`updatedAt` for exact `workDir`; null when none; `.builder-kimi-session` precedence.
- `verifyOwnership`: matching/mismatched `workDir`, missing dir, malformed `state.json`.
- Seed-output parser: `session.resume_hint` extraction; malformed/absent line → loud failure.
- Script generation: Kimi builder script shape (seed guard, `-S` loop, no positional prompt, no role flags); resume script uses `-S <id>`.
- `resolveArchitectLaunch` async: fresh seeds + persists captured id; resume uses stored id sans role injection; `CODEV_SKIP_RESUME=1`; seed failure surfaces.
- `siblingRegistrationIsLive` with Kimi ownership semantics.
- `message-write` per-harness Enter delay selection.
- `doctor` kimi branch (presence, auth heuristic wording, architect affirmation).

**Integration/manual** (real CLI; the PR #1059 checklist adapted):
- Fresh builder spawn → seed runs, TUI opens resumed, task arrives and submits; inner restart retains context; `afx spawn --resume` after kill; no-session resume falls back to fresh-with-role.
- Architect: `afx workspace start` with stale Claude jsonl present (no crash loop, no Claude flags); `add-architect` sibling; shellper reconnect resumes stored id; Tower stop/start liveness reconciliation; `afx architect` no-Tower.
- `afx send`: single-line, multiline (>3 lines), `--interrupt`, `--no-enter`, while streaming — bisect and pin the Enter delay.
- Dashboard + VSCode terminal render/input; Ctrl-C double-tap exit doesn't fight the restart loop.
- `codev doctor` with `shell.builder`/`shell.architect: "kimi"`.

## Effort Estimate

**Medium–Large** (~800–1200 LOC incl. tests). PR #1059 (codex, flag-only) touched 20 files; Kimi adds the async seed seam, a script-shape branch, session-capture plumbing, and the message-write knob on top of that footprint.

**Recommended protocol**: **SPIR** for the full architect+builder integration (the `session`/launch-contract generalization is architectural; phases fall out naturally: 1 = harness + builder MVI, 2 = message delivery + doctor, 3 = architect/session parity). A builder-only MVI alone would fit **PIR** (design largely settled by this spike; `dev-approval` gate covers the live-TUI validation a diff can't show).

## Next Steps

- [ ] Architect decision: green-light SPIR spec for Kimi support (builder MVI first, architect parity staged) referencing this spike.
- [ ] During implementation: bisect the Kimi Enter-delay threshold; pin minimum supported Kimi version (≥ 0.27.0) and add a session-store smoke probe to catch layout drift.
- [ ] Follow-up investigation (separate, small): Kimi "static deny rules" config surface as a partial write-guard substitute for builders.
- [ ] Not pursued: ACP/`kimi server` adapter (larger backend change, no parity payoff — revisit only for structured-agent-I/O needs).

## References

- Exclusive Kimi documentation source: https://www.kimi.com/code/docs/en/kimi-code-cli/reference/kimi-command.html
- Prior art: PR #1059 "Support codex as an architect (PIR #929)" (merged 2026-06-28); `codev/reviews/929-support-codex-and-gemini-clis-.md`; `codev/plans/929-support-codex-and-gemini-clis-.md`
- Architecture: `codev/resources/arch.md` §"Supported Architect Harnesses & Conversation Resume (#929)"; issues/PRs #832, #1145, #1149, #1150, #1062, #1063 (agy deferral — same role-as-user-turn tradeoff), #1018 (write-guard)
- Current seams (HEAD `165339ab` lineage): `packages/codev/src/agent-farm/utils/harness.ts`, `utils/config.ts`, `commands/spawn.ts`, `commands/spawn-worktree.ts`, `commands/architect.ts`, `servers/tower-utils.ts`, `servers/tower-instances.ts`, `servers/tower-terminals.ts`, `servers/message-write.ts`, `packages/codev/src/commands/doctor.ts`
- POC transcript script: `codev/spikes/task-Iptx-kimi-poc.sh` (empirical evidence, kimi 0.27.0, 2026-07-18)
