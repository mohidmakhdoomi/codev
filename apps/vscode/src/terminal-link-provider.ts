import * as vscode from 'vscode';
import type { TerminalManager } from './terminal-manager.js';
import { RECONNECT_LINK_TEXT } from './terminal-adapter.js';

// Matches Codev builder role names like `builder-spir-153`, `builder-bugfix-42`.
const BUILDER_REGEX = /\bbuilder-[a-z]+-[a-z0-9]+\b/g;

interface BuilderLink extends vscode.TerminalLink {
  roleId: string;
}

/**
 * Makes builder role names in terminal output clickable.
 * Clicking opens (or focuses) that builder's terminal.
 */
export class BuilderTerminalLinkProvider implements vscode.TerminalLinkProvider<BuilderLink> {
  constructor(private terminalManager: TerminalManager) {}

  provideTerminalLinks(context: vscode.TerminalLinkContext): BuilderLink[] {
    const links: BuilderLink[] = [];
    BUILDER_REGEX.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = BUILDER_REGEX.exec(context.line)) !== null) {
      links.push({
        startIndex: match.index,
        length: match[0].length,
        tooltip: `Open ${match[0]} terminal`,
        roleId: match[0],
      });
    }
    return links;
  }

  async handleTerminalLink(link: BuilderLink): Promise<void> {
    await this.terminalManager.openBuilderByRoleOrId(link.roleId, true);
  }
}

interface ReconnectLink extends vscode.TerminalLink {
  // The terminal whose line carried the affordance. VSCode hands the same link
  // instance back to handleTerminalLink, so we reconnect exactly the terminal
  // that gave up — not merely the active one.
  terminal: vscode.Terminal;
}

/**
 * Makes the reconnect affordance in a terminal's give-up message clickable
 * (#939). The adapter prints `RECONNECT_LINK_TEXT` when it enters the give-up
 * state (#936); clicking it triggers a fresh reconnect chain on that terminal.
 */
export class ReconnectTerminalLinkProvider implements vscode.TerminalLinkProvider<ReconnectLink> {
  constructor(private terminalManager: TerminalManager) {}

  provideTerminalLinks(context: vscode.TerminalLinkContext): ReconnectLink[] {
    const index = context.line.indexOf(RECONNECT_LINK_TEXT);
    if (index === -1) { return []; }
    return [{
      startIndex: index,
      length: RECONNECT_LINK_TEXT.length,
      tooltip: 'Reconnect this terminal',
      terminal: context.terminal,
    }];
  }

  handleTerminalLink(link: ReconnectLink): void {
    this.terminalManager.reconnectByTerminal(link.terminal);
  }
}
