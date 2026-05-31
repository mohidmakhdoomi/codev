/**
 * Pure recency helpers for the Backlog view (#930).
 *
 * Lives in its own vscode-free file (same rationale as `backlog-filter.ts`)
 * so the age logic can be unit-tested under the vitest harness in
 * `__tests__/` without importing the `vscode` module. `BacklogProvider`
 * (`backlog.ts`) imports these and applies them during row construction.
 *
 * The "new" signal follows the #810 design language: a monochrome `[new]`
 * text prefix leading the row — coexisting with the existing `account` /
 * `issues` icon rather than clobbering it — so a freshly-filed issue
 * *assigned to you* keeps its account icon AND shows `[new]`.
 *
 * `now` is injected (ms) rather than read from `Date.now()` so tests are
 * deterministic. (The existing `relativeTime` in `view-artifact.ts` hardcodes
 * `Date.now()`, which is why it can't be reused here.)
 */

/** Items created within this window of "now" are marked `[new]`. Hardcoded
 * for v1 — no `codev.*` setting until users ask (per #930 design call 3). */
export const RECENT_THRESHOLD_MS = 24 * 60 * 60 * 1000;

/**
 * True when `createdAt` parses to a timestamp between `now - 24h` (inclusive)
 * and `now` (inclusive). Returns false — never throws — for missing, empty,
 * or malformed input, and (defensively) for future timestamps. The threshold
 * is re-evaluated against the caller's `now` on every render, so an item ages
 * out of `[new]` on the next refresh with no persistent state.
 */
export function isRecentlyCreated(createdAt: string | undefined, nowMs: number): boolean {
  if (!createdAt) { return false; }
  const created = Date.parse(createdAt);
  if (Number.isNaN(created)) { return false; }
  const age = nowMs - created;
  return age >= 0 && age < RECENT_THRESHOLD_MS;
}

/**
 * The label prefix for a backlog row: `'[new] '` when recently created, else
 * `''`. Designed to lead the row label
 * (`${recencyPrefix(...)}#${id} ${title}`) — when empty the label is
 * byte-identical to the pre-#930 form. Graceful empty-string fallback mirrors
 * #810's `GATE_ICONS[gate] || 'bell'` shape.
 */
export function recencyPrefix(createdAt: string | undefined, nowMs: number): string {
  return isRecentlyCreated(createdAt, nowMs) ? '[new] ' : '';
}

/**
 * Human-relative age string (`'30s ago'`, `'45m ago'`, `'3h ago'`, `'2d ago'`)
 * for the row tooltip, or `null` when `createdAt` is missing/malformed (caller
 * then leaves the tooltip unchanged). Future timestamps clamp to `'0s ago'`
 * rather than emitting a negative number. Tiers match `view-artifact.ts`'s
 * `relativeTime` so wording stays consistent across the extension.
 */
export function relativeAge(createdAt: string | undefined, nowMs: number): string | null {
  if (!createdAt) { return null; }
  const created = Date.parse(createdAt);
  if (Number.isNaN(created)) { return null; }
  const seconds = Math.max(0, Math.floor((nowMs - created) / 1000));
  if (seconds < 60) { return `${seconds}s ago`; }
  if (seconds < 3600) { return `${Math.floor(seconds / 60)}m ago`; }
  if (seconds < 86400) { return `${Math.floor(seconds / 3600)}h ago`; }
  return `${Math.floor(seconds / 86400)}d ago`;
}
