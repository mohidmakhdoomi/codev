import type { OverviewBacklogItem, OverviewData } from '@cluesmith/codev-types';

/**
 * Backlog rows the user can act on — exclude issues that already have an
 * active builder. Mirrors the dashboard's BacklogList
 * (`items.filter(i => !i.hasBuilder)`) so the extension and web show the
 * same "available work" set and you can't double-spawn from the Backlog.
 *
 * Lives in this file (vscode-free) so both `BacklogProvider` and the
 * title-count helper can share the same primitive without dragging the
 * vscode module into the vitest harness.
 */
export function spawnableBacklog(items: OverviewBacklogItem[]): OverviewBacklogItem[] {
  return items.filter(i => !i.hasBuilder);
}

/**
 * Filter a backlog list to items assigned to `currentUser`. If
 * `currentUser` is empty / null / undefined (gh unavailable, not
 * authenticated), returns the input unchanged so the view doesn't
 * collapse to empty when we can't tell who "mine" is. Login matching
 * is case-insensitive.
 *
 * Lives in its own file (not in `backlog.ts`) so vitest unit tests can
 * import it without dragging in the `vscode` module. Same pattern the
 * codebase uses for any pure helper unit-tested from `__tests__/`.
 */
export function filterMine(
  items: OverviewBacklogItem[],
  currentUser: string | null | undefined,
): OverviewBacklogItem[] {
  const me = currentUser?.toLowerCase();
  if (!me) { return items; }
  return items.filter(item => !!item.assignees?.some(a => a.toLowerCase() === me));
}

/**
 * Compute the visible-vs-total counts the Backlog view's title should
 * display. Mirrors `BacklogProvider.orderedSpawnable`'s filter chain
 * (`spawnableBacklog` → conditionally `filterMine`) but only counts —
 * cheap to recompute on every title refresh and independent of the
 * provider's lifecycle.
 *
 * `total` is the full spawnable count (mode-independent). `visible` is
 * what the tree actually renders given `showAll` and `data.currentUser`.
 * When mine-only is active but `currentUser` is unavailable, `filterMine`
 * is a no-op so `visible == total` — matching the safety branch in
 * `orderedSpawnable`.
 */
export function visibleBacklogCount(
  data: Pick<OverviewData, 'backlog' | 'currentUser'>,
  showAll: boolean,
): { visible: number; total: number } {
  const spawnable = spawnableBacklog(data.backlog);
  const visible = showAll ? spawnable : filterMine(spawnable, data.currentUser);
  return { visible: visible.length, total: spawnable.length };
}

/**
 * Format the Backlog view's title. Renders `Backlog` when counts are
 * unknown (disconnected / loading — falls back to the plain base name,
 * no misleading "(0)"), `Backlog (N)` when the visible set is the full
 * set, and `Backlog (V of T)` when the user has the mine-only filter on
 * and there's more available behind the toggle.
 */
export function formatBacklogTitle(
  visible: number | undefined,
  total: number | undefined,
): string {
  if (typeof visible !== 'number' || typeof total !== 'number') { return 'Backlog'; }
  if (visible === total) { return `Backlog (${total})`; }
  return `Backlog (${visible} of ${total})`;
}
