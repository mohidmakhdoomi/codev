/**
 * CodeLens provider backing the "Forward to Builder" actions in the builder
 * diff (#789).
 *
 * Lenses are driven by **document symbols** (functions/classes/interfaces/
 * methods), not git hunks, so granularity follows the code and a brand-new
 * file is as forwardable as a modified one. The right side of each file in the
 * diff is a plain `file:` document at `<worktree>/<repo-relative-path>`, so we
 * register against `{ scheme: 'file' }` and emit lenses only for documents
 * whose fs path is in the *active diff session* registry. `viewDiff` and the
 * per-file diff replace/extend that registry, so lenses are scoped to the
 * files the reviewer opened for diffing; any other `file:` document returns
 * `[]`.
 *
 * Clicking a lens runs `codev.forwardToBuilder` (a palette-hidden command
 * registered in `extension.ts`), which opens/reveals the builder terminal and
 * types the reference into its prompt without pressing Enter.
 *
 * The registry also backs the `codev.activeEditorIsBuilderFile` context key
 * (set on active-editor change) that scopes the right-click "Forward Selection
 * to Builder" menu item to tracked builder-diff files.
 *
 * NOTE: CodeLens is suppressed in the multi-file `vscode.changes` editor, so
 * these lenses render in the per-file `vscode.diff` and normal editor tabs
 * (with `diffEditor.codeLens` enabled). The selection context-menu action is
 * the path that works inside the multi-file editor.
 */

import * as vscode from 'vscode';
import { buildAllLensDescriptors, type ChangedRange, type SymbolNode } from './diff-inject-ref.js';

/** Command id the lenses invoke. Registered in `extension.ts`, NOT declared in
 *  `contributes.commands`, so it never appears in the Command Palette. */
export const FORWARD_TO_BUILDER_COMMAND = 'codev.forwardToBuilder';

/** Context key (true when the active editor is a tracked builder-diff file) that
 *  scopes the `editor/context` "Forward Selection to Builder" item. */
export const BUILDER_FILE_CONTEXT_KEY = 'codev.activeEditorIsBuilderFile';

/** One changed file in the active diff session, keyed by its right-side fs path. */
export interface DiffInjectSessionEntry {
  /** Absolute fs path of the right-side (worktree) document. */
  fsPath: string;
  /** Builder that owns this diff (canonical id used for the terminal lookup). */
  builderId: string;
  /** Repo-relative path injected into the prompt. */
  relPath: string;
  /** Changed new-side line runs for the per-change lenses (empty = file/symbol lenses only). */
  hunks: ChangedRange[];
}

/** Map a `vscode.DocumentSymbol` tree to the pure `SymbolNode` shape. */
function toSymbolNode(s: vscode.DocumentSymbol): SymbolNode {
  return {
    kind: s.kind as number,
    startLine: s.range.start.line,
    endLine: s.range.end.line,
    children: s.children?.map(toSymbolNode) ?? [],
  };
}

class DiffInjectCodeLensProvider implements vscode.CodeLensProvider {
  private registry = new Map<string, DiffInjectSessionEntry>();
  private readonly _onDidChangeCodeLenses = new vscode.EventEmitter<void>();
  readonly onDidChangeCodeLenses = this._onDidChangeCodeLenses.event;

  // Symbol resolution is the expensive part (a full language-server query). The
  // diff editor re-queries CodeLens often, so cache the result per document
  // *version* — keyed by uri, holding the in-flight promise so concurrent
  // refreshes share one resolution. Without this, `provideCodeLenses` re-ran
  // `executeDocumentSymbolProvider` on every refresh and pegged the CPU.
  private readonly symbolCache = new Map<string, { version: number; nodes: Promise<SymbolNode[]> }>();

  setSession(entries: DiffInjectSessionEntry[]): void {
    this.registry = new Map(entries.map(e => [e.fsPath, e]));
    this._onDidChangeCodeLenses.fire();
  }

