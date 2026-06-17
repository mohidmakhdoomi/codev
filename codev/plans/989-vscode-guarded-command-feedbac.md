# PIR Plan: Guarded-command feedback — modal-first / ephemeral-after

## Understanding

When the CLI preflight (#791) decides the environment is `missing` or `outdated`, the
**first** click on any of the 15 `regCli`-guarded commands shows a modal warning toast
with a `Run Setup` action. Every subsequent click in the same session is **silent**: the
`setupToastShown` one-shot flag at `packages/vscode/src/preflight/preflight.ts:244-248`
short-circuits `showSetupRequiredToast`, so the guard rejects the click with no signal.

The flag was meant to stop modal spam, but it overshot to *zero* feedback. After the first
click the user can't tell a silent no-op apart from a missed click, a hung extension, or a
command that ran invisibly. The fix is **attenuated** feedback, not absent feedback:

- **First** bad-state click in a session: keep today's modal warning toast (`Run Setup`).
- **Subsequent** bad-state clicks: show an ephemeral status-bar message
  (`vscode.window.setStatusBarMessage(text, ms)`) — visible, co-located with the action,
  no modal interrupt, auto-dismissing after a few seconds.

The flag-reset semantics stay: when `recheckCli` confirms `ok`, the session counter resets,
so a fresh breakage later restarts the modal-first pattern (`preflight.ts:176-181`).

This issue also lays a **reusable helper** (`showPreflightFeedback`) so #983 (Tower
running-vs-installed version divergence) can reuse the modal-first / ephemeral-after
dispatch instead of re-inventing the suppression logic.

## Proposed Change

Follow the existing split in this module: pure, vscode-free logic lives in
`preflight-core.ts` (unit-tested by `preflight-core.test.ts`); vscode glue lives in
`preflight.ts`.

### 1. `preflight-core.ts` — pure wording derivation (new, unit-tested)

Add a pure function that maps a bad preflight status to the ephemeral message text:

```ts
/** Ephemeral status-bar text for a non-ok preflight status. */
export function preflightFeedbackMessage(status: PreflightStatus): string {
  const label = status === 'outdated' ? 'outdated' : 'not installed';
  return `Codev: CLI ${label}. Run "Codev: Recheck CLI" when ready.`;
}
```

Keeping this pure means the wording (the part #983 will extend with a Tower dimension) is
testable without a vscode mock, matching how `decidePreflight` / `parseCliVersion` are tested.

(Note on copy: the issue's example uses an em dash; I use a period + quoted command name
instead, both to satisfy the project's no-em-dash convention and to name the recovery
command precisely. Functionally identical.)

### 2. `preflight.ts` — the reusable dispatch helper

Replace `showSetupRequiredToast` with `showPreflightFeedback`, and rename the session flag
to reflect its new meaning (modal-shown, not toast-shown):

```ts
let modalShownThisSession = false;

/**
 * Point-of-action feedback when a guarded command is rejected because the CLI
 * is missing / outdated. First call this session: modal warning toast with a
 * `Run Setup` action. Subsequent calls: ephemeral status-bar message. Resets
 * when `recheckCli` confirms `ok`. Reusable by #983 for the Tower-version
 * dimension.
 */
export function showPreflightFeedback(): void {
  if (!modalShownThisSession) {
    modalShownThisSession = true;
    vscode.window
      .showWarningMessage('Codev: CLI not installed / outdated — run setup', 'Run Setup')
      .then((choice) => {
        if (choice !== 'Run Setup') return;
        if (cachedStatus === 'outdated') {
          showOutdatedNotification(cachedVersion, deps?.context.extension.packageJSON.version ?? '');
        } else {
          openWalkthrough();
        }
      });
    return;
  }
  vscode.window.setStatusBarMessage(preflightFeedbackMessage(cachedStatus as PreflightStatus), 4000);
}
```

- The modal branch is byte-for-byte today's `showSetupRequiredToast` body (acceptance:
  "unchanged from today"), so the `Run Setup` routing to walkthrough / outdated-notification
  is preserved.
- The ephemeral branch is the only new behavior. 4000ms matches the issue's "around 3-4
  seconds".
- `cachedStatus` is guaranteed non-ok here because the guard only calls this helper when
  `isCliReady()` is false (i.e. `missing` or `outdated`), so the `PreflightStatus` cast is safe.

### 3. Flag reset

Rename `setupToastShown = false` → `modalShownThisSession = false` at `preflight.ts:177`
inside the `recheckCli` `status === 'ok'` branch. Semantics unchanged.

