/**
 * Unit tests for the pure helpers that back a builder row's label and icon
 * in the Builders tree (#810):
 * - `builderRowLabel` — phase-prefix label across active / blocked / idle
 *   states plus the empty-phase edge case.
 * - `gateIconFor` — gate → codicon mapping, keyed off the CANONICAL gate name.
 *
 * Lives in `__tests__/` (vitest) rather than `src/test/` (vscode-test Electron
 * harness) because the helpers touch no `vscode` APIs.
 */

import { describe, it, expect } from 'vitest';
import type { OverviewBuilder } from '@cluesmith/codev-types';
import { builderRowLabel, gateIconFor, rollupGroupState, worstBuilderState } from '../views/builder-row.js';

// A fixed clock so elapsed-time suffixes are deterministic.
const NOW = new Date('2026-05-30T12:00:00Z').getTime();
const TWELVE_MIN_AGO = new Date(NOW - 12 * 60_000).toISOString();
// Strictly past IDLE_WAITING_THRESHOLD_MS (5m), so isIdleWaiting() is true.
const SIX_MIN_AGO = new Date(NOW - 6 * 60_000).toISOString();

function builder(overrides: Partial<OverviewBuilder>): OverviewBuilder {
  return {
    id: 'pir-810',
    issueId: '810',
    issueTitle: 'builder row legibility',
    phase: 'implement',
    protocolPhase: 'implement',
    mode: 'strict',
    gates: {},
    worktreePath: '/tmp/wt',
    roleId: null,
    protocol: 'pir',
    planPhases: [],
    progress: 0,
    blocked: null,
    blockedGate: null,
    blockedSince: null,
    startedAt: null,
    idleMs: 0,
    lastDataAt: null,
    spawnedByArchitect: null,
    area: 'Uncategorized',
    prReady: false,
    ...overrides,
  } as OverviewBuilder;
}

// In stage-grouping mode the group header is the stage, so the row prefix
// carries the complementary axis — the `area/*` label.
describe('builderRowLabel (groupBy: stage → area prefix)', () => {
  it('active builder: area prefix after the icon, before the issue number, no trailing state label', () => {
    const b = builder({
      issueId: '882',
      issueTitle: 'refactor extract',
      area: 'vscode',
    });
    expect(builderRowLabel(b, false, NOW, 'stage')).toBe('[vscode] #882 refactor extract');
  });

  it('phase does NOT appear in the row label (conveyed by the stage group header, #952)', () => {
    // Regression for the axis swap: the row carries the area, not the phase —
    // even though protocolPhase is set, no `[implement]` may leak into the label.
    const b = builder({
      issueId: '1190',
      issueTitle: 'Audit and unify',
      phase: 'phase_0_rebase_onto_ci',
      protocolPhase: 'implement',
      area: 'tower',
    });
    expect(builderRowLabel(b, false, NOW, 'stage')).toBe('[tower] #1190 Audit and unify');
  });

  it('cross-cutting area is echoed verbatim (no shorthand)', () => {
    const b = builder({ issueId: '900', issueTitle: 'multi-area', area: 'cross-cutting' });
    expect(builderRowLabel(b, false, NOW, 'stage')).toBe('[cross-cutting] #900 multi-area');
  });

  it('Uncategorized area: no "[...]" prefix (mirrors the old empty-phase omission)', () => {
    // The default fixture area is `Uncategorized` — a builder whose issue has no
    // `area/*` label. The prefix is omitted rather than rendering `[Uncategorized] `.
    const b = builder({ issueId: '810', issueTitle: 'x' });
    expect(builderRowLabel(b, false, NOW, 'stage')).toBe('#810 x');
  });

  it('blocked builder: area prefix + trailing "blocked on <label> [<elapsed>]"', () => {
    const b = builder({
      issueId: '791',
      issueTitle: 'Startup preflight',
      area: 'core',
      blocked: 'plan review',
      blockedSince: TWELVE_MIN_AGO,
    });
    // isIdle is false: blocked takes precedence (caller computes !isBlocked && ...).
    expect(builderRowLabel(b, false, NOW, 'stage')).toBe(
      '[core] #791 Startup preflight blocked on plan review [12m]',
    );
  });

  it('idle builder: area prefix + trailing "waiting on input [<elapsed> silent]"', () => {
    const b = builder({
      issueId: '794',
      issueTitle: 'Notification refactor',
      area: 'vscode',
      blocked: null,
      lastDataAt: SIX_MIN_AGO,
    });
    expect(builderRowLabel(b, true, NOW, 'stage')).toBe(
      '[vscode] #794 Notification refactor waiting on input [6m silent]',
    );
  });

  it('falls back to id when issueId/issueTitle are null', () => {
    const b = builder({ id: 'pir-999', issueId: null, issueTitle: null, area: 'vscode' });
    expect(builderRowLabel(b, false, NOW, 'stage')).toBe('[vscode] #pir-999 ');
  });
});

