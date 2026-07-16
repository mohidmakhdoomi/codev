/**
 * IDE-mode detection and the activation policy it drives (#1144).
 *
 * One codebase ships through two channels: the marketplace vsix (guest mode,
 * running inside stock VS Code / Cursor / etc.) and the same file set baked
 * into the Codev IDE fork as a built-in extension (IDE mode). The behavioral
 * split happens at runtime, keyed off `vscode.env.appName`.
 *
 * With `onStartupFinished` in activationEvents, `activate()` runs in every
 * window of every marketplace install, so which side effects may fire is a
 * safety question, not a styling one. This module is the single place that
 * question is answered: pure functions, no vscode import, unit-tested per
 * quadrant of the issue's behavior matrix.
 */

/**
 * The product name the Codev IDE fork ships in its product.json `nameLong`,
 * which VS Code surfaces to extensions as `vscode.env.appName`.
 *
 * CROSS-REPO CONTRACT with the codev-ide fork's product.json: if either side
 * changes this string, IDE mode silently dies (the extension falls back to
 * guest mode everywhere). Change it here and in the fork together, never in
 * one place. This constant is the ONLY place the extension spells the value;
 * tests import it rather than repeating the literal.
 *
 * Built-in vs marketplace-copy collision: both channels ship the same
 * extension ID, and VS Code lets a user-installed copy shadow the built-in
 * one. That is safe by design because IDE mode is detected from appName at
 * runtime, not from the install channel: a newer marketplace copy running
 * inside the Codev IDE still enters IDE mode with identical behavior.
 */
export const CODEV_IDE_APP_NAME = 'Codev';

/**
 * Environment variable that simulates IDE mode for local testing in the
 * Extension Development Host. Honored ONLY when the extension host runs in
 * ExtensionMode.Development, so it can never flip a production install.
 */
export const IDE_SIMULATION_ENV_VAR = 'CODEV_SIMULATE_IDE';

export interface IdeModeInput {
  /** `vscode.env.appName` of the running product. */
  appName: string;
  /** True when `context.extensionMode === vscode.ExtensionMode.Development`. */
  isDevelopment: boolean;
  /** Value of `process.env.CODEV_SIMULATE_IDE`, if set. */
  simulationSeam?: string;
}

/** Whether this window is running inside the Codev IDE fork. */
export function detectIdeMode(input: IdeModeInput): boolean {
  if (input.appName === CODEV_IDE_APP_NAME) {
    return true;
  }
  if (input.isDevelopment && input.simulationSeam === '1') {
    return true;
  }
  return false;
}

/**
 * The three activation tiers:
 *
 * - `full`: a codev project is present (or the `codev.workspacePath` override
 *   points at one). Today's behavior, unchanged, in guest and IDE alike.
 * - `ide-empty`: the Codev IDE with no codev workspace. Tower-level surfaces
 *   come alive (connection incl. auto-start, status bar, CLI preflight) plus
 *   the empty-window onboarding surface (container focus, first-run).
 * - `dormant`: guest mode with no codev workspace. Must remain exactly as
 *   inert as if activation had never fired: no Tower process, no UI mutation,
 *   no state writes. Commands and providers still register (registration is
 *   invisible, and palette invocations must degrade gracefully rather than
 *   error with "command not found").
 */
export type ActivationTier = 'full' | 'ide-empty' | 'dormant';

export function decideActivationTier(input: {
  ideMode: boolean;
  hasCodevWorkspace: boolean;
}): ActivationTier {
  if (input.hasCodevWorkspace) {
    return 'full';
  }
  if (input.ideMode) {
    return 'ide-empty';
  }
  return 'dormant';
}

/**
 * The side-effect switchboard `activate()` consumes. Each flag corresponds to
 * one concrete side effect in extension.ts; the dormant column being all-false
 * is the marketplace-inertness guarantee, provable in unit tests.
 */
export interface ActivationPolicy {
  /** `connectionManager.initialize()`: Tower connect + auto-start. */
  initializeConnection: boolean;
  /** CLI preflight probe (child process; may open the walkthrough). */
  runPreflight: boolean;
  /** One-time bottom-panel reveal nudge (focus steal + globalState write). */
  revealPanelOnce: boolean;
  /** The connection status-bar item. */
  showStatusBar: boolean;
  /** Housekeeping workspaceState deletions from earlier releases. */
  writeCleanupState: boolean;
  /** Focus the Codev view container on startup (IDE empty window only). */
  focusCodevContainer: boolean;
  /** One-time IDE first-run: welcome notification + walkthrough. */
  ideFirstRun: boolean;
}

export function activationPolicy(tier: ActivationTier): ActivationPolicy {
  const towerLevel = tier !== 'dormant';
  const ideEmpty = tier === 'ide-empty';
  return {
    initializeConnection: towerLevel,
    runPreflight: towerLevel,
    revealPanelOnce: towerLevel,
    showStatusBar: towerLevel,
    writeCleanupState: towerLevel,
    focusCodevContainer: ideEmpty,
    ideFirstRun: ideEmpty,
  };
}
