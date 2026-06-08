/**
 * Tests for issue #1011 — framework-file delivery via resolver-aware channels.
 *
 * Two concerns:
 *  1. The `auditFrameworkRefs` lib (Layer 3 regression guard) flags shell-fetch
 *     violations and ignores legitimate references.
 *  2. The skeleton sweep + template embeds (Layers 1/2 / Patch 2) actually
 *     landed: builder-prompts no longer point at protocol.md, the cat example
 *     and workflow-reference pointer are gone, the redundant plan-template
 *     pointers are dropped, and the embedded templates byte-match canonical.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { fileURLToPath } from 'node:url';
import { dirname, resolve, join } from 'node:path';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { auditFrameworkRefs } from '../lib/framework-ref-audit.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
// src/__tests__ → repo root is four levels up.
const REPO_ROOT = resolve(__dirname, '../../../..');
const SKELETON = join(REPO_ROOT, 'codev-skeleton');

describe('auditFrameworkRefs (issue #1011 Layer 3)', () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'fw-ref-audit-'));
    mkdirSync(join(dir, 'protocols', 'demo'), { recursive: true });
    mkdirSync(join(dir, 'roles'), { recursive: true });
    mkdirSync(join(dir, 'resources'), { recursive: true });
  });

  it('flags a shell cat of a framework file by literal path', () => {
    writeFileSync(join(dir, 'protocols', 'demo', 'protocol.md'),
      '# Demo\n\ncat codev/protocols/demo/protocol.md\n');
    const findings = auditFrameworkRefs(dir);
    expect(findings).toHaveLength(1);
    expect(findings[0].file).toContain('protocol.md');
    expect(findings[0].line).toBe(3);
  });

  it('flags a shell cp of a framework template by literal path', () => {
    writeFileSync(join(dir, 'protocols', 'demo', 'protocol.md'),
      'cp codev/protocols/demo/templates/notes.md notes.md\n');
    expect(auditFrameworkRefs(dir)).toHaveLength(1);
  });

  it('does NOT flag documentation references or user-file paths', () => {
    writeFileSync(join(dir, 'protocols', 'demo', 'protocol.md'),
      [
        'See `codev/protocols/demo/protocol.md` for details.',          // backtick doc ref
        'Update `codev/resources/arch.md` after the change.',           // user file
        'git add codev/resources/lessons-learned.md',                   // user file write
        'Follow the DEMO protocol.',                                    // swept form
      ].join('\n') + '\n');
    expect(auditFrameworkRefs(dir)).toHaveLength(0);
  });

  it('does NOT scan codev/resources (mixed framework + user files)', () => {
    writeFileSync(join(dir, 'resources', 'guide.md'),
      'cat codev/resources/workflow-reference.md\n');
    expect(auditFrameworkRefs(dir)).toHaveLength(0);
  });

  it('the real swept skeleton is clean (no shell-fetch violations)', () => {
    if (!existsSync(SKELETON)) return; // resilient if layout shifts
    expect(auditFrameworkRefs(SKELETON)).toEqual([]);
  });
});

describe('skeleton sweep + embeds (issue #1011 Layers 1/2, Patch 2)', () => {
  const protocols = ['air', 'aspir', 'bugfix', 'experiment', 'maintain', 'pir', 'research', 'spike', 'spir'];

  it('no builder-prompt.md references protocol.md by path', () => {
    for (const p of protocols) {
      const f = join(SKELETON, 'protocols', p, 'builder-prompt.md');
      if (!existsSync(f)) continue;
      expect(readFileSync(f, 'utf-8')).not.toMatch(/protocol\.md/);
    }
  });

  it('roles/builder.md no longer cats the protocol by path', () => {
    const f = join(SKELETON, 'roles', 'builder.md');
    expect(readFileSync(f, 'utf-8')).not.toMatch(/cat codev\/protocols\//);
  });

  it('spir/protocol.md no longer points at workflow-reference.md (A.3)', () => {
    const f = join(SKELETON, 'protocols', 'spir', 'protocol.md');
    expect(readFileSync(f, 'utf-8')).not.toMatch(/workflow-reference\.md/);
  });

  it('spir/aspir plan prompts drop the redundant template pointer but keep Plan Structure', () => {
    for (const p of ['spir', 'aspir']) {
      const md = readFileSync(join(SKELETON, 'protocols', p, 'prompts', 'plan.md'), 'utf-8');
      expect(md).not.toMatch(/codev\/protocols\/spir\/templates\/plan\.md/);
      expect(md).toContain('### Plan Structure');
    }
  });

  it('experiment/spike embed the canonical template verbatim (drift guard)', () => {
    const cases = [
      { protocol: 'experiment', tmpl: 'notes.md' },
      { protocol: 'spike', tmpl: 'findings.md' },
    ];
    for (const { protocol, tmpl } of cases) {
      const md = readFileSync(join(SKELETON, 'protocols', protocol, 'protocol.md'), 'utf-8');
      const canonical = readFileSync(join(SKELETON, 'protocols', protocol, 'templates', tmpl), 'utf-8');
      expect(md).toContain('## Template: ' + tmpl);
      // The full canonical template must be present verbatim — drift fails here.
      expect(md).toContain(canonical.trimEnd());
    }
  });
});
