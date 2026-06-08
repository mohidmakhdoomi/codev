/**
 * Audit the package skeleton for resolver-bypassing shell reads of framework
 * files by literal path (issue #1011, Layer 3 — regression guard).
 *
 * The bug class: a builder-side consumer instructs `cat`/`cp` of a framework
 * doc by literal `codev/...` path. Shell commands bypass the four-tier resolver
 * (`resolveCodevFile`), so the read fails in fresh installs where the file
 * lives only in the embedded skeleton. Framework content is delivered to the
 * builder via the spawn prompt and porch JSON instead — never fetched by shell.
 *
 * Scope is deliberately NARROW to avoid false positives (the skeleton is full
 * of legitimate `codev/...` mentions):
 *   - Only shell-fetch verbs (cat/cp/less/more/head/tail/source) reading a
 *     `codev/protocols/...` or `codev/roles/...` path are flagged.
 *   - `codev/resources/` is NOT scanned: it mixes framework docs with
 *     user-evolved files (`arch.md`, `lessons-learned.md`) that builders and
 *     architects reference and write by path legitimately.
 *   - Plain documentation references (backtick mentions, "see codev/…") are
 *     NOT flagged. The rule is about *fetching*, not *referencing* — the
 *     protocol list in CLAUDE.md/AGENTS.md, for example, is intentional.
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';

export interface FrameworkRefFinding {
  /** Path relative to the scanned skeleton dir. */
  file: string;
  line: number;
  /** The offending line, trimmed. */
  text: string;
}

/** Framework subdirectories whose docs ship in the skeleton and resolve via the resolver. */
const FRAMEWORK_DIRS = ['protocols', 'roles'] as const;

/**
 * A shell command that reads/copies a framework file by literal `codev/` path.
 * Matches e.g. `cat codev/protocols/spir/protocol.md`, `cp codev/roles/builder.md x`.
 */
const SHELL_FETCH_RE =
  /(?:^|[\s|;&(])(?:cat|cp|less|more|head|tail|source)\s+codev\/(?:protocols|roles)\/\S+\.md/;

function collectMarkdown(dir: string, out: string[]): void {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) collectMarkdown(full, out);
    else if (entry.isFile() && entry.name.endsWith('.md')) out.push(full);
  }
}

/**
 * Scan `<skeletonDir>/{protocols,roles}` for shell-fetch-by-literal-path
 * violations. Returns one finding per offending line.
 */
export function auditFrameworkRefs(skeletonDir: string): FrameworkRefFinding[] {
  const findings: FrameworkRefFinding[] = [];
  for (const sub of FRAMEWORK_DIRS) {
    const base = join(skeletonDir, sub);
    if (!existsSync(base)) continue;
    const files: string[] = [];
    collectMarkdown(base, files);
    for (const file of files) {
      const lines = readFileSync(file, 'utf-8').split('\n');
      lines.forEach((text, i) => {
        if (SHELL_FETCH_RE.test(text)) {
          findings.push({ file: relative(skeletonDir, file), line: i + 1, text: text.trim() });
        }
      });
    }
  }
  return findings;
}

export function formatFrameworkRefFinding(f: FrameworkRefFinding): string {
  return `${f.file}:${f.line} shell-fetches a framework file by literal path: ${f.text}`;
}
