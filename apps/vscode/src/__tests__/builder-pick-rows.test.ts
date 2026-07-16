/**
 * Unit tests for the shared builder Quick Pick row-builder (Issue #925).
 *
 * The two outlier pickers (Open Builder Terminal, Send Message) used to render
 * the bare internal builder name because they read `getWorkspaceState`
 * (`Builder`, no `issueId`/`issueTitle`). `buildBuilderPickRows` joins the
 * overview (display fields) to the workspace builders (terminalId / canonical
 * id) so both can render `#<id> <title>` like the seven correct pickers.
 */

import { describe, it, expect } from 'vitest';
import {
  buildBuilderPickRows,
  type OverviewBuilderRow,
  type WorkspaceBuilderRow,
} from '../builder-pick-rows.js';

const ov = (o: Partial<OverviewBuilderRow> & { id: string }): OverviewBuilderRow => ({
  issueId: null,
  issueTitle: null,
  phase: 'implement',
  ...o,
});

const ws = (w: Partial<WorkspaceBuilderRow> & { id: string }): WorkspaceBuilderRow => ({
  name: w.id,
  ...w,
});

describe('buildBuilderPickRows', () => {
  it('formats a joined row as "#<issueId> <issueTitle>" with phase as description', () => {
    const rows = buildBuilderPickRows(
      [ov({ id: 'pir-925', issueId: '925', issueTitle: 'fix the picker', phase: 'review' })],
      [ws({ id: 'builder-pir-925', name: 'pir-925', terminalId: 'term-1' })],
    );
    expect(rows).toEqual([
      {
        label: '#925 fix the picker',
        description: 'review',
        id: 'builder-pir-925',
        name: 'pir-925',
        terminalId: 'term-1',
      },
    ]);
  });

  it('joins despite differing id shapes via resolveAgentName tail-match', () => {
    // overview id `pir-925` must match workspace id `builder-pir-925`
    const rows = buildBuilderPickRows(
      [ov({ id: 'pir-925', issueId: '925', issueTitle: 'x' })],
      [ws({ id: 'builder-pir-925', name: 'pir-925', terminalId: 't' })],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].id).toBe('builder-pir-925');
  });

  it('falls back to "#<id>" when issueId is missing (degenerate state)', () => {
    const rows = buildBuilderPickRows(
      [ov({ id: 'pir-925', issueId: null, issueTitle: null })],
      [ws({ id: 'builder-pir-925', name: 'pir-925', terminalId: 't' })],
    );
    expect(rows[0].label).toBe('#pir-925 ');
  });

  it('excludes builders whose joined workspace builder has no terminal', () => {
    const rows = buildBuilderPickRows(
      [ov({ id: 'pir-925', issueId: '925', issueTitle: 'x' })],
      [ws({ id: 'builder-pir-925', name: 'pir-925' })], // no terminalId
    );
    expect(rows).toEqual([]);
  });

  it('excludes builders with no matching workspace builder', () => {
    const rows = buildBuilderPickRows(
      [ov({ id: 'pir-925', issueId: '925', issueTitle: 'x' })],
      [ws({ id: 'builder-pir-111', name: 'pir-111', terminalId: 't' })],
    );
    expect(rows).toEqual([]);
  });

  it('keeps only the actionable subset across a mixed list', () => {
    const rows = buildBuilderPickRows(
      [
        ov({ id: 'pir-1', issueId: '1', issueTitle: 'one' }),
        ov({ id: 'pir-2', issueId: '2', issueTitle: 'two' }), // no terminal
        ov({ id: 'pir-3', issueId: '3', issueTitle: 'three' }), // no match
      ],
      [
        ws({ id: 'builder-pir-1', name: 'pir-1', terminalId: 't1' }),
        ws({ id: 'builder-pir-2', name: 'pir-2' }),
      ],
    );
    expect(rows.map(r => r.label)).toEqual(['#1 one']);
  });
});
