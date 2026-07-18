# PIR Plan: Ship Codex Skills Through the Scaffold Lifecycle

## Understanding

Issue #1196 asks Codev to give Codex users the same on-disk, packaged skill
experience that Claude users receive today. The current lifecycle has a
single-provider implementation:

- `packages/codev/src/lib/scaffold.ts:358-399` hard-codes both the
  `codev-skeleton/.claude/skills/` source and `.claude/skills/` destination.
- `packages/codev/src/commands/init.ts:98-106`,
  `packages/codev/src/commands/adopt.ts:134-142`, and
  `packages/codev/src/commands/update.ts:218-231` consequently copy and report
  only Claude skills.
- `codev-skeleton/` contains no `.codex/skills/` tree, so the package build's
  existing whole-skeleton copy cannot ship Codex skills.
- There is no automated comparison of the two provider trees.

The branch already contains contributor commit `25e1a000`, which mirrors the
self-hosted root `.claude/skills/` tree into `.codex/skills/`. I will preserve
and validate that existing work rather than recreating it. The shipped
skeleton's provider set is intentionally smaller than the self-hosted root
set; parity will be enforced between providers within each context, not
between the root and skeleton contexts.

Skills are a deliberate exception to the runtime-only framework rule: provider
tools discover them from root `.claude/skills/` or `.codex/skills/`, so they
must be materialized. Their source remains `codev-skeleton/`, obtained through
the existing `getTemplatesDir()` package-skeleton path; no fresh adopter will
be expected to have repository-local framework files.

## Proposed Change

1. Add `codev-skeleton/.codex/skills/` as a byte-identical mirror of the
   shipped `codev-skeleton/.claude/skills/` set. Keep physical files in both
   provider locations because each tool discovers only its own conventional
   path.
2. Generalize the scaffold skill copier around an explicit provider list
   (`claude`, `codex`) rather than duplicating lifecycle logic. The shared
   operation will return provider-qualified copy results so init, adopt, and
   update can report exact paths.
3. Have init copy both provider trees into a fresh project. Have adopt and
   update process both with per-skill-directory `skipExisting` semantics:
   missing skills are added, while any existing provider skill directory is
   left untouched. `--force` will not bypass this customization safeguard,
   matching the issue and current Claude behavior.
4. Add a recursive parity test covering directory names, relative file names,
   and file bytes for both the shipped skeleton provider pair and the
   self-hosted root provider pair. Put provider-specific exceptions in one
   named, reviewed allowlist; validate that entries are real skill names so an
   exception cannot silently become stale. The allowlist starts empty.
5. Expand scaffold/update regression tests to cover fresh Codex installation,
   backfilling a missing Codex skill, preserving a customized Codex skill, and
   provider-qualified update results/output.
6. Update lifecycle comments/output and user-facing skill/directory
   documentation to name both `.claude/skills/` and `.codex/skills/`. Keep
   the self-hosted root `AGENTS.md` and `CLAUDE.md` byte-identical.

## Files to Change

- `codev-skeleton/.codex/skills/**` — new shipped Codex mirror of every
  `codev-skeleton/.claude/skills/**` file.
- `.codex/skills/**` — retain the contributor's existing self-hosted Codex
  mirror; update mirrored documentation alongside `.claude/skills/**` where
  needed.
- `packages/codev/src/lib/scaffold.ts:345-399` — make skill copying
  provider-aware while retaining directory-level preservation semantics.
- `packages/codev/src/commands/init.ts:13-106` — install and report both
  provider skill trees for fresh projects.
- `packages/codev/src/commands/adopt.ts:14-142` — add missing skills for both
  providers without replacing existing skill directories.
- `packages/codev/src/commands/update.ts:1-13,170-231` — refresh/backfill and
  report both provider trees with neutral user-facing wording.
- `packages/codev/src/__tests__/scaffold.test.ts:295-345` — cover dynamic
  installation and preservation for Claude and Codex.
- `packages/codev/src/__tests__/update.test.ts:220-275` — cover Codex
  backfill/preservation and accept `.codex/` in structured relative paths.
- `packages/codev/src/__tests__/skill-parity.test.ts` — new recursive
  provider-parity guard with an explicit exception allowlist.
- `.claude/skills/codev/SKILL.md` and `.codex/skills/codev/SKILL.md` — describe
  both skill locations in the self-hosted command reference.
- `codev-skeleton/.claude/skills/codev/SKILL.md` and
  `codev-skeleton/.codex/skills/codev/SKILL.md` — same documentation in the
  shipped skill trees.
- `AGENTS.md` and `CLAUDE.md` — accurately show Claude and Codex skill
  directories while preserving the required identical pair.

## Risks & Alternatives Considered

- **Risk: user customizations are overwritten in one provider tree.**
  Mitigation: apply `skipExisting` independently to each provider's complete
  skill directory and assert customized file contents remain unchanged.
- **Risk: two copied provider trees drift.** Mitigation: compare recursive
  path sets and bytes in CI, with a single explicit exception allowlist rather
  than informal differences.
- **Risk: tests pass against repository sources but the npm package omits the
  new tree.** Mitigation: use the existing `copy-skeleton` build step, then
  smoke-test the built CLI against a temporary project so resolution starts
  from the embedded package skeleton.
- **Risk: the large pre-existing root `.codex/skills/` commit contains more
  skills than the shipped skeleton.** Mitigation: treat self-hosted and shipped
  inventories as separate contexts, but require provider parity within each.
- **Alternative: symlink `.codex/skills` to `.claude/skills`.** Rejected
  because symlink behavior is less portable in npm packages and adopter
  repositories, and it would couple user customizations across providers.
- **Alternative: generate `.codex/skills` only during package build.**
  Rejected because the issue explicitly requires the source skeleton tree and
  a checked-in parity mechanism; generated-only files would be less visible to
  review and repository tests.
- **Alternative: maintain two separate lifecycle implementations.** Rejected
  because duplicated copy/preservation logic is another drift surface.

## Test Plan

- Unit: run the scaffold tests to prove both real skeleton trees install every
  skill into a fresh target.
- Unit: create a target with one customized Codex skill and one missing Codex
  skill; prove adopt/update semantics preserve the first and add the second.
- Unit: run the recursive parity guard and prove both provider pairs match
  with no exceptions.
- Unit: run update command tests, including structured `newFiles` paths and
  dry-run assertions for `.codex/skills/`.
- Build: run the Codev package build so `codev-skeleton/` is copied into the
  package's embedded `skeleton/`.
- Integration smoke: invoke the built CLI for fresh init and existing-project
  adopt/update in temporary directories; inspect both skill trees, then modify
  a Codex `SKILL.md`, remove a different Codex skill, rerun update, and verify
  the customized bytes remain while the missing skill returns.
- Documentation guard: assert/diff `AGENTS.md` against `CLAUDE.md` and the
  provider skill trees recursively.