  /** Add/replace a single file's entry without clearing the rest — used by the
   *  per-file diff path (`codev.openBuilderFileDiff`), which can be opened
   *  without a prior `viewDiff` run. */
  upsert(entry: DiffInjectSessionEntry): void {
    this.registry.set(entry.fsPath, entry);
    this._onDidChangeCodeLenses.fire();
  }

  get(fsPath: string): DiffInjectSessionEntry | undefined {
    return this.registry.get(fsPath);
  }

  async provideCodeLenses(
    document: vscode.TextDocument,
    token: vscode.CancellationToken,
  ): Promise<vscode.CodeLens[]> {
    const entry = this.registry.get(document.uri.fsPath);
    if (!entry) { return []; }

    const nodes = await this.symbolsFor(document);
    if (token.isCancellationRequested) { return []; }

    const lastLine = Math.max(document.lineCount - 1, 0);
    return buildAllLensDescriptors(entry.relPath, nodes, entry.hunks).map(d => {
      const line = Math.min(Math.max(d.line, 0), lastLine);
      const range = new vscode.Range(line, 0, line, 0);
      return new vscode.CodeLens(range, {
        title: d.title,
        command: FORWARD_TO_BUILDER_COMMAND,
        arguments: [entry.builderId, d.refText],
      });
    });
  }

  /**
   * Document symbols for a file, resolved at most once per (uri, version).
   * Caching the in-flight promise both avoids redundant language-server work on
   * every CodeLens refresh and breaks any refresh loop (a cache hit returns
   * without re-querying the symbol provider, so it can't keep re-triggering).
   */
  private symbolsFor(document: vscode.TextDocument): Promise<SymbolNode[]> {
    const key = document.uri.toString();
    const cached = this.symbolCache.get(key);
    if (cached && cached.version === document.version) { return cached.nodes; }
    const nodes = (async (): Promise<SymbolNode[]> => {
      try {
        const syms = await vscode.commands.executeCommand<vscode.DocumentSymbol[]>(
          'vscode.executeDocumentSymbolProvider',
          document.uri,
        );
        return (syms ?? []).map(toSymbolNode);
      } catch {
        return [];
      }
    })();
    this.symbolCache.set(key, { version: document.version, nodes });
    return nodes;
  }

  dispose(): void {
    this._onDidChangeCodeLenses.dispose();
  }
}

const provider = new DiffInjectCodeLensProvider();

/** Register the provider for `file:` documents and keep the builder-file
 *  context key in sync with the active editor. Called once at activation,
 *  alongside `activateDiffView`. */
export function activateDiffInjectCodeLens(context: vscode.ExtensionContext): void {
  const syncContextKey = (editor: vscode.TextEditor | undefined): void => {
    const isBuilderFile = !!editor && provider.get(editor.document.uri.fsPath) !== undefined;
    void vscode.commands.executeCommand('setContext', BUILDER_FILE_CONTEXT_KEY, isBuilderFile);
  };
  syncContextKey(vscode.window.activeTextEditor);

  context.subscriptions.push(
    vscode.languages.registerCodeLensProvider({ scheme: 'file' }, provider),
    vscode.window.onDidChangeActiveTextEditor(syncContextKey),
    provider,
  );
}

/** Replace the active diff session — called by `viewDiff` before it opens the
 *  multi-file diff editor. */
export function setDiffInjectSession(entries: DiffInjectSessionEntry[]): void {
  provider.setSession(entries);
}

/** Add/replace one file's entry without clearing the rest — called by the
 *  per-file diff path so its lenses appear without a prior `viewDiff` run. */
export function upsertDiffInjectEntry(entry: DiffInjectSessionEntry): void {
  provider.upsert(entry);
}

/** Look up the tracked builder-diff entry for a file path (the selection
 *  command uses this to resolve the owning builder + repo-relative path). */
export function getDiffInjectEntry(fsPath: string): DiffInjectSessionEntry | undefined {
  return provider.get(fsPath);
}
