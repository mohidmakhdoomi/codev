# Spec 1134 — Iteration 1 rebuttal

Verdicts: Gemini APPROVE, Codex REQUEST_CHANGES, Claude APPROVE.
All four Codex points were accepted and the spec updated; Gemini's two
recommendations were adopted, one declined with reasons. Details below.

## Codex (REQUEST_CHANGES)

### 1. Architect state-file contract underdefined — ACCEPTED

Codex is right that `codev/state/` today holds builder thread files
(`<id>_thread.md`), not architect state files, and that "reads the state file
and reports the resume summary" was not implementable/testable as written.
Changes:

- Added an "Architect state files: minimum contract" subsection: free-form
  markdown, authoritative as-is; the resume summary is defined as the opening
  role/banner line plus the most recent dated section (or leading content);
  file absence is a normal first-run condition.
- Explicitly disambiguated architect state files from builder `*_thread.md`
  files sharing the directory; the missing-file listing excludes thread files.
- Narrowed the `/arch-init` MUST acceptance criteria (6–7) to assertions about
  the **shipped skill text** — the testable artifact — rather than runtime
  agent behavior, per Codex's suggestion to "narrow acceptance to shipping the
  skill + documented missing-file behavior."

### 2. Explicit `[name]` needs validation — ACCEPTED

Added: before any file path is built, the name must pass the established
architect-name rule (`[a-z][a-z0-9-]*`, ≤64 chars — `validateArchitectName` in
`utils/architect-name.ts`); slashes/`..`/anything else rejected with the rule
spelled out. Test scenario 12 asserts the skill text carries this rule.

### 3. Architect workspace root ≠ cwd — ACCEPTED

(Claude flagged the same gap.) The spec now names `detectWorkspaceRoot()`
(send.ts:30) as the resolution mechanism: `.builders/` prefix extraction for
builders, cwd-to-root walking (`.codev/config.json` or `.git` marker) for
architects. New test scenario 10 covers running `whoami` from a subdirectory.

### 4. `/arch-init` testing underspecified — ACCEPTED

Added test scenario 12 (skill text identical across both trees; references
`afx whoami` + validation rule; no `ps`/`$PPID` ancestry matching; no
Shannon-specific wording) alongside the existing scaffold scenario 9
(`codev init` installs the skill). Criteria 6–7 rephrased as skill-text
assertions.

## Gemini (APPROVE, with recommendations)

- **Warn when env-resolved architect has no `architect` row** — ADOPTED as a
  SHOULD: best-effort stderr warning, never gating (rows are legitimately
  absent in crash-recovery — the exact scenario `/arch-init` serves). New test
  scenario 11.
- **`--json` failure output** — ADOPTED: structured `{ "error": ... }` on
  stdout AND human-readable explanation on stderr, exit 1.
- **`codev whoami` alias** — DECLINED for this spec: the issue asks for
  `afx whoami`, and agents (the primary consumers) use `afx`. Noted as a
  possible follow-up; keeping scope tight.

## Claude (APPROVE, minor notes)

- **Workspace-root gap** — fixed (see Codex point 3).
- **`describeStateDbOpenFailure()` still says "state.db"** — noted in the
  spec's Consultation Log as an allowed one-line drive-by at implementation
  time (or a follow-up issue); not made a requirement.
