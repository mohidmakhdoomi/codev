/**
 * Spec 987 — Phase 2: always-on hot-tier injection into porch phase prompts.
 *
 * buildHotTierContext() is the unit prepended verbatim to every phase prompt by
 * buildPhasePrompt(). These tests verify:
 *  - the hot files are injected verbatim when present in the workspace (tier-2), and
 *  - runtime four-tier fallback: a workspace WITHOUT local hot files still gets the
 *    installed-skeleton copy (so an upgraded-but-not-yet-seeded repo never injects empty).
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { buildHotTierContext } from '../prompts.js';
import { getSkeletonDir } from '../../../lib/skeleton.js';

const HEADER = '# Always-On Engineering Context (hot tier)';

describe('Spec 987 — hot-tier injection (buildHotTierContext)', () => {
  let tmp: string;

  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'hot-tier-inject-'));
  });

  afterEach(() => {
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  function seedInstanceHotFiles(): void {
    const dir = path.join(tmp, 'codev', 'resources');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'arch-critical.md'), '# arch-critical\n\nARCH_HOT_MARKER\n');
    fs.writeFileSync(
      path.join(dir, 'lessons-critical.md'),
      '# lessons-critical\n\nLESSONS_HOT_MARKER\n'
    );
  }

  it('injects both hot files verbatim, framed by the always-on header', () => {
    seedInstanceHotFiles();
    const block = buildHotTierContext(tmp);

    expect(block.startsWith(HEADER)).toBe(true);
    expect(block).toContain('ARCH_HOT_MARKER');
    expect(block).toContain('LESSONS_HOT_MARKER');
    // Ends with a separator so it cleanly precedes the phase-prompt body.
    expect(block.trimEnd().endsWith('---')).toBe(true);
  });

  it('falls back to the installed-skeleton copy when the workspace has no local hot files', () => {
    // No codev/resources/*-critical.md in tmp → resolver must reach tier-4 (skeleton).
    const skeletonArch = path.join(getSkeletonDir(), 'resources', 'arch-critical.md');
    expect(
      fs.existsSync(skeletonArch),
      'skeleton hot files missing — run `pnpm build` (copy-skeleton) first'
    ).toBe(true);

    const block = buildHotTierContext(tmp);
    expect(block.startsWith(HEADER)).toBe(true);
    // The skeleton ships the generic STARTER variant; "STARTER:" appears only there,
    // never in the real instance content — proving fallback resolved the skeleton copy.
    expect(block).toContain('STARTER:');
    expect(block).toContain('Map of arch.md');
    expect(block).toContain('Map of lessons-learned.md');
  });

  it('prefers the local workspace copy over the skeleton (tier precedence)', () => {
    seedInstanceHotFiles();
    const block = buildHotTierContext(tmp);
    // Local copies win, so the skeleton STARTER text must NOT appear.
    expect(block).toContain('ARCH_HOT_MARKER');
    expect(block).not.toContain('STARTER:');
  });
});
