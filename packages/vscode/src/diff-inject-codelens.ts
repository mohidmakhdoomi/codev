/**
 * CodeLens provider backing the "Forward to Builder" actions in the
 * `codev.viewDiff` multi-file diff editor (issue #789).
 *
 * The right side of each file in that editor is a plain `file:` document at
 * `<worktree>/<repo-relative-path>`, so we register against `{ scheme: 'file' }`
 * and emit lenses only for documents whose fs path is in the *active diff
 * session* registry. `viewDiff` replaces that registry (via
 * `setDiffInjectSession`) on each invocation, so lenses are scoped to the
 * files the reviewer just opened for diffing; any other `file:` document
 * returns `[]` and is unaffected.
 *
 * Clicking a lens runs `codev.injectBuilderFileRef` (a palette-hidden command
 * registered in `extension.ts`), which opens/reveals the builder terminal and
 * types the reference into its prompt without pressing Enter — mirroring the
 * architect-reference pattern (`codev.referenceIssueInArchitect`).
 */

import * as vscode from 'vscode';
import { buildLensDescriptors, type HunkRange } from './diff-inject-ref.js';

/** Command id the lenses invoke. Registered in `extension.ts`, NOT declared in
 *  `contributes.commands`, so it never appears in the Command Palette. */
export const INJECT_BUILDER_FILE_REF = 'codev.injectBuilderFileRef';

/** One changed file in the active diff session, keyed by its right-side fs path. */
export interface DiffInjectSessionEntry {
  /** Absolute fs path of the right-side (worktree) document. */
  fsPath: string;
  /** Builder that owns this diff (canonical id used for the terminal lookup). */
  builderId: string;
  /** Repo-relative path injected into the prompt. */
  relPath: string;
  /** New-side hunk ranges for the per-hunk lenses. */
  hunks: HunkRange[];
}

class DiffInjectCodeLensProvider implements vscode.CodeLensProvider {
  private registry = new Map<string, DiffInjectSessionEntry>();
  private readonly _onDidChangeCodeLenses = new vscode.EventEmitter<void>();
  readonly onDidChangeCodeLenses = this._onDidChangeCodeLenses.event;

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

  provideCodeLenses(document: vscode.TextDocument): vscode.CodeLens[] {
    const entry = this.registry.get(document.uri.fsPath);
    if (!entry) { return []; }
    const lastLine = Math.max(document.lineCount - 1, 0);
    return buildLensDescriptors(entry.relPath, entry.hunks).map(d => {
      const line = Math.min(Math.max(d.line, 0), lastLine);
      const range = new vscode.Range(line, 0, line, 0);
      return new vscode.CodeLens(range, {
        title: d.title,
        command: INJECT_BUILDER_FILE_REF,
        arguments: [entry.builderId, d.refText],
      });
    });
  }

  dispose(): void {
    this._onDidChangeCodeLenses.dispose();
  }
}

const provider = new DiffInjectCodeLensProvider();

/** Register the provider for `file:` documents. Called once at activation,
 *  alongside `activateDiffView`. */
export function activateDiffInjectCodeLens(context: vscode.ExtensionContext): void {
  context.subscriptions.push(
    vscode.languages.registerCodeLensProvider({ scheme: 'file' }, provider),
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
