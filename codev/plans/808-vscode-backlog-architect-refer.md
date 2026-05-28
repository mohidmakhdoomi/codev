# PIR Plan: Backlog → Architect reference includes issue title

## Understanding

The "Reference Issue in Architect" inline action on a backlog row injects only `#<id> ` into the architect's prompt buffer. The architect AI (and the user) then lack the working context until they fetch the issue. The issue (#808) asks us to include the title in the injection, formatted as `#<id> "<title>" ` so the user can keep typing and downstream parsing isn't confused by punctuation in the title.

Confirmed locations on this branch:

- `packages/vscode/src/extension.ts:555-566` — `codev.referenceIssueInArchitect` handler. Currently:
  ```ts
  const issueId = extractIssueId(arg);
  if (!issueId) { return; }
  await vscode.commands.executeCommand('codev.openArchitectTerminal');
  const ok = terminalManager?.injectArchitectText(`#${issueId} `);
  ```
- `packages/vscode/src/extension.ts:63-75` — `extractIssueId(arg)` helper reads from `BacklogTreeItem`.
- `packages/vscode/src/views/backlog-tree-item.ts:17-25` — `BacklogTreeItem` constructor currently takes `(issueId, issueUrl, label)`. The title is **not** a separate field today — it's baked into the composite `label` (`#${item.id} ${item.title}${author}`) constructed in `backlog.ts:105`.
- `packages/vscode/src/views/backlog.ts:98-116` — `makeRow` builds the `BacklogTreeItem`. `item.title` (from `OverviewBacklogItem`) is the source of truth.
- `packages/vscode/src/__tests__/extension-architect-commands.test.ts:77-85` — source-sentinel test that pattern-matches `injectArchitectText(\`#\${issueId} \`)`. This **will need updating** to match the new injection shape, otherwise the unit suite fails.

The issue body proposed adding `extractIssueTitle(arg)` "alongside the existing `extractIssueId(arg)`," noting both should "read from `BacklogTreeItem`'s known fields." The title isn't currently a known field on `BacklogTreeItem` — it's only present in the composite label. So either we (a) parse the title out of the label (brittle — author suffix and `#id` prefix would have to be stripped) or (b) add `issueTitle` as a proper typed field on `BacklogTreeItem` alongside `issueId`/`issueUrl`. Option (b) is the right call: it matches the precedent the class set for `issueId` and `issueUrl`, costs one constructor parameter and one field, and avoids string surgery on a display label that already varies (with/without `@author` suffix).

## Proposed Change

1. **Thread the title as a typed field on `BacklogTreeItem`.**
   Add `issueTitle: string` to the constructor and store it readonly, alongside `issueId` and `issueUrl`. `makeRow` in `backlog.ts` passes `item.title` (the un-decorated title from `OverviewBacklogItem`, without `#id` prefix or `@author` suffix).

2. **Add `extractIssueTitle(arg)` next to `extractIssueId(arg)` in `extension.ts`.**
   Same shape as `extractIssueId`: narrow via `instanceof BacklogTreeItem` and return `.issueTitle`. Returns `undefined` if the arg isn't a `BacklogTreeItem` or if the title is empty.

3. **Update the `codev.referenceIssueInArchitect` handler.**
   Build the injection string conditionally:
   ```ts
   const issueId = extractIssueId(arg);
   if (!issueId) { return; }
   const title = extractIssueTitle(arg);
   const escaped = title?.replace(/"/g, '\\"');
   const injection = escaped ? `#${issueId} "${escaped}" ` : `#${issueId} `;
   await vscode.commands.executeCommand('codev.openArchitectTerminal');
   const ok = terminalManager?.injectArchitectText(injection);
   ```
   - Empty / missing title → fall back to the current `#<id> ` form (preserves the acceptance criterion "If the title is unexpectedly missing/empty, the fallback `#<id> ` injection is used").
   - Escape only the double-quote character (`"` → `\"`). Backslashes in titles are left untouched: GitHub issue titles rendering literal `\` are vanishingly rare, and double-escaping `\` would change what the user sees on screen vs what they typed, which is more surprising than leaving a bare `\` in the buffer.

4. **Update the existing source-sentinel test.**
   `extension-architect-commands.test.ts:84` currently asserts the exact old injection literal. Update it to match the new shape (regex that accepts either the title-present injection or the fallback). Keep the spirit of the assertion — that the call still happens, still no architect-name arg, defaulting to 'main'.

5. **Add new unit tests for the escape + fallback logic.**
   Pull the injection-building logic into a small pure helper (e.g. `buildArchitectReferenceInjection(issueId: string, title: string | undefined): string`) co-located in `extension.ts` (or extracted to a sibling utility file if `extension.ts` doesn't currently export anything testable). Cover:
   - Title present → `#<id> "<title>" `
   - Title contains `"` → escaped to `\"`
   - Title undefined → `#<id> ` fallback
   - Title empty string → `#<id> ` fallback (treat empty as missing)

   Decision point captured here: I'd prefer to **extract a small pure helper** so the escape + fallback logic has direct unit coverage instead of relying on regex pattern-matching against `extension.ts` source. The current architect-commands test file is a "source-sentinel" style (pattern-matches the source string) because activating the full extension requires mocking `vscode` — but a pure string helper has no `vscode` dependency and can be unit-tested directly. This adds a small, exported helper but cleanly separates the testable logic from the command registration boilerplate.

