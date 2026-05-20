import * as vscode from 'vscode';
import { encodeWorkspacePath } from '@cluesmith/codev-core/workspace';
import type { ConnectionManager } from '../connection-manager.js';
import type { TerminalManager } from '../terminal-manager.js';
import { getTowerAddress } from '../workspace-detector.js';
import { resolveWorkspaceDevTarget } from '../commands/dev-shared.js';
import { readWorktreeDevUrls } from '../commands/open-dev-url.js';
import { watchCodevConfig } from '../watch-codev-config.js';

/**
 * Workspace-level entry points: architect terminal, Tower web dashboard,
 * spawn builder, and new shell. Sits at the top of the Codev sidebar so
 * common workspace actions are one click away, not buried in the palette.
 */
export class WorkspaceProvider implements vscode.TreeDataProvider<vscode.TreeItem> {
  private readonly changeEmitter = new vscode.EventEmitter<void>();
  readonly onDidChangeTreeData = this.changeEmitter.event;

  constructor(
    private connectionManager: ConnectionManager,
    private terminalManager: TerminalManager,
    context: vscode.ExtensionContext,
  ) {
    // The workspace view's rows are config-driven (Open Dev URL entries
    // from worktree.devUrls, with more to come), so any edit to
    // .codev/config.json (or its per-engineer .local.json sibling) should
    // re-render. The watching primitive lives in src/watch-codev-config.ts;
    // we just wire it up here. Lazy install: workspacePath isn't available
    // at construction because the Tower connection lands async — attempt
    // on every state change and pin via `configWatcherInstalled` the first
    // time we succeed.
    let configWatcherInstalled = false;
    const installConfigWatcherIfReady = () => {
      if (configWatcherInstalled) { return; }
      const workspacePath = connectionManager.getWorkspacePath();
      if (!workspacePath) { return; }
      configWatcherInstalled = true;
      context.subscriptions.push(
        watchCodevConfig(workspacePath, () => this.changeEmitter.fire()),
      );
    };
    connectionManager.onStateChange(() => {
      this.changeEmitter.fire();
      installConfigWatcherIfReady();
    });
    // Re-render when the dev-terminal set changes (start/stop, a swap that
    // killed this workspace's dev, or cleanup) so the conditional "Stop Dev
    // Server" row reflects reality across every path.
    terminalManager.onDidChangeDevTerminals(() => this.changeEmitter.fire());
    // Eager attempt in case workspacePath is already set (fast cached
    // connect path).
    installConfigWatcherIfReady();
  }

  getTreeItem(element: vscode.TreeItem): vscode.TreeItem {
    return element;
  }

