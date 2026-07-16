/**
 * Shared builder-by-id lookup over `/api/overview` data (#1072).
 *
 * `builders.find(b => b.id === <id>)` was repeated across six command files and
 * `views/builders.ts`. Two variants live here so the lookup — and the
 * worktree-narrowing cast #1066 introduced in `views/builders.ts` — exist in
 * one place. Callers keep their own not-found handling (each surfaces a
 * different message), so these only do the find, never the UI.
 *
 * Pure and dependency-light (no `vscode` import) so it can be unit-tested
 * without a live Tower, following the `builder-pick-rows.ts` precedent.
 */

import type { OverviewBuilder, OverviewData } from '@cluesmith/codev-types';

/** An `OverviewBuilder` whose `worktreePath` is known to be a non-empty string. */
export type OverviewBuilderWithWorktree = OverviewBuilder & { worktreePath: string };

/**
 * The builder with this id, or `undefined` if `data` is absent or no builder
 * matches. Accepts the nullable `OverviewData` straight from
 * `OverviewCache.getData()` / `client.getOverview()` so callers needn't guard
 * the cache read separately.
 */
export function builderById(
  data: OverviewData | null | undefined,
  id: string,
): OverviewBuilder | undefined {
  return data?.builders.find(b => b.id === id);
}

/**
 * The builder with this id, but only when it has a worktree on record. The
 * return type narrows `worktreePath` to a non-null `string`, so callers can
 * pass it to `diffCache.getDiff` / `vscode.Uri.file` without re-guarding —
 * mirroring the precondition the changed-file methods share in
 * `views/builders.ts`.
 */
export function builderWithWorktree(
  data: OverviewData | null | undefined,
  id: string,
): OverviewBuilderWithWorktree | undefined {
  const builder = builderById(data, id);
  if (!builder?.worktreePath) { return undefined; }
  return builder as OverviewBuilderWithWorktree;
}
