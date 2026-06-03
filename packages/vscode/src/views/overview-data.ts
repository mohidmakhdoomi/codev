import * as vscode from 'vscode';
import type { OverviewData } from '@cluesmith/codev-types';
import type { ConnectionManager } from '../connection-manager.js';

/**
 * Shared cache for /api/overview data.
 * Refreshed on SSE events, consumed by all Work View TreeDataProviders.
 *
 * Holds last-known-good data: a transient read — the connection not being
 * `connected`, or a failed `/api/overview` fetch — never overwrites populated
 * data with null. Each data-bearing provider (Builders / Backlog / Pull
 * Requests / Recently Closed) renders a falsy cache read as an empty list, so
 * nulling the cache on a brief SSE drop or reconnect blanked all four views at
 * once until the next event re-populated them (#916). Retaining the last value
 * keeps the views stable across the blip. A genuinely empty workspace still
 * renders empty: `TowerClient.getOverview()` returns null only on request
 * failure, never for a valid-but-empty overview.
 *
 * Freshen-on-reconnect is handled by the extension's own
 * `connectionManager.onStateChange('connected') -> overviewCache.refresh()`
 * wiring (see `extension.ts`), so this class only needs to react to SSE
 * events — it does not subscribe to state changes itself, to avoid a duplicate
 * refresh on every reconnect.
 */
export class OverviewCache {
  private data: OverviewData | null = null;
  private latestSeq = 0;

  private readonly changeEmitter = new vscode.EventEmitter<void>();
  readonly onDidChange = this.changeEmitter.event;

  private readonly subscriptions: vscode.Disposable[] = [];

  constructor(private connectionManager: ConnectionManager) {
    // Refresh on every non-heartbeat SSE event.
    this.subscriptions.push(
      connectionManager.onSSEEvent(() => { this.refresh(); }),
    );
  }

  getData(): OverviewData | null {
    return this.data;
  }

  /**
   * Fetch the latest overview from Tower and notify subscribers.
   *
   * Last-write-wins via a sequence counter rather than a load gate: every
   * call increments `latestSeq` and only commits its result if the seq is
   * still current. This guarantees the cache reflects the most-recently
   * requested state even when SSE bursts (e.g. `porch done --pr` →
   * `porch done --merged` → `afx cleanup`) trigger several refreshes back-
   * to-back. A naive `if (loading) return` gate drops requests #2 and #3
   * and freezes the cache on the mid-transition state from request #1
   * until something else triggers an SSE event — the bug this fixes.
   * Cost: N rapid events → N parallel `/api/overview` requests; on
   * localhost-Tower that's negligible.
   *
   * Transient reads never clobber last-known-good: a not-`connected` state (or
   * absent client) returns without touching the cache, and a failed fetch
   * (null result) is likewise ignored. Only a successful fetch — including a
   * valid empty overview — commits a new value and fires the change event.
   */
  async refresh(): Promise<void> {
    const mySeq = ++this.latestSeq;
    const client = this.connectionManager.getClient();
    if (!client || this.connectionManager.getState() !== 'connected') {
      // Transient (disconnected / reconnecting) — keep last-known-good rather
      // than emptying every data view.
      return;
    }

    const workspacePath = this.connectionManager.getWorkspacePath();
    const result = await client.getOverview(workspacePath ?? undefined);
    if (mySeq !== this.latestSeq) { return; }
    if (!result) {
      // Failed fetch — keep last-known-good.
      return;
    }
    this.data = result;
    this.changeEmitter.fire();
  }

  dispose(): void {
    for (const sub of this.subscriptions) { sub.dispose(); }
    this.changeEmitter.dispose();
  }
}
