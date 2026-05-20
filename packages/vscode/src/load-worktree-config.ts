/**
 * Thin client-side wrapper over Tower's `GET /api/worktree-config`.
 *
 * Returns the canonical `ResolvedWorktreeConfig` for the active
 * workspace — Tower applies the full five-layer deep-merge (defaults
 * / cache / global / project / project-local), so the extension
 * never has to parse or merge `.codev/config(.local).json` itself.
 *
 * Lives at the top level of `src/` because multiple consumers need
 * it (the Workspace tree view, the `Codev: Open Dev URL` command,
 * any future config-driven UI). Past versions had this inlined in
 * `commands/open-dev-url.ts`, but that file's job is one command;
 * the resolved config is a workspace-wide concern.
 */

import type { ResolvedWorktreeConfig, WorktreeDevUrl } from '@cluesmith/codev-types';
import type { ConnectionManager } from './connection-manager.js';

export type { ResolvedWorktreeConfig, WorktreeDevUrl };

/**
 * Returns `null` when Tower is unreachable or the workspace isn't
 * activated. Callers extract whichever field they need (e.g.
 * `(await loadWorktreeConfig(cm))?.devUrls ?? []`).
 */
export async function loadWorktreeConfig(
  connectionManager: ConnectionManager,
): Promise<ResolvedWorktreeConfig | null> {
  const client = connectionManager.getClient();
  const workspacePath = connectionManager.getWorkspacePath();
  if (!client || !workspacePath || connectionManager.getState() !== 'connected') { return null; }
  return client.getWorktreeConfig(workspacePath);
}
