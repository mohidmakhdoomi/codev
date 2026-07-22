/**
 * Provider skill drift guard (issue #1196).
 *
 * Claude and Codex need physical trees at their provider-native discovery
 * paths, but those copies must not become independently maintained sources.
 */
import { describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';

const REPO_ROOT = path.resolve(__dirname, '..', '..', '..', '..');

/**
 * Skill directories that intentionally differ between providers.
 *
 * An entry exempts the complete top-level skill directory in both the
 * self-hosted and shipped contexts. Keep this list empty unless a reviewed,
 * provider-specific implementation is genuinely required.
 */
const PROVIDER_SPECIFIC_SKILL_EXCEPTIONS = new Set<string>();

const CONTEXTS = [
  {
    name: 'self-hosted root',
    claude: path.join(REPO_ROOT, '.claude', 'skills'),
    codex: path.join(REPO_ROOT, '.codex', 'skills'),
  },
  {
    name: 'shipped skeleton',
    claude: path.join(REPO_ROOT, 'codev-skeleton', '.claude', 'skills'),
    codex: path.join(REPO_ROOT, 'codev-skeleton', '.codex', 'skills'),
  },
] as const;

function skillNames(root: string): string[] {
  return fs
    .readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
}

function relativeFiles(root: string): string[] {
  const files: string[] = [];

  function visit(directory: string): void {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const absolute = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        visit(absolute);
      } else if (entry.isFile()) {
        files.push(path.relative(root, absolute));
      }
    }
  }

  visit(root);
  return files.sort();
}

describe('Claude/Codex skill parity (issue #1196)', () => {
  for (const context of CONTEXTS) {
    it(`${context.name}: provider skill sets and file bytes match`, () => {
      const claudeSkills = skillNames(context.claude);
      const codexSkills = skillNames(context.codex);
      const includedClaudeSkills = claudeSkills.filter(
        (skill) => !PROVIDER_SPECIFIC_SKILL_EXCEPTIONS.has(skill)
      );
      const includedCodexSkills = codexSkills.filter(
        (skill) => !PROVIDER_SPECIFIC_SKILL_EXCEPTIONS.has(skill)
      );

      expect(includedCodexSkills).toEqual(includedClaudeSkills);

      for (const skill of includedClaudeSkills) {
        const claudeRoot = path.join(context.claude, skill);
        const codexRoot = path.join(context.codex, skill);
        const files = relativeFiles(claudeRoot);

        expect(relativeFiles(codexRoot), `${context.name}/${skill} file list`).toEqual(files);
        for (const relativeFile of files) {
          expect(
            fs.readFileSync(path.join(codexRoot, relativeFile)),
            `${context.name}/${skill}/${relativeFile}`
          ).toEqual(fs.readFileSync(path.join(claudeRoot, relativeFile)));
        }
      }
    });
  }

  it('every provider-specific exception names a real skill', () => {
    const knownSkills = new Set(CONTEXTS.flatMap((context) => [
      ...skillNames(context.claude),
      ...skillNames(context.codex),
    ]));

    for (const exception of PROVIDER_SPECIFIC_SKILL_EXCEPTIONS) {
      expect(knownSkills.has(exception), `stale provider exception: ${exception}`).toBe(true);
    }
  });
});