  getChildren(): vscode.TreeItem[] {
    const items: vscode.TreeItem[] = [];

    const architect = new vscode.TreeItem('Open Architect');
    architect.iconPath = new vscode.ThemeIcon('person');
    architect.tooltip = 'Open the architect terminal';
    architect.contextValue = 'workspace-architect';
    architect.command = {
      command: 'codev.openArchitectTerminal',
      title: 'Open Architect Terminal',
    };
    items.push(architect);

    const webUrl = this.buildDashboardUrl();
    if (webUrl) {
      const web = new vscode.TreeItem('Open Web Interface');
      web.iconPath = new vscode.ThemeIcon('globe');
      web.tooltip = webUrl;
      web.contextValue = 'workspace-web';
      web.command = {
        command: 'vscode.open',
        title: 'Open Tower dashboard in browser',
        arguments: [vscode.Uri.parse(webUrl)],
      };
      items.push(web);
    }

    const spawn = new vscode.TreeItem('Spawn Builder');
    spawn.iconPath = new vscode.ThemeIcon('rocket');
    spawn.tooltip = 'Spawn a new builder for a GitHub issue';
    spawn.contextValue = 'workspace-spawn';
    spawn.command = {
      command: 'codev.spawnBuilder',
      title: 'Spawn Builder',
    };
    items.push(spawn);

    const shell = new vscode.TreeItem('New Shell');
    shell.iconPath = new vscode.ThemeIcon('terminal-new');
    shell.tooltip = 'Open a new shell tab in Tower';
    shell.contextValue = 'workspace-shell';
    shell.command = {
      command: 'codev.newShell',
      title: 'New Shell',
    };
    items.push(shell);

    // Target is whatever folder this VSCode window is rooted at: the main
    // checkout → `main`, a `.builders/<id>/` worktree → that builder. The
    // label stays generic; the tooltip names the resolved target.
    const workspacePath = this.connectionManager.getWorkspacePath();
    const devTarget = workspacePath ? resolveWorkspaceDevTarget(workspacePath) : null;

    // Mutually exclusive: show Start when no dev is running anywhere, Stop
    // when one is — regardless of which target started it. The single-slot
    // model in dev-shared.ts means listDevTerminals() has at most one entry;
    // reflect the slot's occupancy here so a dev started from a builder's
    // right-click context menu is visible/stoppable from the Workspace view
    // too. The visible control is itself the state indicator (play/stop
    // model) — never both, no row-count jitter.
    const allDevs = this.terminalManager.listDevTerminals();
    const targetDev = devTarget ? allDevs.find(d => d.builderId === devTarget.id) : undefined;
    const otherDev = !targetDev ? allDevs[0] : undefined; // single-slot ⇒ at most one

    if (targetDev) {
      // This workspace's own dev is the running one. Today's Stop row.
      const stopDev = new vscode.TreeItem('Stop Dev Server');
      stopDev.iconPath = new vscode.ThemeIcon('debug-stop');
      stopDev.tooltip = `Stop the dev server for this workspace (target: ${devTarget!.id})`;
      stopDev.contextValue = 'workspace-dev-stop';
      stopDev.command = {
        command: 'codev.stopWorkspaceDev',
        title: 'Stop Dev Server',
      };
      items.push(stopDev);
    } else if (otherDev) {
      // A dev is running, but for a different target — surface it so the
      // user can see/stop it without leaving the Workspace view. Goes
      // through codev.stopWorktreeDev which targets the dev slot directly
      // (kills every dev in the local registry; single-slot invariant
      // means that's exactly the one running).
      const stopDev = new vscode.TreeItem('Stop Dev Server');
      stopDev.iconPath = new vscode.ThemeIcon('debug-stop');
      stopDev.tooltip = `Stop the dev server (currently running for ${otherDev.builderId})`;
      stopDev.contextValue = 'workspace-dev-stop-other';
      stopDev.command = {
        command: 'codev.stopWorktreeDev',
        title: 'Stop Dev Server',
      };
      items.push(stopDev);
    } else {
      // No dev anywhere — today's Start row for this workspace's target.
      const startDev = new vscode.TreeItem('Start Dev Server');
      startDev.iconPath = new vscode.ThemeIcon('play');
      startDev.tooltip = devTarget
        ? `Run worktree.devCommand for this workspace (target: ${devTarget.id})`
        : 'Run worktree.devCommand for this workspace';
      startDev.contextValue = 'workspace-dev-start';
      startDev.command = {
        command: 'codev.runWorkspaceDev',
        title: 'Start Dev Server',
      };
      items.push(startDev);
    }

    // Open Dev URL rows: one per entry in `worktree.devUrls` (or one
    // for the legacy `worktree.devUrl`). Visible independent of dev-PTY
    // state. Opens in the user's default browser (real DevTools, real
    // cookies, real OAuth) — not the embedded Simple Browser webview.
    // Closed the tab? Click the row again for a fresh one.
    const devUrls = readWorktreeDevUrls(workspacePath);
    for (const { label, url } of devUrls) {
      const row = new vscode.TreeItem(label);
      row.iconPath = new vscode.ThemeIcon('globe');
      row.tooltip = `Open ${url} in your default browser`;
      row.contextValue = 'workspace-dev-url';
      row.command = {
        command: 'codev.openDevUrl',
        title: label,
        arguments: [url],
      };
      items.push(row);
    }

    return items;
  }

  private buildDashboardUrl(): string | null {
    const workspacePath = this.connectionManager.getWorkspacePath();
    if (!workspacePath) { return null; }
    const { host, port } = getTowerAddress();
    return `http://${host}:${port}/workspace/${encodeWorkspacePath(workspacePath)}/`;
  }
}
