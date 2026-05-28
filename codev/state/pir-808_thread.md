# pir-808 thread

## Plan phase — initial draft (2026-05-28)

Wrote `codev/plans/808-vscode-backlog-architect-refer.md`. Key decisions captured there:

- Thread `issueTitle` as a typed field on `BacklogTreeItem` (option B). Rejected parsing it out of the composite display label (option A) — too brittle, label format has varied historically.
- Extract a small pure `buildArchitectReferenceInjection(issueId, title)` helper so the escape + fallback logic gets direct unit coverage instead of relying on the source-sentinel regex pattern in `extension-architect-commands.test.ts`.
- Escape `"` → `\"` only; leave backslashes untouched (acceptance criteria say `"` escaping only, and double-escaping `\` would change rendered vs typed semantics).

Existing sentinel test at `extension-architect-commands.test.ts:77-85` needs updating; current literal regex `injectArchitectText(\`#\${issueId} \`)` will fail against the new injection shape.

Sitting at `plan-approval` gate after commit + push.
