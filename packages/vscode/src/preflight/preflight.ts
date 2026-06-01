/**
 * Startup CLI preflight (#791) — vscode glue around the pure logic in
 * `preflight-core.ts`.
 *
 * On activation the extension fires `runPreflight` (fire-and-forget) to verify
 * the `codev` CLI is installed and at least as new as the extension itself
 * (the extension's own `package.json` `version` is the source of truth). The
 * result is cached for the session; the command guard in `extension.ts` reads
 * it via `isCliReady`. Depending on the outcome we either open the
 * `Get started with Codev` walkthrough (missing CLI), show an upgrade
 * notification (outdated CLI), or do nothing (ok).
 *
 * A single `codev.recheckCli` command re-runs the whole flow; it is surfaced
 * from the Status-view row, the post-install follow-up toast, and the
 * walkthrough's Verify step.
 */

import * as vscode from 'vscode';
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import {
  decidePreflight,
  parseCliVersion,
  resolveCodevPath,
  type PreflightStatus,
} from './preflight-core.js';

/** Fully-qualified walkthrough id: `<publisher>.<name>#<walkthroughId>`. */
const WALKTHROUGH_ID = 'cluesmith.codev-vscode#codevGettingStarted';
/** workspaceState key gating the once-per-workspace auto-open of the walkthrough. */
const WALKTHROUGH_SHOWN_KEY = 'codev.preflight.walkthroughShown';
/** Install docs surfaced from the outdated-CLI notification and walkthrough. */
export const INSTALL_DOCS_URL = 'https://github.com/cluesmith/codev#installation';
/** Hard cap on the `codev --version` probe so a hung binary can't stall startup. */
const VERSION_TIMEOUT_MS = 400;
/** The command users / UI invoke to re-verify after fixing the CLI. */
export const RECHECK_COMMAND = 'codev.recheckCli';

/** What the Status-view row renders. */
export interface PreflightState {
  status: PreflightStatus | 'pending';
  cliVersion: string | null;
}

let cachedStatus: PreflightStatus | 'pending' = 'pending';
let cachedVersion: string | null = null;
let setupToastShown = false;

/** Dependencies captured on the first `runPreflight`, reused by recheck / button handlers. */
let deps: {
  context: vscode.ExtensionContext;
  workspacePath: string | null;
  outputChannel: vscode.OutputChannel;
} | null = null;

const changeEmitter = new vscode.EventEmitter<void>();
/** Fires whenever the cached preflight state changes (drives the Status-view row). */
export const onPreflightChange = changeEmitter.event;

/** Current cached preflight state, for the Status-view row. */
export function getPreflightState(): PreflightState {
  return { status: cachedStatus, cliVersion: cachedVersion };
}

/**
 * Whether CLI-dependent commands may run. Optimistic: `pending` (preflight
 * hasn't finished its <400ms background probe yet) counts as ready so a
 * command fired during the startup window isn't falsely blocked.
 */
export function isCliReady(): boolean {
  return cachedStatus === 'ok' || cachedStatus === 'pending';
}

/**
 * Spawn `codev --version` with a hard timeout. Resolves `{ ok, stdout }`;
 * `ok` is false on spawn error (binary not on PATH), non-zero exit, or
 * timeout (the child is killed).
 */
function runCodevVersion(
  codevPath: string,
  cwd: string | null,
  timeoutMs = VERSION_TIMEOUT_MS,
): Promise<{ ok: boolean; stdout: string }> {
  return new Promise((resolveResult) => {
    let stdout = '';
    let settled = false;
    const finish = (ok: boolean) => {
      if (!settled) {
        settled = true;
        resolveResult({ ok, stdout });
      }
    };

    let child: ReturnType<typeof spawn>;
    try {
      child = spawn(codevPath, ['--version'], { cwd: cwd ?? undefined });
    } catch {
      finish(false);
      return;
    }

    const timer = setTimeout(() => {
      try { child.kill(); } catch { /* already gone */ }
      finish(false);
    }, timeoutMs);

    child.stdout?.on('data', (d: Buffer) => { stdout += d.toString(); });
    child.on('error', () => { clearTimeout(timer); finish(false); });
    child.on('close', (code) => { clearTimeout(timer); finish(code === 0); });
  });
}

/**
 * Resolve → probe → decide → cache → dispatch UX. Shared by activation
 * (`runPreflight`) and the recheck command (`recheckCli`).
 */
