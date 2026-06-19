# PIR Plan: Architects tree — Add Architect UI, Cmd+K A picker, label casing

Issue: #841 (`area/vscode`). Three follow-up gaps on the Spec 786 Architects tree.

## Understanding

Spec 786 landed an **Architects** tree under the Workspace view (`codev.workspace`) that lists every registered architect (`main` + siblings), with right-click Remove on siblings and live SSE refresh. Three gaps remain, all in the VS Code extension:

1. **No "Add Architect" UI** — siblings can only be registered via `afx workspace add-architect --name <name>`. There is no `codev.addArchitect` command and no affordance in the tree. The Tower REST endpoint and the client method already exist (`TowerClient.addArchitect`, `packages/core/src/tower-client.ts:249`); only the UI is missing.
2. **`Cmd/Ctrl+K A` always opens `main`** — `codev.openArchitectTerminal` (`extension.ts:685`) accepts an optional `architectName`; tree rows pass it, but no-arg invocations (keybinding + palette) hardcode `main` (`extension.ts:695`). With siblings registered there is no keyboard-driven way to pick a non-`main` architect.
3. **Lowercase `main` breaks the Title Case label convention** — every other Workspace row is Title Case (`Open Web Interface`, `Spawn Builder`, `Architects`); the architect child rows render the raw name, so the default row shows `main` (the only lowercase row). `getArchitectChildren()` does `new vscode.TreeItem(name)` at `views/workspace.ts:271`.

Acceptance (from the issue):
- A user can register a sibling architect entirely from the extension UI, no CLI.
- `Cmd/Ctrl+K A` handles single-architect (opens `main` directly, no picker) and multi-architect (picker) workspaces.
- Architect rows match the casing convention of the rest of the Workspace view.

### Relevant existing code (verified)

- `views/workspace.ts:252-286` — `getArchitectChildren()`: fetches `getWorkspaceStatus`, filters `type === 'architect'`, maps to rows. Each row sets `contextValue` (`workspace-architect-main` / `-sibling`), `command: codev.openArchitectTerminal` with `arguments: [name]`. Parent row id `workspace-architects-root`, `contextValue: 'workspace-architects-root'`. Provider already exposes `refresh()` (line 62).
- `extension.ts:685-713` — `codev.openArchitectTerminal(architectName?)`: resolves `state.architects` (with scalar `state.architect` fallback), opens the matching `terminalId`.
- `extension.ts:718-760` — `codev.removeArchitect`: derives the name from `arg.label` when invoked with a TreeItem; refuses `main`; modal confirm; calls `workspaceProvider.refresh()` on success.
- `core/src/tower-client.ts:249-278` — `addArchitect(workspacePath, name?)`: POSTs to `/api/workspaces/:enc/architects`; Tower validates `[a-z][a-z0-9-]*`, rejects `main`/duplicates/malformed with a 4xx and an operator-facing `error` string.
- `codev/src/agent-farm/utils/architect-name.ts` — pure `validateArchitectName(name)` (rejects empty, `main`, >64 chars, non-`[a-z][a-z0-9-]*`). Currently in the **codev CLI** package (6 import sites); the **vscode** package depends on `@cluesmith/codev-core` + `@cluesmith/codev-types`, not codev.
- `package.json`: keybinding `cmd+k a` / `ctrl+k a` → `codev.openArchitectTerminal` (no `when`, global); `view/item/context` already gates `removeArchitect` on `viewItem == workspace-architect-sibling`; `view/title` holds per-view navigation buttons.

## Proposed Change

### Gap 1 — `codev.addArchitect` command + inline "+" affordance on the Architects row

- **Command** `codev.addArchitect` registered with `regCli` (it needs Tower/CLI, mirroring `removeArchitect`). Flow:
  1. Guard on connection (client + workspacePath + state connected), same pattern as `removeArchitect`.
  2. Prompt with `vscode.window.showInputBox({ prompt, placeHolder, validateInput })`. `validateInput` runs the **same rule Tower uses** for instant inline feedback (see Decision A below for where that validator lives).
  3. On accept, call `client.addArchitect(workspacePath, name)`. On `ok`, `showInformationMessage("Codev: Added architect '<name>'.")` and `workspaceProvider.refresh()` (the `architects-updated` SSE will also fire, but the explicit refresh avoids a stale window like `removeArchitect` does). On failure, surface `result.error`.
- **Affordance**: inline `+` icon button on the **Architects** parent row.
  - `package.json` → `commands`: add `{ "command": "codev.addArchitect", "title": "Codev: Add Architect", "icon": "$(add)" }` (use the `add` codicon; declare via the `"icon"` field).
  - `package.json` → `menus.view/item/context`: `{ "command": "codev.addArchitect", "when": "view == codev.workspace && viewItem == workspace-architects-root", "group": "inline@1" }` so it renders as a hover `+` on the parent row.
  - `package.json` → `menus.commandPalette`: add `{ "command": "codev.addArchitect", "when": "false" }`? No — keep it palette-visible (it's a useful no-context command; the handler self-guards on connection). Leave it OUT of the `when:false` list so "Codev: Add Architect" works from the palette too. (`removeArchitect` is hidden from the palette because it needs a row; `addArchitect` doesn't.)

