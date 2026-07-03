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

Workspace field: the workspace root is the cwd for architects, or the path
prefix before `/.builders/` for builders. The display name is resolved from the
`known_workspaces` registry in global.db when present, else the directory
basename. (The workspace name is informational context, not identity — a
basename fallback here does not violate the fail-loud rule, which applies to
type/name.)

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
to stderr; `--json` mode prints `{ "error": "<message>" }` to stdout and still
exits 1, so scripted callers get structured output on both paths.

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
   1. Explicit `[name]` argument → use verbatim (normal path; human named you).
   2. Else run `afx whoami`. If it resolves `type: architect`, adopt that
      `name`. If it resolves `type: builder`, STOP — this command is for
      architect terminals; report the mismatch. If it fails (non-zero), STOP
      and ask the human which architect this terminal is — never guess.

   The old `ps -p $PPID` / `afx status` ancestry matching is removed entirely.
2. **Read `codev/state/<name>.md`** (relative to the workspace root). If
   missing: list `codev/state/*.md`, tell the human, and ask whether to start a
   fresh state file — do not fabricate state.
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

- **Important — cross-check architect env against the `architect` table?**
  `CODEV_ARCHITECT_NAME` only exists because Tower injected it, so trusting it
  satisfies "from Tower's perspective". `whoami` COULD additionally verify a
  matching row in the `architect` table (keyed `workspace_path, id`) and warn —
  not fail — on mismatch (rows may be absent after crashes; pid matching is
  the fragility we're removing). Default: trust env, no cross-check, unless
  reviewers argue otherwise.
- **Nice-to-know — should `whoami` print `--json` errors to stderr instead?**
  Proposed: stdout `{ "error": ... }` + exit 1 (structured for scripts).
- **Nice-to-know — top-level `codev whoami` alias?** Not proposed; `afx` is
  the agent-farm surface and the issue asks for `afx whoami`.

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
6. `/arch-init [name]` uses the explicit argument when given; otherwise
   resolves identity via `afx whoami`; otherwise stops and asks the human.
7. `/arch-init` reads `codev/state/<name>.md` and reports the resume summary;
   when the file is missing it lists available state files and asks before
   creating anything.
8. `/arch-init` ships in `codev-skeleton/.claude/skills/arch-init/` and is
   installed by `codev init` (and offered by `codev update`); it is mirrored
   in this repo's `.claude/skills/arch-init/`.
9. `whoami` requires no running Tower.

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

## Consultation Log

*(To be filled by porch-driven 3-way review.)*
