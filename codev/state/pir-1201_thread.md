# Thread — pir-1201 (Support Kimi Code CLI as a builder)

## 2026-07-18 — Plan phase

- Spawned in PIR strict mode against issue #1201. Spike `task-Iptx` (findings + addendum + POC script) rode into the worktree from main — used as the design base.
- Architect constraints received mid-turn and folded into the plan: hard scope fence (builder MVI only — no architect parity, no ACP; write-guard is a caveat), evidence rule (documented claims cite the Kimi command reference only; store layout / `session_index.jsonl` / `resume_hint` labeled undocumented, kimi ≥ 0.27.0 pinned), fork flow (pushes land on mohidmakhdoomi/codev via per-worktree pushurl; cross-fork PR to cluesmith/codev; NO self-merge — maintainers merge), live demo required before dev-approval.
- Investigated all seams at HEAD: `harness.ts` (provider interface + #1062 claude fallthrough), `spawn-worktree.ts` script generation, `spawn.ts` `discoverResumeSession`, `message-write.ts` pacing constants, tower-routes/cron delivery paths, `createTerminal` surface (core tower-client + `handleTerminalCreate`), `claude-session-discovery.ts` (pattern for the kimi sibling), `doctor.ts` check structures.
- Key plan decisions:
  - New optional `HarnessProvider.buildBuilderLaunchScript` capability — provider-owned script shape; only Kimi implements; existing harness scripts byte-identical.
  - Seed-session bootstrap in the generated script (idempotent `-s` guard, seed-failure exits before the loop, sentinel re-printed on relaunch).
  - Readiness barrier Tower-side (new `servers/seed-kick.ts`) armed via a `seedKick` field on createTerminal; store-verified BEGIN with Enter-resend → kick-resend → loud-warn ladder.
  - `kimi-session-discovery.ts` scans the store directly (skips `session_index.jsonl` — one undocumented surface instead of two).
  - NO `session` block on KIMI_HARNESS (mint-and-pin `newSessionArgs` unsatisfiable; contract generalization = stage 2). Architect use fails loudly via `buildRoleInjection` throw + doctor warning.
  - Enter-delay: optional `pacing.enterDelayMs` on `writeMessageToSession`, sourced from `HarnessProvider.messagePacing`; bisect 80ms–1s live during implement.
- Plan committed at `codev/plans/1201-support-kimi-code-cli-as-a-bui.md`; sitting at plan-approval gate.

## 2026-07-18 — Implement phase

- Plan approved with one review note: make message-pacing resolution robust to a per-spawn `--builder-cmd` override. Solved without a DB migration: pacing probes the target's cwd for the `.builder-kimi-session` marker FIRST (the marker exists iff the launch script is Kimi-shaped — self-describing, survives Tower restarts, override-proof), then falls back to config-resolved harness by terminal role.
- Full MVI implemented across five commits: harness+discovery+script-shape, Tower seed-kick+pacing, doctor, docs, hardening. All porch checks (build, tests) green; suite 3592 passing after fixing a 500 my pacing hook caused in the /api/send test env (lesson: advisory features must be try/catch-total — pacing can never break delivery).
- Enter-delay bisect (real kimi 0.27.0, POC probe-10 method): 80ms fails (spike-confirmed), 120/250/500ms submit. Threshold ≈ 100ms; shipped constant pinned at 1000ms (~10x margin, POC-validated, latency-only cost).
- Demo driver at `codev/spikes/pir-1201-kimi-builder-demo.mjs` — runs the REAL dist modules (script generator, armSeedKick, writeMessageToSession, buildResume) against a real kimi PTY, covering the architect's 4-point demo checklist without touching the global Tower. Full `afx spawn` path needs the branch build installed into Tower (`pnpm -w run local-install`) — that restarts Tower, so it's the human's call at the gate.
- **Demo executed: ALL 5 steps PASS** (kimi 0.27.0, first run). Seed → sentinel → store-verified BEGIN (`lastPrompt="BEGIN"`); the ack-and-wait-with-task discipline HELD (spike addendum's open question — no fallback needed); multiline submitted with the pinned delay; TUI killed mid-session → `-S` restart recalled both role token and task verbatim; buildResume returned the pinned id. Sitting at dev-approval gate.

## 2026-07-19 — Review phase

- dev-approval approved after the human ran the full afx-spawn-through-Tower demo (all 4 checklist items live).
- Review file written; two lessons routed to COLD lessons-learned.md (advisory-decorator failure-totality; on-disk marker over schema for per-instance runtime facts). Arch already routed during implement (COLD arch.md subsection); no HOT-tier changes.
- Cross-fork PR opened: cluesmith/codev#1203 (head mohidmakhdoomi:builder/pir-1201). No self-merge — maintainers merge.
- CMAP (single advisory pass): gemini APPROVE, claude APPROVE, **codex REQUEST_CHANGES** — a real defect: seed-kick delivery confirmation used substring match on lastPrompt, but the fresh-spawn seed prompt itself contains "BEGIN", so the verifier false-positived before the kick submitted (the happy-path demo had masked it). **Fixed** (`732f04b8`): whitespace-normalized equality + two pinning regression tests; live demo re-run post-fix 5/5 PASS. Disposition recorded in `codev/projects/1201-*/1201-review-iter1-rebuttals.md` and flagged in the review's "Things to Look At" since PIR won't re-review it. Good CMAP catch — the exact class of thing solo review + a passing live demo can miss.
- Sitting at the pr gate.
