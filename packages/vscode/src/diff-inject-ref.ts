/**
 * Pure helpers for the "Forward to Builder" CodeLens actions in the
 * `codev.viewDiff` editor (issue #789). No `vscode` import — same precedent
 * as `architect-reference-injection.ts`, so the parsing/string logic is
 * unit-tested directly without mocking the editor API.
 *
 * The provider (`diff-inject-codelens.ts`) is thin glue over these: it turns
 * `LensDescriptor`s into `vscode.CodeLens` objects and wires the inject
 * command. All the line-math and ref-string logic lives here.
 */

/**
 * New-side line numbers of one diff hunk (1-based, inclusive).
 *
 * `newStart`/`newEnd` are the hunk header's full new-side span (context
 * included — what `@@ … +c,d @@` reports). `changeStart`/`changeEnd` are the
 * first and last lines that are *actually added* on the new side (the `+`
 * lines), so a lens anchored there sits on the real change rather than on the
 * up-to-3 lines of leading context git emits with `--unified=3`. For a
 * pure-deletion hunk (no `+` lines) both change fields collapse to `newStart`.
 */
export interface HunkRange {
  newStart: number;
  newEnd: number;
  changeStart: number;
  changeEnd: number;
}

/**
 * Editor-agnostic description of one CodeLens to render: the 0-based line to
 * anchor it on, the label, and the text to inject into the builder prompt.
 */
export interface LensDescriptor {
  /** 0-based anchor line (the provider clamps to the document bounds). */
  line: number;
  title: string;
  /** Text typed into the builder terminal — always ends with a space, no Enter. */
  refText: string;
}

const HUNK_HEADER = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/;

/**
 * Parse the `@@ -a,b +c,d @@` hunk headers from a single file's unified diff
 * and return each hunk's new-side line range.
 *
 * - New-side length is `d` (absent → 1, matching git's shorthand for a
 *   single added/changed line).
 * - A pure-deletion hunk (`+c,0`) has no new-side lines; we clamp it to a
 *   single anchor at `c` (or line 1 if `c` is 0) so a click still references
 *   a sane location near the change.
 */
export function parseHunkRanges(patch: string): HunkRange[] {
  const lines = patch.split('\n');
  const ranges: HunkRange[] = [];
  for (let i = 0; i < lines.length; i++) {
    const m = HUNK_HEADER.exec(lines[i]!);
    if (!m) { continue; }
    const newStart = Number(m[1]);
    const len = m[2] === undefined ? 1 : Number(m[2]);
    const newEnd = len <= 0 ? Math.max(newStart, 1) : newStart + len - 1;

    // Walk the hunk body to find the first/last lines actually added on the
    // new side. `cur` tracks the new-side line number: context (' ') and
    // additions ('+') advance it; deletions ('-') are old-side only; the
    // "\ No newline at end of file" marker advances nothing.
    let cur = newStart;
    let firstChange = -1;
    let lastChange = -1;
    for (let j = i + 1; j < lines.length; j++) {
      const l = lines[j]!;
      if (HUNK_HEADER.test(l) || l.startsWith('diff --git')) { break; }
      if (l.startsWith('\\')) { continue; }
      if (l.startsWith('+')) {
        if (firstChange === -1) { firstChange = cur; }
        lastChange = cur;
        cur++;
      } else if (l.startsWith('-')) {
        // old-side only — does not advance the new-side counter
      } else {
        cur++; // context line
      }
    }

    const changeStart = firstChange === -1 ? Math.max(newStart, 1) : firstChange;
    const changeEnd = lastChange === -1 ? changeStart : lastChange;
    ranges.push({
      newStart: len <= 0 ? Math.max(newStart, 1) : newStart,
      newEnd,
      changeStart,
      changeEnd,
    });
  }
  return ranges;
}

/**
 * Split a multi-file unified diff (`git diff -M --unified=N <ref>`) into a
 * map from each file's **new** path to its hunk ranges. The new path is read
 * from the `+++ b/<path>` line (the canonical new-side path, correct for
 * renames); files whose new side is `/dev/null` (deletions) are omitted —
 * they have no right-side document to host a lens.
 */
export function parseUnifiedDiff(patch: string): Map<string, HunkRange[]> {
  const out = new Map<string, HunkRange[]>();
  // Split on the per-file boundary; the first chunk before any `diff --git`
  // is empty/preamble and parses to no path, so it's harmless.
  const sections = patch.split(/^diff --git .*$/m).slice(1);
  // `split` drops the delimiter lines, but the `+++`/`@@` lines we need live
  // in the body after each boundary, so re-walk the raw text per section.
  for (const section of sections) {
    const newPath = newPathFromSection(section);
    if (!newPath) { continue; }
    out.set(newPath, parseHunkRanges(section));
  }
  return out;
}

/** Extract the new-side path from a single file section's `+++ b/<path>` line. */
function newPathFromSection(section: string): string | null {
  for (const line of section.split('\n')) {
    if (!line.startsWith('+++ ')) { continue; }
    const target = line.slice(4).trim();
    if (target === '/dev/null') { return null; }
    // Strip the conventional `b/` prefix git prepends to the new path.
    return target.startsWith('b/') ? target.slice(2) : target;
  }
  return null;
}

/** Text injected by the file-level lens: `<repo-relative-path> ` (no Enter). */
export function buildBuilderFileRef(relPath: string): string {
  return `${relPath} `;
}

/** Text injected by a hunk lens: `<repo-relative-path>:L<start>-L<end> ` (no Enter). */
export function buildBuilderHunkRef(relPath: string, start: number, end: number): string {
  return `${relPath}:L${start}-L${end} `;
}

/**
 * Build the full set of lens descriptors for one changed file: a file-level
 * lens at the top, plus one lens per hunk anchored at the hunk's new-side
 * start line (converted to 0-based).
 */
export function buildLensDescriptors(relPath: string, hunks: HunkRange[]): LensDescriptor[] {
  const lenses: LensDescriptor[] = [
    { line: 0, title: 'Forward to Builder', refText: buildBuilderFileRef(relPath) },
  ];
  for (const h of hunks) {
    // Anchor and label on the first/last *changed* new-side lines, not the
    // hunk header's context-inclusive span — so the lens sits on the real edit
    // (e.g. inside the right function) rather than on the up-to-3 leading
    // context lines git emits with --unified=3.
    const line = Math.max(h.changeStart - 1, 0);
    // The file-level lens already occupies line 0. A hunk that anchors there —
    // a newly-added file (one whole-file hunk from line 1) or a change to the
    // very first line — would stack a second "Forward to Builder" on the same
    // line. Skip it; the file-level lens covers that spot.
    if (line === 0) { continue; }
    lenses.push({
      line,
      title: `Forward to Builder (lines ${h.changeStart}-${h.changeEnd})`,
      refText: buildBuilderHunkRef(relPath, h.changeStart, h.changeEnd),
    });
  }
  return lenses;
}
