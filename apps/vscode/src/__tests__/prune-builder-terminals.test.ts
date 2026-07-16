/**
 * Unit tests for the present→absent diff helper that drives VSCode
 * builder-terminal-tab auto-close on cleanup (Issue #883).
 *
 * The previous implementation read `client.getWorkspaceState(workspacePath)`
 * and saw the cleaned-up builder forever because surviving shellper
 * processes kept `terminal_sessions` rows alive. The diff now runs against
 * `overviewCache.getData().builders` (worktree disk scan source) which
 * does drop cleaned-up builders, and the helper here is the pure piece
 * that decides which role IDs went present→absent.
 */

import { describe, it, expect } from 'vitest';
import {
  computeBuildersToClose,
  roleIdsFromBuilders,
  type OverviewBuilderLike,
} from '../prune-builder-terminals.js';

describe('computeBuildersToClose', () => {
  it('returns empty on the first tick (prev=null) so freshly-loaded data does not close anything', () => {
    const curr = new Set(['builder-pir-883']);
    expect(computeBuildersToClose(null, curr)).toEqual([]);
  });

  it('returns the role IDs that went present→absent', () => {
    const prev = new Set(['builder-pir-883', 'builder-bugfix-799']);
    const curr = new Set(['builder-pir-883']);
    expect(computeBuildersToClose(prev, curr)).toEqual(['builder-bugfix-799']);
  });

  it('returns multiple role IDs when several builders disappear in the same tick', () => {
    const prev = new Set(['builder-pir-883', 'builder-bugfix-799', 'builder-bugfix-839']);
    const curr = new Set(['builder-pir-883']);
    expect(computeBuildersToClose(prev, curr).sort()).toEqual(
      ['builder-bugfix-799', 'builder-bugfix-839'].sort(),
    );
  });

  it('returns empty when no builders disappear (steady state)', () => {
    const prev = new Set(['builder-pir-883']);
    const curr = new Set(['builder-pir-883']);
    expect(computeBuildersToClose(prev, curr)).toEqual([]);
  });

  it('returns empty when builders are added but none disappear', () => {
    const prev = new Set(['builder-pir-883']);
    const curr = new Set(['builder-pir-883', 'builder-pir-911']);
    expect(computeBuildersToClose(prev, curr)).toEqual([]);
  });

  it('returns all previously-tracked role IDs when curr is empty (last builder cleaned up)', () => {
    const prev = new Set(['builder-pir-883', 'builder-bugfix-799']);
    const curr = new Set<string>();
    expect(computeBuildersToClose(prev, curr).sort()).toEqual(
      ['builder-bugfix-799', 'builder-pir-883'].sort(),
    );
  });
});

describe('roleIdsFromBuilders', () => {
  it('projects strict-mode builders to their canonical role IDs', () => {
    const builders: OverviewBuilderLike[] = [
      { roleId: 'builder-pir-883' },
      { roleId: 'builder-bugfix-799' },
    ];
    expect(roleIdsFromBuilders(builders)).toEqual(
      new Set(['builder-pir-883', 'builder-bugfix-799']),
    );
  });

  it('drops soft-mode builders (roleId=null) — documented known limitation', () => {
    const builders: OverviewBuilderLike[] = [
      { roleId: 'builder-pir-883' },
      { roleId: null }, // soft mode (e.g. task-/worktree- prefix)
    ];
    expect(roleIdsFromBuilders(builders)).toEqual(new Set(['builder-pir-883']));
  });

  it('returns an empty set for an empty builders array', () => {
    expect(roleIdsFromBuilders([])).toEqual(new Set());
  });
});

describe('integration: full diff loop end-to-end', () => {
  // The wiring in extension.ts is: every overview tick, call
  // `roleIdsFromBuilders(data.builders)` then feed it to
  // `computeBuildersToClose(prev, curr)`. This block walks the same
  // sequence to confirm the two helpers compose as expected.

  it('first tick (empty cache) does nothing', () => {
    let prev: Set<string> | null = null;
    const builders: OverviewBuilderLike[] = [{ roleId: 'builder-pir-883' }];
    const curr = roleIdsFromBuilders(builders);
    const closed = computeBuildersToClose(prev, curr);
    expect(closed).toEqual([]);
    prev = curr;
    expect(prev).toEqual(new Set(['builder-pir-883']));
  });

  it('cleanup tick closes the disappearing builder', () => {
    // Tick 1: two active builders → seed prev
    let prev: Set<string> | null = null;
    let curr = roleIdsFromBuilders([
      { roleId: 'builder-pir-883' },
      { roleId: 'builder-bugfix-799' },
    ]);
    computeBuildersToClose(prev, curr); // seed only; result not asserted here
    prev = curr;

    // Tick 2: bugfix-799 is cleaned up → only pir-883 remains in overview
    curr = roleIdsFromBuilders([{ roleId: 'builder-pir-883' }]);
    const closed = computeBuildersToClose(prev, curr);
    expect(closed).toEqual(['builder-bugfix-799']);
  });
});
