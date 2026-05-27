import { UNCATEGORIZED_AREA } from './constants.js';

/**
 * Render an area name as a human-readable group-header label.
 *
 * Display-only. The raw `area` value (the wire string from
 * `OverviewBacklogItem.area` / `OverviewBuilder.area`, or the
 * `UNCATEGORIZED_AREA` sentinel) MUST continue to be used for
 * bucketing (`groupByArea`), id stability, and `===` matchers.
 *
 * Rule: split on `-`, `_`, and whitespace; capitalize the first
 * character of each word; rejoin with a single space. Examples:
 *   'vscode'        -> 'Vscode'
 *   'cross-cutting' -> 'Cross Cutting'
 *   'front_end'     -> 'Front End'
 *   'Uncategorized' -> 'Uncategorized'  (no-op; sentinel is already
 *                                        single-word, first-char-upper)
 *
 * Purely structural: no hardcoded list of "known acronyms". Teams
 * using Codev decide their own labeling semantics; a per-repo
 * override map can be layered on top as a non-breaking extension.
 */
export function formatAreaForDisplay(area: string): string {
  return area
    .split(/[-_\s]+/)
    .filter(w => w.length > 0)
    .map(w => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

/**
 * Bucket items by their resolved area, returning groups in canonical
 * Codev order: alphabetical specific areas first, then `Uncategorized`
 * last. Within each group, the input order is preserved (the caller
 * has already applied any sort policy — display-order for builders,
 * mine-first for backlog).
 *
 * Pure, generic over the item type. Both `views/backlog.ts` and
 * `views/builders.ts` in the VSCode extension consume this directly,
 * keying off each item's resolved `area` (already projected on the
 * server via `parseArea`; see #819). Future consumers (dashboard
 * equivalents, etc.) reuse the same function so the grouping rule
 * stays byte-shared, not merely prose-described.
 */
export function groupByArea<T>(
  items: T[],
  getArea: (item: T) => string,
): Array<{ area: string; items: T[] }> {
  const buckets = new Map<string, T[]>();
  for (const item of items) {
    const area = getArea(item);
    const bucket = buckets.get(area);
    if (bucket) {
      bucket.push(item);
    } else {
      buckets.set(area, [item]);
    }
  }

  const result: Array<{ area: string; items: T[] }> = [];
  const uncategorized = buckets.get(UNCATEGORIZED_AREA);
  const specifics = [...buckets.keys()]
    .filter(a => a !== UNCATEGORIZED_AREA)
    .sort();
  for (const area of specifics) {
    result.push({ area, items: buckets.get(area)! });
  }
  if (uncategorized) {
    result.push({ area: UNCATEGORIZED_AREA, items: uncategorized });
  }
  return result;
}
