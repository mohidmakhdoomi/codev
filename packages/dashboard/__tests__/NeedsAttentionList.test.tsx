import { describe, it, expect } from 'vitest';
import { buildItems } from '../src/components/NeedsAttentionList.js';
import type { OverviewPR, OverviewBuilder } from '../src/lib/api.js';

function makePR(overrides: Partial<OverviewPR> = {}): OverviewPR {
  return {
    id: '100',
    title: 'PR title',
    url: 'https://github.com/org/repo/pull/100',
    reviewStatus: 'REVIEW_REQUIRED',
    linkedIssue: '42',
    createdAt: new Date('2026-01-01T00:00:00Z').toISOString(),
    ...overrides,
  };
}

function makeBuilder(overrides: Partial<OverviewBuilder> = {}): OverviewBuilder {
  return {
    id: 'bugfix-42',
    issueId: '42',
    issueTitle: 'Issue 42',
    phase: 'review',
    mode: 'strict',
    gates: {},
    worktreePath: '/path',
    roleId: 'builder-bugfix-42',
    protocol: 'bugfix',
    planPhases: [],
    progress: 0.5,
    blocked: null,
    blockedGate: null,
    blockedSince: null,
    startedAt: null,
    idleMs: 0,
    lastDataAt: null,
    spawnedByArchitect: 'main',
    ...overrides,
  };
}

describe('NeedsAttentionList buildItems — PR gating (issue #844)', () => {
  it('excludes a PR whose builder is still in CMAP review (not yet at pr gate)', () => {
    const prs = [makePR({ id: '100', linkedIssue: '42' })];
    const builders = [makeBuilder({ issueId: '42', blocked: null })];

    const items = buildItems(prs, builders);

    expect(items.find(i => i.key === 'pr-100')).toBeUndefined();
  });

  it('includes a PR once the builder reaches the pr gate', () => {
    const prs = [makePR({ id: '100', linkedIssue: '42' })];
    const builders = [
      makeBuilder({
        issueId: '42',
        blocked: 'PR review',
        blockedGate: 'pr',
        blockedSince: new Date('2026-01-02T00:00:00Z').toISOString(),
      }),
    ];

    const items = buildItems(prs, builders);

    expect(items.find(i => i.key === 'pr-100')).toBeDefined();
  });

  it('emits the PR exactly once when builder is at the pr gate (no dedupe double-count)', () => {
    const prs = [makePR({ id: '100', linkedIssue: '42' })];
    const builders = [
      makeBuilder({
        issueId: '42',
        blocked: 'PR review',
        blockedGate: 'pr',
        blockedSince: new Date('2026-01-02T00:00:00Z').toISOString(),
      }),
    ];

    const items = buildItems(prs, builders);

    expect(items.filter(i => i.issueOrPR === '#100')).toHaveLength(1);
  });

  it('surfaces a human-authored PR (no matching builder) only when reviewStatus is REVIEW_REQUIRED', () => {
    const required = makePR({ id: '200', linkedIssue: null, reviewStatus: 'REVIEW_REQUIRED' });
    const approved = makePR({ id: '201', linkedIssue: null, reviewStatus: 'APPROVED' });

    const items = buildItems([required, approved], []);

    expect(items.find(i => i.key === 'pr-200')).toBeDefined();
    expect(items.find(i => i.key === 'pr-201')).toBeUndefined();
  });

  it('still surfaces other gate-pending builders (spec/plan/dev review)', () => {
    const prs: OverviewPR[] = [];
    const builders = [
      makeBuilder({
        id: 'spir-99',
        issueId: '99',
        blocked: 'spec review',
        blockedGate: 'spec-approval',
        blockedSince: new Date('2026-01-02T00:00:00Z').toISOString(),
      }),
    ];

    const items = buildItems(prs, builders);

    expect(items.find(i => i.key === 'gate-spir-99')).toBeDefined();
  });

  it('treats a PR whose linkedIssue does not match any builder as unaffiliated', () => {
    // PR claims to link issue 42, but no builder is tracking issue 42 — treat
    // it the same as a human-authored PR (surface only if reviewStatus needs it).
    const prs = [makePR({ id: '300', linkedIssue: '42', reviewStatus: 'APPROVED' })];
    const builders: OverviewBuilder[] = [];

    const items = buildItems(prs, builders);

    expect(items.find(i => i.key === 'pr-300')).toBeUndefined();
  });

  it('uses the builder blockedSince (not pr.createdAt) as waitingSince for affiliated PRs', () => {
    const createdAt = new Date('2026-01-01T00:00:00Z').toISOString();
    const blockedSince = new Date('2026-01-05T12:00:00Z').toISOString();
    const prs = [makePR({ id: '400', linkedIssue: '42', createdAt })];
    const builders = [
      makeBuilder({ issueId: '42', blocked: 'PR review', blockedGate: 'pr', blockedSince }),
    ];

    const items = buildItems(prs, builders);
    const pr = items.find(i => i.key === 'pr-400');

    expect(pr).toBeDefined();
    expect(pr!.waitingSince).toBe(blockedSince);
  });

  it('still surfaces a builder stuck at the pr gate when its PR is missing from prs', () => {
    // Defensive: if a builder is at the pr gate but its PR didn't appear in
    // `prs` (cache miss / pagination / API error), do NOT silently drop the
    // builder from Needs Attention.
    const prs: OverviewPR[] = [];
    const blockedSince = new Date('2026-01-05T12:00:00Z').toISOString();
    const builders = [
      makeBuilder({
        id: 'bugfix-42',
        issueId: '42',
        blocked: 'PR review',
        blockedGate: 'pr',
        blockedSince,
      }),
    ];

    const items = buildItems(prs, builders);

    expect(items.find(i => i.key === 'gate-bugfix-42')).toBeDefined();
  });

  it('does NOT double-emit when both the PR and the builder are present', () => {
    // Regression guard for the dedupe invariant after the missing-PR fallback
    // was added: when the PR IS emitted, the builder loop must skip.
    const prs = [makePR({ id: '500', linkedIssue: '42' })];
    const builders = [
      makeBuilder({
        id: 'bugfix-42',
        issueId: '42',
        blocked: 'PR review',
        blockedGate: 'pr',
        blockedSince: new Date('2026-01-02T00:00:00Z').toISOString(),
      }),
    ];

    const items = buildItems(prs, builders);

    expect(items).toHaveLength(1);
    expect(items[0].key).toBe('pr-500');
  });
});
