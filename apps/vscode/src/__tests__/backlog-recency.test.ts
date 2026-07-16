/**
 * Unit tests for the pure recency helpers behind the Backlog "new" marker (#930):
 * - `isRecentlyCreated` (24h age threshold)
 * - `recencyPrefix` (`'[new] '` vs `''`)
 * - `relativeAge` (human-relative age string for the tooltip)
 *
 * Lives in `__tests__/` (vitest) rather than `src/test/` (vscode-test Electron
 * harness) because the helpers touch no `vscode` APIs. `now` is injected so the
 * assertions are deterministic.
 */

import { describe, it, expect } from 'vitest';
import {
  RECENT_THRESHOLD_MS,
  isRecentlyCreated,
  recencyPrefix,
  relativeAge,
} from '../views/backlog-recency.js';

// Fixed reference "now" so every case is deterministic.
const NOW = Date.parse('2026-05-30T12:00:00.000Z');
const iso = (msAgo: number) => new Date(NOW - msAgo).toISOString();

const HOUR = 60 * 60 * 1000;
const MINUTE = 60 * 1000;
const DAY = 24 * HOUR;

describe('isRecentlyCreated', () => {
  it('returns true for items created within the last 24h', () => {
    expect(isRecentlyCreated(iso(0), NOW)).toBe(true); // just now
    expect(isRecentlyCreated(iso(HOUR), NOW)).toBe(true); // 1h ago
    expect(isRecentlyCreated(iso(23 * HOUR + 59 * MINUTE), NOW)).toBe(true); // 23h59m ago
    expect(isRecentlyCreated(iso(RECENT_THRESHOLD_MS - 1), NOW)).toBe(true); // 1ms inside window
  });

  it('returns false at and beyond the 24h boundary', () => {
    expect(isRecentlyCreated(iso(RECENT_THRESHOLD_MS), NOW)).toBe(false); // exactly 24h
    expect(isRecentlyCreated(iso(25 * HOUR), NOW)).toBe(false);
    expect(isRecentlyCreated(iso(2 * DAY), NOW)).toBe(false);
  });

  it('returns false for missing / empty / malformed input', () => {
    expect(isRecentlyCreated(undefined, NOW)).toBe(false);
    expect(isRecentlyCreated('', NOW)).toBe(false);
    expect(isRecentlyCreated('not-a-date', NOW)).toBe(false);
  });

  it('returns false (defensively) for future timestamps', () => {
    expect(isRecentlyCreated(iso(-HOUR), NOW)).toBe(false); // 1h in the future
  });
});

describe('recencyPrefix', () => {
  it("returns '[new] ' for recent items", () => {
    expect(recencyPrefix(iso(HOUR), NOW)).toBe('[new] ');
  });

  it("returns '' for older / malformed / missing items", () => {
    expect(recencyPrefix(iso(2 * DAY), NOW)).toBe('');
    expect(recencyPrefix('not-a-date', NOW)).toBe('');
    expect(recencyPrefix(undefined, NOW)).toBe('');
  });
});

describe('relativeAge', () => {
  it('formats seconds / minutes / hours / days tiers', () => {
    expect(relativeAge(iso(30 * 1000), NOW)).toBe('30s ago');
    expect(relativeAge(iso(45 * MINUTE), NOW)).toBe('45m ago');
    expect(relativeAge(iso(3 * HOUR), NOW)).toBe('3h ago');
    expect(relativeAge(iso(2 * DAY), NOW)).toBe('2d ago');
  });

  it('returns null for missing / malformed input', () => {
    expect(relativeAge(undefined, NOW)).toBeNull();
    expect(relativeAge('', NOW)).toBeNull();
    expect(relativeAge('not-a-date', NOW)).toBeNull();
  });

  it("clamps future timestamps to '0s ago'", () => {
    expect(relativeAge(iso(-HOUR), NOW)).toBe('0s ago');
  });
});
