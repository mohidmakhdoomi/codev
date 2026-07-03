/**
 * Spec 1134 — `/arch-init` skill-text assertions (spec test scenario 12).
 *
 * The shipped SKILL.md text is the testable artifact (a skill is instructions
 * to an agent, not code). These tests pin the two-tree byte equality and the
 * spec's required/forbidden content:
 *   - identity via `afx whoami` with explicit-arg override + validation rule
 *   - no `ps`/`$PPID` process-ancestry matching (the fragility being replaced)
 *   - no Shannon-specific wording (workspace-agnostic)
 *   - builder-thread exclusion in the missing-state-file flow
 *   - the four architect guardrails
 */

import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';

// Resolve repo root (packages/codev/src/agent-farm/__tests__ -> repo root)
const repoRoot = path.resolve(__dirname, '..', '..', '..', '..', '..');

const SKELETON_SKILL = path.join(repoRoot, 'codev-skeleton', '.claude', 'skills', 'arch-init', 'SKILL.md');
const INSTANCE_SKILL = path.join(repoRoot, '.claude', 'skills', 'arch-init', 'SKILL.md');

describe('Spec 1134 — /arch-init skill ships in both trees', () => {
  it('exists in the skeleton (shipped to adopters) and in our instance', () => {
    expect(fs.existsSync(SKELETON_SKILL)).toBe(true);
    expect(fs.existsSync(INSTANCE_SKILL)).toBe(true);
  });

  it('is byte-identical across the two trees (drift guard)', () => {
    expect(fs.readFileSync(INSTANCE_SKILL, 'utf-8')).toBe(fs.readFileSync(SKELETON_SKILL, 'utf-8'));
  });

  describe('required content', () => {
    const text = () => fs.readFileSync(SKELETON_SKILL, 'utf-8');

    it('resolves identity via afx whoami', () => {
      expect(text()).toContain('afx whoami');
    });

    it('carries the architect-name validation rule (path-traversal guard)', () => {
      expect(text()).toContain('[a-z][a-z0-9-]*');
      expect(text()).toMatch(/64/);
      expect(text()).toContain('..');
    });

    it('excludes builder thread files when listing state files', () => {
      expect(text()).toContain('_thread.md');
    });

    it('handles both whoami identity types and the unknown case', () => {
      expect(text()).toContain('type: architect');
      expect(text()).toContain('type: builder');
      expect(text()).toMatch(/ask the human/i);
    });

    it('reads architect state from codev/state/<name>.md', () => {
      expect(text()).toContain('codev/state/<name>.md');
    });

    it('carries the four architect guardrails', () => {
      const t = text();
      expect(t).toMatch(/never auto-approve porch gates/i);
      expect(t).toMatch(/only your own builders/i);
      expect(t).toMatch(/never `?cd`? into a builder worktree/i);
      expect(t).toMatch(/default branch/i);
    });

    it('never defaults to main', () => {
      expect(text()).toMatch(/do NOT default to `main`/i);
    });
  });

  describe('forbidden content', () => {
    const text = () => fs.readFileSync(SKELETON_SKILL, 'utf-8');

    it('has no ps/$PPID process-ancestry matching (replaced by afx whoami)', () => {
      expect(text()).not.toContain('ps -p');
      expect(text()).not.toContain('$PPID');
      expect(text()).not.toMatch(/ancestry/i);
    });

    it('has no Shannon-specific wording (workspace-agnostic)', () => {
      expect(text()).not.toMatch(/shannon/i);
    });
  });

  it('has the expected skill frontmatter (name + description)', () => {
    const t = fs.readFileSync(SKELETON_SKILL, 'utf-8');
    expect(t).toMatch(/^---\nname: arch-init\n/);
    expect(t).toMatch(/\ndescription: /);
  });
});
