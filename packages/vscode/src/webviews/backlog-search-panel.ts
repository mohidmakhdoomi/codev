/**
 * Codev: Search Backlog (#920) — an editor-tab `WebviewPanel` for rich,
 * exploratory backlog triage. Complements the always-on sidebar tree and the
 * Quick Pick (#918): this surface persists, lets you filter by Area /
 * Assignee / Author, substring-search title + body, sort columns, and refine
 * without re-opening.
 *
 * Architecture:
 * - **Single instance.** `createOrShow` focuses the existing panel rather than
 *   stacking duplicates.
 * - **Data via Tower.** The body-bearing dataset comes from
 *   `TowerClient.searchBacklog` (GET /api/backlog-search), fetched on open, on
 *   `OverviewCache` heartbeats (throttled), and whenever the Status dropdown
 *   changes (the one criterion the server resolves).
 * - **Filtering is host-side.** The webview posts criteria; this class runs the
 *   pure `searchBacklog` helper and posts back only display rows. Issue body
 *   never crosses into the webview.
 * - **Theme-aware.** The HTML uses `--vscode-*` CSS variables only — no
 *   hand-coded colors — so dark / light / high-contrast all render natively.
 */

import * as vscode from 'vscode';
import type { BacklogSearchItem } from '@cluesmith/codev-types';
import type { ConnectionManager } from '../connection-manager.js';
import type { OverviewCache } from '../views/overview-data.js';
import {
  searchBacklog,
  formatAge,
  type BacklogSearchCriteria,
  type BacklogSortColumn,
} from '../views/backlog-filter.js';

type IssueState = 'open' | 'closed' | 'all';

const REFRESH_THROTTLE_MS = 30_000;
/** gh issue list is hard-capped at 200; surfaced in the footer so the cap isn't silent. */
const SOURCE_CAP = 200;

/** A single display row sent to the webview — deliberately body-free. */
interface ResultRow {
  id: string;
  title: string;
  area: string;
  assignee: string;
  age: string;
}

export class BacklogSearchPanel {
  public static readonly viewType = 'codev.backlogSearch';
  private static current: BacklogSearchPanel | undefined;

  private readonly disposables: vscode.Disposable[] = [];
  private dataset: BacklogSearchItem[] = [];
  private currentUser: string | undefined;
  private state: IssueState = 'open';
  private criteria: BacklogSearchCriteria = {};
  private lastRefreshAt = 0;
  private loadError: string | undefined;

  static createOrShow(
    connectionManager: ConnectionManager,
    overviewCache: OverviewCache,
    extensionUri: vscode.Uri,
  ): void {
    // Anchor "Beside" to group 1 so the panel reuses a single editor group on
    // repeated invocations (same reasoning as view-issue.ts's preview).
    if (BacklogSearchPanel.current) {
      BacklogSearchPanel.current.panel.reveal(vscode.ViewColumn.Beside);
      return;
    }
    const panel = vscode.window.createWebviewPanel(
      BacklogSearchPanel.viewType,
      'Search Backlog',
      vscode.ViewColumn.Beside,
      { enableScripts: true, retainContextWhenHidden: true, localResourceRoots: [extensionUri] },
    );
    BacklogSearchPanel.current = new BacklogSearchPanel(panel, connectionManager, overviewCache);
  }

  private constructor(
    private readonly panel: vscode.WebviewPanel,
    private readonly connectionManager: ConnectionManager,
    private readonly overviewCache: OverviewCache,
  ) {
    this.panel.webview.html = this.html();

    this.panel.onDidDispose(() => this.dispose(), null, this.disposables);
    this.panel.webview.onDidReceiveMessage(
      (msg) => this.onMessage(msg),
      null,
      this.disposables,
    );
    // Keep an open panel fresh as backlog state changes, but throttle the
    // SSE/poll burst the same way view-issue.ts does.
    this.overviewCache.onDidChange(() => this.refreshThrottled(), null, this.disposables);

    void this.fetchAndRender();
  }

  private async refreshThrottled(): Promise<void> {
    const now = Date.now();
    if (now - this.lastRefreshAt < REFRESH_THROTTLE_MS) { return; }
    this.lastRefreshAt = now;
    await this.fetchAndRender();
  }

  /** Fetch the dataset for the current Status from Tower, then re-render. */
  private async fetchAndRender(): Promise<void> {
    this.lastRefreshAt = Date.now();
    const client = this.connectionManager.getClient();
    const workspacePath = this.connectionManager.getWorkspacePath();
    if (!client || !workspacePath || this.connectionManager.getState() !== 'connected') {
      this.loadError = 'Not connected to Tower';
      this.dataset = [];
      this.currentUser = undefined;
      this.postDataset();
      this.postResults();
      return;
    }
    const response = await client.searchBacklog(workspacePath, this.state);
    if (!response) {
      this.loadError = 'Could not load backlog (forge unavailable?)';
      this.dataset = [];
    } else {
      this.loadError = response.error;
      this.dataset = response.items;
      this.currentUser = response.currentUser;
    }
    this.postDataset();
    this.postResults();
  }

