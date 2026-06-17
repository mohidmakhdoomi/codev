/**
 * Issue-derived `OverviewBuilder` fields that are *resolved* fresh from the
 * GitHub issue on each overview refresh and need to survive windows where the
 * issue can't be read.
 *
 * To make another issue-derived field "sticky", add it here and resolve it
 * through {@link ResolvedEnrichmentCache.resolve} at the enrichment site —
 * nothing else changes.
 */
export interface ResolvedEnrichment {
  /** Resolved `area/*` group, or the `UNCATEGORIZED_AREA` sentinel. */
  area?: string;
}

/**
 * Per-builder cache of {@link ResolvedEnrichment} values, keyed by the stable
 * absolute `worktreePath`.
 *
 * The overview projection derives certain builder fields (today: `area`) from
 * the GitHub issue every refresh. The issue source is open-only and transient:
 * once an issue is closed (PR merged via `Fixes #N`), torn down mid-cleanup, or
 * the `issue-list` fetch fails, those fields can no longer be recomputed — yet
 * the builder may still be listed for a few refreshes while teardown finishes.
 * Without this cache the fields snap back to their structural default (e.g.
 * `area` → `Uncategorized`), briefly mis-rendering a builder that is merely
 * being cleaned up (PIR #907).
 *
 * These values are STABLE per builder — one issue per builder, fixed for its
 * lifetime — so this caches a fixed fact to bridge a source outage; it does not
 * track a value that changes over time.
 *
 * Contract: {@link resolve} is gated on whether the *issue was reachable* this
 * refresh (`sourceAvailable`), NOT on whether the value is non-empty. A
 * reachable issue that genuinely resolves to a sentinel (e.g. `area` =
 * `Uncategorized` for an unlabeled issue) is a real value and is cached as
 * such. Only an UNREACHABLE issue replays the cached value. Gating on
 * reachability rather than value-emptiness is what stops a legitimate change
 * (e.g. a label edited on a still-open issue) from being masked by a stale
 * entry.
 */
export class ResolvedEnrichmentCache {
  private byBuilder = new Map<string, ResolvedEnrichment>();

  /**
   * Resolve one field for one builder. When the issue is reachable and produced
   * a value, cache and return it. Otherwise replay the cached value (or
   * `undefined` if the field was never resolved for this builder).
   */
  resolve<K extends keyof ResolvedEnrichment>(
    builderKey: string,
    field: K,
    sourceAvailable: boolean,
    freshValue: ResolvedEnrichment[K] | undefined,
  ): ResolvedEnrichment[K] | undefined {
    if (sourceAvailable && freshValue !== undefined) {
      const snapshot = this.byBuilder.get(builderKey) ?? {};
      snapshot[field] = freshValue;
      this.byBuilder.set(builderKey, snapshot);
      return freshValue;
    }
    return this.byBuilder.get(builderKey)?.[field];
  }

  /**
   * Drop cached entries for builders no longer present, so the cache can't grow
   * unbounded across the Tower process lifetime. Once a builder is gone for good
   * (dropped by the active-session filter) it is forgotten.
   */
  prune(liveBuilderKeys: Set<string>): void {
    for (const key of this.byBuilder.keys()) {
      if (!liveBuilderKeys.has(key)) this.byBuilder.delete(key);
    }
  }
}