Chosen affordance = inline `+` on the parent row (issue's first suggestion). Rejected the "+ Add Architect" child row (adds a permanent fake row that complicates `getArchitectChildren`) and a Workspace `view/title` `+` button (the Workspace view is not architect-specific, so a title button would be ambiguous).

### Gap 2 — `Cmd/Ctrl+K A` picker when N > 1

Restructure `codev.openArchitectTerminal(architectName?)`:
- When `architectName` is provided (tree-row click), keep today's behavior exactly.
- When `architectName` is **undefined** (keybinding / palette):
  1. Fetch `state = await client.getWorkspaceState(workspacePath)` (the handler already makes this call — reuse it).
  2. `architects = state?.architects ?? (state?.architect ? [state.architect] : [])`.
  3. If `architects.length <= 1` → resolve `main` exactly as today (open `main` directly, no picker — preserves single-architect UX).
  4. If `architects.length > 1` → `showQuickPick` of the architect names sorted **alphabetically with `main` first** (display label via the casing helper from Gap 3; the picked value resolves back to the raw name). If the user dismisses the picker, no-op. Open the picked architect's `terminalId`.
- The terminal-open path (`terminalManager.openArchitect(terminalId, name, true)`) is unchanged and always receives the raw lowercase name.

### Gap 3 — UPPERCASE display label (display-only)

- Add a tiny pure helper `displayArchitectName(name)` (in `views/workspace.ts` or a small shared util): returns `name.toUpperCase()` for every architect — so `main` → `MAIN`, `web` → `WEB`, `ob-refine` → `OB-REFINE`. The internal identifier stays lowercase everywhere (used by `architect:<name>` messaging, spawn affinity, `validateArchitectName`, and the Tower add/remove API).
- `views/workspace.ts:271` → `new vscode.TreeItem(displayArchitectName(name))`. Keep `command.arguments: [name]` (raw lowercase) and `contextValue` keyed on the raw `name === 'main'`. Tooltip keeps using the raw name so the canonical identifier is still discoverable on hover.
- Reuse the same helper for the Gap 2 QuickPick labels so the picker and the tree agree (`MAIN`, `WEB`, … shown; raw name resolved on pick).

**Casing safety — `removeArchitect` fix is now MANDATORY (not just defensive):** `codev.removeArchitect` currently derives the name from `arg.label` for TreeItem invocations. With UPPERCASE labels, a sibling row's `label` is now `WEB` while Tower knows it as `web` — so the existing `arg.label` path would send a DELETE for a name Tower doesn't recognize (silent failure / wrong target). Therefore the row **must** carry the raw lowercase name through a channel independent of the display label, and `removeArchitect` **must** read that instead of `arg.label`:
  - In `getArchitectChildren`, set `item.id = 'workspace-architect-' + name` (raw name embedded; these are the only `workspace-architect-`-prefixed ids in the tree, so no collision).
  - In `removeArchitect`, when `arg` is a `TreeItem`, derive the name by stripping the `workspace-architect-` prefix from `arg.id` (fall back to `arg.label` only if `arg.id` is absent, for safety). The `name === 'main'` guard and `viewItem == workspace-architect-sibling` menu gate are unchanged.
  - Add a regression test asserting `removeArchitect` resolves the name from `arg.id`, not the (now-uppercased) `arg.label`.

### Decision A — where the shared name validator lives (plan-approval decision)

The InputBox should validate with the **same rule Tower uses**. Three options:

- **A1 (recommended): relocate the pure validator into `@cluesmith/codev-core`.** Move `validateArchitectName` (+ `ARCHITECT_NAME_PATTERN`, `MAX_ARCHITECT_NAME_LENGTH`, `DEFAULT_ARCHITECT_NAME`) into a new `packages/core/src/architect-name.ts` with a `./architect-name` subpath export (core already does this for `./agent-names`, a direct precedent). Re-export from the existing `packages/codev/.../utils/architect-name.ts` so all 6 existing import sites and tests are untouched (zero churn). vscode imports `validateArchitectName` from core. Single source of truth; honors "implementation/policy belongs in core."
- **A2 (lighter, contained): duplicate the regex in the vscode extension.** A ~4-line local `validateArchitectName`. No cross-package change, but duplicates policy (the lessons-critical "single source of truth" caution) — two copies can drift.
- **A3 (minimal): no client-side validation; rely on Tower's server-side 4xx.** The InputBox accepts anything; on failure the handler surfaces `result.error`. Simplest, but no inline red-text feedback as the user types.

**Recommendation: A1** — principled, low-risk (pure functions, no new deps, core builds before codev/vscode), and there's an exact precedent (`agent-names`). I'll fall back to A2 if the reviewer prefers to keep the change contained to `area/vscode`.

## Files to Change

- `packages/vscode/src/extension.ts`
  - Register `codev.addArchitect` (regCli) — InputBox + `client.addArchitect` + `refresh()`.
  - `codev.openArchitectTerminal` — add the N>1 QuickPick path for no-arg invocations.
  - `codev.removeArchitect` — derive raw name from `arg.id` (strip `workspace-architect-` prefix) instead of `arg.label` (MANDATORY now that labels are uppercased).
- `packages/vscode/src/views/workspace.ts`
  - Add `displayArchitectName()` helper (`name.toUpperCase()`); wrap the child label at line 271; set `item.id = 'workspace-architect-' + name` to carry the raw name.
- `packages/vscode/package.json`
  - `contributes.commands`: add `codev.addArchitect` (with `$(add)` icon).
  - `contributes.menus.view/item/context`: inline `+` on `workspace-architects-root`.
  - Leave `addArchitect` palette-visible (do NOT add to the `when:false` list).
- **If Decision A1:**
  - `packages/core/src/architect-name.ts` — new; pure validator + constants.
  - `packages/core/package.json` — add `./architect-name` to `exports`.
  - `packages/codev/src/agent-farm/utils/architect-name.ts` — re-export the moved symbols from core (keep `autoNumberArchitectName` / `currentArchitectName` wherever lowest-risk; they can stay in codev if they pull process/env, or move too if pure).
- Tests:
  - `packages/vscode/src/__tests__/extension-architect-commands.test.ts` — extend: `addArchitect` registered + validates + refreshes; `openArchitectTerminal` has the N>1 picker path; update the `targetName defaults to 'main'` sentinel to match the restructured handler.
  - `packages/vscode/src/__tests__/workspace.test.ts` — assert `displayArchitectName('main') === 'MAIN'` and `displayArchitectName('ob-refine') === 'OB-REFINE'`; row label uses the helper; row `item.id` carries the raw lowercase name.
  - If A1: a small core unit test for the relocated `validateArchitectName` (or confirm the existing codev test still passes through the re-export).

## Risks & Alternatives Considered

- **Risk (HIGH): UPPERCASE labels break `removeArchitect`'s label-derived name** (`WEB` label vs `web` identity). Mitigated by routing the raw name through `item.id` and having `removeArchitect` read `arg.id`, with a regression test. This is the load-bearing correctness fix of the casing change — not optional.
- **Risk: Decision A1 broadens the change beyond `area/vscode` into core + codev.** Mitigated by the re-export shim (no call-site churn) and core's existing `agent-names` precedent. A2/A3 are the contained fallbacks if the reviewer prefers.
- **Risk: QuickPick ordering / display mismatch.** `main` first then alphabetical; labels via the shared helper so picker and tree agree; resolve back to the raw name before opening.
- **Risk: double-refresh (explicit `refresh()` + `architects-updated` SSE).** Benign — both just fire the tree's change emitter; matches the existing `removeArchitect` pattern.
- **Alternative affordances for Gap 1** (child "+" row, Workspace title button) — rejected as noted above.

## Test Plan

The reviewer exercises the running worktree at the `dev-approval` gate (VS Code Extension Host).

- **Unit (vitest, run from the worktree):** `pnpm --filter @cluesmith/codev-vscode test` (or the package's test script) — new/updated sentinel + behavior tests above all green; full vscode + core suites pass.
- **Build:** `pnpm build` (core → codev → vscode) clean; `tsc` no errors.
- **Manual (Extension Development Host against a Tower workspace):**
  1. **Add (UI):** hover the **Architects** row → click `+` → enter `ob-refine` → row appears without manual refresh. Re-open `+`, enter `main` → inline validation rejects it; enter `Bad Name` / empty → rejected. Palette → "Codev: Add Architect" works too.
  2. **Cmd+K A picker:** with only `main` registered → `Cmd/Ctrl+K A` opens `main` directly (no picker). Add a sibling → `Cmd/Ctrl+K A` shows a QuickPick (`Main` first, then siblings alphabetical); picking opens the right terminal. Palette → "Codev: Open Architect Terminal" behaves the same. Clicking a tree row still opens directly (no picker).
  3. **Casing:** every architect row renders UPPERCASE (`MAIN`, `WEB`, `OB-REFINE`); hover tooltip still shows the raw lowercase name.
  4. **Remove still works (critical with UPPERCASE):** right-click a sibling (e.g. shown as `WEB`) → Remove → modal → row disappears and Tower actually deregisters `web` (confirms `removeArchitect` resolves the raw name from `item.id`, not the uppercased label).
- **Cross-platform:** N/A (desktop VS Code only); verify on the reviewer's OS.
