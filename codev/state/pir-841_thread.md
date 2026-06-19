# PIR #841 — Architects tree: Add Architect UI, Cmd+K A picker, label casing

Builder: pir-841 | Branch: builder/pir-841 | Protocol: PIR (strict)

## Plan phase (started)
Investigated the multi-architect surface:
- `packages/vscode/src/views/workspace.ts` — Workspace tree; `getArchitectChildren()` renders one row per architect (line 271 `new vscode.TreeItem(name)`). Architects parent row has `contextValue: 'workspace-architects-root'`. Already has `refresh()` (line 62) for imperative re-render.
- `packages/vscode/src/extension.ts:685` — `codev.openArchitectTerminal(architectName?)`; no-arg defaults to `main` (line 695). `codev.removeArchitect` (718) reads name from `arg.label` for TreeItem invocations.
- `packages/core/src/tower-client.ts:249` — `addArchitect(workspacePath, name?)` already exists; POST validates server-side.
- `packages/codev/src/agent-farm/utils/architect-name.ts` — `validateArchitectName` (pure). Lives in codev CLI pkg, NOT core. vscode depends on core only (6 import sites in codev).
- `package.json` — keybinding `cmd+k a`→openArchitectTerminal (no `when`); menus `view/item/context` + `view/title`.

Key decision for plan: where to source client-side name validation for the Add Architect InputBox (relocate pure validator to core w/ re-export shim, vs duplicate regex, vs server-side only). Recommending core relocation.

Casing safety check: `removeArchitect` reads `arg.label`; Option A keeps siblings as-typed so label==name stays correct (only `main`→`Main`, and main is unremovable). Verified safe.

## Plan revision 1 — casing decision
User chose **UPPERCASE all** for architect display labels (`MAIN`, `WEB`, `OB-REFINE`). Internal id stays lowercase. Consequence: sibling label now != raw name, so the `removeArchitect` fix (read raw name from `item.id`, not `arg.label`) is now MANDATORY, not defensive — otherwise Remove would DELETE the uppercased name Tower doesn't know. Plan Gap 3 + Files + Tests + Risks updated. Still awaiting plan-approval gate.
