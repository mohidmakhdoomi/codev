/**
 * Pure helper for the present→absent diff that drives builder-terminal-tab
 * auto-close on cleanup. Lives in its own module so the unit test can
 * import it without touching the vscode API. Wired up in `extension.ts`
 * against the `OverviewCache.onDidChange` listener.
 *
 * Why overview data is the right source (see #883): the previous
 * implementation read `client.getWorkspaceState`, whose `builders` array is
 * rebuilt from SQLite `terminal_sessions`. After `afx cleanup`, the
 * shellper process is designed to survive (it's detached so it can
 * outlive a Tower restart) and Tower's reconnect-on-the-fly path keeps
 * the row alive forever — so the diff never observed the cleaned-up
 * builder's absence. `OverviewCache.getData().builders` comes from
 * `discoverBuilders`, a `readdirSync(.builders/)` scan, so the source
 * collapses to whether the worktree directory still exists — the
 * authoritative "this builder still exists" signal.
 */

export interface OverviewBuilderLike {
  /** Canonical role id (e.g. `builder-pir-883`); `null` for soft-mode worktrees. */
  roleId: string | null;
}

/**
 * Given the previous and current sets of active builder role IDs, return
 * the role IDs whose terminal tabs should be closed (present in `prev`,
 * absent from `curr`).
 *
 * - `prev === null` is the first-tick sentinel — return `[]` so freshly
 *   opened terminals aren't pre-emptively closed before the cache has
 *   ever populated.
 * - Soft-mode builders surface as `roleId: null` upstream and never
 *   enter either set, so their tabs won't auto-close via this path —
 *   a known limitation since soft-mode terminals are keyed by the
 *   opaque PtySession UUID, not by the worktree name. The issue's
 *   repro path is `afx spawn --protocol bugfix` (strict mode), and
 *   the older state-based code wasn't really helping soft-mode either
 *   in this scenario.
 */
export function computeBuildersToClose(
  prev: ReadonlySet<string> | null,
  curr: ReadonlySet<string>,
): string[] {
  if (prev === null) { return []; }
  const closed: string[] = [];
  for (const id of prev) {
    if (!curr.has(id)) { closed.push(id); }
  }
  return closed;
}

/**
 * Project an `OverviewBuilder[]`-shaped list to the role-ID set used by
 * the diff. Drops null roleIds (soft mode).
 */
export function roleIdsFromBuilders(builders: ReadonlyArray<OverviewBuilderLike>): Set<string> {
  const out = new Set<string>();
  for (const b of builders) {
    if (b.roleId !== null) { out.add(b.roleId); }
  }
  return out;
}