## Files to Change

- `packages/vscode/src/views/backlog-tree-item.ts` — add `issueTitle: string` to `BacklogTreeItem` constructor / readonly field.
- `packages/vscode/src/views/backlog.ts:105` — pass `item.title` as the new constructor arg.
- `packages/vscode/src/extension.ts` — add `extractIssueTitle` near `extractIssueId` (line ~75); add `buildArchitectReferenceInjection` pure helper (exported for testing); update `codev.referenceIssueInArchitect` handler (lines 555-566) to use the helper.
- `packages/vscode/src/__tests__/extension-architect-commands.test.ts:77-85` — update the existing sentinel test to match the new injection shape.
- `packages/vscode/src/__tests__/extension-architect-commands.test.ts` (or a new sibling file) — add direct unit tests for `buildArchitectReferenceInjection`.

No changes outside `packages/vscode/`. No new dependencies. No package.json / contribution-point changes — the command is already registered.

## Risks & Alternatives Considered

- **Risk: titles with shell-special characters or VSCode-terminal escape sequences breaking the buffer.** Mitigation: `injectArchitectText` writes the literal string to the terminal input buffer (not through a shell). The terminal renders the characters; the model only sees them when the user hits Enter. Quoted titles are exactly the same characters the user could type by hand, so this widens nothing. The only escaping we owe is `"` so the quoted form parses as a single quoted span downstream.
- **Risk: titles containing backslashes.** Decision: don't escape backslashes. Rationale in §3 above. Acceptance criteria specify `"` escaping only.
- **Risk: regressing the source-sentinel test.** Mitigation: explicit step 4 updates the assertion. Worth flagging because the existing test pattern (regex against source) will silently still pass against the wrong shape if the regex is too loose — keep it tight on the helper-call shape.
- **Alternative: parse title out of the composite label string** rather than threading a new field. Rejected — brittle and tightly couples `extractIssueTitle` to the exact label format (`#id title @author`), which has varied historically. A typed field is the clearer contract.
- **Alternative: extend `extractIssueId` to return `{ id, title }` instead of adding a separate function.** Rejected — the issue explicitly asks for `extractIssueTitle` as a sibling, and a `{id, title}` return would force all existing callers (`codev.spawnBuilder`, `codev.viewBacklogIssue`) to destructure even though they don't need the title.
- **Alternative: inline the build logic, no helper.** Rejected — the escape + fallback is the only part of this change with branching logic worth covering directly. Inlining keeps the source-sentinel test as the only safety net, which is weaker than a direct unit test.

## Test Plan

### Unit

- `buildArchitectReferenceInjection('1234', 'Build feature X')` → `#1234 "Build feature X" ` (trailing space preserved).
- `buildArchitectReferenceInjection('1234', 'Has "quoted" word')` → `#1234 "Has \"quoted\" word" `.
- `buildArchitectReferenceInjection('1234', undefined)` → `#1234 ` (fallback).
- `buildArchitectReferenceInjection('1234', '')` → `#1234 ` (empty treated as missing).
- Existing source-sentinel test in `extension-architect-commands.test.ts` updated to match the new injection-call shape.

### Manual (at the `dev-approval` gate)

The reviewer will spin up the worktree with `afx dev pir-808` (VSCode dev server) and:

1. Open the Codev sidebar → Backlog view.
2. Click the "Reference Issue in Architect" inline button on any backlog row.
3. The architect terminal opens and focuses; the prompt contains `#<id> "<title>" ` with the cursor positioned after the trailing space.
4. No Enter is sent (matches existing behavior — the change is to the injected text only).
5. Try a backlog item whose title contains a literal `"` — confirm the buffer shows `\"` for each occurrence.
6. (Optional, harder to reproduce) If a backlog item with an empty title is available, confirm the fallback `#<id> ` is injected. If not reproducible, the unit test covers this.

### Cross-platform

VSCode extension only — no native code paths. macOS / Windows / Linux behave identically here.

## Out of scope

- Other inject sites (per the issue body — `codev.referenceIssueInArchitect` is the only one with an id+title shape today).
- A user-facing toggle for the injection format.
- Changes to `OverviewBacklogItem` or `BacklogProvider.makeRow`'s label rendering (the visible row label stays `#id title @author`; only the injection text changes).
