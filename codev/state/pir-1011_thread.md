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
