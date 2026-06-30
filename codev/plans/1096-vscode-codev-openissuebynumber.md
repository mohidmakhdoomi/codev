# PIR Plan: `codev.openIssueById` + `Cmd+K I` keybinding

## Understanding

Opening a specific GitHub issue by its ID in the Codev VSCode extension is a
multi-step palette round-trip today (`Cmd+Shift+P` → "Codev: Search Backlog..."
→ Quick Pick → scan filtered rows → Enter). Two gaps:

1. **No direct "open #N" command.** `codev.searchBacklog` is a Quick Pick that
   filters backlog rows by typed text; there is no command that takes a typed
   issue ID and opens it directly, independent of the backlog set.
2. **No keybinding on any issue command.** `contributes.keybindings` has zero
   issue affordances.

The fix is additive: one new command (`codev.openIssueById`) that prompts
for an issue ID and opens the issue preview via the *existing* open path, plus a
default `Cmd+K I` / `Ctrl+K I` keybinding.

> **Naming note:** the GitHub issue #1096 proposes the command id
> `codev.openIssueByNumber`. Per architect direction at plan time, this plan uses
> **`codev.openIssueById`** ("Open Issue by ID") instead — "ID" is the preferred
> term. This is a deliberate divergence from the issue text, not an oversight.
> (The porch project slug / plan filename remain `…openissuebynumber` because
> they are porch-managed identifiers derived from the original issue title; only
> the shipped command, title, and code identifiers use "ID".)

### Folded-in palette-clarity fix (approved at planning)

A review of the existing palette surfaced a pre-existing discoverability bug,
independent of the new command: two entries whose titles differ only by a
trailing `...`:

