/**
 * Codev: Paste Image into Terminal (#736).
 *
 * Bound to a DEDICATED shortcut (Cmd+Alt+V / Ctrl+Alt+V), scoped
 * `when: codev.terminalFocused && terminalFocus`. It never touches Cmd+V —
 * normal text paste stays 100% native VSCode Pseudoterminal paste (no
 * interception, no async detour, no re-dispatch). That is why the earlier
 * multi-line text-paste corruption is gone *by construction*: we no longer
 * sit in the text-paste path at all.
 *
 * Codev terminals are `Pseudoterminal`-backed, so VSCode's built-in image
 * paste bridge never fires for them (it only fires for terminals VSCode
 * owns). This command reimplements it: if the clipboard holds an image,
 * upload it to Tower's /api/paste-image and inject the returned temp-file
 * path into the focused Codev PTY — the same path-injection UX as the web
 * dashboard and VSCode's own built-in terminal. For anything else (no image
 * / clipboard tool missing / read error / Tower down) we surface a toast; we
 * do NOT paste text here — that is Cmd+V's job and we leave it untouched.
 */

import * as vscode from 'vscode';
import type { ConnectionManager } from '../connection-manager.js';
import type { TerminalManager } from '../terminal-manager.js';
import { readClipboardImage } from '../clipboard-image.js';

export async function pasteImage(
  connectionManager: ConnectionManager,
  terminalManager: TerminalManager,
): Promise<void> {
  const pty = terminalManager.getActiveManagedPty();
  if (!pty) {
    // `when` should prevent this. If it ever fires outside a Codev terminal,
    // no-op — never shadow normal paste (that's Cmd+V, which we don't bind).
    return;
  }

  const client = connectionManager.getClient();
  if (!client || connectionManager.getState() !== 'connected') {
    vscode.window.showWarningMessage(
      'Codev: not connected to Tower — image paste needs Tower running.',
    );
    return;
  }

  const result = await readClipboardImage();

  if (result.kind === 'no-image') {
    vscode.window.showInformationMessage('Codev: no image on the clipboard.');
    return;
  }
  if (result.kind === 'tool-missing') {
    vscode.window.showErrorMessage(
      `Codev: image paste needs ${result.tool} installed.`,
    );
    return;
  }
  if (result.kind === 'error') {
    vscode.window.showErrorMessage(
      `Codev: couldn't read clipboard image (${result.message}).`,
    );
    return;
  }

  // result.kind === 'image'
  const workspacePath = connectionManager.getWorkspacePath();
  if (!workspacePath) {
    pty.writeNotice('\r\n\x1b[31m[Image upload failed: no workspace]\x1b[0m\r\n');
    return;
  }
  pty.writeNotice('\r\n\x1b[90m[Uploading image...]\x1b[0m');
  const up = await client.pasteImage(workspacePath, result.bytes, result.mime);
  if (!up.ok || !up.path) {
    pty.writeNotice(
      `\r\x1b[2K\x1b[31m[Image upload failed${up.error ? `: ${up.error}` : ''}]\x1b[0m\r\n`,
    );
    return;
  }
  pty.writeNotice('\r\x1b[2K');
  pty.handleInput(up.path); // no newline — mirrors the dashboard's term.paste(path)
}
