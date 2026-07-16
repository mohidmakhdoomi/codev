/**
 * Resolve the integration branch for a workspace via `origin/HEAD`,
 * falling back to `'main'` when the symbolic-ref is unset, dangling, or
 * the remote doesn't exist.
 *
 * Sync mirror of the async pattern at
 * `apps/vscode/src/commands/view-diff.ts:261-272`; consult is sync
 * everywhere so the helper is too.
 */

import { execSync } from 'node:child_process';

export function resolveDefaultBranch(workspaceRoot: string): string {
  try {
    const stdout = execSync(
      'git symbolic-ref --short refs/remotes/origin/HEAD',
      { cwd: workspaceRoot, encoding: 'utf-8', stdio: ['ignore', 'pipe', 'ignore'] },
    );
    const ref = stdout.trim().replace(/^origin\//, '');
    if (ref) return ref;
  } catch {
    // origin/HEAD not set, no remote, or dangling — fall through.
  }
  return 'main';
}