### 4. `extension.ts` — call the renamed helper

Update the import (`preflight.ts:49`) and the `guard` body (`extension.ts:528`) from
`showSetupRequiredToast()` to `showPreflightFeedback()`. No other call sites exist
(verified by grep: only `extension.ts` imports it).

### Why a no-arg helper rather than `showPreflightFeedback(state)`

The issue's suggested signature takes a `PreflightState`. In this module the CLI state is
already module-level (`cachedStatus` / `cachedVersion`), and the existing
`showSetupRequiredToast` reads it directly, so a no-arg helper matches the current style and
keeps the single source of truth. #983 introduces a *second* dimension (Tower version) that
is not module-level here; when it lands, the helper gains a small discriminator argument
(e.g. `showPreflightFeedback(dimension)`) and `preflightFeedbackMessage` gains a Tower branch.
The pure-wording-in-core + flag-driven-dispatch structure is the reusable foundation #983
needs; pre-adding the parameter now would be speculative shape with one caller. This is
called out so the reviewer can object if they want the parameter wired in immediately.

## Files to Change

- `packages/vscode/src/preflight/preflight-core.ts` — add pure `preflightFeedbackMessage(status)`.
- `packages/vscode/src/preflight/preflight.ts:47` — rename `setupToastShown` → `modalShownThisSession`.
- `packages/vscode/src/preflight/preflight.ts:177` — rename in the reset.
- `packages/vscode/src/preflight/preflight.ts:240-261` — replace `showSetupRequiredToast` with
  `showPreflightFeedback` (modal-first / ephemeral-after); import `preflightFeedbackMessage`.
- `packages/vscode/src/extension.ts:49` — update import name.
- `packages/vscode/src/extension.ts:528` — call `showPreflightFeedback()`.
- `packages/vscode/src/__tests__/preflight-core.test.ts` — add cases for `preflightFeedbackMessage`.

## Risks & Alternatives Considered

- **Risk: status-bar messages are easy to miss.** Mitigation: the modal still fires first
  (highest-salience moment — first discovery of the bad state); the ephemeral message is the
  deliberately-attenuated follow-up. The persistent Status row from #791 remains the
  always-visible surface. This issue is explicitly *not* adding a new persistent indicator.
- **Risk: the `PreflightStatus` cast on `cachedStatus`.** Mitigation: the guard only invokes
  the helper when `isCliReady()` is false, which excludes `ok` and `pending`. If that
  invariant ever changes, `preflightFeedbackMessage` still returns the "not installed" string
  for any non-`outdated` value, so the worst case is slightly-wrong copy, never a crash.
- **Alternative: keep `showSetupRequiredToast` as a thin wrapper around the new helper.**
  Rejected — only one caller (`extension.ts`), so renaming in place is cleaner than carrying a
  deprecated alias. The issue explicitly allows "merges into the helper".
- **Alternative: pass `PreflightState` into the helper now (issue's literal signature).**
  Deferred to #983 (see "Why a no-arg helper" above); flagged for reviewer override.
- **Alternative: a status-bar message with a `Run Setup` action.** Not possible —
  `setStatusBarMessage` takes only text + timeout, no actions. That's acceptable: the modal
  already offered the action, and `Codev: Recheck CLI` is named in the ephemeral text.

## Test Plan

- **Unit (`preflight-core.test.ts`)**: `preflightFeedbackMessage('outdated')` contains
  "outdated"; `preflightFeedbackMessage('missing')` contains "not installed"; both name
  `Codev: Recheck CLI`. Run via `pnpm --filter @cluesmith/codev-vscode test` (or the package's
  vitest script).
- **Build / lint**: `pnpm --filter @cluesmith/codev-vscode build` and the package lint to
  confirm the rename has no dangling references.
- **Manual (at the `dev-approval` gate, in the Extension Development Host)**: with a `missing`
  or `outdated` CLI state —
  1. First click on a guarded command (e.g. *Spawn Builder*) → modal toast with `Run Setup`.
  2. Second + third clicks → brief status-bar message naming the state and `Codev: Recheck CLI`,
     no modal.
  3. Run `Codev: Recheck CLI` while still broken → still status-bar on next click (no `ok`,
     no reset).
  4. Fix the CLI, run `Codev: Recheck CLI` → `ok` info toast; next breakage restarts at the
     modal.
  5. Happy path: with `ok`/`pending`, guarded commands run normally, zero feedback noise.
- **Cross-platform**: n/a (VSCode-host behavior only).