// In area-grouping mode the group header is the area, so the row prefix flips
// to the complementary axis — the coarse protocolPhase (the original #810 form).
describe('builderRowLabel (groupBy: area → phase prefix)', () => {
  it('active builder: phase prefix, area does NOT appear in the row', () => {
    const b = builder({ issueId: '882', issueTitle: 'refactor extract', protocolPhase: 'implement', area: 'vscode' });
    expect(builderRowLabel(b, false, NOW, 'area')).toBe('[implement] #882 refactor extract');
  });

  it('renders the coarse protocolPhase, NOT the collapsed sub-phase id in `phase`', () => {
    const b = builder({
      issueId: '1190',
      issueTitle: 'Audit and unify',
      phase: 'phase_0_rebase_onto_ci',
      protocolPhase: 'implement',
      area: 'tower',
    });
    expect(builderRowLabel(b, false, NOW, 'area')).toBe('[implement] #1190 Audit and unify');
  });

  it('empty protocolPhase: no "[] " literal prefix', () => {
    const b = builder({ issueId: '810', issueTitle: 'x', protocolPhase: '', area: 'vscode' });
    expect(builderRowLabel(b, false, NOW, 'area')).toBe('#810 x');
  });

  it('blocked builder: phase prefix + trailing state label', () => {
    const b = builder({
      issueId: '791',
      issueTitle: 'Startup preflight',
      protocolPhase: 'plan',
      area: 'core',
      blocked: 'plan review',
      blockedSince: TWELVE_MIN_AGO,
    });
    expect(builderRowLabel(b, false, NOW, 'area')).toBe(
      '[plan] #791 Startup preflight blocked on plan review [12m]',
    );
  });
});

describe('gateIconFor', () => {
  it('maps each canonical gate name to its codicon', () => {
    expect(gateIconFor('spec-approval')).toBe('book');
    expect(gateIconFor('plan-approval')).toBe('checklist');
    expect(gateIconFor('dev-approval')).toBe('code');
    expect(gateIconFor('pr')).toBe('git-pull-request');
    expect(gateIconFor('verify-approval')).toBe('verified');
  });

  it('falls back to bell for unknown / future gates', () => {
    expect(gateIconFor('some-future-gate')).toBe('bell');
  });

  it('falls back to bell when not blocked (null gate)', () => {
    expect(gateIconFor(null)).toBe('bell');
  });

  it('regression: keys off the canonical gate name, NOT the human-readable label', () => {
    // `b.blocked` holds "plan review"; `b.blockedGate` holds "plan-approval".
    // Passing the label must NOT match the map — guards against reverting to
    // keying the icon off `b.blocked` (which would no-op the whole feature).
    expect(gateIconFor('plan review')).toBe('bell');
    expect(gateIconFor('dev review')).toBe('bell');
    expect(gateIconFor('PR review')).toBe('bell');
  });
});

describe('rollupGroupState', () => {
  const blockedBuilder = () => builder({ blocked: 'plan review', blockedGate: 'plan-approval' });
  const idleBuilder = () => builder({ blocked: null, lastDataAt: SIX_MIN_AGO });
  const activeBuilder = () => builder({ blocked: null, lastDataAt: TWELVE_MIN_AGO, phase: 'verified' });

  it('all active → only the active count', () => {
    // `verified` phase makes isIdleWaiting false regardless of silence.
    const state = rollupGroupState([activeBuilder(), activeBuilder(), activeBuilder()], NOW);
    expect(state).toEqual({ blocked: 0, idle: 0, active: 3 });
  });

  it('one idle among actives → idle counted (idle beats active in the worst-of)', () => {
    const state = rollupGroupState([activeBuilder(), idleBuilder(), activeBuilder()], NOW);
    expect(state).toEqual({ blocked: 0, idle: 1, active: 2 });
  });

  it('one blocked → blocked counted (blocked beats idle + active)', () => {
    const state = rollupGroupState([activeBuilder(), idleBuilder(), blockedBuilder()], NOW);
    expect(state).toEqual({ blocked: 1, idle: 1, active: 1 });
  });

  it('blocked takes precedence over idle for the SAME builder', () => {
    // A builder that is both blocked AND silent past the threshold counts as
    // blocked only — mirrors the row classification (`!isBlocked && isIdle`).
    const both = builder({ blocked: 'plan review', blockedGate: 'plan-approval', lastDataAt: SIX_MIN_AGO });
    expect(rollupGroupState([both], NOW)).toEqual({ blocked: 1, idle: 0, active: 0 });
  });

  it('empty group → all zero', () => {
    expect(rollupGroupState([], NOW)).toEqual({ blocked: 0, idle: 0, active: 0 });
  });
});

describe('worstBuilderState', () => {
  it('blocked beats everything', () => {
    expect(worstBuilderState({ blocked: 1, idle: 5, active: 9 })).toBe('blocked');
  });

  it('idle beats active when nothing blocked', () => {
    expect(worstBuilderState({ blocked: 0, idle: 1, active: 9 })).toBe('idle');
  });

  it('active when nothing blocked or idle', () => {
    expect(worstBuilderState({ blocked: 0, idle: 0, active: 3 })).toBe('active');
  });

  it('all-zero (empty group) → active', () => {
    expect(worstBuilderState({ blocked: 0, idle: 0, active: 0 })).toBe('active');
  });
});
