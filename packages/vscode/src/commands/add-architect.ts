/**
 * Pure helpers for the conversational `Codev: Add Architect` flow (Issue 1104).
 *
 * Architect creation is no longer a direct CLI/REST call from the sidebar — it
 * is a request routed to the `main` architect, the workspace orchestrator, who
 * decides whether the specialisation makes sense, runs
 * `afx workspace add-architect`, and briefs the new architect. These helpers
 * hold the vscode-free decision logic (resolve main, build the request message)
 * so it can be unit-tested directly; `extension.ts` owns the VS Code UI around
 * them.
 */

import type { ArchitectState } from '@cluesmith/codev-types';

/** The recipient addressing form for the request — main, explicitly. */
export const ADD_ARCHITECT_RECIPIENT = 'architect:main';

/**
 * Resolve the `main` architect from a roster (the overview payload's
 * `architects`), or `undefined` when no main session is running. The roster only
 * lists architects with a live session (Tower skips dead registrations), so a
 * present `main` is by definition reachable — the contract the Add Architect
 * action depends on ("ask main to add").
 */
export function resolveMainArchitect(architects: ArchitectState[]): ArchitectState | undefined {
  return architects.find(a => a.name === 'main');
}

/**
 * The message asking main to create a new architect. Name-only for v1 (the
 * issue defers a scope/brief prompt); main asks for scope if it needs it.
 */
export function addArchitectRequestMessage(name: string): string {
  return `Please add a ${name} architect.`;
}
