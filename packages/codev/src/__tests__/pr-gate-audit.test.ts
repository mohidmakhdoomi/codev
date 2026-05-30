/**
 * Tests for the PR-gate audit (#943).
 *
 * Verifies that PR-producing protocol overrides missing a `pr` gate are flagged,
 * and correctly-gated / unparseable / absent protocols are not.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { tmpdir } from 'node:os';
import { auditPrGates, formatPrGateWarning, PR_PRODUCING_PROTOCOLS } from '../lib/pr-gate-audit.js';

/** Write a tier-2 protocol override (codev/protocols/<name>/protocol.json). */
function writeOverride(root: string, name: string, json: unknown): void {
  const dir = path.join(root, 'codev', 'protocols', name);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'protocol.json'), JSON.stringify(json, null, 2));
}

const gatelessBugfix = {
  name: 'bugfix',
  phases: [
    { id: 'investigate' },
    { id: 'fix' },
    { id: 'pr', steps: ['create_pr', 'link_issue'] }, // create_pr but NO `pr` gate
  ],
};

const gatedBugfix = {
  name: 'bugfix',
  phases: [
    { id: 'investigate' },
    { id: 'fix' },
    { id: 'pr', gate: 'pr', steps: ['create_pr', 'link_issue'] },
  ],
};

describe('pr-gate-audit', () => {
  let baseDir: string;

  beforeEach(() => {
    baseDir = fs.mkdtempSync(path.join(tmpdir(), 'pr-gate-audit-'));
    // A bare codev/ dir so findWorkspaceRoot anchors here even if not passed.
    fs.mkdirSync(path.join(baseDir, 'codev'), { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(baseDir, { recursive: true, force: true });
  });

  it('flags a gateless bugfix override', () => {
    writeOverride(baseDir, 'bugfix', gatelessBugfix);

    const warnings = auditPrGates(baseDir);
    const bugfix = warnings.find(w => w.protocol === 'bugfix');

    expect(bugfix).toBeDefined();
    expect(bugfix!.source).toBe('override');
    expect(bugfix!.displayPath).toBe(path.join('codev', 'protocols', 'bugfix', 'protocol.json'));
  });

  it('does not flag a correctly pr-gated override', () => {
    writeOverride(baseDir, 'bugfix', gatedBugfix);

    const warnings = auditPrGates(baseDir);
    expect(warnings.find(w => w.protocol === 'bugfix')).toBeUndefined();
  });

  it('recognizes the object gate form ({ name: "pr" })', () => {
    writeOverride(baseDir, 'air', {
      name: 'air',
      phases: [
        { id: 'implement' },
        { id: 'pr', gate: { name: 'pr', next: null } },
      ],
    });

    const warnings = auditPrGates(baseDir);
    expect(warnings.find(w => w.protocol === 'air')).toBeUndefined();
  });

  it('skips an unparseable override rather than crashing', () => {
    const dir = path.join(baseDir, 'codev', 'protocols', 'spir');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'protocol.json'), '{ this is not json');

    expect(() => auditPrGates(baseDir)).not.toThrow();
    const warnings = auditPrGates(baseDir);
    expect(warnings.find(w => w.protocol === 'spir')).toBeUndefined();
  });

  it('returns empty when no PR-producing protocols are overridden', () => {
    // No codev/protocols/ overrides at all; bundled protocols resolve from the
    // (always-gated) package skeleton or not at all — either way, no warning.
    const warnings = auditPrGates(baseDir);
    expect(warnings).toEqual([]);
  });

  it('flags multiple offending overrides independently', () => {
    writeOverride(baseDir, 'bugfix', gatelessBugfix);
    writeOverride(baseDir, 'pir', {
      name: 'pir',
      phases: [{ id: 'plan' }, { id: 'implement' }, { id: 'review' }],
    });

    const warnings = auditPrGates(baseDir);
    const names = warnings.map(w => w.protocol).sort();
    expect(names).toContain('bugfix');
    expect(names).toContain('pir');
  });

  it('only audits the bundled PR-producing set', () => {
    expect([...PR_PRODUCING_PROTOCOLS].sort()).toEqual(['air', 'aspir', 'bugfix', 'pir', 'spir']);
    // experiment / maintain are intentionally excluded.
    expect(PR_PRODUCING_PROTOCOLS).not.toContain('experiment' as never);
    expect(PR_PRODUCING_PROTOCOLS).not.toContain('maintain' as never);
  });

  describe('formatPrGateWarning', () => {
    it('produces a loud, actionable message naming the protocol and fix', () => {
      writeOverride(baseDir, 'bugfix', gatelessBugfix);
      const [warning] = auditPrGates(baseDir);
      const msg = formatPrGateWarning(warning);

      expect(msg).toContain('Protocol `bugfix`');
      expect(msg).toContain('local override at');
      expect(msg).toContain('no `pr` gate');
      expect(msg).toContain('Needs Attention');
      expect(msg).toContain('"gate": "pr"');
    });
  });
});
