/**
 * Unit tests for `parseIssueId` — the pure input normalizer behind
 * `codev.openIssueById`. `open-issue-by-id.ts` imports `vscode` at module load,
 * so we stub it (the established pattern from command-relay.test.ts); the parser
 * itself touches no `vscode` API.
 */

import { describe, it, expect, vi } from 'vitest';

vi.mock('vscode', () => ({
  window: { showInputBox: vi.fn() },
  commands: { executeCommand: vi.fn() },
}));

const { parseIssueId } = await import('../commands/open-issue-by-id.js');

describe('parseIssueId', () => {
  it('accepts a bare numeric id', () => {
    expect(parseIssueId('1234')).toBe('1234');
  });

  it('accepts a single leading hash', () => {
    expect(parseIssueId('#1234')).toBe('1234');
  });

  it('trims surrounding whitespace', () => {
    expect(parseIssueId('  1234  ')).toBe('1234');
    expect(parseIssueId(' #1234 ')).toBe('1234');
  });

  it('preserves leading zeros as typed (normalization is the forge\'s job)', () => {
    expect(parseIssueId('007')).toBe('007');
  });

  it('rejects empty / whitespace-only input', () => {
    expect(parseIssueId('')).toBeUndefined();
    expect(parseIssueId('   ')).toBeUndefined();
  });

  it('rejects a lone hash', () => {
    expect(parseIssueId('#')).toBeUndefined();
    expect(parseIssueId(' # ')).toBeUndefined();
  });

  it('rejects non-numeric input', () => {
    expect(parseIssueId('abc')).toBeUndefined();
    expect(parseIssueId('12a3')).toBeUndefined();
    expect(parseIssueId('12.3')).toBeUndefined();
    expect(parseIssueId('-5')).toBeUndefined();
  });

  it('rejects more than one leading hash', () => {
    expect(parseIssueId('##12')).toBeUndefined();
    expect(parseIssueId('#12#')).toBeUndefined();
  });
});
