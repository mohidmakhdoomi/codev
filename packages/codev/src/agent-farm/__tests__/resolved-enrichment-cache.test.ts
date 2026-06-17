/**
 * Unit tests for ResolvedEnrichmentCache (PIR #907).
 *
 * The cache backs the resolved-area fallback in the overview projection:
 * issue-derived builder fields that can't be recomputed this refresh (issue
 * closed / torn down / fetch failed) replay their last resolved value instead
 * of snapping back to a structural default. The load-bearing contract is that
 * fallback is gated on issue *reachability*, never on value emptiness.
 */

import { describe, it, expect } from 'vitest';
import { ResolvedEnrichmentCache } from '../servers/resolved-enrichment-cache.js';

describe('ResolvedEnrichmentCache', () => {
  it('returns the fresh value and caches it when the source is available', () => {
    const cache = new ResolvedEnrichmentCache();
    expect(cache.resolve('/wt/a', 'area', true, 'vscode')).toBe('vscode');
    // Source now unavailable → replays the cached value.
    expect(cache.resolve('/wt/a', 'area', false, undefined)).toBe('vscode');
  });

  it('returns undefined when the field was never resolved and the source is unavailable', () => {
    const cache = new ResolvedEnrichmentCache();
    expect(cache.resolve('/wt/a', 'area', false, undefined)).toBeUndefined();
  });

  it('caches a genuine sentinel value (gates on reachability, not emptiness)', () => {
    const cache = new ResolvedEnrichmentCache();
    // A reachable-but-unlabeled issue resolves to the Uncategorized sentinel —
    // that is a real value and must be cached as such, not treated as "missing".
    expect(cache.resolve('/wt/a', 'area', true, 'Uncategorized')).toBe('Uncategorized');
    expect(cache.resolve('/wt/a', 'area', false, undefined)).toBe('Uncategorized');
  });

  it('does not mask a changed value while the source stays available', () => {
    const cache = new ResolvedEnrichmentCache();
    expect(cache.resolve('/wt/a', 'area', true, 'vscode')).toBe('vscode');
    // Issue still reachable but the value changed (e.g. label edited) → the new
    // value wins; the cache never replays a stale entry while reachable.
    expect(cache.resolve('/wt/a', 'area', true, 'tower')).toBe('tower');
  });

  it('isolates entries per builder key', () => {
    const cache = new ResolvedEnrichmentCache();
    cache.resolve('/wt/a', 'area', true, 'vscode');
    cache.resolve('/wt/b', 'area', true, 'tower');
    expect(cache.resolve('/wt/a', 'area', false, undefined)).toBe('vscode');
    expect(cache.resolve('/wt/b', 'area', false, undefined)).toBe('tower');
  });

  it('prunes entries for builders no longer present', () => {
    const cache = new ResolvedEnrichmentCache();
    cache.resolve('/wt/a', 'area', true, 'vscode');
    cache.resolve('/wt/b', 'area', true, 'tower');
    cache.prune(new Set(['/wt/a']));
    expect(cache.resolve('/wt/a', 'area', false, undefined)).toBe('vscode');
    // '/wt/b' was pruned → no cached value to replay.
    expect(cache.resolve('/wt/b', 'area', false, undefined)).toBeUndefined();
  });
});
