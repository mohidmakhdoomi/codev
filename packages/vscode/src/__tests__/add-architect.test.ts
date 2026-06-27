/**
 * Unit tests for the conversational Add Architect helpers (Issue 1104).
 */

import { describe, it, expect } from 'vitest';
import type { ArchitectState } from '@cluesmith/codev-types';
import {
  resolveMainArchitect,
  addArchitectRequestMessage,
  ADD_ARCHITECT_RECIPIENT,
} from '../commands/add-architect.js';

function arch(name: string): ArchitectState {
  return { name, port: 0, pid: 1, terminalId: `t-${name}`, persistent: false };
}

describe('resolveMainArchitect (#1104)', () => {
  it('returns the main architect when present', () => {
    const main = resolveMainArchitect([arch('vscode'), arch('main'), arch('reviewer')]);
    expect(main?.name).toBe('main');
  });

  it('returns undefined when no main session is in the roster', () => {
    expect(resolveMainArchitect([arch('vscode'), arch('reviewer')])).toBeUndefined();
  });

  it('returns undefined for an empty roster', () => {
    expect(resolveMainArchitect([])).toBeUndefined();
  });
});

describe('addArchitectRequestMessage / recipient (#1104)', () => {
  it('addresses main explicitly', () => {
    expect(ADD_ARCHITECT_RECIPIENT).toBe('architect:main');
  });

  it('builds a name-only request message', () => {
    expect(addArchitectRequestMessage('security')).toBe('Please add a security architect.');
  });
});
