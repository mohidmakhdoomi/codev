# Spec 1134: `afx whoami` + ship `/arch-init` command in codev (multi-architect identity)

## Metadata

- **ID**: 1134
- **Status**: draft
- **GitHub Issue**: [#1134](https://github.com/cluesmith/codev/issues/1134)
- **Protocol**: SPIR

## Problem Statement

Multi-architect workspaces (Spec 755/786) mean a single codev workspace can host
several architect terminals (`main`, `triage`, `ob-refine`, …) plus many builder
terminals. Agents need a reliable, first-class way to answer the question **"who
am I, from Tower's perspective?"** Today there is no such command, and the two
places that need the answer both work around its absence badly:

1. **No `afx whoami`.** Identity signals exist — `CODEV_ARCHITECT_NAME` in
   architect PTY env (`tower-terminals.ts:654`, `:897`), builder-worktree cwd
   matching against global.db (`detectCurrentBuilderId()` in
   `packages/codev/src/agent-farm/commands/send.ts`), architect rows in the
   `architect` table of `~/.agent-farm/global.db` (#1118) — but they are
   internal plumbing. There is no user/agent-facing command that surfaces them.

2. **The `/architect` slash command is personal and fragile.** It lives only in
   the architect's private `~/.claude/commands/architect.md`, is
   Shannon-workspace-flavored, and auto-detects identity by matching `ps -p
   $PPID` process ancestry against `afx status` output — a heuristic that is
   easy to get wrong. Adopting projects get no equivalent command at all.

Issue #1094 documented why silent identity fallbacks are dangerous: an
unverified identity misroutes `afx send architect` to `main`. Identity
resolution must **fail loud, never guess**.

### Current State

- Architect terminals carry `CODEV_ARCHITECT_NAME` (Tower-injected), but nothing
  reports it.
- Builders can be resolved from cwd via `detectCurrentBuilderId()`, but only
  `afx send` uses it, internally.
- `/architect` exists only on one machine, with workspace-specific wording and
  `ps`-ancestry identity guessing.
- A fresh `codev init` project has no identity-adoption command for architects.

### Desired State

- `afx whoami` reports workspace, agent type, and name from any Tower-managed
  terminal — architect or builder — and exits non-zero with a clear message
  when identity cannot be determined.
- `/arch-init` ships with codev (skeleton → all adopting projects), is
  workspace-agnostic, resolves identity via `afx whoami` (explicit argument
  overrides), and recovers architect state from `codev/state/<name>.md`.

## Stakeholders

- **Architects** (human + AI, `main` and siblings): need `/arch-init` to adopt
  identity and resume state after a terminal restart or context loss.
- **Builders**: get a diagnostic to confirm their own identity (and spawning
  architect) matches Tower's records.
- **Adopting projects**: receive `/arch-init` automatically via
  `codev init` / `codev update`.
- **Codev maintainers**: replace ad-hoc `ps`-ancestry heuristics with one
  supported resolution path.

## Constraints

- **Fail loud, no guessing** (#1094): when identity cannot be determined,
  `whoami` must exit non-zero with a helpful message. It must never fall back
  to `main` implicitly. (Note: `currentArchitectName()` defaults to `main` by
  design for `afx status --mine`; `whoami` must NOT reuse that defaulting
  behavior — it reads the env signal directly and treats absence as unknown.)
- **Identity precedence** (fixed by the issue): builder-worktree cwd match →
  `CODEV_ARCHITECT_NAME` env → unknown (non-zero exit).
- **Reuse, don't duplicate**: `whoami` must share `detectCurrentBuilderId()`
  (and `lookupBuilderSpawningArchitect()`), not reimplement worktree/db
  matching.
- **Two-tree rule**: `/arch-init` must exist in BOTH `codev-skeleton/` (shipped
  to adopters) and our own instance (`.claude/skills/`).
- **`whoami` works in both contexts**: from the main workspace root (architect)
  and from inside a `.builders/<id>/` worktree (builder).
- **`/arch-init` guardrails preserved**: never auto-approve gates, only touch
  your own builders, never `cd` into worktrees, stay on the default branch at
  the workspace root.
- No Tower requirement: `whoami` reads `global.db` (read-only) and process env;
  it must not require Tower to be running.

## Solution Exploration

### Deliverable 1: `afx whoami`

#### Approach A (chosen): new CLI subcommand reusing existing resolvers

A new `afx whoami` command in `packages/codev/src/agent-farm/` that:

1. Calls `detectCurrentBuilderId()` (exported from `send.ts` or extracted to a
   shared module). Three outcomes:
   - **Canonical builder id returned** → type `builder`. Look up
     `spawned_by_architect` via `lookupBuilderSpawningArchitect()` for the
     `architect:` field (omit when NULL/legacy).
   - **`BuilderIdResolutionError` thrown** → we ARE in a builder worktree but
     identity can't be verified: print the error's message (it already explains
     the #1094 rationale) and exit non-zero. Do NOT fall through to the env
     check.
   - **`null` returned** → not a builder worktree; continue to step 2.
2. Reads `CODEV_ARCHITECT_NAME` from the environment (trimmed, non-empty) →
   type `architect` with that name. No `main` default.
3. Neither resolves → print a clear "cannot determine identity" message (what
   was checked, likely causes: plain shell, terminal not started by Tower,
   pre-#786 architect terminal) and exit non-zero.

Workspace field: the workspace root is resolved via the existing
`detectWorkspaceRoot()` (send.ts) — it extracts the prefix before
`/.builders/` for builders and otherwise walks up from cwd to the nearest
directory containing `.codev/config.json` or `.git`. This handles an architect
running `whoami` from a subdirectory (cwd is NOT assumed to be the root). The
display name is resolved from the `known_workspaces` registry in global.db
when present, else the directory basename. (The workspace name is
informational context, not identity — a basename fallback here does not
violate the fail-loud rule, which applies to type/name.)

- **Pros**: single source of truth; inherits #1094 fail-loud semantics for
  free; works offline (no Tower dependency); minimal new code.
- **Cons**: `detectCurrentBuilderId()` needs export/relocation out of
  `send.ts`; env-based architect identity is trusted, not cross-checked (see
  Open Questions).
- **Complexity**: low. **Risk**: low.

#### Approach B (rejected): query Tower's HTTP API

Ask Tower "which agent owns this terminal?" via terminal id / pid.

- **Pros**: authoritative live view.
- **Cons**: requires Tower running (fails in exactly the recovery scenarios
  `/arch-init` exists for); needs a terminal-identity handshake that doesn't
  exist today; more moving parts. Rejected.

#### Approach C (rejected): env-var-only

Report `CODEV_ARCHITECT_NAME` / a hypothetical builder env var.

- **Cons**: builders have no such env var today; env vars leak across nested
  shells; contradicts "from Tower/global.db's perspective" in the issue.
  Rejected.

#### Output format

Human-readable (default), `key: value` lines:

```
workspace: codev
type: architect
name: main
```

Builder:

```
workspace: codev
type: builder
name: builder-spir-984
architect: main
```

(`architect:` line omitted when `spawned_by_architect` is NULL — a legacy row.)

`--json` emits a single JSON object on stdout:

```json
{ "workspace": "codev", "type": "builder", "name": "builder-spir-984", "architect": "main" }
```

`architect` is omitted (not `null`) when unknown, keeping the schema minimal.

On failure (identity unknown): exit code 1; human mode prints the explanation
to stderr; `--json` mode prints `{ "error": "<message>" }` to stdout AND the
human-readable explanation to stderr, still exiting 1 — scripted callers get
structured stdout on both paths while humans keep an informative stderr
(consultation feedback, Gemini).

Architect-row cross-check: when identity resolves via `CODEV_ARCHITECT_NAME`,
`whoami` SHOULD best-effort check the `architect` table for a matching
`(workspace_path, id)` row and emit a warning to stderr when none is found
(e.g. after a Tower crash). The warning never changes the output or exit code
— rows being absent is expected in exactly the recovery scenarios `/arch-init`
serves, so this is diagnostics, not gating.

### Deliverable 2: ship `/arch-init`

#### Vehicle (chosen): a skill in `.claude/skills/arch-init/`

The scaffold pipeline ships slash-invocable commands as skills:
`codev init` / `adopt` / `update` copy `codev-skeleton/.claude/skills/` into
projects (`init.ts:98`, `adopt.ts:134`, `update.ts:223`). A
`.claude/commands/` file is NOT shipped by any scaffold path, so the command
ships as `codev-skeleton/.claude/skills/arch-init/SKILL.md`, mirrored in our
own `.claude/skills/arch-init/` (two-tree rule). Users invoke it as
`/arch-init [name]`.

#### Content: generalized from `~/.claude/commands/architect.md`

Workspace-agnostic rewrite of the existing personal command, with the identity
step replaced:

1. **Resolve the architect name.** Precedence:
   1. Explicit `[name]` argument → use it (normal path; human named you), but
      only after validating its shape (below).
   2. Else run `afx whoami`. If it resolves `type: architect`, adopt that
      `name`. If it resolves `type: builder`, STOP — this command is for
      architect terminals; report the mismatch. If it fails (non-zero), STOP
      and ask the human which architect this terminal is — never guess.

   **Name validation** (consultation feedback, Codex): before the name is used
   to build any file path, it must match the established architect-name rule
   (`[a-z][a-z0-9-]*`, max 64 chars — the `validateArchitectName` rule in
   `packages/codev/src/agent-farm/utils/architect-name.ts`). Anything else —
   slashes, `..`, uppercase, spaces — is rejected with the rule spelled out.
   This closes the `/arch-init ../../foo` path-traversal hole.

   The old `ps -p $PPID` / `afx status` ancestry matching is removed entirely.
2. **Read `codev/state/<name>.md`** (relative to the workspace root). If
   missing: list the architect state files in `codev/state/` — excluding
   builder thread files, which share the directory and are named
   `<builder-id>_thread.md` — tell the human the file is missing, and ask
   whether to start a fresh state file — do not fabricate state.
3. **Confirm identity + orient**: report adopted name, the state file read, and
   the current-state/open-loops summary; then follow the state file's resume
   instructions.
4. **Guardrails** (workspace-agnostic, kept from the original):
   - Never auto-approve porch gates — gate notifications are for the human.
   - Touch only your own builders / spawns / filings; siblings own theirs.
   - Never `cd` into a builder worktree; use `git -C` + absolute paths.
   - Stay on the default branch at the workspace root.

All Shannon-specific wording (workspace name, roster references, example
architect names beyond generic ones) is removed.

#### Architect state files: minimum contract

`codev/state/` is a shared directory: builder threads live at
`codev/state/<builder-id>_thread.md`, and architect state files live at
`codev/state/<name>.md` where `<name>` is a valid architect name. This spec
does not impose a schema on architect state files — they are free-form
markdown owned by each architect — but `/arch-init` assumes this minimum
contract so its behavior is well-defined:

- The file is **authoritative free text**: whatever it says about resuming
  (role banner, "read FIRST on resume" notes, open loops) is followed as-is.
- The "resume summary" `/arch-init` reports is: the file's opening role/banner
  line (if any) plus the most recent dated section (or, absent dated sections,
  the file's leading content). No parsing beyond that is required or promised.
- Absence of the file is a normal, first-run condition — handled by the
  missing-file flow above, never by fabricating content.

Creating/maintaining these files remains out of scope; this contract exists
only so the skill's read-and-summarize behavior is implementable and
reviewable (consultation feedback, Codex).

## Out of Scope

- Deleting/migrating the user's personal `~/.claude/commands/architect.md`
  (their file; they can retire it themselves).
- A builder-side equivalent of `/arch-init` (builders get identity from their
  spawn prompt).
- Tower HTTP API changes or new terminal-identity handshakes.
- Changing `currentArchitectName()`'s `main`-defaulting behavior for
  `afx status --mine` (that default is intentional there).
- Architect state-file (`codev/state/<name>.md`) format or lifecycle changes.

## Open Questions

All resolved during the iteration-1 consultation:

- **Cross-check architect env against the `architect` table?** RESOLVED:
  trust `CODEV_ARCHITECT_NAME` (it exists only because Tower injected it), but
  emit a best-effort stderr **warning** when no matching `architect` row is
  found — never failing, never changing output/exit code (Gemini's
  recommendation; rows are legitimately absent in crash-recovery scenarios).
- **`--json` errors to stdout or stderr?** RESOLVED: both — structured
  `{ "error": ... }` on stdout for scripts, human-readable explanation on
  stderr, exit 1 (Gemini's recommendation).
- **Top-level `codev whoami` alias?** RESOLVED: declined for this spec. The
  issue asks for `afx whoami`; agents are the primary consumers and use `afx`.
  An alias can be a follow-up if humans ask for it.

## Success Criteria

### Functional (MUST)

1. `afx whoami` from an architect terminal prints workspace/type/name matching
   Tower's records (i.e. the injected `CODEV_ARCHITECT_NAME`).
2. `afx whoami` from inside a `.builders/<id>/` worktree prints the canonical
   builder id from global.db, plus `architect: <name>` when
   `spawned_by_architect` is recorded.
3. `afx whoami` in an unrecognized context (plain shell, unregistered
   terminal) exits non-zero with a helpful message; it never implicitly
   reports `main`.
4. `afx whoami` inside a builder worktree whose identity cannot be verified
   (missing/unopenable global.db, no matching row) exits non-zero with the
   `BuilderIdResolutionError` explanation — it does not fall back to the env
   check or the bare directory name.
5. `afx whoami --json` emits the documented JSON schema on success and
   `{ "error": ... }` + exit 1 on failure.
6. The `/arch-init` skill text instructs: explicit `[name]` argument wins
   (after `[a-z][a-z0-9-]*`/64-char validation, rejecting path-traversal
   shapes); otherwise identity comes from `afx whoami`; otherwise STOP and ask
   the human. It contains no `ps`/`$PPID`/process-ancestry instructions.
7. The `/arch-init` skill text instructs reading `codev/state/<name>.md` and
   reporting the resume summary per the minimum contract; the missing-file
   flow lists architect state files (excluding `*_thread.md` builder threads)
   and asks before creating anything.
8. `/arch-init` ships in `codev-skeleton/.claude/skills/arch-init/` and is
   installed by `codev init` (and offered by `codev update`); it is mirrored
   in this repo's `.claude/skills/arch-init/` with identical content.
9. `whoami` requires no running Tower.

(6–7 are phrased as assertions about the shipped skill text — that is the
testable artifact; the runtime behavior it produces is exercised manually,
since a skill is instructions to an agent, not code. Consultation feedback,
Codex.)

### Non-functional

- `whoami` opens global.db read-only (no state mutation).
- Builder-identity logic is shared with `afx send` (one implementation).
- `/arch-init` skill text contains no Shannon-/workspace-specific references.

### Test Scenarios

1. Env `CODEV_ARCHITECT_NAME=ob-refine`, cwd = workspace root → architect
   `ob-refine`, exit 0 (text + `--json`).
2. Cwd inside `.builders/spir-984/` with matching global.db row
   (`spawned_by_architect = 'main'`) → builder `builder-spir-984`,
   `architect: main`, exit 0.
3. Same, `spawned_by_architect` NULL → no `architect` line/field, exit 0.
4. Cwd inside a builder worktree, no matching row → exit 1, #1094-style
   message; env var (even if set) is NOT consulted.
5. Plain shell, no env, cwd outside any worktree → exit 1, helpful message.
6. Env set AND cwd inside a builder worktree → builder identity wins
   (precedence rule).
7. Whitespace-only `CODEV_ARCHITECT_NAME` treated as unset.
8. Workspace registered in `known_workspaces` → its `name`; unregistered →
   directory basename.
9. Fresh `codev init` project contains `.claude/skills/arch-init/SKILL.md`.
10. Architect terminal, cwd in a subdirectory of the workspace (e.g.
    `packages/codev/src/`) → workspace root still resolved correctly via
    `detectWorkspaceRoot()`.
11. Env resolves an architect name but no matching `architect` row exists →
    success output unchanged, warning on stderr, exit 0.
12. Skill-text assertions: `codev-skeleton/.claude/skills/arch-init/SKILL.md`
    and `.claude/skills/arch-init/SKILL.md` are identical; text references
    `afx whoami` and the name-validation rule; text contains no `ps `/`$PPID`
    ancestry matching and no Shannon-specific wording.

## Consultation Log

### Iteration 1 (spec review): Gemini APPROVE, Codex REQUEST_CHANGES, Claude APPROVE

Changes made in response:

- **Codex**: defined a minimum contract for architect state files (free-form
  markdown, authoritative; resume summary = banner + latest dated section) and
  disambiguated them from builder `*_thread.md` files sharing `codev/state/`;
  added `[name]` validation via the `validateArchitectName` rule to close the
  path-traversal hole; replaced "workspace root is cwd for architects" with
  `detectWorkspaceRoot()` cwd-to-root walking; rephrased `/arch-init` MUST
  criteria as assertions about the shipped skill text (the testable artifact)
  and added skill-text/scaffold test scenarios (10–12).
- **Gemini**: adopted stderr warning when env-resolved architect has no
  `architect` table row (non-gating); adopted dual-output `--json` failure
  (JSON stdout + human stderr). Declined the `codev whoami` alias (scope:
  issue asks for `afx whoami`; agents are the consumers).
- **Claude**: same workspace-root gap as Codex (fixed above). Noted for the
  plan: `describeStateDbOpenFailure()`'s message text still says "state.db"
  post-#1118; the implementation MAY do that one-line wording drive-by (or
  file a follow-up issue) since `whoami` will surface these messages.

Full reviews: `codev/projects/1134-afx-whoami-ship-arch-init-comm/1134-specify-iter1-{gemini,codex,claude}.txt`;
rebuttal: `1134-specify-iter1-rebuttals.md`.
