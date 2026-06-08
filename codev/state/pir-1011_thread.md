# PIR #1011 — inline protocol.md into builder prompt at spawn

## Plan phase (2026-06-08)

Read issue #1011, PIR protocol, and the target code. Investigation findings:

- Target: `loadBuilderPromptTemplate()` in `packages/codev/src/agent-farm/commands/spawn-roles.ts:99-108`.
- The returned template flows through `renderTemplate()` in `buildPromptFromTemplate()` (handlebars substitution + `\n{3,}→\n\n` collapse + trim).
- Verified: **zero `{{` occurrences across all 8 `codev-skeleton/protocols/*/protocol.md`** files, so appending protocol.md before render is safe today (no accidental substitution).
- `validateProtocol()` already fatals earlier in the spawn flow if BOTH `protocol.json` and `protocol.md` are missing — so by the time we inline, a missing `protocol.md` means the json exists; silently skipping is correct.
- Tests live in `packages/codev/src/agent-farm/__tests__/spawn-roles.test.ts`; the skeleton-fallback `describe` block (issue #706) is the natural home for the new inline-behavior test.
- Plan-gate decisions locked: (1) `---` + `## Protocol Reference (full text)` delimiter, (2) silently skip + debug log when protocol.md absent, (3) unconditional (no config flag).

Plan written to `codev/plans/1011-agent-farm-inline-protocol-md-.md`. Awaiting plan-approval gate.

## Implement phase (2026-06-08)

plan-approval approved. Implemented per plan:

- `spawn-roles.ts`: `loadBuilderPromptTemplate()` now resolves `protocol.md` via `resolveCodevFile()` and appends it under `\n\n---\n\n## Protocol Reference (full text)\n\n`. Missing protocol.md → `logger.debug` + skip (validateProtocol already fatals earlier if both json+md absent).
- `spawn-roles.test.ts`: 2 new tests in the skeleton-fallback block — (1) inlines protocol.md under the delimiter with a sentinel body, (2) builds without error and omits the heading when protocol.md is absent.

Build ✓ (root `npm run build`), full suite ✓ (3260 passed, 13 pre-existing skips — none mine). Committed + pushed. At dev-approval gate.

## Scope expansion (2026-06-08, architect-driven)

Architect expanded #1011 twice: first to a framework-file class fix (A.1/A.2/A.3), then to a three-layer structure (Delivery / Cleanup / Enforcement). Plan rewritten accordingly. 5 plan-gate decisions locked (delimiter; Patch2=B explicit-embed; A.3=strip; missing-file=silent-skip+debug; doctor=warn-not-error skeleton-only). Patch 1 (Layer 1/A.1) already done + at dev-approval; Patch 2 + Layer 2 sweep + Layer 3 (doctor check + AGENTS/CLAUDE convention) still to implement.

bugfix sub-decision RESOLVED → drop its dead pointer, embed nothing. Evidence: bugfix builder-relevant guidance (300-LOC/escalation/regression/Fixes#) already in its phase prompts (investigate/fix/pr); the 548-line codev/ protocol.md is mostly architect-facing + partly stale (manual merge flow, deprecated projectlist) and absent from the skeleton. That doc-hygiene gap filed separately as **#1013** (area/protocols), kept out of #1011's plumbing scope.
