# aspir-1210 — codev doctor: detect protocol-file drift

## Context
Issue #1210. Add drift detection to `codev doctor`:
- **Shadow drift**: local `codev/**` (and `.codev/**`) files that also exist in the installed
  skeleton — diff them; identical = redundant, differs = "customized or stale? adjudicate".
- **Skeleton staleness**: installed package version vs npm latest (best-effort, offline-tolerant).
- **Known-default detection** (stretch): historical skeleton hashes → provably-rot local copies.
- **No auto-delete** — report only; adjudication stays human.

No "Baked Decisions" section in the issue → free to explore the design.

## Key codebase facts (gathered during Specify)
- `codev doctor` lives in `packages/codev/src/commands/doctor.ts`. It already has a mature
  pattern of section-by-section checks + `warningDetails` roll-up. Existing analogous audits:
  `pr-gate-audit.ts` (#943), `framework-ref-audit.ts` (#1011), `gitignore.ts`. Each is a pure
  lib returning findings + a formatter, wired into both `doctor.ts` and (some) `update.ts`.
- Four-tier resolver: `packages/codev/src/lib/skeleton.ts` → `resolveCodevFile()`
  (.codev/ → codev/ → cache → skeleton). `getSkeletonDir()` = built `packages/codev/skeleton/`.
  `listSkeletonFiles(subdir)` walks the skeleton. `hasLocalOverride()` checks tier-2.
- Skeleton relative path == local path minus the `codev/` prefix (e.g. skeleton
  `protocols/spir/protocol.md` ↔ local `codev/protocols/spir/protocol.md`).
- Installed pkg version: `version.ts` (reads package.json). No npm-latest check exists anywhere yet.

## Progress
- [in progress] Specify phase — writing spec.