- `codev.openBacklogSearch` — **"Codev: Search Backlog"** — opens the rich
  **webview panel** (#920): persistent editor tab, filter by Area/Assignee/Author,
  body substring search, sortable columns. Also the 🔍 icon in the Backlog view
  title bar (`view/title` menu).
- `codev.searchBacklog` — **"Codev: Search Backlog..."** — opens the lightweight
  **Quick Pick** (#918): one-shot fuzzy filter over backlog rows, Enter to open.
  Palette-only.

A user typing "Codev: Search Backlog" sees two near-identical rows and cannot
tell which opens what. The agreed fix (folded into this PR) is a **title-only**
rename of the panel command so the two read distinctly. This is purely a display
change in `contributes.commands` — **no command-id rename** (that would break the
`view/title` menu binding, future keybindings, and `executeCommand` callers) and
**no behavior change**. The new `codev.openIssueById` then joins a palette
where the three issue-entry verbs are clearly distinguished:

| Command | New title | Verb |
|---|---|---|
| `codev.openIssueById` (new) | `Codev: Open Issue by ID...` | open one issue by typed ID (incl. closed/arbitrary) |
| `codev.searchBacklog` (unchanged) | `Codev: Search Backlog...` | fuzzy quick-pick over the backlog set |
| `codev.openBacklogSearch` (retitled) | `Codev: Open Backlog Search Panel` | rich persistent triage panel |

### Relevant existing code (verified)

- `packages/vscode/src/commands/view-issue.ts:154` — `viewBacklogIssue(connectionManager, issueId)`:
  the canonical open-preview path. Checks connection, fetches via
  `client.getIssue(issueId, workspacePath)`, renders a read-only `codev-issue:`
  markdown preview with deterministic column placement (`pickIssuePreviewColumn`),
  and already handles the null-issue case with a clean warning. PR #1076 aligned
  its placement with the builder-terminal count-then-pick model.
- `packages/vscode/src/commands/search-backlog.ts:35` — on selection, delegates
  to `codev.viewBacklogIssue` via `executeCommand`. The pattern the new command
  should mirror.
- `packages/core/src/tower-client.ts:347` — `getIssue(issueNumber, workspacePath?): Promise<IssueView | null>`.
  Hits forge-backed `GET /api/issue?number=…`. Returns `null` for **both**
  not-found and transport failure (the contract does not distinguish a 404 from
  a forge-down).
- `packages/vscode/package.json` — `contributes.commands` (line ~120-360),
  `contributes.menus.commandPalette` (line ~370), `contributes.keybindings`
  (line ~740). Existing Codev `Cmd+K` family: `a`=openArchitectTerminal,
  `d`=sendMessage, `g`=approveGate, `b`=forwardSelectionToBuilder. `Cmd+K I` is
  unbound in both Codev's set and (per the issue) bundled VS Code 1.125.0.
- Unit tests: `packages/vscode/src/__tests__/**/*.test.ts` (vitest,
  `vi.mock('vscode')` pattern — see `command-relay.test.ts`). `pnpm test:unit`.

## Proposed Change

Add a new command `codev.openIssueById` whose handler:

1. Prompts via `vscode.window.showInputBox` for an issue ID, with a
   `validateInput` callback that rejects empty / non-numeric input live.
2. Parses the input with a pure `parseIssueId(input)` helper (trims, strips a
   single leading `#`, requires the remainder to be all digits and non-empty).
3. On a valid ID, **delegates to `codev.viewBacklogIssue`** via
   `vscode.commands.executeCommand('codev.viewBacklogIssue', parsed)`. This is
   the same delegation `searchBacklog` uses, so placement / focus / reuse / the
   connection check / the null-issue message are all inherited unchanged — no
   duplicated fetch or render logic. Because the open path is the live forge
   fetch (not the cached backlog set), it works for open AND closed/archived
   issues and arbitrary IDs, exactly as the acceptance criteria require.

Register it with the plain `reg` helper (it needs no CLI — `viewBacklogIssue`
already gates on Tower connection). Add the command + palette title + default
keybinding to `package.json`.

### Why delegate rather than re-fetch (the one real design decision)

The issue's acceptance criterion #4 suggests the message *"Codev: issue #1234 not
found in this repository"*. But `getIssue` returns `null` indistinguishably for
not-found and forge-unavailable, so asserting "not found in this repository"
would over-claim whenever the forge is merely down. `viewBacklogIssue` already
shows a clean, honest warning for the null case (`Could not load issue #N (forge
unavailable?)`) with no exception leak. **Recommendation: delegate to
`viewBacklogIssue` and keep its existing message**, rather than re-implement the
fetch just to print a message we can't actually substantiate. This keeps a single
source of truth for the open path and satisfies criterion #4's spirit (clean
message, no exception leak). See plan-gate decision #2 below if a distinct
wording is still wanted.

## Files to Change

- `packages/vscode/src/commands/open-issue-by-id.ts` — **new file.**
  - `export function parseIssueId(input: string): string | undefined` — pure,
    no `vscode` dependency in its logic; trims, strips one optional leading `#`,
    returns the digit string if the remainder is non-empty and all digits, else
    `undefined`.
  - `export async function openIssueById(): Promise<void>` — `showInputBox`
    (placeholder e.g. `"Issue ID, e.g. 1096 or #1096"`, `validateInput` using
    `parseIssueId`) → on accept, parse → `executeCommand('codev.viewBacklogIssue', parsed)`.
- `packages/vscode/src/extension.ts`
  - Import `openIssueById` (near the `view-issue` / `search-backlog` imports, ~line 27-29).
  - Register `reg('codev.openIssueById', () => openIssueById())` in the
    command block near `codev.searchBacklog` (~line 1004).
- `packages/vscode/package.json`
  - `contributes.commands`: add `{ "command": "codev.openIssueById", "title": "Codev: Open Issue by ID..." }`.
  - `contributes.keybindings`: add `{ "command": "codev.openIssueById", "key": "ctrl+k i", "mac": "cmd+k i" }` — **no `when` clause** (global, per criterion #6).
  - `commandPalette`: no entry needed — palette-discoverable by default (we do NOT add a `when: false` hide entry).
  - **Folded-in rename:** change the `title` of `codev.openBacklogSearch` from
    `"Codev: Search Backlog"` to `"Codev: Open Backlog Search Panel"`. Title field
    only; the command id, its `view/title` menu binding (the 🔍 Backlog title-bar
    icon, whose tooltip updates automatically), and all callers are untouched.
    Leave `codev.searchBacklog`'s `"Codev: Search Backlog..."` as the canonical
    quick-pick title. Note: `packages/vscode/CHANGELOG.md` already refers to the
    panel as the "Search Backlog editor-tab webview" / 🔍 icon, so the new title is
    consistent with existing release notes (no CHANGELOG edit needed here — that
    accumulates via the architect's vscode-changelog workflow post-merge).
- `packages/vscode/src/__tests__/open-issue-by-id.test.ts` — **new file.** Unit
  tests for `parseIssueId`: `"1234"`→`"1234"`, `"#1234"`→`"1234"`,
  `" 1234 "`→`"1234"`, `" #1234 "`→`"1234"`, `""`→`undefined`, `"abc"`→`undefined`,
  `"12a3"`→`undefined`, `"#"`→`undefined`, `"##12"`→`undefined`. Uses the
  `vi.mock('vscode')` pattern if the import chain requires it (the parser itself
  is vscode-free).

No `codev-skeleton/` mirror: this is VSCode-extension product code (single
source), not a framework doc/template/protocol.

## Risks & Alternatives Considered

- **Risk: `Cmd+K I` near-collision with `Cmd+K Cmd+I` (`showHover`).** These are
  distinct chords in VS Code's grammar (release-vs-hold of `Cmd` differentiates),
  same as Codev's existing `Cmd+K B` near-collision with `setSelectionAnchor`.
  Mitigation: none needed; documented precedent. Users can rebind.
- **Risk: keybinding conflicts with a user's personal binding.** Shipping a
  default matches the `Cmd+K B` / `Cmd+K A`-family precedent; users override in
  `keybindings.json`. Accepted.
- **Alternative: re-fetch in the new command to print a precise "not found"
  message.** Rejected — double-fetch + can't actually distinguish 404 from
  forge-down; delegating keeps one source of truth. (Revisitable at gate
  decision #2.)
- **Alternative: route PRs (decision #4).** Deferred — see below.

## Plan-gate decisions (recommendations to lock at `plan-approval`)

1. **Input validation shape.** Recommend: numeric + single optional leading `#`,
   trimmed. No URL parsing in v1 (follow-up if users paste links).
2. **Not-found message.** Recommend: delegate to `viewBacklogIssue` and keep its
   existing honest warning, rather than assert "not found in this repository"
   (the contract can't distinguish 404 from forge-down). If you want a distinct
   message, the alternative is a pre-fetch in the new command (one extra GET) —
   say so and I'll implement that instead.
3. **Cross-repo (`owner/repo#1234`).** Recommend: no for v1; same-repo only.
4. **Accept PR numbers too.** Recommend: **no for v1 — issues only.** The open
   path is `/api/issue`; routing PRs cleanly needs a separate viewer surface and
   PR/issue disambiguation. The issue leans "yes" but lists PR reverse-lookup
   under Out of Scope ("if accepted"). Keeps v1 at the ~60-100 LOC target. If you
   want PRs in v1, I'll scope a follow-on in the implement phase.
5. **Keybinding default vs opt-in.** Recommend: ship `Cmd+K I` / `Ctrl+K I` as
   default (matches `Cmd+K B` / `Cmd+K A`). Accepted.

## Test Plan

- **Unit** (`pnpm --filter @cluesmith/codev-vscode test:unit`, or from
  `packages/vscode`): `parseIssueId` table — `1234`, `#1234`, whitespace
  variants, empty, non-numeric, `#`-only, double-`#` all handled per above.
- **Build/typecheck**: `pnpm --filter ... build` (or the repo's vscode build) is green.
- **Manual (reviewer at `dev-approval`, running the worktree in VSCode):**
  - `Cmd+Shift+P` → "Codev: Open Issue by ID..." appears and runs.
  - Press `Cmd+K I` → input box appears immediately (no editor/view scoping).
  - Enter `1096` → issue #1096 preview opens in the same placement as a
    sidebar-row click / search-pick.
  - Enter `#1096` → same result (hash accepted).
  - Enter a closed/archived issue ID not in the current backlog → still opens
    (proves it's the live forge fetch, not the backlog set).
  - Enter a non-existent ID → clean warning, no exception in the dev console.
  - Enter empty / letters → input box shows live validation error, won't submit.
  - Confirm `codev.searchBacklog`, `codev.viewBacklogIssue`, `codev.openBacklogIssue`
    still work (no regression).
  - **Palette rename:** `Cmd+Shift+P` → type "Search Backlog" now shows two
    clearly-distinct entries: "Codev: Search Backlog..." (Quick Pick) and
    "Codev: Open Backlog Search Panel" (webview). The 🔍 icon in the Backlog view
    title bar still opens the panel (its tooltip now reads "Open Backlog Search
    Panel"). The panel itself behaves identically (rename was title-only).