  private onMessage(msg: unknown): void {
    if (!msg || typeof msg !== 'object') { return; }
    const m = msg as { type?: string; criteria?: BacklogSearchCriteria; state?: string; id?: string };
    switch (m.type) {
      case 'criteria':
        this.criteria = m.criteria ?? {};
        this.postResults();
        return;
      case 'state':
        this.state = m.state === 'closed' || m.state === 'all' ? m.state : 'open';
        void this.fetchAndRender();
        return;
      case 'refresh':
        void this.fetchAndRender();
        return;
      case 'open':
        if (m.id) { void vscode.commands.executeCommand('codev.viewBacklogIssue', m.id); }
        return;
    }
  }

  /** Send the dropdown facets (distinct areas/assignees/authors) + currentUser. */
  private postDataset(): void {
    const areas = [...new Set(this.dataset.map(i => i.area))].sort((a, b) => a.localeCompare(b));
    const assignees = [...new Set(this.dataset.flatMap(i => i.assignees ?? []))]
      .sort((a, b) => a.localeCompare(b));
    const authors = [...new Set(this.dataset.map(i => i.author).filter((a): a is string => !!a))]
      .sort((a, b) => a.localeCompare(b));
    void this.panel.webview.postMessage({
      type: 'dataset',
      areas,
      assignees,
      authors,
      currentUser: this.currentUser ?? null,
      total: this.dataset.length,
      capped: this.dataset.length >= SOURCE_CAP,
      error: this.loadError ?? null,
    });
  }

  /** Run the host-side filter/sort and send display rows. */
  private postResults(): void {
    const matched = searchBacklog(this.dataset, { ...this.criteria, currentUser: this.currentUser });
    const now = Date.now();
    const rows: ResultRow[] = matched.map(i => ({
      id: i.id,
      title: i.title,
      area: i.area,
      assignee: i.assignees?.[0] ?? '',
      age: formatAge(i.createdAt, now),
    }));
    void this.panel.webview.postMessage({ type: 'results', rows });
  }

  private dispose(): void {
    BacklogSearchPanel.current = undefined;
    while (this.disposables.length) {
      this.disposables.pop()?.dispose();
    }
  }