async function performPreflight(): Promise<PreflightStatus> {
  if (!deps) {
    return 'missing';
  }
  const { context, workspacePath, outputChannel } = deps;
  const extVersion = context.extension.packageJSON.version as string;

  const codevPath = resolveCodevPath(workspacePath, existsSync);
  const { ok, stdout } = await runCodevVersion(codevPath, workspacePath);
  const cliVersion = parseCliVersion(stdout);
  const status = decidePreflight({ cliFound: ok, cliVersion, extVersion });

  cachedStatus = status;
  cachedVersion = cliVersion;
  changeEmitter.fire();

  // Drives the `Get started with Codev` walkthrough's Verify step completion
  // (`onContext:codev.cliReady`) — so the step ticks only when the CLI is
  // genuinely OK, not merely when a recheck was attempted.
  vscode.commands.executeCommand('setContext', 'codev.cliReady', status === 'ok');

  outputChannel.appendLine(
    `[${new Date().toISOString()}] [Preflight] status=${status} `
    + `cli=${cliVersion ?? 'none'} ext=${extVersion}`,
  );

  if (status === 'missing') {
    maybeOpenWalkthrough(context);
  } else if (status === 'outdated') {
    showOutdatedNotification(cliVersion, extVersion);
  }
  return status;
}

/**
 * Activation entry point. Fire-and-forget — never awaited in `activate` — so
 * activation isn't blocked. Captures deps for later recheck / button handlers.
 */
export async function runPreflight(
  context: vscode.ExtensionContext,
  workspacePath: string | null,
  outputChannel: vscode.OutputChannel,
): Promise<void> {
  deps = { context, workspacePath, outputChannel };
  await performPreflight();
}

/**
 * Re-verify after the user (claims to have) fixed the CLI. Clears the cache,
 * re-runs the flow, and confirms success with a toast. The single re-verify
 * path that every recheck affordance funnels through.
 */
export async function recheckCli(): Promise<void> {
  if (!deps) {
    return;
  }
  cachedStatus = 'pending';
  changeEmitter.fire();
  const status = await performPreflight();
  if (status === 'ok') {
    setupToastShown = false; // a fresh problem later should be allowed to re-toast
    vscode.window.showInformationMessage(
      `Codev: CLI ready — codev ${cachedVersion ?? ''}`.trim(),
    );
  }
}

/** Open the walkthrough automatically, but only once per workspace. */
function maybeOpenWalkthrough(context: vscode.ExtensionContext): void {
  if (context.workspaceState.get<boolean>(WALKTHROUGH_SHOWN_KEY, false)) {
    return;
  }
  context.workspaceState.update(WALKTHROUGH_SHOWN_KEY, true);
  openWalkthrough();
}

function openWalkthrough(): void {
  vscode.commands.executeCommand('workbench.action.openWalkthrough', WALKTHROUGH_ID, false);
}

/**
 * Rich notification for an outdated CLI: one-click upgrade, docs, or dismiss.
 */
function showOutdatedNotification(cliVersion: string | null, extVersion: string): void {
  const message = `Codev CLI ${cliVersion ?? '(unknown)'} is older than the extension `
    + `(${extVersion}). Update to avoid compatibility issues.`;
  vscode.window
    .showWarningMessage(message, 'Update via npm', 'Open Install Docs', 'Dismiss')
    .then((choice) => {
      if (choice === 'Update via npm') {
        updateViaNpm();
      } else if (choice === 'Open Install Docs') {
        vscode.env.openExternal(vscode.Uri.parse(INSTALL_DOCS_URL));
      }
    });
}

/**
 * Run the global install in an integrated terminal, then re-verify once that
 * specific terminal closes with a success exit code. A failed / cancelled
 * install does not silently re-cache — it surfaces an explicit Recheck toast.
 */
function updateViaNpm(): void {
  const terminal = vscode.window.createTerminal({ name: 'Codev: Update CLI' });
  terminal.show();
  terminal.sendText('npm install -g @cluesmith/codev');

  const listener = vscode.window.onDidCloseTerminal((closed) => {
    if (closed !== terminal) {
      return; // instance-matched: ignore every other terminal
    }
    listener.dispose();
    if (closed.exitStatus?.code === 0) {
      recheckCli();
    } else {
      vscode.window
        .showWarningMessage('Codev: CLI update did not complete. Recheck once installed.', 'Recheck')
        .then((choice) => { if (choice === 'Recheck') { recheckCli(); } });
    }
  });
  deps?.context.subscriptions.push(listener);
}

/**
 * Shown the first time a guarded command is invoked while the CLI is
 * unresolved. Single-per-session so repeated invocations don't spam.
 */
export function showSetupRequiredToast(): void {
  if (setupToastShown) {
    return;
  }
  setupToastShown = true;
  vscode.window
    .showWarningMessage('Codev: CLI not installed / outdated — run setup', 'Run Setup')
    .then((choice) => {
      if (choice !== 'Run Setup') {
        return;
      }
      if (cachedStatus === 'outdated') {
        showOutdatedNotification(cachedVersion, deps?.context.extension.packageJSON.version ?? '');
      } else {
        openWalkthrough();
      }
    });
}
