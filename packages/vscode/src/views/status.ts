import * as vscode from 'vscode';
import type { TunnelStatus } from '@cluesmith/codev-types';
import type { ConnectionManager } from '../connection-manager.js';
import { getPreflightState, onPreflightChange } from '../preflight/preflight.js';

export class StatusProvider implements vscode.TreeDataProvider<vscode.TreeItem> {
  private readonly changeEmitter = new vscode.EventEmitter<void>();
  readonly onDidChangeTreeData = this.changeEmitter.event;

  constructor(private connectionManager: ConnectionManager) {
    connectionManager.onStateChange(() => this.changeEmitter.fire());
    connectionManager.onSSEEvent(() => this.changeEmitter.fire());
    // The CLI row reflects preflight state, which changes independently of
    // Tower (e.g. after a recheck) — refresh on its dedicated event too.
    onPreflightChange(() => this.changeEmitter.fire());
  }

  getTreeItem(element: vscode.TreeItem): vscode.TreeItem {
    return element;
  }

  async getChildren(): Promise<vscode.TreeItem[]> {
    const items: vscode.TreeItem[] = [];
    const client = this.connectionManager.getClient();
    const state = this.connectionManager.getState();

    // Codev CLI preflight status. Driven by preflight state (not the Tower
    // connection), so it renders even when Tower is offline — exactly the
    // case where a missing / outdated CLI is the likely cause.
    items.push(this.cliRow());

    // Tower status
    const towerItem = new vscode.TreeItem(`Tower: ${state}`);
    towerItem.iconPath = state === 'connected'
      ? new vscode.ThemeIcon('check', new vscode.ThemeColor('testing.iconPassed'))
      : new vscode.ThemeIcon('circle-slash', new vscode.ThemeColor('testing.iconFailed'));
    items.push(towerItem);

    if (client && state === 'connected') {
      // Tunnel status
      try {
        const tunnel = await client.getTunnelStatus();
        if (tunnel) {
          const label = tunnel.state === 'connected'
            ? `Tunnel: ${tunnel.towerName ?? 'connected'}`
            : `Tunnel: ${tunnel.state}`;
          const tunnelItem = new vscode.TreeItem(label);
          tunnelItem.iconPath = tunnel.state === 'connected'
            ? new vscode.ThemeIcon('cloud', new vscode.ThemeColor('testing.iconPassed'))
            : new vscode.ThemeIcon('cloud-download');
          items.push(tunnelItem);
        }
      } catch { /* ignore */ }

      // Cron tasks
      try {
        const result = await client.request<{ tasks: Array<{ name: string; enabled: boolean }> }>('/api/cron/tasks');
        if (result.ok && result.data?.tasks) {
          const running = result.data.tasks.filter(t => t.enabled).length;
          const cronItem = new vscode.TreeItem(`Cron: ${result.data.tasks.length} tasks (${running} enabled)`);
          cronItem.iconPath = new vscode.ThemeIcon('clock');
          items.push(cronItem);
        }
      } catch { /* ignore */ }
    }

    return items;
  }

  /**
   * The "Codev CLI" row. A non-ok status sets a `codev-cli-<status>`
   * contextValue so package.json's inline `view/item/context` menu shows the
   * recheck button; `ok` carries no contextValue, so no button.
   */
  private cliRow(): vscode.TreeItem {
    const { status, cliVersion, towerStatus, runningVersion } = getPreflightState();
    const labelFor: Record<typeof status, string> = {
      ok: `Codev CLI: ${cliVersion ?? 'ready'}`,
      outdated: `Codev CLI: ${cliVersion ?? '?'} (outdated)`,
      missing: 'Codev CLI: not installed',
      pending: 'Codev CLI: checking…',
    };
    const item = new vscode.TreeItem(labelFor[status]);
    // #983: surface the running-Tower version alongside the installed CLI so a
    // divergence (upgraded CLI, un-restarted Tower) is visible proactively.
    const towerLine = towerStatus === 'stale' || towerStatus === 'too-old'
      ? `Running Tower: ${runningVersion ?? 'too old to report'} (restart to update)`
      : runningVersion
        ? `Running Tower: ${runningVersion}`
        : null;
    item.tooltip = [`Installed CLI: ${cliVersion ?? 'not found'}`, towerLine]
      .filter(Boolean)
      .join('\n');
    switch (status) {
      case 'ok':
        item.iconPath = new vscode.ThemeIcon('check', new vscode.ThemeColor('testing.iconPassed'));
        break;
      case 'outdated':
        item.iconPath = new vscode.ThemeIcon('warning', new vscode.ThemeColor('testing.iconQueued'));
        item.contextValue = 'codev-cli-outdated';
        break;
      case 'missing':
        item.iconPath = new vscode.ThemeIcon('error', new vscode.ThemeColor('testing.iconFailed'));
        item.contextValue = 'codev-cli-missing';
        break;
      case 'pending':
        item.iconPath = new vscode.ThemeIcon('sync~spin');
        break;
    }
    return item;
  }
}
