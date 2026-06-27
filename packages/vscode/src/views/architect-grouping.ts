/**
 * Architect-tier partition for the Agents tree (Issue 1104) — the outer level-1
 * wrapper around the existing per-axis grouping strategies (`builder-grouping.ts`),
 * which stay one level deep and untouched. This module owns only "which builder
 * belongs to which architect"; the area/phase sub-grouping below an architect is
 * still the existing strategy's job.
 *
 * Pure / vscode-free, so it's unit-testable under the vitest `__tests__/`
 * harness (mirrors `builder-grouping.ts` / `builder-row.ts`).
 */

import type { OverviewBuilder } from '@cluesmith/codev-types';

/**
 * Sentinel "architect" key for builders whose `spawnedByArchitect` is `null`
 * (legacy / pre-#755 rows, or a missing state.db row) OR whose owner is no
 * longer in the workspace roster (architect removed). In the multi-architect
 * tree these collect under one trailing "Unassigned" node so a builder is never
 * silently dropped just because Tower can't attribute it. Not a real architect —
 * its node carries no open-terminal command and no remove action.
 */
export const UNASSIGNED_ARCHITECT = 'unassigned';

/** One architect's slice of the builder list for the level-1 Agents tier. */
export interface ArchitectPartition {
  /** Architect name (canonical lowercase), or `UNASSIGNED_ARCHITECT`. */
  name: string;
  /**
   * `false` only for the Unassigned bucket — drives the node's non-interactive
   * (no open-terminal, no remove) rendering. `true` for every real architect,
   * including passive ones with zero builders.
   */
  interactive: boolean;
  /** This architect's builders, in the caller's display order. */
  builders: OverviewBuilder[];
}

/**
 * Partition already-ordered builders under architects, roster order preserved
 * (`architectNames` is main-first as Tower returns it). Every roster architect
 * gets a partition — including passive ones, which get an empty `builders` list
 * so they still render as leaf rows. Builders whose `spawnedByArchitect` is
 * null/unknown or names an architect absent from the roster collect under a
 * single trailing `UNASSIGNED_ARCHITECT` partition, emitted only when non-empty.
 *
 * `ordered` should already be `orderForDisplay`-sorted; the per-architect
 * `filter` preserves that order within each bucket.
 */
export function partitionByArchitect(
  ordered: OverviewBuilder[],
  architectNames: string[],
): ArchitectPartition[] {
  const roster = new Set(architectNames);
  const partitions: ArchitectPartition[] = architectNames.map(name => ({
    name,
    interactive: true,
    builders: ordered.filter(b => b.spawnedByArchitect === name),
  }));

  const unowned = ordered.filter(
    b => !b.spawnedByArchitect || !roster.has(b.spawnedByArchitect),
  );
  if (unowned.length > 0) {
    partitions.push({ name: UNASSIGNED_ARCHITECT, interactive: false, builders: unowned });
  }
  return partitions;
}

/**
 * Whether the owning architect should be surfaced as a dim `description` badge
 * on a builder row (Issue 1104). True only when the workspace has more than one
 * architect AND the architect is NOT already the row's ancestor in the tree —
 * so single-architect workspaces stay clean (the badge would just repeat the
 * lone architect on every row), and the nested multi-architect tree stays clean
 * too (the architect node is already the ancestor). Returns the badge text, or
 * `''` to render no badge.
 */
export function architectBadge(
  b: OverviewBuilder,
  architectCount: number,
  ownerIsAncestor: boolean,
): string {
  if (architectCount <= 1) { return ''; }
  if (ownerIsAncestor) { return ''; }
  return b.spawnedByArchitect ?? '';
}
