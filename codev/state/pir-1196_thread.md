# PIR #1196 thread

- Resumed the existing `builder/pir-1196` branch in the plan phase. The branch
  is based on contributor commit `25e1a000`, which added a byte-identical
  self-hosted `.codex/skills/` mirror of the root `.claude/skills/` tree.
- Investigation found that `copySkills()` and all three scaffold lifecycle
  commands are hard-coded to `.claude/skills/`; `codev-skeleton/.codex/skills/`
  is absent and no provider-parity guard exists.
- Plan decision: materialize both provider paths from the embedded skeleton,
  centralize provider iteration, preserve existing skill directories per
  provider, and enforce recursive byte parity with an explicit (initially
  empty) provider-specific exception allowlist.
- Implemented provider-qualified skill copying for init/adopt/update, added the
  seven-skill shipped Codex skeleton mirror, updated both provider docs, and
  added recursive parity plus lifecycle preservation coverage.
- Verification: dependency/core/types/artifact/codev build chain passed; 58
  targeted tests passed; built-CLI smoke tests passed for fresh init, adopt,
  and update. The full default suite passed 3,508 tests but has 17 unrelated
  environment-sensitive failures in `tower-utils.test.ts` (Codex harness
  selected where assertions assume Claude session flags) and
  `findWorkspaceRoot.test.ts` (`/tmp` is detected as a workspace). No tests
  were skipped or modified to mask these pre-existing failures.