  private html(): string {
    const nonce = getNonce();
    const cspSource = this.panel.webview.cspSource;
    const csp = [
      `default-src 'none'`,
      `style-src ${cspSource} 'unsafe-inline'`,
      `script-src 'nonce-${nonce}'`,
    ].join('; ');
    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta http-equiv="Content-Security-Policy" content="${csp}" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Search Backlog</title>
  <style>
    body {
      font-family: var(--vscode-font-family);
      font-size: var(--vscode-font-size);
      color: var(--vscode-foreground);
      background: var(--vscode-editor-background);
      padding: 0 12px 12px;
    }
    h1 { font-size: 1.2em; font-weight: 600; margin: 12px 0; }
    .row { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; margin-bottom: 8px; }
    label { font-size: 0.85em; opacity: 0.85; }
    select, input, button {
      font-family: inherit; font-size: inherit;
      color: var(--vscode-input-foreground);
      background: var(--vscode-input-background);
      border: 1px solid var(--vscode-input-border, transparent);
      border-radius: 2px; padding: 3px 6px;
    }
    input#q { flex: 1 1 220px; min-width: 160px; }
    button {
      color: var(--vscode-button-foreground);
      background: var(--vscode-button-background);
      border: none; cursor: pointer; padding: 4px 12px;
    }
    button:hover { background: var(--vscode-button-hoverBackground); }
    table { width: 100%; border-collapse: collapse; margin-top: 8px; }
    th, td {
      text-align: left; padding: 4px 8px;
      border-bottom: 1px solid var(--vscode-editorWidget-border, var(--vscode-panel-border, transparent));
      white-space: nowrap;
    }
    th { cursor: pointer; user-select: none; font-weight: 600; }
    th:hover { color: var(--vscode-textLink-foreground); }
    td.title { white-space: normal; }
    td.num, th.num { text-align: right; font-variant-numeric: tabular-nums; }
    tbody tr { cursor: pointer; }
    tbody tr:hover { background: var(--vscode-list-hoverBackground); }
    .area-tag { opacity: 0.8; }
    footer { margin-top: 10px; font-size: 0.85em; opacity: 0.8; }
    .error { color: var(--vscode-errorForeground); }
    .empty { opacity: 0.7; padding: 16px 8px; }
  </style>
</head>
<body>
  <h1>Search Backlog</h1>
  <div class="row">
    <label>Area <select id="area"><option value="">All</option></select></label>
    <label>Assignee <select id="assignee">
      <option value="">All</option>
      <option value="me">Me</option>
      <option value="unassigned">Unassigned</option>
    </select></label>
    <label>Author <select id="author">
      <option value="">Anyone</option>
      <option value="me">Me</option>
    </select></label>
  </div>
  <div class="row">
    <input id="q" type="text" placeholder="Search title and body…" />
    <label>Status <select id="status">
      <option value="open">Open</option>
      <option value="closed">Closed</option>
      <option value="all">All</option>
    </select></label>
    <button id="search">Search</button>
  </div>
  <div id="status-line" class="error"></div>
  <table>
    <thead>
      <tr>
        <th class="num" data-col="id">#</th>
        <th data-col="title">Title</th>
        <th data-col="area">Area</th>
        <th data-col="assignee">Assignee</th>
        <th data-col="age">Age</th>
      </tr>
    </thead>
    <tbody id="rows"></tbody>
  </table>
  <div id="empty" class="empty" hidden>No matching issues.</div>
  <footer id="footer"></footer>
  <script nonce="${nonce}">
    const vscode = acquireVsCodeApi();
    let sortCol = 'age';
    let sortDir = 'desc';
    let lastRows = [];

    const $ = (id) => document.getElementById(id);
    const area = $('area'), assignee = $('assignee'), author = $('author');
    const q = $('q'), status = $('status');

    function criteria() {
      return {
        text: q.value,
        area: area.value,
        assignee: assignee.value,
        author: author.value,
        sort: sortCol,
        direction: sortDir,
      };
    }
    function postCriteria() { vscode.postMessage({ type: 'criteria', criteria: criteria() }); }

    let debounce;
    q.addEventListener('input', () => {
      clearTimeout(debounce);
      debounce = setTimeout(postCriteria, 150);
    });
    $('search').addEventListener('click', postCriteria);
    q.addEventListener('keydown', (e) => { if (e.key === 'Enter') { clearTimeout(debounce); postCriteria(); } });
    area.addEventListener('change', postCriteria);
    assignee.addEventListener('change', postCriteria);
    author.addEventListener('change', postCriteria);
    status.addEventListener('change', () => vscode.postMessage({ type: 'state', state: status.value }));

    document.querySelectorAll('th[data-col]').forEach((th) => {
      th.addEventListener('click', () => {
        const col = th.getAttribute('data-col');
        if (sortCol === col) { sortDir = sortDir === 'asc' ? 'desc' : 'asc'; }
        else { sortCol = col; sortDir = col === 'age' ? 'desc' : 'asc'; }
        renderHeaders();
        postCriteria();
      });
    });

    const LABELS = { id: '#', title: 'Title', area: 'Area', assignee: 'Assignee', age: 'Age' };
    function renderHeaders() {
      document.querySelectorAll('th[data-col]').forEach((th) => {
        const col = th.getAttribute('data-col');
        const arrow = col === sortCol ? (sortDir === 'asc' ? ' ▲' : ' ▼') : '';
        th.textContent = LABELS[col] + arrow;
      });
    }

    function fillSelect(sel, values, keepLeading) {
      const prev = sel.value;
      // Remove dynamic options, keep the static leading ones (All/Me/etc.).
      while (sel.options.length > keepLeading) { sel.remove(sel.options.length - 1); }
      for (const v of values) {
        const o = document.createElement('option');
        o.value = v; o.textContent = v;
        sel.appendChild(o);
      }
      // Restore prior selection if still present.
      if ([...sel.options].some(o => o.value === prev)) { sel.value = prev; }
    }

    function renderRows(rows) {
      lastRows = rows;
      const tbody = $('rows');
      tbody.innerHTML = '';
      for (const r of rows) {
        const tr = document.createElement('tr');
        tr.addEventListener('click', () => vscode.postMessage({ type: 'open', id: r.id }));
        const cells = [
          ['num', '#' + r.id],
          ['title', r.title],
          ['area', r.area],
          ['assignee', r.assignee],
          ['num', r.age],
        ];
        for (const [cls, text] of cells) {
          const td = document.createElement('td');
          td.className = cls === 'title' ? 'title' : cls;
          td.textContent = text;
          tr.appendChild(td);
        }
        tbody.appendChild(tr);
      }
      $('empty').hidden = rows.length > 0;
      renderFooter(rows);
    }

    function renderFooter(rows) {
      const byArea = {};
      for (const r of rows) { byArea[r.area] = (byArea[r.area] || 0) + 1; }
      const breakdown = Object.keys(byArea).sort()
        .map(a => byArea[a] + ' in ' + a).join(', ');
      let text = rows.length + ' match' + (rows.length === 1 ? '' : 'es') + ' found';
      if (breakdown) { text += ' · ' + breakdown; }
      $('footer').textContent = text;
    }

    window.addEventListener('message', (event) => {
      const msg = event.data;
      if (msg.type === 'dataset') {
        fillSelect(area, msg.areas, 1);       // keep "All"
        fillSelect(assignee, msg.assignees, 3); // keep All / Me / Unassigned
        fillSelect(author, msg.authors, 2);   // keep Anyone / Me
        const line = $('status-line');
        if (msg.error) { line.textContent = msg.error; }
        else if (msg.capped) { line.textContent = 'Showing the forge limit of ' + msg.total + ' issues — narrow your scope.'; line.className = 'empty'; }
        else { line.textContent = ''; }
      } else if (msg.type === 'results') {
        renderRows(msg.rows);
      }
    });

    renderHeaders();
  </script>
</body>
</html>`;
  }
}

function getNonce(): string {
  let text = '';
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  for (let i = 0; i < 32; i++) {
    text += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return text;
}
