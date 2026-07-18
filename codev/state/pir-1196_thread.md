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
